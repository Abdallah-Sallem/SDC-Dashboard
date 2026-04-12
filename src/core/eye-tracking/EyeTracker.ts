/**
 * EyeTracker.ts
 * RÔLE : Interface entre WebGazer.js (webcam) et le reste de l'application.
 * Attend que WebGazer soit chargé, demande la permission caméra explicitement,
 * et fonctionne en mode dégradé si la permission est refusée.
 */

import { EventBus }        from '../event-bus/EventBus';
import { GazeAnonymizer }  from './GazeAnonymizer';
import { logger }          from '../../shared/logger';
import {
  EYE_TRACKING_CAMERA_OFF_NULL_STREAK,
  EYE_TRACKING_FACE_LOST_TIMEOUT_MS,
  EYE_TRACKING_INTERVAL_MS,
  EYE_TRACKING_MIN_CONFIDENCE,
  EYE_TRACKING_SMOOTHING_WINDOW,
} from '../../shared/constants';
import type { TrackingLostReason } from '../../shared/types';

interface StartOptions {
  userInitiated?: boolean;
}

interface PermissionResult {
  granted: boolean;
  error: string | null;
}

interface GazePoint {
  x: number;
  y: number;
  timestamp: number;
  confidence: number;
}

declare global {
  interface Window {
    webgazer: {
      setGazeListener: (fn: (data: { x: number; y: number; confidence?: number } | null, ts: number) => void) => Window['webgazer'];
      begin:              () => Promise<void>;
      end:                () => void;
      pause:              () => Window['webgazer'];
      resume:             () => Window['webgazer'];
      showPredictionPoints: (show: boolean) => Window['webgazer'];
      showVideoPreview:     (show: boolean) => Window['webgazer'];
      clearData?:          () => Window['webgazer'];
    };
  }
}

export class EyeTracker {
  private anonymizer    = new GazeAnonymizer();
  private isRunning     = false;
  private isPaused      = false;
  private trackingLostEmitted = false;
  private lastError: string | null = null;
  private sessionId     = '';
  private frameBuffer:  { x: number; y: number; timestamp: number }[] = [];
  private smoothingBuffer: GazePoint[] = [];
  private throttleTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastSampledAt = 0;
  private lastValidPointAt = 0;
  private invalidFrameStreak = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Attend que window.webgazer soit disponible (chargé via <script defer>).
   * Timeout de 5 secondes.
   */
  private waitForWebGazer(): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.webgazer) { resolve(true); return; }

      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.webgazer) {
          clearInterval(interval);
          resolve(true);
        } else if (attempts >= 50) {   // 50 × 100ms = 5 secondes
          clearInterval(interval);
          logger.warn('EyeTracker', 'WebGazer non disponible après 5s');
          resolve(false);
        }
      }, 100);
    });
  }

  /**
   * Demande la permission caméra via getUserMedia AVANT de lancer WebGazer.
   * Cela déclenche le dialogue natif du navigateur.
   * Retourne true si accordée, false si refusée.
   */
  private async requestCameraPermission(): Promise<PermissionResult> {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { granted: false, error: 'API caméra non disponible sur cet appareil' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Permission accordée — on libère immédiatement le stream
      // (WebGazer va le reprendre lui-même via begin())
      stream.getTracks().forEach(track => track.stop());
      logger.info('EyeTracker', 'Permission caméra accordée');
      return { granted: true, error: null };
    } catch (err) {
      const error = err as DOMException;
      if (error.name === 'NotAllowedError') {
        logger.warn('EyeTracker', 'Permission caméra refusée par l\'utilisateur');
        return { granted: false, error: 'Permission caméra refusée' };
      } else if (error.name === 'NotFoundError') {
        logger.warn('EyeTracker', 'Aucune caméra détectée sur cet appareil');
        return { granted: false, error: 'Aucune caméra détectée' };
      } else if (error.name === 'NotReadableError') {
        logger.warn('EyeTracker', 'Caméra déjà utilisée ou indisponible');
        return { granted: false, error: 'Caméra occupée ou indisponible' };
      } else {
        logger.error('EyeTracker', 'Erreur permission caméra', { error: error.message });
        return { granted: false, error: `Erreur caméra: ${error.message}` };
      }
    }
  }

  private resetRuntimeBuffers(): void {
    this.frameBuffer = [];
    this.smoothingBuffer = [];
    this.lastSampledAt = 0;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;
  }

  private clearTimers(): void {
    if (this.throttleTimer) clearInterval(this.throttleTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.throttleTimer = null;
    this.healthTimer = null;
  }

  private startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (!this.isRunning || this.isPaused) return;
      if (Date.now() - this.lastValidPointAt > EYE_TRACKING_FACE_LOST_TIMEOUT_MS) {
        this.handleTrackingLost('face_lost');
      }
    }, 500);
  }

  private smoothPoint(point: GazePoint): GazePoint {
    this.smoothingBuffer.push(point);
    if (this.smoothingBuffer.length > EYE_TRACKING_SMOOTHING_WINDOW) {
      this.smoothingBuffer.shift();
    }

    const sums = this.smoothingBuffer.reduce(
      (acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        acc.confidence += p.confidence;
        return acc;
      },
      { x: 0, y: 0, confidence: 0 }
    );

    const len = this.smoothingBuffer.length;
    return {
      x: sums.x / len,
      y: sums.y / len,
      confidence: sums.confidence / len,
      timestamp: point.timestamp,
    };
  }

  private handleTrackingLost(reason: TrackingLostReason): void {
    if (!this.isRunning || this.trackingLostEmitted) return;

    this.trackingLostEmitted = true;
    this.lastError =
      reason === 'camera_off'
        ? 'Caméra indisponible ou interrompue'
        : 'Visage perdu, tracking en pause';

    this.pause();
    EventBus.emit('tracking_lost', {
      reason,
      timestamp: Date.now(),
    }, this.sessionId);

    logger.warn('EyeTracker', 'Tracking perdu', { reason, sessionId: this.sessionId });
  }

  private handleGazeSample(data: { x: number; y: number; confidence?: number } | null, timestamp: number): void {
    if (!this.isRunning || this.isPaused) return;

    if (!data) {
      this.invalidFrameStreak++;
      if (this.invalidFrameStreak >= EYE_TRACKING_CAMERA_OFF_NULL_STREAK) {
        this.handleTrackingLost('camera_off');
      }
      return;
    }

    const confidence = typeof data.confidence === 'number' ? data.confidence : 1;
    const isInvalidPoint =
      confidence < EYE_TRACKING_MIN_CONFIDENCE ||
      !Number.isFinite(data.x) ||
      !Number.isFinite(data.y);

    if (isInvalidPoint) {
      this.invalidFrameStreak++;
      return;
    }

    // 20 FPS max pour limiter la charge et stabiliser le pipeline.
    if (timestamp - this.lastSampledAt < EYE_TRACKING_INTERVAL_MS) {
      return;
    }

    this.lastSampledAt = timestamp;
    this.invalidFrameStreak = 0;
    this.lastValidPointAt = Date.now();

    const smoothed = this.smoothPoint({
      x: data.x,
      y: data.y,
      timestamp,
      confidence,
    });

    EventBus.emit('gaze:point', smoothed, this.sessionId);
    this.frameBuffer.push({ x: smoothed.x, y: smoothed.y, timestamp: smoothed.timestamp });
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Démarre le tracking oculaire.
   * 1. Attend WebGazer
   * 2. Demande la permission caméra (dialogue navigateur)
   * 3. Lance WebGazer
   * Si l'élève refuse, le système fonctionne avec des règles statiques.
   */
  async start(options: StartOptions = {}): Promise<boolean> {
    if (this.isRunning) return true;

    if (!options.userInitiated) {
      this.lastError = 'Démarrage bloqué : interaction utilisateur requise';
      logger.warn('EyeTracker', this.lastError);
      return false;
    }

    this.lastError = null;
    this.resetRuntimeBuffers();

    // Étape 1 : WebGazer chargé ?
    const webgazerReady = await this.waitForWebGazer();
    if (!webgazerReady) {
      this.lastError = 'WebGazer non disponible';
      return false;
    }

    // Étape 2 : Demander la permission caméra explicitement
    const permission = await this.requestCameraPermission();
    if (!permission.granted) {
      this.lastError = permission.error ?? 'Permission caméra refusée';
      return false;
    }

    // Étape 3 : Lancer WebGazer
    try {
      window.webgazer
        .showPredictionPoints(false)
        .showVideoPreview(false)
        .setGazeListener((data, timestamp) => this.handleGazeSample(data, timestamp));

      await window.webgazer.begin();
      this.isRunning = true;
      this.isPaused = false;
      this.lastValidPointAt = Date.now();

      this.clearTimers();
      this.throttleTimer = setInterval(() => this.processFrameBuffer(), EYE_TRACKING_INTERVAL_MS);
      this.startHealthMonitor();

      logger.info('EyeTracker', 'Tracking démarré', { sessionId: this.sessionId });
      return true;

    } catch (err) {
      this.lastError = `Erreur démarrage WebGazer: ${String(err)}`;
      logger.error('EyeTracker', 'Erreur démarrage WebGazer', { error: String(err) });
      return false;
    }
  }

  private processFrameBuffer(): void {
    if (this.frameBuffer.length === 0) return;

    const frames = [...this.frameBuffer];
    this.frameBuffer = [];

    for (const frame of frames) {
      const metrics = this.anonymizer.process(frame);
      if (metrics) {
        EventBus.emit('gaze:metrics', metrics, this.sessionId);
      }
    }
  }

  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    if (window.webgazer) window.webgazer.pause();
    this.isPaused = true;
    logger.debug('EyeTracker', 'Tracking en pause');
  }

  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    if (window.webgazer) window.webgazer.resume();
    this.isPaused = false;
    this.lastValidPointAt = Date.now();
    this.invalidFrameStreak = 0;
    this.trackingLostEmitted = false;
    this.lastError = null;
    logger.debug('EyeTracker', 'Tracking repris');
  }

  recalibrate(): boolean {
    if (!window.webgazer) {
      this.lastError = 'WebGazer indisponible pour recalibration';
      return false;
    }

    try {
      window.webgazer.clearData?.();
      this.anonymizer.resetSession();
      this.resetRuntimeBuffers();

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
    this.clearTimers();
    if (window.webgazer)    window.webgazer.end();
    this.anonymizer.resetSession();
    this.resetRuntimeBuffers();
    this.isPaused = false;
    this.isRunning = false;
    logger.info('EyeTracker', 'Tracking arrêté, caméra libérée');
  }

  getStatus(): boolean {
    return this.isRunning && !this.isPaused;
  }
}