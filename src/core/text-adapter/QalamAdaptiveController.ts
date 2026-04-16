/**
 * QalamAdaptiveController.ts
 * Role: Stable, demo-safe adaptation controller for UI parameters.
 * Applies EMA smoothing, hysteresis, hold time, rate limiting, and lerp transitions.
 */

import { clamp } from '../../shared/utils';

export interface QalamAdaptiveOutput {
  fontScale: number;
  wordSpacing: number;
  isAssistActive: boolean;
}

interface QalamAdaptiveOptions {
  emaAlpha?: number;
  highThreshold?: number;
  lowThreshold?: number;
  holdTimeMs?: number;
  maxUpdateRateMs?: number;
  minConfidence?: number;
  fontScaleMax?: number;
  wordSpacingMax?: number;
  lerpAlpha?: number;
}

const DEFAULTS: Required<QalamAdaptiveOptions> = {
  emaAlpha: 0.14,
  highThreshold: 0.7,
  lowThreshold: 0.4,
  holdTimeMs: 1000,
  maxUpdateRateMs: 800,
  minConfidence: 0.62,
  fontScaleMax: 1.15,
  wordSpacingMax: 1.2,
  lerpAlpha: 0.045,
};

const FRAME_MS = 1000 / 60;
const TARGET_EPSILON = 0.005;

export class QalamAdaptiveController {
  private readonly options: Required<QalamAdaptiveOptions>;
  private smoothedScore = 0;
  private hasScore = false;

  private assistActive = false;
  private holdMs = 0;
  private timeSinceTargetUpdate = 0;

  private targetFontScale = 1;
  private targetWordSpacing = 1;
  private currentFontScale = 1;
  private currentWordSpacing = 1;

  constructor(options: QalamAdaptiveOptions = {}) {
    const emaAlpha = clamp(options.emaAlpha ?? DEFAULTS.emaAlpha, 0.1, 0.2);
    this.options = {
      ...DEFAULTS,
      ...options,
      emaAlpha,
    };
  }

  update(score: number, confidence: number, deltaTimeMs: number): QalamAdaptiveOutput {
    const dt = Number.isFinite(deltaTimeMs) && deltaTimeMs > 0 ? deltaTimeMs : 0;

    if (!Number.isFinite(score) || confidence < this.options.minConfidence) {
      this.timeSinceTargetUpdate = Math.min(
        this.options.maxUpdateRateMs,
        this.timeSinceTargetUpdate + dt
      );
      return this.buildOutput();
    }

    const clampedScore = clamp(score, 0, 1);
    this.timeSinceTargetUpdate = Math.min(
      this.options.maxUpdateRateMs,
      this.timeSinceTargetUpdate + dt
    );

    if (!this.hasScore) {
      this.smoothedScore = clampedScore;
      this.hasScore = true;
    } else {
      this.smoothedScore =
        this.options.emaAlpha * clampedScore +
        (1 - this.options.emaAlpha) * this.smoothedScore;
    }

    let desiredActive = this.assistActive;

    if (!this.assistActive) {
      if (this.smoothedScore >= this.options.highThreshold) {
        this.holdMs = Math.min(this.options.holdTimeMs, this.holdMs + dt);
        if (this.holdMs >= this.options.holdTimeMs) {
          desiredActive = true;
        }
      } else {
        this.holdMs = 0;
      }
    } else {
      this.holdMs = 0;
      if (this.smoothedScore <= this.options.lowThreshold) {
        desiredActive = false;
      }
    }

    const intensity = desiredActive
      ? clamp(
          (this.smoothedScore - this.options.highThreshold) /
            Math.max(0.01, 1 - this.options.highThreshold),
          0,
          1
        )
      : 0;

    const desiredFontScale =
      1 + intensity * (this.options.fontScaleMax - 1);
    const desiredWordSpacing =
      1 + intensity * (this.options.wordSpacingMax - 1);

    const targetChangeNeeded =
      desiredActive !== this.assistActive ||
      Math.abs(desiredFontScale - this.targetFontScale) > TARGET_EPSILON ||
      Math.abs(desiredWordSpacing - this.targetWordSpacing) > TARGET_EPSILON;

    if (targetChangeNeeded && this.timeSinceTargetUpdate >= this.options.maxUpdateRateMs) {
      this.assistActive = desiredActive;
      this.targetFontScale = clamp(desiredFontScale, 1, this.options.fontScaleMax);
      this.targetWordSpacing = clamp(
        desiredWordSpacing,
        1,
        this.options.wordSpacingMax
      );
      this.timeSinceTargetUpdate = 0;
    }

    const lerpFactor = this.toLerpFactor(dt);
    this.currentFontScale = this.lerp(this.currentFontScale, this.targetFontScale, lerpFactor);
    this.currentWordSpacing = this.lerp(
      this.currentWordSpacing,
      this.targetWordSpacing,
      lerpFactor
    );

    this.currentFontScale = clamp(this.currentFontScale, 1, this.options.fontScaleMax);
    this.currentWordSpacing = clamp(this.currentWordSpacing, 1, this.options.wordSpacingMax);

    return this.buildOutput();
  }

  private toLerpFactor(deltaTimeMs: number): number {
    if (deltaTimeMs <= 0) return 0;
    const factor = 1 - Math.pow(1 - this.options.lerpAlpha, deltaTimeMs / FRAME_MS);
    return clamp(factor, 0, 1);
  }

  private lerp(current: number, target: number, alpha: number): number {
    return current + (target - current) * alpha;
  }

  private buildOutput(): QalamAdaptiveOutput {
    return {
      fontScale: this.currentFontScale,
      wordSpacing: this.currentWordSpacing,
      isAssistActive: this.assistActive,
    };
  }
}
