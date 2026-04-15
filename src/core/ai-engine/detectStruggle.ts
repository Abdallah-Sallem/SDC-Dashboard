export type StruggleBand = 'smooth' | 'early' | 'high';

export interface SaccadeSample {
  dx: number;
  timestamp: number;
}

export interface DetectStruggleInput {
  now: number;
  fixationDurationMs: number;
  wordCharCount: number;
  gazeVelocity: number;
  meanFixationDurationMs: number;
  wordComplexity: number;
  saccades: SaccadeSample[];
}

export interface DetectStruggleOutput {
  expectedFixationDurationMs: number;
  fixationTriggerDurationMs: number;
  fixationDurationOverMean: number;
  regressionCount: number;
  regressionSignal: number;
  velocityRejected: boolean;
  score: number;
  band: StruggleBand;
}

export const STRUGGLE_CONSTANTS = {
  // Dynamic fixation thresholding
  BASE_CONSTANT_MS: 170,
  PER_CHAR_WEIGHT_MS: 34,
  FIXATION_TRIGGER_MULTIPLIER: 1.5,

  // Regression detection over short temporal context
  REGRESSION_WINDOW_MS: 2000,
  REGRESSION_SIGNIFICANT_NEGATIVE_DX: -26,
  LAST_SACCADE_COUNT: 3,
  REGRESSION_BOOST_COUNT: 2,

  // Velocity noise filtering (blink/head turn rejection)
  MAX_VALID_VELOCITY_PX_PER_MS: 1.1,

  // Weighted probability output
  WEIGHT_FIXATION_OVER_MEAN: 0.45,
  WEIGHT_REGRESSION: 0.30,
  WEIGHT_WORD_COMPLEXITY: 0.25,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyBand(score: number): StruggleBand {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'early';
  return 'smooth';
}

export function expectedFixationDuration(wordCharCount: number): number {
  const charCount = Math.max(1, Math.round(wordCharCount));
  return (
    STRUGGLE_CONSTANTS.BASE_CONSTANT_MS +
    charCount * STRUGGLE_CONSTANTS.PER_CHAR_WEIGHT_MS
  );
}

export function detectStruggle(input: DetectStruggleInput): DetectStruggleOutput {
  const now = input.now;

  if (input.gazeVelocity > STRUGGLE_CONSTANTS.MAX_VALID_VELOCITY_PX_PER_MS) {
    return {
      expectedFixationDurationMs: expectedFixationDuration(input.wordCharCount),
      fixationTriggerDurationMs:
        expectedFixationDuration(input.wordCharCount) *
        STRUGGLE_CONSTANTS.FIXATION_TRIGGER_MULTIPLIER,
      fixationDurationOverMean: 0,
      regressionCount: 0,
      regressionSignal: 0,
      velocityRejected: true,
      score: 0,
      band: 'smooth',
    };
  }

  const efd = expectedFixationDuration(input.wordCharCount);
  const triggerDuration = efd * STRUGGLE_CONSTANTS.FIXATION_TRIGGER_MULTIPLIER;

  const meanFix = Math.max(120, input.meanFixationDurationMs);
  const fixationOverMean = clamp(
    (input.fixationDurationMs - meanFix) / meanFix,
    0,
    1
  );

  const fixationTriggered = input.fixationDurationMs > triggerDuration;
  const fixationSignal = fixationTriggered
    ? clamp(
        (input.fixationDurationMs - triggerDuration) /
          Math.max(100, triggerDuration),
        0,
        1
      )
    : fixationOverMean * 0.35;

  const recentSaccades = input.saccades
    .filter((sample) => now - sample.timestamp <= STRUGGLE_CONSTANTS.REGRESSION_WINDOW_MS)
    .slice(-STRUGGLE_CONSTANTS.LAST_SACCADE_COUNT);

  const regressionCount = recentSaccades.reduce((count, sample) => {
    return sample.dx <= STRUGGLE_CONSTANTS.REGRESSION_SIGNIFICANT_NEGATIVE_DX
      ? count + 1
      : count;
  }, 0);

  let regressionSignal = 0;
  if (regressionCount > STRUGGLE_CONSTANTS.REGRESSION_BOOST_COUNT) {
    regressionSignal = clamp(regressionCount / STRUGGLE_CONSTANTS.LAST_SACCADE_COUNT, 0, 1);
  } else {
    regressionSignal = clamp(regressionCount / 4, 0, 0.55);
  }

  const wordComplexity = clamp(input.wordComplexity, 0, 1);

  const weightSum =
    STRUGGLE_CONSTANTS.WEIGHT_FIXATION_OVER_MEAN +
    STRUGGLE_CONSTANTS.WEIGHT_REGRESSION +
    STRUGGLE_CONSTANTS.WEIGHT_WORD_COMPLEXITY;

  const score = clamp(
    (
      fixationSignal * STRUGGLE_CONSTANTS.WEIGHT_FIXATION_OVER_MEAN +
      regressionSignal * STRUGGLE_CONSTANTS.WEIGHT_REGRESSION +
      wordComplexity * STRUGGLE_CONSTANTS.WEIGHT_WORD_COMPLEXITY
    ) / weightSum,
    0,
    1
  );

  return {
    expectedFixationDurationMs: efd,
    fixationTriggerDurationMs: triggerDuration,
    fixationDurationOverMean: fixationOverMean,
    regressionCount,
    regressionSignal,
    velocityRejected: false,
    score,
    band: classifyBand(score),
  };
}
