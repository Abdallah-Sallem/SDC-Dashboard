/**
 * NoseAnchorGazeTracker.js
 *
 * Lightweight real-time gaze module for browser use with MediaPipe Face Mesh.
 *
 * Core idea:
 * - Use the nose bridge (nasion) as a stable head anchor.
 * - Compute eye movement relative to that anchor:
 *     relative = irisCenter - noseAnchor
 * - Smooth the relative signal with a velocity-adaptive EMA.
 *
 * Output contract emitted via callback:
 *   { x: smoothedRelativeX, y: smoothedRelativeY, isTracking: boolean }
 */

import { FaceMesh } from '@mediapipe/face_mesh';

const NOSE_NASION_INDEX = 168;
const LEFT_IRIS_INDEXES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDEXES = [473, 474, 475, 476, 477];
const EYE_DOMINANCE_X = 1.12;
const EYE_DOMINANCE_Y = 1.08;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function averagePoint(landmarks, indexes) {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const idx of indexes) {
    const point = landmarks[idx];
    if (!point) continue;
    sumX += point.x;
    sumY += point.y;
    count += 1;
  }

  if (count === 0) return null;

  return {
    x: sumX / count,
    y: sumY / count,
  };
}

/**
 * @typedef {Object} NoseAnchorOutput
 * @property {number} x Relative smoothed X (pixels, nose-anchored).
 * @property {number} y Relative smoothed Y (pixels, nose-anchored).
 * @property {boolean} isTracking True when face/iris are valid in current frame.
 */

/**
 * @typedef {Object} NoseAnchorOptions
 * @property {(output: NoseAnchorOutput) => void} [onUpdate]
 * @property {number} [baseAlpha] EMA alpha when movement is slow (stability mode).
 * @property {number} [fastAlpha] EMA alpha when movement is fast (responsiveness mode).
 * @property {number} [velocityThresholdPx] Velocity threshold to switch alpha behavior.
 * @property {number} [maxJumpPx] Outlier clamp threshold to reject single-frame spikes.
 * @property {number} [gainX] Horizontal gain applied to relative vector.
 * @property {number} [gainY] Vertical gain applied to relative vector.
 * @property {number} [minDetectionConfidence] MediaPipe detection confidence.
 * @property {number} [minTrackingConfidence] MediaPipe tracking confidence.
 * @property {boolean} [selfieMode] MediaPipe selfie mode.
 */

export class NoseAnchorGazeTracker {
  /**
   * @param {HTMLVideoElement} videoEl Live webcam video element.
   * @param {NoseAnchorOptions} [options]
   */
  constructor(videoEl, options = {}) {
    if (!videoEl) {
      throw new Error('NoseAnchorGazeTracker: video element is required.');
    }

    this.videoEl = videoEl;
    this.onUpdate = options.onUpdate ?? (() => {});

    // EMA tuning
    this.baseAlpha = options.baseAlpha ?? 0.18;
    this.fastAlpha = options.fastAlpha ?? 0.44;
    this.velocityThresholdPx = options.velocityThresholdPx ?? 10;

    // Spike guard
    this.maxJumpPx = options.maxJumpPx ?? 120;

    // Relative vector gain
    this.gainX = options.gainX ?? 1.0;
    this.gainY = options.gainY ?? 1.0;

    // FaceMesh options
    this.minDetectionConfidence = options.minDetectionConfidence ?? 0.55;
    this.minTrackingConfidence = options.minTrackingConfidence ?? 0.55;
    this.selfieMode = options.selfieMode ?? true;

    this.faceMesh = null;
    this.running = false;
    this.processing = false;
    this.rafId = null;

    this.lastRaw = null;
    this.lastSmoothed = null;
    this.lastOutput = { x: 0, y: 0, isTracking: false };

    this.onResults = this.onResults.bind(this);
    this.frameLoop = this.frameLoop.bind(this);
  }

  async init() {
    if (this.faceMesh) return;

    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: this.minDetectionConfidence,
      minTrackingConfidence: this.minTrackingConfidence,
      selfieMode: this.selfieMode,
    });

    this.faceMesh.onResults(this.onResults);
    await this.faceMesh.initialize();
  }

  async start() {
    if (this.running) return;
    await this.init();

    this.running = true;
    this.frameLoop();
  }

  stop() {
    this.running = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.processing = false;
  }

  async dispose() {
    this.stop();

    if (this.faceMesh) {
      await this.faceMesh.close();
      this.faceMesh = null;
    }

    this.lastRaw = null;
    this.lastSmoothed = null;
    this.lastOutput = { x: 0, y: 0, isTracking: false };
  }

  async frameLoop() {
    if (!this.running) return;

    if (!this.processing && this.videoEl.readyState >= 2 && this.faceMesh) {
      this.processing = true;
      try {
        await this.faceMesh.send({ image: this.videoEl });
      } catch {
        this.emitTrackingLost();
      } finally {
        this.processing = false;
      }
    }

    this.rafId = requestAnimationFrame(this.frameLoop);
  }

  /**
   * MediaPipe callback.
   *
   * Relative gaze math:
   *   eyeCenter = (leftIrisCenter + rightIrisCenter) / 2
   *   relativeNorm = eyeCenter - noseAnchor
   *   relativePx = relativeNorm * sourceDimensions
   */
  onResults(results) {
    const landmarks = results.multiFaceLandmarks?.[0];
    if (!landmarks) {
      this.emitTrackingLost();
      return;
    }

    const nose = landmarks[NOSE_NASION_INDEX];
    const leftIris = averagePoint(landmarks, LEFT_IRIS_INDEXES);
    const rightIris = averagePoint(landmarks, RIGHT_IRIS_INDEXES);

    if (!nose || (!leftIris && !rightIris)) {
      this.emitTrackingLost();
      return;
    }

    const sourceWidth = this.videoEl.videoWidth || 640;
    const sourceHeight = this.videoEl.videoHeight || 480;

    let relativeNormX = 0;
    let relativeNormY = 0;

    if (leftIris && rightIris) {
      const leftRelX = leftIris.x - nose.x;
      const leftRelY = leftIris.y - nose.y;
      const rightRelX = rightIris.x - nose.x;
      const rightRelY = rightIris.y - nose.y;

      const symmetry = 1 - clamp(Math.abs(leftRelX - rightRelX) / 0.09, 0, 1);
      const symmetryBoost = 1 + symmetry * 0.18;

      relativeNormX = ((leftRelX + rightRelX) * 0.5) * EYE_DOMINANCE_X * symmetryBoost;
      relativeNormY = ((leftRelY + rightRelY) * 0.5) * EYE_DOMINANCE_Y;
    } else {
      const eye = leftIris || rightIris;
      relativeNormX = (eye.x - nose.x) * EYE_DOMINANCE_X * 0.94;
      relativeNormY = (eye.y - nose.y) * EYE_DOMINANCE_Y * 0.94;
    }

    let rawX = relativeNormX * sourceWidth * this.gainX;
    let rawY = relativeNormY * sourceHeight * this.gainY;

    // Outlier clamp to avoid single-frame spikes.
    if (this.lastRaw) {
      const dx = rawX - this.lastRaw.x;
      const dy = rawY - this.lastRaw.y;
      const jump = Math.hypot(dx, dy);

      if (jump > this.maxJumpPx) {
        const ratio = this.maxJumpPx / jump;
        rawX = this.lastRaw.x + dx * ratio;
        rawY = this.lastRaw.y + dy * ratio;
      }
    }

    const raw = { x: rawX, y: rawY, t: performance.now() };

    // Velocity-aware EMA:
    // - slow movement => smaller alpha (more stable)
    // - fast movement => larger alpha (more responsive)
    if (!this.lastSmoothed || !this.lastRaw) {
      this.lastSmoothed = { x: raw.x, y: raw.y };
    } else {
      const dt = Math.max(1, raw.t - this.lastRaw.t);
      const velocity = Math.hypot(raw.x - this.lastRaw.x, raw.y - this.lastRaw.y) / dt;
      const velocityNorm = clamp(velocity / Math.max(1e-6, this.velocityThresholdPx / 16), 0, 1);
      const alpha = this.baseAlpha + (this.fastAlpha - this.baseAlpha) * velocityNorm;

      this.lastSmoothed = {
        x: this.lastSmoothed.x + alpha * (raw.x - this.lastSmoothed.x),
        y: this.lastSmoothed.y + alpha * (raw.y - this.lastSmoothed.y),
      };
    }

    this.lastRaw = raw;

    this.lastOutput = {
      x: this.lastSmoothed.x,
      y: this.lastSmoothed.y,
      isTracking: true,
    };

    this.onUpdate(this.lastOutput);
  }

  emitTrackingLost() {
    this.lastOutput = {
      x: this.lastOutput.x,
      y: this.lastOutput.y,
      isTracking: false,
    };

    this.onUpdate(this.lastOutput);
  }

  /**
   * Optional pull API if you prefer polling over callbacks.
   * @returns {NoseAnchorOutput}
   */
  getLatestOutput() {
    return { ...this.lastOutput };
  }
}
