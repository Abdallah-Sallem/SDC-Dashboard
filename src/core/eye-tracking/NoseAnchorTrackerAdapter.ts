import { EventBus } from '../event-bus/EventBus';
import { logger } from '../../shared/logger';
import {
  EYE_TRACKING_CAMERA_OFF_NULL_STREAK,
  EYE_TRACKING_FACE_LOST_TIMEOUT_MS,
  EYE_TRACKING_INTERVAL_MS,
  EYE_TRACKING_MIN_CONFIDENCE,
} from '../../shared/constants';
import { clamp } from '../../shared/utils';
import type { GazeMetrics, GazePointData, TrackingLostReason } from '../../shared/types';
import { NoseAnchorGazeTracker, type NoseAnchorOutput } from './NoseAnchorGazeTracker.js';

interface StartOptions {
  userInitiated?: boolean;
}

interface PermissionResult {
  granted: boolean;
  error: string | null;
}

const RELATIVE_TO_NORM_X = 0.043;
const RELATIVE_TO_NORM_Y = 0.052;
const HORIZONTAL_DIRECTION = -1;
const BASELINE_BOOTSTRAP_ALPHA = 0.18;
const BASELINE_ADAPT_ALPHA = 0.006;
const BASELINE_LOCK_RADIUS_PX = 7;

/**
 * Adapter exposing the same lifecycle API as EyeTracker,
 * while relying on NoseAnchorGazeTracker for gaze extraction.
 */
export class NoseAnchorTrackerAdapter {
  private readonly sessionId: string;

  private tracker: NoseAnchorGazeTracker | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;

  private isRunning = false;
  private isPaused = false;

  private trackingLostEmitted = false;
  private lastError: string | null = null;

  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  private lastSampledAt = 0;
  private lastValidPointAt = 0;
  private invalidFrameStreak = 0;

  private baselineRelative: { x: number; y: number } | null = null;
  private baselineSamples = 0;
  private lastPoint: GazePointData | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getStatus(): boolean {
    return this.isRunning && !this.isPaused;
  }

  async start(options: StartOptions = {}): Promise<boolean> {
    if (this.isRunning) return true;

    if (!options.userInitiated) {
      this.lastError = 'Demarrage bloque: interaction utilisateur requise';
      logger.warn('NoseAnchorTrackerAdapter', this.lastError);
      return false;
    }

    this.resetRuntimeBuffers();
    this.lastError = null;

    const permission = await this.requestCameraPermission();
    if (!permission.granted) {
      this.lastError = permission.error ?? 'Permission camera refusee';
      return false;
    }

    if (!this.mediaStream) {
      this.lastError = 'Flux camera indisponible';
      return false;
    }

    try {
      this.videoEl = await this.createHiddenVideo(this.mediaStream);
      this.tracker = new NoseAnchorGazeTracker(this.videoEl, {
        onUpdate: (output) => this.handleUpdate(output),
        baseAlpha: 0.18,
        fastAlpha: 0.52,
        velocityThresholdPx: 11,
        maxJumpPx: 95,
        gainX: 1.18,
        gainY: 1.12,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
        selfieMode: true,
      });

      this.isRunning = true;
      this.isPaused = false;
      this.lastValidPointAt = Date.now();

      await this.tracker.start();

      this.startHealthMonitor();
      this.metricsTimer = setInterval(() => this.emitMetrics(), 220);

      logger.info('NoseAnchorTrackerAdapter', 'Tracking nose-anchor demarre', {
        sessionId: this.sessionId,
      });
      return true;
    } catch (err) {
      this.lastError = `Erreur demarrage nose-anchor: ${String(err)}`;
      logger.error('NoseAnchorTrackerAdapter', 'Erreur demarrage', {
        error: String(err),
        sessionId: this.sessionId,
      });
      this.stop();
      return false;
    }
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    logger.debug('NoseAnchorTrackerAdapter', 'Tracking en pause');
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;
    this.lastError = null;
    logger.debug('NoseAnchorTrackerAdapter', 'Tracking repris');
  }

  recalibrate(): boolean {
    try {
      this.baselineRelative = null;
      this.baselineSamples = 0;
      this.lastPoint = null;
      this.invalidFrameStreak = 0;
      this.trackingLostEmitted = false;
      this.lastError = null;

      if (this.isRunning && this.isPaused) {
        this.resume();
      }

      logger.info('NoseAnchorTrackerAdapter', 'Recalibration nose-anchor declenchee', {
        sessionId: this.sessionId,
      });
      return true;
    } catch (err) {
      this.lastError = `Recalibration impossible: ${String(err)}`;
      logger.error('NoseAnchorTrackerAdapter', 'Erreur recalibration', {
        error: String(err),
      });
      return false;
    }
  }

  stop(): void {
    this.isRunning = false;
    this.isPaused = false;

    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.healthTimer = null;
    this.metricsTimer = null;

    if (this.tracker) {
      void this.tracker.dispose().catch((err) => {
        logger.warn('NoseAnchorTrackerAdapter', 'Erreur liberation tracker', {
          error: String(err),
          sessionId: this.sessionId,
        });
      });
      this.tracker = null;
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
    logger.info('NoseAnchorTrackerAdapter', 'Tracking arrete, camera liberee');
  }

  private async requestCameraPermission(): Promise<PermissionResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'API camera non disponible sur cet appareil' };
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
      logger.info('NoseAnchorTrackerAdapter', 'Permission camera accordee');
      return { granted: true, error: null };
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError') {
        return { granted: false, error: 'Permission camera refusee' };
      }
      if (error.name === 'NotFoundError') {
        return { granted: false, error: 'Aucune camera detectee' };
      }
      if (error.name === 'NotReadableError') {
        return { granted: false, error: 'Camera occupee ou indisponible' };
      }
      return { granted: false, error: `Erreur camera: ${error.message}` };
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

      video.onerror = () => reject(new Error('Impossible de lire le flux video'));
    });
  }

  private handleUpdate(output: NoseAnchorOutput): void {
    if (!this.isRunning || this.isPaused) return;

    const now = Date.now();

    if (!output.isTracking) {
      this.invalidFrameStreak += 1;
      if (this.invalidFrameStreak >= EYE_TRACKING_CAMERA_OFF_NULL_STREAK) {
        this.handleTrackingLost('face_lost');
      }
      return;
    }

    this.invalidFrameStreak = 0;
    this.lastValidPointAt = now;
    this.trackingLostEmitted = false;
    this.lastError = null;

    const relative = { x: output.x, y: output.y };

    if (!this.baselineRelative) {
      this.baselineRelative = { ...relative };
      this.baselineSamples = 1;
    } else {
      const dx = relative.x - this.baselineRelative.x;
      const dy = relative.y - this.baselineRelative.y;
      const drift = Math.hypot(dx, dy);
      const alpha =
        this.baselineSamples < 24
          ? BASELINE_BOOTSTRAP_ALPHA
          : drift <= BASELINE_LOCK_RADIUS_PX
            ? BASELINE_ADAPT_ALPHA
            : 0;

      if (alpha > 0) {
        this.baselineRelative.x += dx * alpha;
        this.baselineRelative.y += dy * alpha;
      }

      this.baselineSamples = Math.min(this.baselineSamples + 1, 1500);
    }

    const baseline = this.baselineRelative ?? relative;
    const deltaX = relative.x - baseline.x;
    const deltaY = relative.y - baseline.y;

    // Symmetric center mapping around 0.5 ensures equal response left/right.
    const mirroredDeltaX = HORIZONTAL_DIRECTION * deltaX;
    const normalizedX = clamp(0.5 + mirroredDeltaX * RELATIVE_TO_NORM_X, 0, 1);
    const normalizedY = clamp(0.5 + deltaY * RELATIVE_TO_NORM_Y, 0, 1);

    const screenX = normalizedX * window.innerWidth;
    const screenY = normalizedY * window.innerHeight;

    let velocity = 0;
    if (this.lastPoint) {
      const dt = Math.max(1, now - this.lastPoint.timestamp);
      velocity = Math.hypot(screenX - this.lastPoint.x, screenY - this.lastPoint.y) / dt;
    }

    const confidence = clamp(0.74 + (1 - Math.min(1, Math.hypot(deltaX, deltaY) / 26)) * 0.16, EYE_TRACKING_MIN_CONFIDENCE, 0.94);

    const point: GazePointData = {
      x: screenX,
      y: screenY,
      confidence,
      normalizedX,
      normalizedY,
      velocity,
      timestamp: now,
      headStability: 0.8,
      trackingLossRate: 0,
      fixationInstability: 0,
      blinkRate: 0,
    };

    this.lastPoint = point;

    if (now - this.lastSampledAt >= EYE_TRACKING_INTERVAL_MS) {
      this.lastSampledAt = now;
      EventBus.emit('gaze:point', point, this.sessionId);
    }
  }

  private emitMetrics(): void {
    if (!this.isRunning || this.isPaused || !this.lastPoint) return;

    const now = Date.now();
    const trackingLossRate = this.invalidFrameStreak === 0 ? 0 : clamp(this.invalidFrameStreak / EYE_TRACKING_CAMERA_OFF_NULL_STREAK, 0, 1);

    const metrics: GazeMetrics = {
      saccadeSpeed: this.lastPoint.velocity ?? 0,
      fixationDuration: 0,
      regressionCount: 0,
      blinkRate: 15,
      lineSkipRate: 0,
      fixationInstability: 0,
      headStability: 0.8,
      trackingLossRate,
      timestamp: now,
    };

    EventBus.emit('gaze:metrics', metrics, this.sessionId);
  }

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (!this.isRunning || this.isPaused) return;

      const trackEnded = this.mediaStream?.getVideoTracks().some((track) => track.readyState === 'ended') ?? false;
      if (trackEnded) {
        this.handleTrackingLost('camera_off');
        return;
      }

      if (Date.now() - this.lastValidPointAt > EYE_TRACKING_FACE_LOST_TIMEOUT_MS) {
        this.handleTrackingLost('face_lost');
      }
    }, 450);
  }

  private handleTrackingLost(reason: TrackingLostReason): void {
    if (!this.isRunning || this.trackingLostEmitted) return;

    this.trackingLostEmitted = true;
    this.lastError =
      reason === 'camera_off'
        ? 'Camera indisponible ou interrompue'
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

    logger.warn('NoseAnchorTrackerAdapter', 'Tracking perdu', { reason, sessionId: this.sessionId });
  }

  private resetRuntimeBuffers(): void {
    this.lastSampledAt = 0;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;

    this.baselineRelative = null;
    this.baselineSamples = 0;
    this.lastPoint = null;
  }
}