/**
 * AdaptiveLoopController.ts
 * RÔLE : Contrôleur central de la boucle adaptative temps réel.
 * - Consomme les points gaze de EyeTracker
 * - Extrait des features robustes sur fenêtre glissante (1-2s)
 * - Calibre un baseline individuel en début de session
 * - Applique seuil adaptatif + hysteresis + debounce temporel
 * - Émet des adaptations UI stables (anti-flicker)
 */

import { EventBus } from '../event-bus/EventBus';
import { DifficultyDetector } from './DifficultyDetector';
import {
  ADAPTIVE_LOOP_COOLDOWN_MS,
  ADAPTIVE_LOOP_FEATURE_WINDOW,
  ADAPTIVE_LOOP_MIN_CONFIDENCE,
  ADAPTIVE_LOOP_SMOOTHING_WINDOW,
  DIFFICULTY_THRESHOLD_LIGHT,
} from '../../shared/constants';
import { clamp } from '../../shared/utils';
import { logger } from '../../shared/logger';
import type {
  AdaptiveDifficultyLevel,
  AdaptiveLoopOutput,
  DetectorDebugPayload,
  DetectorMode,
  DifficultySignal,
  GazeMetrics,
  GazePointData,
  ReadingLanguage,
} from '../../shared/types';

interface AdaptiveLoopControllerOptions {
  minConfidence?: number;
  smoothingWindow?: number;
  featureWindow?: number;
  featureWindowMs?: number;
  calibrationMs?: number;
  baselineK?: number;
  debounceFrames?: number;
  cooldownMs?: number;
  baseLanguage?: ReadingLanguage;
}

interface ExtractedFeatures {
  fixationDuration: number;
  fixationDurationVariance: number;
  regressionCount: number;
  regressionFrequency: number;
  gazeStability: number;
  gazeDispersion: number;
  saccadeSpeed: number;
  microSaccadeIntensity: number;
  lineSkipRate: number;
  blinkRate: number;
  fixationInstability: number;
  headStability: number;
  trackingLossRate: number;
}

interface TriggerState {
  active: boolean;
  activationDebounce: number;
  releaseDebounce: number;
}

const FIXATION_RADIUS_PX = 24;
const REGRESSION_DELTA_PX = 17;
const LINE_SKIP_DELTA_PX = 40;
const MICRO_SACCADE_MIN_PX = 2;
const MICRO_SACCADE_MAX_PX = 18;
const MICRO_SACCADE_MAX_DT_MS = 120;
const STABILITY_NORMALIZER_PX = 120;
const FEATURE_WINDOW_MS_DEFAULT = 1800;
const CALIBRATION_MS_DEFAULT = 3200;
const BASELINE_STD_FLOOR = 0.035;
const DEFAULT_RELEASE_GAP = 0.10;
const SCORING_INTERVAL_MS = 90;

export class AdaptiveLoopController {
  private readonly sessionId: string;
  private readonly detector: DifficultyDetector;
  private readonly options: Required<AdaptiveLoopControllerOptions>;

  private unsubscribePoints: (() => void) | null = null;
  private unsubscribeMetrics: (() => void) | null = null;
  private unsubscribeMode: (() => void) | null = null;

  private isActive = false;
  private smoothingBuffer: GazePointData[] = [];
  private featureBuffer: GazePointData[] = [];

  private lastFeatureComputeAt = 0;
  private currentLevel: AdaptiveDifficultyLevel = 'none';
  private lastAppliedAt = 0;
  private latestExternalMetrics: Partial<GazeMetrics> = {};

  private calibrationStartedAt = 0;
  private calibrationSamples: number[] = [];
  private calibrationReady = false;
  private baselineMean = 0.22;
  private baselineStd = 0.07;
  private triggerThreshold = DIFFICULTY_THRESHOLD_LIGHT;
  private releaseThreshold = Math.max(0.18, DIFFICULTY_THRESHOLD_LIGHT - DEFAULT_RELEASE_GAP);
  private difficultyActive = false;
  private activationDebounce = 0;
  private releaseDebounce = 0;

  constructor(sessionId: string, options: AdaptiveLoopControllerOptions = {}) {
    this.sessionId = sessionId;
    this.detector = new DifficultyDetector(sessionId);

    this.options = {
      minConfidence: options.minConfidence ?? ADAPTIVE_LOOP_MIN_CONFIDENCE,
      smoothingWindow: options.smoothingWindow ?? ADAPTIVE_LOOP_SMOOTHING_WINDOW,
      featureWindow: options.featureWindow ?? ADAPTIVE_LOOP_FEATURE_WINDOW,
      featureWindowMs: options.featureWindowMs ?? FEATURE_WINDOW_MS_DEFAULT,
      calibrationMs: options.calibrationMs ?? CALIBRATION_MS_DEFAULT,
      baselineK: options.baselineK ?? 1.35,
      debounceFrames: options.debounceFrames ?? 4,
      cooldownMs: options.cooldownMs ?? ADAPTIVE_LOOP_COOLDOWN_MS,
      baseLanguage: options.baseLanguage ?? 'fr',
    };
  }

  start(): void {
    if (this.isActive) return;

    this.unsubscribePoints = EventBus.on<GazePointData>('gaze:point', (event) => {
      if (event.sessionId !== this.sessionId) return;
      this.handlePoint(event.payload);
    });

    this.unsubscribeMetrics = EventBus.on<GazeMetrics>('gaze:metrics', (event) => {
      if (event.sessionId !== this.sessionId) return;
      this.latestExternalMetrics = {
        blinkRate: event.payload.blinkRate,
        headStability: event.payload.headStability,
        trackingLossRate: event.payload.trackingLossRate,
        fixationInstability: event.payload.fixationInstability,
      };
    });

    this.unsubscribeMode = EventBus.on<{ mode: DetectorMode }>('detector:mode', (event) => {
      if (event.sessionId !== this.sessionId) return;
      this.detector.setMode(event.payload.mode);
      logger.info('AdaptiveLoopController', 'Detector mode updated', {
        mode: event.payload.mode,
        sessionId: this.sessionId,
      });
    });

    this.isActive = true;
    logger.info('AdaptiveLoopController', 'Boucle adaptative démarrée', {
      sessionId: this.sessionId,
      smoothingWindow: this.options.smoothingWindow,
      featureWindow: this.options.featureWindow,
      cooldownMs: this.options.cooldownMs,
    });
  }

  stop(): void {
    this.unsubscribePoints?.();
    this.unsubscribePoints = null;
    this.unsubscribeMetrics?.();
    this.unsubscribeMetrics = null;
    this.unsubscribeMode?.();
    this.unsubscribeMode = null;

    this.smoothingBuffer = [];
    this.featureBuffer = [];
    this.lastFeatureComputeAt = 0;
    this.currentLevel = 'none';
    this.lastAppliedAt = 0;
    this.latestExternalMetrics = {};

    this.calibrationStartedAt = 0;
    this.calibrationSamples = [];
    this.calibrationReady = false;
    this.baselineMean = 0.22;
    this.baselineStd = 0.07;
    this.triggerThreshold = DIFFICULTY_THRESHOLD_LIGHT;
    this.releaseThreshold = Math.max(0.18, DIFFICULTY_THRESHOLD_LIGHT - DEFAULT_RELEASE_GAP);
    this.difficultyActive = false;
    this.activationDebounce = 0;
    this.releaseDebounce = 0;

    this.isActive = false;

    logger.info('AdaptiveLoopController', 'Boucle adaptative arrêtée', {
      sessionId: this.sessionId,
    });
  }

  private handlePoint(point: GazePointData): void {
    if (!this.isActive) return;
    if (point.confidence < this.options.minConfidence) return;

    const now = point.timestamp || Date.now();

    this.pushSmoothedPoint(point);
    const smoothedPoint = this.computeSmoothedPoint();

    this.featureBuffer.push(smoothedPoint);
    this.trimFeatureBuffer(now);

    if (now - this.lastFeatureComputeAt < SCORING_INTERVAL_MS) return;
    this.lastFeatureComputeAt = now;

    if (this.featureBuffer.length < Math.max(8, Math.floor(this.options.featureWindow / 3))) {
      return;
    }

    const points = this.featureBuffer;
    const features = this.extractFeatures(points);
    const metrics = this.toGazeMetrics(features, now);

    const inferred = this.detector.infer(metrics);
    const detectorDebug = this.detector.getLastDebug();
    const adjustedScore = this.computeAdjustedScore(detectorDebug.selectedScore, features);

    this.updateBaseline(adjustedScore, now);
    this.updateThresholds();
    const triggerState = this.updateTriggerState(adjustedScore);
    const nextLevel = this.resolveLevel(adjustedScore, triggerState.active);

    const signal: DifficultySignal = {
      ...inferred,
      level: adjustedScore,
      language: this.options.baseLanguage,
      timestamp: now,
    };

    const debugPayload: DetectorDebugPayload = {
      ...detectorDebug,
      adjustedScore,
      triggerThreshold: this.triggerThreshold,
      releaseThreshold: this.releaseThreshold,
      baselineMean: this.baselineMean,
      baselineStd: this.baselineStd,
      calibrationReady: this.calibrationReady,
      activationDebounce: triggerState.activationDebounce,
      releaseDebounce: triggerState.releaseDebounce,
      fixationVariance: features.fixationDurationVariance,
      microSaccadeIntensity: features.microSaccadeIntensity,
      gazeDispersion: features.gazeDispersion,
      gazeStability: features.gazeStability,
      currentLevel: this.currentLevel,
      nextLevel,
      triggered: triggerState.active,
      timestamp: now,
    };

    EventBus.emit('detector:debug', debugPayload, this.sessionId);

    this.applyAdaptationControl(nextLevel, adjustedScore, signal, triggerState.active);
  }

  private trimFeatureBuffer(now: number): void {
    const minTs = now - this.options.featureWindowMs;
    this.featureBuffer = this.featureBuffer.filter((p) => p.timestamp >= minTs);

    const hardCap = Math.max(this.options.featureWindow * 4, 80);
    if (this.featureBuffer.length > hardCap) {
      this.featureBuffer.splice(0, this.featureBuffer.length - hardCap);
    }
  }

  private pushSmoothedPoint(point: GazePointData): void {
    this.smoothingBuffer.push(point);
    if (this.smoothingBuffer.length > this.options.smoothingWindow) {
      this.smoothingBuffer.shift();
    }
  }

  private computeSmoothedPoint(): GazePointData {
    const last = this.smoothingBuffer[this.smoothingBuffer.length - 1];

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
      normalizedX: last.normalizedX,
      normalizedY: last.normalizedY,
      velocity: last.velocity,
      timestamp: last.timestamp,
    };
  }

  private extractFeatures(points: GazePointData[]): ExtractedFeatures {
    if (points.length < 2) {
      return {
        fixationDuration: 0,
        fixationDurationVariance: 0,
        regressionCount: 0,
        regressionFrequency: 0,
        gazeStability: 1,
        gazeDispersion: 0,
        saccadeSpeed: 0,
        microSaccadeIntensity: 0,
        lineSkipRate: 0,
        blinkRate: this.latestExternalMetrics.blinkRate ?? 15,
        fixationInstability: this.latestExternalMetrics.fixationInstability ?? 0,
        headStability: this.latestExternalMetrics.headStability ?? 1,
        trackingLossRate: this.latestExternalMetrics.trackingLossRate ?? 0,
      };
    }

    const fixationDurations: number[] = [];
    let currentFixation = 0;

    let regressionCount = 0;
    let directionReversals = 0;
    let lineSkips = 0;
    let totalDisplacement = 0;
    let microSaccadeAccum = 0;
    let microSaccadeCount = 0;
    let previousDirection = 0;

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
      } else if (currentFixation > 0) {
        fixationDurations.push(currentFixation);
        currentFixation = 0;
      }

      if (dx < -REGRESSION_DELTA_PX) {
        regressionCount++;
      }

      const direction = Math.sign(dx);
      if (
        direction !== 0 &&
        previousDirection !== 0 &&
        direction !== previousDirection &&
        Math.abs(dx) > REGRESSION_DELTA_PX * 0.45
      ) {
        directionReversals++;
      }
      if (direction !== 0) {
        previousDirection = direction;
      }

      if (Math.abs(dy) > LINE_SKIP_DELTA_PX) {
        lineSkips++;
      }

      if (
        dist >= MICRO_SACCADE_MIN_PX &&
        dist <= MICRO_SACCADE_MAX_PX &&
        dt <= MICRO_SACCADE_MAX_DT_MS
      ) {
        microSaccadeAccum += dist / dt;
        microSaccadeCount++;
      }
    }

    if (currentFixation > 0) {
      fixationDurations.push(currentFixation);
    }

    const totalDuration = Math.max(1, points[points.length - 1].timestamp - points[0].timestamp);
    const saccadeSpeed = totalDisplacement / totalDuration;

    const fixationDuration = fixationDurations.length > 0 ? Math.max(...fixationDurations) : 0;
    const fixationMean =
      fixationDurations.length > 0
        ? fixationDurations.reduce((sum, value) => sum + value, 0) / fixationDurations.length
        : 0;

    const fixationDurationVariance =
      fixationDurations.length > 0
        ? fixationDurations.reduce((sum, value) => {
            const diff = value - fixationMean;
            return sum + diff * diff;
          }, 0) / fixationDurations.length
        : 0;

    const regressionFrequency = clamp(
      (regressionCount + directionReversals * 0.4) / Math.max(1, totalDuration / 1000),
      0,
      1
    );

    const microSaccadeIntensity =
      microSaccadeCount > 0
        ? clamp((microSaccadeAccum / microSaccadeCount) * 8.5, 0, 1)
        : 0;

    const center = points.reduce(
      (acc, p) => {
        acc.x += p.x;
        acc.y += p.y;
        return acc;
      },
      { x: 0, y: 0 }
    );
    center.x /= points.length;
    center.y /= points.length;

    const variance =
      points.reduce((sum, p) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return sum + dx * dx + dy * dy;
      }, 0) / points.length;

    const gazeDispersion = Math.sqrt(variance);
    const gazeStability = clamp(1 - gazeDispersion / STABILITY_NORMALIZER_PX, 0, 1);

    return {
      fixationDuration,
      fixationDurationVariance,
      regressionCount,
      regressionFrequency,
      gazeStability,
      gazeDispersion,
      saccadeSpeed,
      microSaccadeIntensity,
      lineSkipRate: lineSkips / (points.length - 1),
      blinkRate: this.latestExternalMetrics.blinkRate ?? 15,
      fixationInstability: this.latestExternalMetrics.fixationInstability ?? gazeDispersion,
      headStability: this.latestExternalMetrics.headStability ?? gazeStability,
      trackingLossRate: this.latestExternalMetrics.trackingLossRate ?? 0,
    };
  }

  private toGazeMetrics(features: ExtractedFeatures, timestamp: number): GazeMetrics {
    return {
      saccadeSpeed: features.saccadeSpeed,
      fixationDuration: features.fixationDuration,
      fixationDurationVariance: features.fixationDurationVariance,
      regressionCount: features.regressionCount,
      regressionFrequency: features.regressionFrequency,
      blinkRate: features.blinkRate,
      lineSkipRate: features.lineSkipRate,
      microSaccadeIntensity: features.microSaccadeIntensity,
      gazeDispersion: features.gazeDispersion,
      gazeStability: features.gazeStability,
      fixationInstability: features.fixationInstability,
      headStability: features.headStability,
      trackingLossRate: features.trackingLossRate,
      timestamp,
    };
  }

  private computeAdjustedScore(rawScore: number, features: ExtractedFeatures): number {
    const fixationVarianceScore = clamp(features.fixationDurationVariance / 45_000, 0, 1);
    const dispersionScore = clamp(features.gazeDispersion / STABILITY_NORMALIZER_PX, 0, 1);
    const reliability = clamp(features.gazeStability * (1 - features.trackingLossRate), 0, 1);

    const enriched = clamp(
      rawScore * 0.78 +
        features.microSaccadeIntensity * 0.10 +
        fixationVarianceScore * 0.08 +
        features.regressionFrequency * 0.08 +
        dispersionScore * 0.06,
      0,
      1
    );

    // Les frames peu fiables (perte tracking / scanning) pèsent moins.
    return clamp(enriched * (0.72 + reliability * 0.28), 0, 1);
  }

  private updateBaseline(score: number, now: number): void {
    if (this.calibrationStartedAt === 0) {
      this.calibrationStartedAt = now;
    }

    if (!this.calibrationReady) {
      this.calibrationSamples.push(score);
      if (this.calibrationSamples.length > 220) {
        this.calibrationSamples.shift();
      }

      const { mean, std } = this.computeMeanStd(this.calibrationSamples);
      this.baselineMean = mean;
      this.baselineStd = Math.max(BASELINE_STD_FLOOR, std);

      const elapsed = now - this.calibrationStartedAt;
      if (elapsed >= this.options.calibrationMs && this.calibrationSamples.length >= 16) {
        this.calibrationReady = true;
      }
      return;
    }

    // Après calibration, le baseline suit lentement la dérive naturelle de l'élève.
    if (!this.difficultyActive) {
      const learningRate = 0.04;
      const delta = score - this.baselineMean;
      this.baselineMean += learningRate * delta;

      const prevVar = this.baselineStd * this.baselineStd;
      const nextVar = (1 - learningRate) * prevVar + learningRate * delta * delta;
      this.baselineStd = Math.sqrt(Math.max(BASELINE_STD_FLOOR * BASELINE_STD_FLOOR, nextVar));
    }
  }

  private updateThresholds(): void {
    if (!this.calibrationReady) {
      this.triggerThreshold = Math.max(DIFFICULTY_THRESHOLD_LIGHT, 0.34);
      this.releaseThreshold = Math.max(0.18, this.triggerThreshold - DEFAULT_RELEASE_GAP);
      return;
    }

    const trigger = clamp(this.baselineMean + this.options.baselineK * this.baselineStd, 0.34, 0.86);
    const releaseGap = Math.max(DEFAULT_RELEASE_GAP, this.baselineStd * 0.9);
    const release = clamp(trigger - releaseGap, 0.18, trigger - 0.04);

    this.triggerThreshold = trigger;
    this.releaseThreshold = release;
  }

  private updateTriggerState(score: number): TriggerState {
    if (!this.difficultyActive) {
      if (score >= this.triggerThreshold) {
        this.activationDebounce++;
      } else {
        this.activationDebounce = Math.max(0, this.activationDebounce - 1);
      }

      this.releaseDebounce = 0;

      if (this.activationDebounce >= this.options.debounceFrames) {
        this.difficultyActive = true;
        this.activationDebounce = 0;
      }
    } else {
      if (score <= this.releaseThreshold) {
        this.releaseDebounce++;
      } else {
        this.releaseDebounce = Math.max(0, this.releaseDebounce - 1);
      }

      this.activationDebounce = 0;

      if (this.releaseDebounce >= this.options.debounceFrames) {
        this.difficultyActive = false;
        this.releaseDebounce = 0;
      }
    }

    return {
      active: this.difficultyActive,
      activationDebounce: this.activationDebounce,
      releaseDebounce: this.releaseDebounce,
    };
  }

  private resolveLevel(score: number, isTriggered: boolean): AdaptiveDifficultyLevel {
    if (!isTriggered) {
      return 'none';
    }

    const span = Math.max(0.08, 1 - this.triggerThreshold);
    const normalized = clamp((score - this.triggerThreshold) / span, 0, 1);

    if (normalized >= 0.68) return 'strong';
    if (normalized >= 0.34) return 'moderate';
    return 'light';
  }

  private computeMeanStd(values: number[]): { mean: number; std: number } {
    if (values.length === 0) {
      return { mean: 0.22, std: BASELINE_STD_FLOOR };
    }

    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => {
        const d = v - mean;
        return sum + d * d;
      }, 0) / values.length;

    return {
      mean,
      std: Math.sqrt(Math.max(BASELINE_STD_FLOOR * BASELINE_STD_FLOOR, variance)),
    };
  }

  private applyAdaptationControl(
    nextLevel: AdaptiveDifficultyLevel,
    score: number,
    signal: DifficultySignal,
    isTriggered: boolean
  ): void {
    const stateChanged = nextLevel !== this.currentLevel;
    if (!stateChanged) return;

    const now = Date.now();
    if (now - this.lastAppliedAt < this.options.cooldownMs) return;

    this.lastAppliedAt = now;
    this.currentLevel = nextLevel;

    if (nextLevel === 'none' || !isTriggered) {
      EventBus.emit('adaptation:reset', null, this.sessionId);
    } else {
      EventBus.emit('difficulty:detected', signal, this.sessionId);
    }

    const output: AdaptiveLoopOutput = {
      difficultyLevel: nextLevel,
      actions: this.actionsForLevel(nextLevel),
      difficultyScore: score,
    };

    EventBus.emit('adaptive:output', output, this.sessionId);

    logger.info('AdaptiveLoopController', 'Adaptation contrôlée émise', {
      level: nextLevel,
      score: score.toFixed(2),
      triggerThreshold: this.triggerThreshold.toFixed(2),
      releaseThreshold: this.releaseThreshold.toFixed(2),
      sessionId: this.sessionId,
    });
  }

  private actionsForLevel(level: AdaptiveDifficultyLevel): [string, string, string] {
    if (level === 'none') {
      return ['fontSize:base', 'spacing:base', 'focusZoom:off'];
    }
    if (level === 'light') {
      return ['fontSize:+3%', 'spacing:+8%', 'focusZoom:+3%'];
    }
    if (level === 'moderate') {
      return ['fontSize:+8%', 'spacing:+14%', 'focusZoom:+8%'];
    }
    return ['fontSize:+15%', 'spacing:+22%', 'focusZoom:+14%'];
  }
}
