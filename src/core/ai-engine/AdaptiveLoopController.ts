/**
 * AdaptiveLoopController.ts
 * RÔLE : Contrôleur central de la boucle adaptative temps réel.
 * - Consomme les points gaze bruts de EyeTracker
 * - Stabilise le signal (moyenne mobile + filtre confiance)
 * - Extrait des features robustes
 * - Interroge DifficultyDetector
 * - Applique un contrôle anti-flicker (cooldown + changement d'état)
 */

import { EventBus } from '../event-bus/EventBus';
import { DifficultyDetector } from './DifficultyDetector';
import {
  ADAPTIVE_LOOP_COOLDOWN_MS,
  ADAPTIVE_LOOP_FEATURE_WINDOW,
  ADAPTIVE_LOOP_MIN_CONFIDENCE,
  ADAPTIVE_LOOP_SMOOTHING_WINDOW,
  DIFFICULTY_THRESHOLD_LIGHT,
  DIFFICULTY_THRESHOLD_MODERATE,
  DIFFICULTY_THRESHOLD_STRONG,
} from '../../shared/constants';
import { clamp } from '../../shared/utils';
import { logger } from '../../shared/logger';
import type {
  AdaptiveDifficultyLevel,
  AdaptiveLoopOutput,
  DifficultySignal,
  GazeMetrics,
  GazePointData,
  ReadingLanguage,
} from '../../shared/types';

interface AdaptiveLoopControllerOptions {
  minConfidence?: number;
  smoothingWindow?: number;
  featureWindow?: number;
  cooldownMs?: number;
  baseLanguage?: ReadingLanguage;
}

interface ExtractedFeatures {
  fixationDuration: number;
  regressionCount: number;
  gazeStability: number;
  saccadeSpeed: number;
  lineSkipRate: number;
  blinkRate: number;
}

const FIXATION_RADIUS_PX = 24;
const REGRESSION_DELTA_PX = 18;
const LINE_SKIP_DELTA_PX = 40;
const STABILITY_NORMALIZER_PX = 120;

export class AdaptiveLoopController {
  private readonly sessionId: string;
  private readonly detector: DifficultyDetector;
  private readonly options: Required<AdaptiveLoopControllerOptions>;

  private unsubscribePoints: (() => void) | null = null;

  private isActive = false;
  private smoothingBuffer: GazePointData[] = [];
  private featureBuffer: GazePointData[] = [];

  private previousScore = 0;
  private currentLevel: AdaptiveDifficultyLevel = 'none';
  private lastAppliedAt = 0;

  constructor(sessionId: string, options: AdaptiveLoopControllerOptions = {}) {
    this.sessionId = sessionId;
    this.detector = new DifficultyDetector(sessionId);

    this.options = {
      minConfidence: options.minConfidence ?? ADAPTIVE_LOOP_MIN_CONFIDENCE,
      smoothingWindow: options.smoothingWindow ?? ADAPTIVE_LOOP_SMOOTHING_WINDOW,
      featureWindow: options.featureWindow ?? ADAPTIVE_LOOP_FEATURE_WINDOW,
      cooldownMs: options.cooldownMs ?? ADAPTIVE_LOOP_COOLDOWN_MS,
      baseLanguage: options.baseLanguage ?? 'fr',
    };
  }

  start(): void {
    if (this.isActive) return;

    this.unsubscribePoints = EventBus.on<GazePointData>('gaze:point', (event) => {
      this.handlePoint(event.payload);
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

    this.smoothingBuffer = [];
    this.featureBuffer = [];
    this.previousScore = 0;
    this.currentLevel = 'none';
    this.lastAppliedAt = 0;
    this.isActive = false;

    logger.info('AdaptiveLoopController', 'Boucle adaptative arrêtée', {
      sessionId: this.sessionId,
    });
  }

  private handlePoint(point: GazePointData): void {
    if (!this.isActive) return;
    if (point.confidence < this.options.minConfidence) return;

    this.pushSmoothedPoint(point);
    const smoothedPoint = this.computeSmoothedPoint();

    this.featureBuffer.push(smoothedPoint);
    const maxBufferedPoints = this.options.featureWindow * 2;
    if (this.featureBuffer.length > maxBufferedPoints) {
      this.featureBuffer.splice(0, this.featureBuffer.length - maxBufferedPoints);
    }

    if (this.featureBuffer.length < this.options.featureWindow) return;

    const points = this.featureBuffer.slice(-this.options.featureWindow);
    const features = this.extractFeatures(points);
    const metrics = this.toGazeMetrics(features);

    const inferred = this.detector.infer(metrics);
    const adjustedScore = this.computeAdjustedScore(inferred?.level ?? 0, features.gazeStability);
    const nextLevel = this.resolveLevel(adjustedScore);

    const signal = inferred
      ? {
          ...inferred,
          level: adjustedScore,
          language: this.options.baseLanguage,
          timestamp: Date.now(),
        }
      : null;

    this.applyAdaptationControl(nextLevel, adjustedScore, signal);
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
      timestamp: last.timestamp,
    };
  }

  private extractFeatures(points: GazePointData[]): ExtractedFeatures {
    if (points.length < 2) {
      return {
        fixationDuration: 0,
        regressionCount: 0,
        gazeStability: 1,
        saccadeSpeed: 0,
        lineSkipRate: 0,
        blinkRate: 15,
      };
    }

    let fixationDuration = 0;
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
        fixationDuration += dt;
      }
      if (dx < -REGRESSION_DELTA_PX) {
        regressionCount++;
      }
      if (Math.abs(dy) > LINE_SKIP_DELTA_PX) {
        lineSkips++;
      }
    }

    const totalDuration = Math.max(1, points[points.length - 1].timestamp - points[0].timestamp);
    const saccadeSpeed = totalDisplacement / totalDuration;

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

    const spread = Math.sqrt(variance);
    const gazeStability = clamp(1 - spread / STABILITY_NORMALIZER_PX, 0, 1);

    return {
      fixationDuration,
      regressionCount,
      gazeStability,
      saccadeSpeed,
      lineSkipRate: lineSkips / (points.length - 1),
      blinkRate: 15,
    };
  }

  private toGazeMetrics(features: ExtractedFeatures): GazeMetrics {
    return {
      saccadeSpeed: features.saccadeSpeed,
      fixationDuration: features.fixationDuration,
      regressionCount: features.regressionCount,
      blinkRate: features.blinkRate,
      lineSkipRate: features.lineSkipRate,
      timestamp: Date.now(),
    };
  }

  private computeAdjustedScore(rawScore: number, stability: number): number {
    const instabilityPenalty = 1 - stability;
    return clamp(rawScore * 0.85 + instabilityPenalty * 0.15, 0, 1);
  }

  private resolveLevel(score: number): AdaptiveDifficultyLevel {
    if (score >= DIFFICULTY_THRESHOLD_STRONG) return 'strong';
    if (score >= DIFFICULTY_THRESHOLD_MODERATE) return 'moderate';
    if (score >= DIFFICULTY_THRESHOLD_LIGHT) return 'light';
    return 'none';
  }

  private applyAdaptationControl(
    nextLevel: AdaptiveDifficultyLevel,
    score: number,
    signal: DifficultySignal | null
  ): void {
    const stateChanged = nextLevel !== this.currentLevel;
    const crossedThreshold = this.hasCrossedThreshold(this.previousScore, score);
    this.previousScore = score;

    if (!stateChanged || !crossedThreshold) return;

    const now = Date.now();
    if (now - this.lastAppliedAt < this.options.cooldownMs) return;

    this.lastAppliedAt = now;
    this.currentLevel = nextLevel;

    if (nextLevel === 'none') {
      EventBus.emit('adaptation:reset', null, this.sessionId);
    } else {
      const safeSignal = signal ?? {
        type: 'attention',
        level: score,
        confidence: 0.4,
        language: this.options.baseLanguage,
        timestamp: now,
      };
      EventBus.emit('difficulty:detected', safeSignal, this.sessionId);
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
      sessionId: this.sessionId,
    });
  }

  private hasCrossedThreshold(previous: number, next: number): boolean {
    const boundaries = [
      DIFFICULTY_THRESHOLD_LIGHT,
      DIFFICULTY_THRESHOLD_MODERATE,
      DIFFICULTY_THRESHOLD_STRONG,
    ];

    return boundaries.some((threshold) => {
      const crossedUp = previous < threshold && next >= threshold;
      const crossedDown = previous >= threshold && next < threshold;
      return crossedUp || crossedDown;
    });
  }

  private actionsForLevel(level: AdaptiveDifficultyLevel): [string, string, string] {
    if (level === 'none') {
      return ['fontSize:base', 'spacing:base', 'color:default'];
    }
    if (level === 'light') {
      return ['fontSize:+3%', 'spacing:+8%', 'color:soft-contrast'];
    }
    if (level === 'moderate') {
      return ['fontSize:+8%', 'spacing:+14%', 'color:warm-contrast'];
    }
    return ['fontSize:+15%', 'spacing:+22%', 'color:high-contrast'];
  }
}
