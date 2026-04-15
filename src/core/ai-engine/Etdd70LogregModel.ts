import modelArtifact from './model/etdd70_logreg_v0.json';
import type { GazeMetrics } from '../../shared/types';
import { clamp } from '../../shared/utils';

interface Etdd70ModelArtifact {
  feature_names: string[];
  coefficients: number[];
  intercept: number;
  scaler_mean: number[];
  scaler_scale: number[];
  feature_ranges: Record<string, { min: number; max: number }>;
}

/**
 * Lightweight runtime logistic model trained from ETDD70 metrics.
 * It estimates a dyslexia-risk proxy probability used by the live detector.
 */
export class Etdd70LogregModel {
  private readonly artifact: Etdd70ModelArtifact;

  constructor(artifact: Etdd70ModelArtifact = modelArtifact as Etdd70ModelArtifact) {
    this.artifact = artifact;
  }

  predictProbability(metrics: GazeMetrics): number {
    const featureMap = this.mapMetricsToModelFeatures(metrics);

    const values = this.artifact.feature_names.map((name) => {
      const raw = featureMap[name] ?? 0;
      const range = this.artifact.feature_ranges[name];
      if (!range) return raw;
      return clamp(raw, range.min, range.max);
    });

    const standardized = values.map((value, index) => {
      const mean = this.artifact.scaler_mean[index] ?? 0;
      const scale = this.artifact.scaler_scale[index] ?? 1;
      return (value - mean) / (scale || 1);
    });

    let logit = this.artifact.intercept;
    for (let i = 0; i < standardized.length; i++) {
      logit += standardized[i] * (this.artifact.coefficients[i] ?? 0);
    }

    return 1 / (1 + Math.exp(-logit));
  }

  private mapMetricsToModelFeatures(metrics: GazeMetrics): Record<string, number> {
    // Regression count in ETDD70 is trial-level. We upscale short-window counts
    // so runtime signals are on a comparable magnitude.
    const regressionCountProxy = metrics.regressionCount * 12;

    return {
      fixation_duration_ms: metrics.fixationDuration,
      regression_count: regressionCountProxy,
      saccade_speed_proxy: metrics.saccadeSpeed,
      line_skip_rate: metrics.lineSkipRate,
    };
  }
}
