/**
 * DifficultyDetector.ts
 * Hybrid detector for V0:
 * - Heuristic behavioral score (stable in real-time)
 * - ETDD70-trained logistic probability (data-driven signal)
 *
 * It combines:
 * - fixation instability (jitter)
 * - long fixation
 * - regressions
 * - blink deviation
 * - head/tracking instability
 */

import { DIFFICULTY_THRESHOLD_LIGHT } from '../../shared/constants';
import type { DifficultySignal, DifficultyType, GazeMetrics } from '../../shared/types';
import { clamp } from '../../shared/utils';
import { Etdd70LogregModel } from './Etdd70LogregModel';

interface HeuristicBreakdown {
  score: number;
  instabilityScore: number;
  longFixationScore: number;
  regressionScore: number;
  blinkScore: number;
  trackingScore: number;
}

export class DifficultyDetector {
  private readonly sessionId: string;
  private readonly trainedModel: Etdd70LogregModel;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.trainedModel = new Etdd70LogregModel();
  }

  infer(metrics: GazeMetrics): DifficultySignal | null {
    const heuristic = this.computeHeuristic(metrics);

    let modelProbability = 0;
    try {
      modelProbability = this.trainedModel.predictProbability(metrics);
    } catch {
      modelProbability = heuristic.score;
    }

    const modelWeight = 0.35;
    const heuristicWeight = 0.65;

    const difficultyScore = clamp(
      heuristic.score * heuristicWeight + modelProbability * modelWeight,
      0,
      1
    );

    if (difficultyScore < DIFFICULTY_THRESHOLD_LIGHT) {
      return null;
    }

    const dominantType = this.classifyType({
      instabilityScore: heuristic.instabilityScore,
      longFixationScore: heuristic.longFixationScore,
      regressionScore: heuristic.regressionScore,
      blinkScore: heuristic.blinkScore,
      trackingScore: heuristic.trackingScore,
    });

    const modelAgreement = 1 - Math.abs(modelProbability - heuristic.score);
    const confidence = clamp(
      0.45 +
        modelAgreement * 0.25 +
        difficultyScore * 0.20 +
        (1 - metrics.trackingLossRate) * 0.10,
      0,
      1
    );

    return {
      type: dominantType,
      level: difficultyScore,
      confidence,
      language: 'fr',
      timestamp: Date.now(),
    };
  }

  private computeHeuristic(metrics: GazeMetrics): HeuristicBreakdown {
    const instabilityScore = clamp(metrics.fixationInstability / 42, 0, 1);

    const longFixationScore =
      metrics.fixationDuration <= 430
        ? 0
        : clamp((metrics.fixationDuration - 430) / 850, 0, 1);

    const regressionScore = clamp(metrics.regressionCount / 4, 0, 1);

    const blinkScore = this.computeBlinkDeviation(metrics.blinkRate);

    const trackingScore = clamp(
      metrics.trackingLossRate * 1.3 + (1 - metrics.headStability) * 0.7,
      0,
      1
    );

    const score = clamp(
      instabilityScore * 0.28 +
        longFixationScore * 0.30 +
        regressionScore * 0.22 +
        blinkScore * 0.12 +
        trackingScore * 0.08,
      0,
      1
    );

    return {
      score,
      instabilityScore,
      longFixationScore,
      regressionScore,
      blinkScore,
      trackingScore,
    };
  }

  private computeBlinkDeviation(blinkRate: number): number {
    if (blinkRate >= 12 && blinkRate <= 24) return 0;
    if (blinkRate < 12) {
      return clamp((12 - blinkRate) / 12, 0, 1);
    }
    return clamp((blinkRate - 24) / 20, 0, 1);
  }

  private classifyType(scores: {
    instabilityScore: number;
    longFixationScore: number;
    regressionScore: number;
    blinkScore: number;
    trackingScore: number;
  }): DifficultyType {
    if (scores.blinkScore >= 0.55) return 'fatigue';

    if (scores.trackingScore >= 0.55) return 'line-tracking';

    if (
      scores.longFixationScore + scores.regressionScore >=
      scores.instabilityScore + 0.2
    ) {
      return 'dyslexia-visual';
    }

    if (scores.instabilityScore > 0.45) return 'attention';

    return 'attention';
  }

  stop(): void {
    void this.sessionId;
  }
}
