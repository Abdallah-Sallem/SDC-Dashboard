/**
 * DifficultyDetector.ts
 * Hybrid detector real-time:
 * - Heuristique robuste sur fenêtre glissante (1-2s)
 * - Probabilité issue du modèle ETDD70
 *
 * Le détecteur fournit un score continu. La logique de déclenchement
 * (baseline, hysteresis, debounce) est gérée dans AdaptiveLoopController.
 */

import type {
  DetectorDebugPayload,
  DetectorMode,
  DifficultySignal,
  DifficultyType,
  GazeMetrics,
} from '../../shared/types';
import { clamp } from '../../shared/utils';
import { Etdd70LogregModel } from './Etdd70LogregModel';

interface HeuristicBreakdown {
  score: number;
  fixationVarianceScore: number;
  microSaccadeScore: number;
  regressionScore: number;
  dispersionScore: number;
  blinkScore: number;
  trackingScore: number;
}

export class DifficultyDetector {
  private readonly sessionId: string;
  private readonly trainedModel: Etdd70LogregModel;
  private mode: DetectorMode = 'hybrid';
  private lastDebug: DetectorDebugPayload = {
    mode: 'hybrid',
    heuristicScore: 0,
    modelProbability: 0,
    hybridScore: 0,
    selectedScore: 0,
    confidence: 0,
    dominantType: 'attention',
    triggered: false,
    fixationVariance: 0,
    microSaccadeIntensity: 0,
    gazeDispersion: 0,
    gazeStability: 1,
    timestamp: Date.now(),
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.trainedModel = new Etdd70LogregModel();
  }

  setMode(mode: DetectorMode): void {
    this.mode = mode;
  }

  getMode(): DetectorMode {
    return this.mode;
  }

  getLastDebug(): DetectorDebugPayload {
    return { ...this.lastDebug };
  }

  infer(metrics: GazeMetrics): DifficultySignal {
    const heuristic = this.computeHeuristic(metrics);

    let modelProbability = 0;
    try {
      modelProbability = this.trainedModel.predictProbability(metrics);
    } catch {
      modelProbability = heuristic.score;
    }

    const modelWeight = 0.35;
    const heuristicWeight = 0.65;

    const hybridScore = clamp(
      heuristic.score * heuristicWeight + modelProbability * modelWeight,
      0,
      1
    );

    const selectedScore = this.mode === 'hybrid' ? hybridScore : heuristic.score;

    const dominantType = this.classifyType({
      fixationVarianceScore: heuristic.fixationVarianceScore,
      microSaccadeScore: heuristic.microSaccadeScore,
      regressionScore: heuristic.regressionScore,
      dispersionScore: heuristic.dispersionScore,
      blinkScore: heuristic.blinkScore,
      trackingScore: heuristic.trackingScore,
    });

    const stability = clamp(
      metrics.gazeStability ?? 1 - (metrics.gazeDispersion ?? metrics.fixationInstability) / 140,
      0,
      1
    );
    const trackingQuality = clamp(1 - metrics.trackingLossRate, 0, 1);
    const modelAgreement = 1 - Math.abs(modelProbability - heuristic.score);

    const confidence = clamp(
      0.32 + modelAgreement * 0.28 + trackingQuality * 0.24 + stability * 0.16,
      0,
      1
    );

    this.lastDebug = {
      mode: this.mode,
      heuristicScore: heuristic.score,
      modelProbability,
      hybridScore,
      selectedScore,
      confidence,
      dominantType,
      triggered: false,
      fixationVariance: metrics.fixationDurationVariance,
      microSaccadeIntensity: metrics.microSaccadeIntensity,
      gazeDispersion: metrics.gazeDispersion,
      gazeStability: stability,
      timestamp: Date.now(),
    };

    return {
      type: dominantType,
      level: selectedScore,
      confidence,
      language: 'fr',
      timestamp: Date.now(),
    };
  }

  private computeHeuristic(metrics: GazeMetrics): HeuristicBreakdown {
    const fixationVarianceScore = clamp((metrics.fixationDurationVariance ?? 0) / 45_000, 0, 1);
    const microSaccadeScore = clamp(metrics.microSaccadeIntensity ?? 0, 0, 1);
    const regressionScore = clamp(
      (metrics.regressionFrequency ?? metrics.regressionCount / 6) * 1.25,
      0,
      1
    );
    const dispersionScore = clamp(
      (metrics.gazeDispersion ?? metrics.fixationInstability) / 92,
      0,
      1
    );

    const blinkScore = this.computeBlinkDeviation(metrics.blinkRate);

    const trackingScore = clamp(
      metrics.trackingLossRate * 1.3 + (1 - metrics.headStability) * 0.7,
      0,
      1
    );

    const score = clamp(
      fixationVarianceScore * 0.21 +
        microSaccadeScore * 0.22 +
        regressionScore * 0.22 +
        dispersionScore * 0.20 +
        blinkScore * 0.09 +
        trackingScore * 0.06,
      0,
      1
    );

    return {
      score,
      fixationVarianceScore,
      microSaccadeScore,
      regressionScore,
      dispersionScore,
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
    fixationVarianceScore: number;
    microSaccadeScore: number;
    regressionScore: number;
    dispersionScore: number;
    blinkScore: number;
    trackingScore: number;
  }): DifficultyType {
    if (scores.trackingScore >= 0.58) return 'line-tracking';
    if (scores.blinkScore >= 0.56) return 'fatigue';

    if (scores.fixationVarianceScore + scores.regressionScore >= scores.microSaccadeScore + 0.22) {
      return 'dyslexia-visual';
    }

    if (scores.microSaccadeScore + scores.dispersionScore > 0.78) return 'attention';

    return 'attention';
  }

  stop(): void {
    void this.sessionId;
  }
}
