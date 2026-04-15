export interface NoseAnchorOutput {
  x: number;
  y: number;
  isTracking: boolean;
}

export interface NoseAnchorOptions {
  onUpdate?: (output: NoseAnchorOutput) => void;
  baseAlpha?: number;
  fastAlpha?: number;
  velocityThresholdPx?: number;
  maxJumpPx?: number;
  gainX?: number;
  gainY?: number;
  minDetectionConfidence?: number;
  minTrackingConfidence?: number;
  selfieMode?: boolean;
}

export class NoseAnchorGazeTracker {
  constructor(videoEl: HTMLVideoElement, options?: NoseAnchorOptions);

  init(): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  dispose(): Promise<void>;
  getLatestOutput(): NoseAnchorOutput;
}