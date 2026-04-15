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
const EYE_GAIN_X = 1.14;
const EYE_GAIN_Y = 1.08;
const FAST_MOTION_THRESHOLD_PX = 22;

const LEFT_EAR_POINTS = [33, 159, 158, 133, 153, 145] as const;
const RIGHT_EAR_POINTS = [362, 386, 385, 263, 373, 374] as const;
const LEFT_IRIS_POINTS = [468, 469, 470, 471, 472] as const;
const RIGHT_IRIS_POINTS = [473, 474, 475, 476, 477] as const;

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
    const tick = async (): Promise<void> => {
      if (!this.isRunning) return;

      if (!this.isPaused && this.videoEl && this.faceMesh && !this.isFrameInFlight) {
        this.isFrameInFlight = true;
        try {
          await this.faceMesh.send({ image: this.videoEl });
        } catch (err) {
          logger.warn('EyeTracker', 'Frame processing error', { error: String(err) });
        } finally {
          this.isFrameInFlight = false;
        }
      }

      this.rafId = requestAnimationFrame(() => {
        void tick();
      });
    };

    void tick();
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
    let currentFixation = 0;
    let regressionCount = 0;
    let lineSkips = 0;
    let totalDisplacement = 0;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dt = Math.max(1, curr.timestamp - prev.timestamp);
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      totalDisplacement += dist;

      if (dist <= FIXATION_RADIUS_PX) {
        currentFixation += dt;
        longestFixation = Math.max(longestFixation, currentFixation);
      } else {
        currentFixation = 0;
      }

      if (dx < -REGRESSION_DELTA_PX) regressionCount++;
      if (Math.abs(dy) > LINE_SKIP_DELTA_PX) lineSkips++;
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

  private smoothPoint(point: GazePointData): GazePointData {
    this.smoothingBuffer.push(point);
    if (this.smoothingBuffer.length > EYE_TRACKING_SMOOTHING_WINDOW) {
      this.smoothingBuffer.shift();
    }

    const len = this.smoothingBuffer.length;
    const latest = this.smoothingBuffer[len - 1];
    const prev = len > 1 ? this.smoothingBuffer[len - 2] : latest;
    const motion = Math.hypot(latest.x - prev.x, latest.y - prev.y);

    const dynamicWindow =
      motion >= FAST_MOTION_THRESHOLD_PX
        ? Math.max(3, Math.floor(EYE_TRACKING_SMOOTHING_WINDOW / 2))
        : EYE_TRACKING_SMOOTHING_WINDOW;

    const points = this.smoothingBuffer.slice(-dynamicWindow);

    let weightedX = 0;
    let weightedY = 0;
    let weightedConfidence = 0;
    let totalWeight = 0;

    // Poids croissants vers les points récents pour réduire le lag.
    for (let i = 0; i < points.length; i++) {
      const weight = i + 1;
      totalWeight += weight;
      weightedX += points[i].x * weight;
      weightedY += points[i].y * weight;
      weightedConfidence += points[i].confidence * weight;
    }

    const averagedX = weightedX / Math.max(1, totalWeight);
    const averagedY = weightedY / Math.max(1, totalWeight);
    const settleFactor = motion < FAST_MOTION_THRESHOLD_PX * 0.45 ? 0.34 : 0.14;

    // À l'arrêt, on rapproche légèrement le point lissé du dernier point mesuré
    // pour éviter une position finale décalée après un mouvement.
    const settledX = averagedX + (latest.x - averagedX) * settleFactor;
    const settledY = averagedY + (latest.y - averagedY) * settleFactor;

    return {
      x: settledX,
      y: settledY,
      confidence: weightedConfidence / Math.max(1, totalWeight),
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

    const xNorm = (leftIris.x + rightIris.x) / 2;
    const yNorm = (leftIris.y + rightIris.y) / 2;

    const nose = landmarks[1];
    let compensatedX = xNorm;
    let compensatedY = yNorm;

    if (nose && this.baselineNose) {
      compensatedX = clamp(
        compensatedX - (nose.x - this.baselineNose.x) * HEAD_COMPENSATION_X,
        0,
        1
      );
      compensatedY = clamp(
        compensatedY - (nose.y - this.baselineNose.y) * HEAD_COMPENSATION_Y,
        0,
        1
      );
    }

    // Gain léger autour du centre pour mieux couvrir les mouvements de l'oeil.
    compensatedX = clamp((compensatedX - 0.5) * EYE_GAIN_X + 0.5, 0, 1);
    compensatedY = clamp((compensatedY - 0.5) * EYE_GAIN_Y + 0.5, 0, 1);

    const baseConfidence = clamp(1 - Math.abs(leftIris.y - rightIris.y) * 3, 0, 1);
    const confidence = clamp(baseConfidence * 0.78 + headStability * 0.22, 0, 1);

    return {
      x: compensatedX * window.innerWidth,
      y: compensatedY * window.innerHeight,
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