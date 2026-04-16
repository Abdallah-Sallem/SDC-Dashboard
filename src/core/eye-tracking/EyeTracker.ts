/**
 * EyeTracker.ts
 * Browser-only webcam tracker based on MediaPipe Face Mesh.
 * Emits:
 * - gaze:point (smoothed point stream)
 * - gaze:metrics (heuristic features over a short sliding window)
 */

import { FaceMesh, type NormalizedLandmark, type Results } from '@mediapipe/face_mesh';
import { EventBus } from '../event-bus/EventBus';
import { logger } from '../../shared/logger';
import {
  EYE_TRACKING_CAMERA_OFF_NULL_STREAK,
  EYE_TRACKING_FACE_LOST_TIMEOUT_MS,
  EYE_TRACKING_INTERVAL_MS,
  EYE_TRACKING_INVERT_X,
  EYE_TRACKING_INVERT_Y,
  EYE_TRACKING_MIN_CONFIDENCE,
  EYE_TRACKING_SMOOTHING_WINDOW,
} from '../../shared/constants';
import { clamp } from '../../shared/utils';
import type { GazeMetrics, GazePointData, TrackingLostReason } from '../../shared/types';

interface StartOptions {
  userInitiated?: boolean;
}

interface PermissionResult {
  granted: boolean;
  error: string | null;
}

const METRIC_WINDOW_MS = 1800;
const METRIC_EMIT_INTERVAL_MS = 220;
const BLINK_WINDOW_MS = 60_000;
const BLINK_EAR_THRESHOLD = 0.19;
const BLINK_MIN_MS = 60;
const BLINK_MAX_MS = 420;
const FIXATION_RADIUS_PX = 22;
const REGRESSION_DELTA_PX = 18;
const LINE_SKIP_DELTA_PX = 40;
const HEAD_MOTION_NORMALIZER = 0.025;
const HEAD_COMPENSATION_X = 0.20;
const HEAD_COMPENSATION_Y = 0.24;
const EYE_GAIN_X = 1.05;
const EYE_GAIN_Y = 1.03;
const FAST_MOTION_THRESHOLD_PX = 22;

const LEFT_EAR_POINTS = [33, 159, 158, 133, 153, 145] as const;
const RIGHT_EAR_POINTS = [362, 386, 385, 263, 373, 374] as const;
const LEFT_IRIS_POINTS = [468, 469, 470, 471, 472] as const;
const RIGHT_IRIS_POINTS = [473, 474, 475, 476, 477] as const;

// --- STEP 3: One Euro Filter Implementation ---
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev: number | null = null;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.tPrev === null || this.xPrev === null || this.dxPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = t;
      return x;
    }

    const dt = (t - this.tPrev) / 1000.0; // convert to seconds
    if (dt <= 0) return x;

    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const result = this.xPrev + this.alpha(cutoff, dt) * (x - this.xPrev);

    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = t;
    return result;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
}

export class EyeTracker {
  private readonly sessionId: string;

  private faceMesh: FaceMesh | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;

  private isRunning = false;
  private isPaused = false;
  private isFrameInFlight = false;

  private trackingLostEmitted = false;
  private lastError: string | null = null;

  private rafId: number | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  private lastSampledAt = 0;
  private lastValidPointAt = 0;
  private invalidFrameStreak = 0;

  private smoothingBuffer: GazePointData[] = [];
  private gazeWindow: GazePointData[] = [];
  private frameQualityWindow: { timestamp: number; valid: boolean }[] = [];
  private blinkTimestamps: number[] = [];
  private headStabilityWindow: number[] = [];
  private eyeClosedAt: number | null = null;
  private previousNose: NormalizedLandmark | null = null;
  private baselineNose: NormalizedLandmark | null = null;
  private baselineNoseSamples = 0;

  // --- STEP 3: One Euro Filter Instances ---
  private filterX = new OneEuroFilter(0.8, 0.005, 1.0);
  private filterY = new OneEuroFilter(0.8, 0.005, 1.0);

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async start(options: StartOptions = {}): Promise<boolean> {
    if (this.isRunning) return true;

    if (!options.userInitiated) {
      this.lastError = 'Démarrage bloqué : interaction utilisateur requise';
      logger.warn('EyeTracker', this.lastError);
      return false;
    }

    this.resetRuntimeBuffers();
    this.lastError = null;

    const permission = await this.requestCameraPermission();
    if (!permission.granted) {
      this.lastError = permission.error ?? 'Permission caméra refusée';
      return false;
    }

    if (!this.mediaStream) {
      this.lastError = 'Flux caméra indisponible';
      return false;
    }

    try {
      this.videoEl = await this.createHiddenVideo(this.mediaStream);
      this.faceMesh = await this.createFaceMesh();

      this.isRunning = true;
      this.isPaused = false;
      this.lastValidPointAt = Date.now();

      this.startHealthMonitor();
      this.metricsTimer = setInterval(() => this.emitMetrics(), METRIC_EMIT_INTERVAL_MS);
      this.scheduleFrameLoop();

      logger.info('EyeTracker', 'Tracking démarré (MediaPipe Face Mesh)', {
        sessionId: this.sessionId,
      });
      return true;
    } catch (err) {
      this.lastError = `Erreur démarrage Face Mesh: ${String(err)}`;
      logger.error('EyeTracker', 'Erreur démarrage', { error: String(err) });
      this.stop();
      return false;
    }
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    logger.debug('EyeTracker', 'Tracking en pause');
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;
    this.lastError = null;
    logger.debug('EyeTracker', 'Tracking repris');
  }

  recalibrate(): boolean {
    try {
      this.resetRuntimeBuffers();
      this.faceMesh?.reset();
      if (this.isRunning && this.isPaused) {
        this.resume();
      }
      logger.info('EyeTracker', 'Recalibration déclenchée', { sessionId: this.sessionId });
      return true;
    } catch (err) {
      this.lastError = `Recalibration impossible: ${String(err)}`;
      logger.error('EyeTracker', 'Erreur recalibration', { error: String(err) });
      return false;
    }
  }

  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.isFrameInFlight = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.metricsTimer = null;
    this.healthTimer = null;

    if (this.faceMesh) {
      void this.faceMesh.close();
      this.faceMesh = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.resetRuntimeBuffers();
    logger.info('EyeTracker', 'Tracking arrêté, caméra libérée');
  }

  getStatus(): boolean {
    return this.isRunning && !this.isPaused;
  }

  private async requestCameraPermission(): Promise<PermissionResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'API caméra non disponible sur cet appareil' };
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      logger.info('EyeTracker', 'Permission caméra accordée');
      return { granted: true, error: null };
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError') {
        return { granted: false, error: 'Permission caméra refusée' };
      }
      if (error.name === 'NotFoundError') {
        return { granted: false, error: 'Aucune caméra détectée' };
      }
      if (error.name === 'NotReadableError') {
        return { granted: false, error: 'Caméra occupée ou indisponible' };
      }
      return { granted: false, error: `Erreur caméra: ${error.message}` };
    }
  }

  private createHiddenVideo(stream: MediaStream): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.width = 640;
      video.height = 480;
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      video.style.top = '-9999px';
      video.style.width = '1px';
      video.style.height = '1px';
      video.setAttribute('aria-hidden', 'true');
      video.srcObject = stream;
      document.body.appendChild(video);

      video.onloadedmetadata = () => {
        void video.play().then(() => resolve(video)).catch(reject);
      };

      video.onerror = () => reject(new Error('Impossible de lire le flux vidéo'));
    });
  }

  private async createFaceMesh(): Promise<FaceMesh> {
    const mesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    mesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      selfieMode: true,
    });

    mesh.onResults((results) => this.handleResults(results));
    await mesh.initialize();
    return mesh;
  }

  private scheduleFrameLoop(): void {
    let lastFrameTime = 0;
    const TARGET_FPS = 30;
    const FRAME_MIN_TIME = 1000 / TARGET_FPS;

    const tick = async (currentTime: number): Promise<void> => {
      if (!this.isRunning) return;

      const dt = currentTime - lastFrameTime;

      // --- STEP 7: Limit processing to ~30 FPS ---
      if (!this.isPaused && this.videoEl && this.faceMesh && !this.isFrameInFlight && dt >= FRAME_MIN_TIME) {
        lastFrameTime = currentTime - (dt % FRAME_MIN_TIME);
        this.isFrameInFlight = true;
        try {
          await this.faceMesh.send({ image: this.videoEl });
        } catch (err) {
          logger.warn('EyeTracker', 'Frame processing error', { error: String(err) });
        } finally {
          this.isFrameInFlight = false;
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (!this.isRunning || this.isPaused) return;

      const trackEnded = this.mediaStream?.getVideoTracks().some((track) => track.readyState === 'ended') ?? false;
      if (trackEnded || this.invalidFrameStreak >= EYE_TRACKING_CAMERA_OFF_NULL_STREAK) {
        this.handleTrackingLost('camera_off');
        return;
      }

      if (Date.now() - this.lastValidPointAt > EYE_TRACKING_FACE_LOST_TIMEOUT_MS) {
        this.handleTrackingLost('face_lost');
      }
    }, 450);
  }

  private handleResults(results: Results): void {
    if (!this.isRunning || this.isPaused) return;

    const now = Date.now();
    const landmarks = results.multiFaceLandmarks?.[0] ?? null;

    this.frameQualityWindow.push({ timestamp: now, valid: Boolean(landmarks) });
    this.trimQualityWindow(now);

    if (!landmarks) {
      this.invalidFrameStreak++;
      return;
    }

    const blinkRate = this.updateBlinkRate(landmarks, now);
    const headStability = this.updateHeadStability(landmarks);
    this.updateHeadBaseline(landmarks, headStability);
    const rawPoint = this.estimateGazePoint(landmarks, now, headStability);

    if (!rawPoint || rawPoint.confidence < EYE_TRACKING_MIN_CONFIDENCE) {
      this.invalidFrameStreak++;
      return;
    }

    this.invalidFrameStreak = 0;
    this.lastValidPointAt = now;
    this.trackingLostEmitted = false;

    const smoothed = this.smoothPoint(rawPoint);
    this.gazeWindow.push(smoothed);
    this.trimGazeWindow(now);

    if (now - this.lastSampledAt >= EYE_TRACKING_INTERVAL_MS) {
      this.lastSampledAt = now;
      EventBus.emit(
        'gaze:point',
        {
          ...smoothed,
          blinkRate,
          headStability,
          trackingLossRate: this.computeTrackingLossRate(),
          fixationInstability: this.computeFixationInstability(),
        },
        this.sessionId
      );
    }
  }

  private emitMetrics(): void {
    if (!this.isRunning || this.isPaused) return;
    const now = Date.now();
    this.trimGazeWindow(now);

    const points = this.gazeWindow;
    if (points.length < 3) return;

    let longestFixation = 0;
    let regressionCount = 0;
    let lineSkips = 0;
    let totalDisplacement = 0;

    // --- STEP 6: Refactor Metrics Layer ---
    
    // 1. Dispersion-based Fixation Detection
    // Check if points stay within radius R for time T
    const FIXATION_DISPERSION_RADIUS = 30; // px
    let currentFixationStart = points[0].timestamp;
    let currentFixationCentroid = { x: points[0].x, y: points[0].y };
    let currentFixationCount = 1;

    for (let i = 1; i < points.length; i++) {
        const curr = points[i];
        const prev = points[i - 1];
        const dt = Math.max(1, curr.timestamp - prev.timestamp);
        
        const dxFromCentroid = curr.x - currentFixationCentroid.x;
        const dyFromCentroid = curr.y - currentFixationCentroid.y;
        const distFromCentroid = Math.hypot(dxFromCentroid, dyFromCentroid);

        totalDisplacement += Math.hypot(curr.x - prev.x, curr.y - prev.y);

        if (distFromCentroid <= FIXATION_DISPERSION_RADIUS) {
            // Update centroid
            currentFixationCentroid.x = (currentFixationCentroid.x * currentFixationCount + curr.x) / (currentFixationCount + 1);
            currentFixationCentroid.y = (currentFixationCentroid.y * currentFixationCount + curr.y) / (currentFixationCount + 1);
            currentFixationCount++;
            
            const currentDuration = curr.timestamp - currentFixationStart;
            longestFixation = Math.max(longestFixation, currentDuration);
        } else {
            currentFixationStart = curr.timestamp;
            currentFixationCentroid = { x: curr.x, y: curr.y };
            currentFixationCount = 1;
        }
    }

    // 2. Direction Reversal Regression Detection
    let isMovingRight = true;
    let leftwardMovementDuration = 0;
    const REGRESSION_REVERSAL_MS_THRESHOLD = 150; // Need to move backwards for > 150ms to count as a regression

    for (let i = 1; i < points.length; i++) {
        const curr = points[i];
        const prev = points[i - 1];
        const dx = curr.x - prev.x;
        const dt = Math.max(1, curr.timestamp - prev.timestamp);

        if (dx > 2) {
            // Moving forward (right)
            isMovingRight = true;
            leftwardMovementDuration = 0;
        } else if (dx < -2) {
            // Moving backward (left)
            if (isMovingRight) {
                // Just turned left
                isMovingRight = false;
                leftwardMovementDuration = dt;
            } else {
                leftwardMovementDuration += dt;
                // Only count regression if the streak is long enough (prevents counting jitter)
                if (leftwardMovementDuration > REGRESSION_REVERSAL_MS_THRESHOLD && leftwardMovementDuration - dt <= REGRESSION_REVERSAL_MS_THRESHOLD) {
                    regressionCount++;
                }
            }
        }
    }

    // 3. Line Skip Detection (Y-axis grouping / clustering)
    const Y_BAND_HEIGHT = 45; // Approximate line height in pixels
    let prevBandIndex: number | null = null;
    let timeInCurrentBand = 0;
    const METRIC_BAND_STABLE_MS = 120; // Need to dwell out of band to consider it a real shift

    for (let i = 1; i < points.length; i++) {
        const curr = points[i];
        const prev = points[i - 1];
        const dt = Math.max(1, curr.timestamp - prev.timestamp);
        const currentBandIdx = Math.floor(curr.y / Y_BAND_HEIGHT);

        if (prevBandIndex === null) {
            prevBandIndex = currentBandIdx;
            continue;
        }

        if (currentBandIdx === prevBandIndex) {
            // Stable in band
            timeInCurrentBand += dt;
        } else {
            // Moved to a different band
            const bandDiff = Math.abs(currentBandIdx - prevBandIndex);
            
            if (bandDiff > 1 && timeInCurrentBand > METRIC_BAND_STABLE_MS) {
                // If it's a large jump (>1 band difference) and we were previously stable
                lineSkips++;
                timeInCurrentBand = 0;
                prevBandIndex = currentBandIdx;
            } else if (timeInCurrentBand > METRIC_BAND_STABLE_MS / 2) {
                // Just moving down/up normally or small jump without counting lineSkip, update band
                timeInCurrentBand = 0;
                prevBandIndex = currentBandIdx;
            }
        }
    }

    const duration = Math.max(1, points[points.length - 1].timestamp - points[0].timestamp);

    const metrics: GazeMetrics = {
      saccadeSpeed: totalDisplacement / duration,
      fixationDuration: longestFixation,
      regressionCount,
      blinkRate: this.computeBlinkRate(now),
      lineSkipRate: lineSkips / Math.max(1, points.length - 1),
      fixationInstability: this.computeFixationInstability(),
      headStability: this.getAverageHeadStability(),
      trackingLossRate: this.computeTrackingLossRate(),
      timestamp: now,
    };

    EventBus.emit('gaze:metrics', metrics, this.sessionId);
  }

  private lastStablePoint: { x: number; y: number } | null = null;
  private lastFinalPoint: { x: number; y: number } | null = null;
  private lastFinalTime: number | null = null;
  private readonly CONFIDENCE_THRESHOLD = 0.45;

  private smoothPoint(point: GazePointData): GazePointData {
    // --- STEP 4: Confidence-Based Filtering ---
    let blendedX = point.x;
    let blendedY = point.y;

    if (this.lastStablePoint) {
      if (point.confidence < this.CONFIDENCE_THRESHOLD) {
        // Discard frame effectively by reusing the last stable point
        blendedX = this.lastStablePoint.x;
        blendedY = this.lastStablePoint.y;
      } else {
        // Blend using lerp
        // Lerp factor depends on confidence: higher confidence -> closer to current point
        const alpha = clamp(point.confidence, 0, 1);
        blendedX = this.lastStablePoint.x + (point.x - this.lastStablePoint.x) * alpha;
        blendedY = this.lastStablePoint.y + (point.y - this.lastStablePoint.y) * alpha;
      }
    }

    this.lastStablePoint = { x: blendedX, y: blendedY };

    // --- STEP 3: Apply One Euro Filter ---
    const smoothedX = this.filterX.filter(blendedX, point.timestamp);
    const smoothedY = this.filterY.filter(blendedY, point.timestamp);

    // --- STEP 5: Clamp and Stabilize Output ---
    const maxVelocityPxMs = 3.0; // max movement pixel per ms
    const deadZonePx = 1.2; // ignore sub-pixel jitters

    let finalX = smoothedX;
    let finalY = smoothedY;

    if (this.lastFinalPoint && this.lastFinalTime) {
      const dt = Math.max(1, point.timestamp - this.lastFinalTime);
      const dx = finalX - this.lastFinalPoint.x;
      const dy = finalY - this.lastFinalPoint.y;
      const distance = Math.hypot(dx, dy);

      // Dead zone
      if (distance < deadZonePx) {
        finalX = this.lastFinalPoint.x;
        finalY = this.lastFinalPoint.y;
      } else {
        // Velocity clamp
        if (distance / dt > maxVelocityPxMs) {
          const ratio = (maxVelocityPxMs * dt) / distance;
          finalX = this.lastFinalPoint.x + dx * ratio;
          finalY = this.lastFinalPoint.y + dy * ratio;
        }
      }
    }

    // Screen bounds clamp
    finalX = clamp(finalX, 0, window.innerWidth);
    finalY = clamp(finalY, 0, window.innerHeight);

    this.lastFinalPoint = { x: finalX, y: finalY };
    this.lastFinalTime = point.timestamp;

    return {
      x: finalX,
      y: finalY,
      confidence: point.confidence,
      timestamp: point.timestamp,
    };
  }

  private estimateGazePoint(
    landmarks: NormalizedLandmark[],
    timestamp: number,
    headStability: number
  ): GazePointData | null {
    const leftIris = this.averagePoint(landmarks, LEFT_IRIS_POINTS) ?? this.averagePoint(landmarks, [33, 133]);
    const rightIris = this.averagePoint(landmarks, RIGHT_IRIS_POINTS) ?? this.averagePoint(landmarks, [362, 263]);

    if (!leftIris || !rightIris) return null;

    const irisCenterX = (leftIris.x + rightIris.x) / 2;
    const irisCenterY = (leftIris.y + rightIris.y) / 2;

    const innerLeftEye = landmarks[133];
    const innerRightEye = landmarks[362];
    
    if (!innerLeftEye || !innerRightEye) return null;

    const anchorX = (innerLeftEye.x + innerRightEye.x) / 2;
    const anchorY = (innerLeftEye.y + innerRightEye.y) / 2;

    const outerLeftEye = landmarks[33];
    const outerRightEye = landmarks[263];
    const faceWidth = Math.abs(outerRightEye.x - outerLeftEye.x) || 0.1;

    // --- STEP 1: Compute Gaze Vector ---
    let compensatedX = (irisCenterX - anchorX) / faceWidth;
    let compensatedY = (irisCenterY - anchorY) / faceWidth;

    // --- STEP 2: Basic Head Pose Compensation ---
    const nose = landmarks[1];
    if (nose) {
      const yaw = (nose.x - anchorX) / faceWidth;
      const pitch = (nose.y - anchorY) / faceWidth;
      
      const k1 = 0.5; // Empirical yaw correction constant
      const k2 = 0.4; // Empirical pitch correction constant

      compensatedX -= yaw * k1;
      compensatedY -= pitch * k2;
    }

    // We still apply gain around the center to keep the output in the [0, 1] range properly
    // The base gaze without offset is 0, so we shift it to 0.5 center.
    compensatedX = clamp(compensatedX * EYE_GAIN_X * 5.0 + 0.5, 0, 1);
    compensatedY = clamp(compensatedY * EYE_GAIN_Y * 5.0 + 0.5, 0, 1);

    const baseConfidence = clamp(1 - Math.abs(leftIris.y - rightIris.y) * 3, 0, 1);
    const confidence = clamp(baseConfidence * 0.78 + headStability * 0.22, 0, 1);

    let normalizedX = compensatedX;
    let normalizedY = compensatedY;

    if (EYE_TRACKING_INVERT_X) normalizedX = 1 - normalizedX;
    if (EYE_TRACKING_INVERT_Y) normalizedY = 1 - normalizedY;

    return {
      x: normalizedX * window.innerWidth,
      y: normalizedY * window.innerHeight,
      timestamp,
      confidence,
    };
  }

  private updateHeadBaseline(landmarks: NormalizedLandmark[], headStability: number): void {
    const nose = landmarks[1];
    if (!nose) return;

    if (!this.baselineNose) {
      this.baselineNose = {
        x: nose.x,
        y: nose.y,
        z: nose.z,
      };
      this.baselineNoseSamples = 1;
      return;
    }

    if (headStability < 0.48) {
      return;
    }

    const alpha = this.baselineNoseSamples < 40 ? 0.08 : 0.02;
    this.baselineNose.x += (nose.x - this.baselineNose.x) * alpha;
    this.baselineNose.y += (nose.y - this.baselineNose.y) * alpha;
    this.baselineNose.z += (nose.z - this.baselineNose.z) * alpha;
    this.baselineNoseSamples = Math.min(this.baselineNoseSamples + 1, 1500);
  }

  private updateBlinkRate(landmarks: NormalizedLandmark[], now: number): number {
    const leftEar = this.computeEAR(landmarks, LEFT_EAR_POINTS);
    const rightEar = this.computeEAR(landmarks, RIGHT_EAR_POINTS);
    const ear = (leftEar + rightEar) / 2;

    const isClosed = ear < BLINK_EAR_THRESHOLD;
    if (isClosed && this.eyeClosedAt === null) {
      this.eyeClosedAt = now;
    }

    if (!isClosed && this.eyeClosedAt !== null) {
      const closeDuration = now - this.eyeClosedAt;
      if (closeDuration >= BLINK_MIN_MS && closeDuration <= BLINK_MAX_MS) {
        this.blinkTimestamps.push(now);
      }
      this.eyeClosedAt = null;
    }

    return this.computeBlinkRate(now);
  }

  private computeBlinkRate(now: number): number {
    const minTs = now - BLINK_WINDOW_MS;
    this.blinkTimestamps = this.blinkTimestamps.filter((ts) => ts >= minTs);
    return this.blinkTimestamps.length;
  }

  private updateHeadStability(landmarks: NormalizedLandmark[]): number {
    const nose = landmarks[1];
    if (!nose) return this.getAverageHeadStability();

    let stability = 1;
    if (this.previousNose) {
      const dx = nose.x - this.previousNose.x;
      const dy = nose.y - this.previousNose.y;
      const motion = Math.sqrt(dx * dx + dy * dy);
      stability = clamp(1 - motion / HEAD_MOTION_NORMALIZER, 0, 1);
    }

    this.previousNose = nose;
    this.headStabilityWindow.push(stability);
    if (this.headStabilityWindow.length > 24) {
      this.headStabilityWindow.shift();
    }

    return this.getAverageHeadStability();
  }

  private getAverageHeadStability(): number {
    if (this.headStabilityWindow.length === 0) return 1;
    const sum = this.headStabilityWindow.reduce((acc, val) => acc + val, 0);
    return sum / this.headStabilityWindow.length;
  }

  private computeFixationInstability(): number {
    if (this.gazeWindow.length < 3) return 0;

    const center = this.gazeWindow.reduce(
      (acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    center.x /= this.gazeWindow.length;
    center.y /= this.gazeWindow.length;

    const variance =
      this.gazeWindow.reduce((sum, p) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return sum + dx * dx + dy * dy;
      }, 0) / this.gazeWindow.length;

    return Math.sqrt(variance);
  }

  private computeTrackingLossRate(): number {
    if (this.frameQualityWindow.length === 0) return 0;
    const invalid = this.frameQualityWindow.filter((f) => !f.valid).length;
    return invalid / this.frameQualityWindow.length;
  }

  private trimGazeWindow(now: number): void {
    const minTs = now - METRIC_WINDOW_MS;
    this.gazeWindow = this.gazeWindow.filter((p) => p.timestamp >= minTs);
  }

  private trimQualityWindow(now: number): void {
    const minTs = now - METRIC_WINDOW_MS;
    this.frameQualityWindow = this.frameQualityWindow.filter((f) => f.timestamp >= minTs);
  }

  private averagePoint(landmarks: NormalizedLandmark[], indexes: readonly number[]): NormalizedLandmark | null {
    const points = indexes
      .map((idx) => landmarks[idx])
      .filter((p): p is NormalizedLandmark => Boolean(p));

    if (points.length === 0) return null;

    const sum = points.reduce(
      (acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        acc.z += p.z;
        return acc;
      },
      { x: 0, y: 0, z: 0 }
    );

    return {
      x: sum.x / points.length,
      y: sum.y / points.length,
      z: sum.z / points.length,
    };
  }

  private computeEAR(landmarks: NormalizedLandmark[], idx: readonly number[]): number {
    const p1 = landmarks[idx[0]];
    const p2 = landmarks[idx[1]];
    const p3 = landmarks[idx[2]];
    const p4 = landmarks[idx[3]];
    const p5 = landmarks[idx[4]];
    const p6 = landmarks[idx[5]];

    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.3;

    const vertical1 = this.distance(p2, p6);
    const vertical2 = this.distance(p3, p5);
    const horizontal = Math.max(0.0001, this.distance(p1, p4));

    return (vertical1 + vertical2) / (2 * horizontal);
  }

  private distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private handleTrackingLost(reason: TrackingLostReason): void {
    if (!this.isRunning || this.trackingLostEmitted) return;

    this.trackingLostEmitted = true;
    this.lastError =
      reason === 'camera_off'
        ? 'Caméra indisponible ou interrompue'
        : 'Visage perdu, tracking en pause';

    this.pause();
    EventBus.emit(
      'tracking_lost',
      {
        reason,
        timestamp: Date.now(),
      },
      this.sessionId
    );

    logger.warn('EyeTracker', 'Tracking perdu', { reason, sessionId: this.sessionId });
  }

  private resetRuntimeBuffers(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.lastStablePoint = null;
    this.lastFinalPoint = null;
    this.lastFinalTime = null;
    this.smoothingBuffer = [];
    this.gazeWindow = [];
    this.frameQualityWindow = [];
    this.blinkTimestamps = [];
    this.headStabilityWindow = [];
    this.eyeClosedAt = null;
    this.previousNose = null;
    this.baselineNose = null;
    this.baselineNoseSamples = 0;

    this.lastSampledAt = 0;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;
  }
}