import { FaceMesh } from '@mediapipe/face_mesh';

/* =========================
 * QalamTracker Constants
 * ========================= */
const NOSE_BRIDGE_INDEX = 168;
const LEFT_IRIS_INDEXES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDEXES = [473, 474, 475, 476, 477];

const EPSILON = 1e-6;
const DEFAULT_MAX_FPS = 30;

const DEFAULT_CONFIG = {
  fpsTarget: 30,
  smoothingFactor: 0.22,
  debug: false,
  windowMs: 500,
  outlierDistance: 0.45,
  confidenceDecayPerSecond: 0.55,
  minConfidenceThreshold: 0.2,
  weights: {
    backtrack: 0.4,
    volatility: 0.35,
    stagnation: 0.25,
  },
  kalman: {
    processNoisePosition: 2.0e-4,
    processNoiseVelocity: 1.5e-2,
    measurementNoise: 1.6e-2,
  },
};

/* =========================
 * Math Helpers
 * ========================= */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

function square(v) {
  return v * v;
}

function hypot2(x, y) {
  return Math.sqrt(x * x + y * y);
}

function averageLandmark2D(landmarks, indexes, out) {
  let count = 0;
  let x = 0;
  let y = 0;

  for (let i = 0; i < indexes.length; i += 1) {
    const point = landmarks[indexes[i]];
    if (!point) continue;
    x += point.x;
    y += point.y;
    count += 1;
  }

  if (count === 0) {
    out.valid = false;
    return out;
  }

  out.x = x / count;
  out.y = y / count;
  out.valid = true;
  return out;
}

/* =========================
 * QalamTracker
 * ========================= */
export class QalamTracker {
  constructor(videoElement, config = {}) {
    if (!(videoElement instanceof HTMLVideoElement)) {
      throw new Error('QalamTracker requires a valid HTMLVideoElement');
    }

    this.videoElement = videoElement;
    this.config = this.#mergeConfig(config);

    this.debugCanvas = this.config.debugCanvas instanceof HTMLCanvasElement ? this.config.debugCanvas : null;
    this.debugCtx = this.debugCanvas ? this.debugCanvas.getContext('2d') : null;

    this.faceMesh = null;
    this.stream = null;

    this.isInitialized = false;
    this.isRunning = false;
    this.isProcessingFrame = false;

    this.frameRequestId = 0;
    this.frameIntervalMs = 1000 / clamp(this.config.fpsTarget, 5, DEFAULT_MAX_FPS);
    this.lastLoopTs = 0;
    this.lastPredictionTs = 0;
    this.lastMeasurementTs = 0;

    // Publicly exposed filtered gaze.
    this.smoothedGaze = { x: 0, y: 0 };

    this.rawGazeX = 0;
    this.rawGazeY = 0;
    this.confidence = 0;

    this.lastStableGazeX = 0;
    this.lastStableGazeY = 0;
    this.hasStableGaze = false;

    this.lastInterEyeDistance = 0;
    this.lastRoll = 0;

    // Reusable containers to avoid allocations in hot loop.
    this._nose = { x: 0, y: 0, valid: false };
    this._leftIris = { x: 0, y: 0, valid: false };
    this._rightIris = { x: 0, y: 0, valid: false };

    // Kalman state: [x, y, vx, vy]
    this.state = new Float64Array(4);
    this.P = new Float64Array(16);
    this.A = new Float64Array(16);
    this.AP = new Float64Array(16);
    this.PPred = new Float64Array(16);

    this.#resetKalman();

    // Time-based rolling buffer (ring buffers).
    const baseCapacity = Math.ceil((this.config.windowMs / 1000) * this.config.fpsTarget * 6);
    this.bufferCapacity = Math.max(120, baseCapacity);
    this.sampleT = new Float64Array(this.bufferCapacity);
    this.sampleX = new Float32Array(this.bufferCapacity);
    this.sampleY = new Float32Array(this.bufferCapacity);
    this.bufferHead = 0;
    this.bufferCount = 0;

    this.features = {
      backtrack: 0,
      volatility: 0,
      stagnation: 0,
    };

    this.scoreEma = 0;

    // Bind once for rAF and MediaPipe callbacks.
    this._loop = this._loop.bind(this);
    this._onResults = this._onResults.bind(this);
  }

  /* =========================
   * Public API
   * ========================= */
  async init() {
    if (this.isInitialized) return;

    await this.#initWebcam();
    await this.#initFaceMesh();

    if (this.config.debug) {
      this.#initDebugOverlay();
    }

    this.isInitialized = true;
  }

  async start() {
    if (this.isRunning) return;
    if (!this.isInitialized) {
      await this.init();
    }

    this.isRunning = true;
    this.lastLoopTs = performance.now();
    this.lastPredictionTs = this.lastLoopTs;
    this.lastMeasurementTs = this.lastLoopTs;

    this.frameRequestId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.isRunning = false;

    if (this.frameRequestId) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = 0;
    }

    this.isProcessingFrame = false;

    if (this.faceMesh) {
      this.faceMesh.close();
      this.faceMesh = null;
    }

    if (this.stream) {
      const tracks = this.stream.getTracks();
      for (let i = 0; i < tracks.length; i += 1) {
        tracks[i].stop();
      }
      this.stream = null;
    }

    this.videoElement.srcObject = null;
    this.isInitialized = false;
  }

  getCurrentState() {
    return {
      gaze: {
        x: this.smoothedGaze.x,
        y: this.smoothedGaze.y,
      },
      features: {
        backtrack: this.features.backtrack,
        volatility: this.features.volatility,
        stagnation: this.features.stagnation,
      },
      struggleScore: this.scoreEma,
      confidence: this.confidence,
    };
  }

  /* =========================
   * Initialization Layer
   * ========================= */
  async #initWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('getUserMedia is not available in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    this.videoElement.srcObject = this.stream;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;

    await this.videoElement.play();
  }

  async #initFaceMesh() {
    this.faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55,
      selfieMode: true,
    });

    this.faceMesh.onResults(this._onResults);
    await this.faceMesh.initialize();
  }

  #initDebugOverlay() {
    if (!this.debugCanvas) {
      const parent = this.videoElement.parentElement;
      if (!parent) return;

      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.pointerEvents = 'none';
      parent.appendChild(canvas);

      this.debugCanvas = canvas;
      this.debugCtx = canvas.getContext('2d');
    }

    if (!this.debugCanvas || !this.debugCtx) return;

    if (this.videoElement.videoWidth > 0 && this.videoElement.videoHeight > 0) {
      this.debugCanvas.width = this.videoElement.videoWidth;
      this.debugCanvas.height = this.videoElement.videoHeight;
    }
  }

  #mergeConfig(config) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
      weights: {
        ...DEFAULT_CONFIG.weights,
        ...(config.weights || {}),
      },
      kalman: {
        ...DEFAULT_CONFIG.kalman,
        ...(config.kalman || {}),
      },
    };

    merged.fpsTarget = clamp(merged.fpsTarget, 5, DEFAULT_MAX_FPS);
    merged.smoothingFactor = clamp(merged.smoothingFactor, 0.05, 0.9);
    merged.windowMs = clamp(merged.windowMs, 250, 2000);

    return merged;
  }

  #resetKalman() {
    this.state[0] = 0;
    this.state[1] = 0;
    this.state[2] = 0;
    this.state[3] = 0;

    for (let i = 0; i < 16; i += 1) {
      this.P[i] = 0;
      this.A[i] = 0;
      this.AP[i] = 0;
      this.PPred[i] = 0;
    }

    this.P[0] = 0.15;
    this.P[5] = 0.15;
    this.P[10] = 0.08;
    this.P[15] = 0.08;
  }

  /* =========================
   * Frame Loop
   * ========================= */
  _loop(ts) {
    if (!this.isRunning) return;

    this.frameRequestId = requestAnimationFrame(this._loop);

    const elapsed = ts - this.lastLoopTs;
    if (elapsed < this.frameIntervalMs) {
      return;
    }

    const dtSec = clamp((ts - this.lastPredictionTs) / 1000, 0.001, 0.08);
    this.lastLoopTs = ts;
    this.lastPredictionTs = ts;

    // Kalman predict runs every logical frame to keep velocity model stable.
    this.#kalmanPredict(dtSec);

    if (this.isProcessingFrame || !this.faceMesh) {
      this.#handleMissingMeasurement(ts, dtSec);
      return;
    }

    if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.#handleMissingMeasurement(ts, dtSec);
      return;
    }

    this.isProcessingFrame = true;
    this.faceMesh
      .send({ image: this.videoElement })
      .catch(() => {
        this.#handleMissingMeasurement(ts, dtSec);
      })
      .finally(() => {
        this.isProcessingFrame = false;
      });
  }

  _onResults(results) {
    const ts = performance.now();
    const dtSec = clamp((ts - this.lastMeasurementTs) / 1000, 0.001, 0.08);

    const measurement = this.#extractRelativeGaze(results);
    if (!measurement.valid) {
      this.#handleMissingMeasurement(ts, dtSec);
      this.#drawDebugOverlay();
      return;
    }

    // Outlier gate before Kalman correction to reject sudden spikes.
    const predictedX = this.state[0];
    const predictedY = this.state[1];
    const innovationDistance = hypot2(measurement.x - predictedX, measurement.y - predictedY);
    const adaptiveOutlier = this.config.outlierDistance + (1 - this.confidence) * 0.25;

    if (innovationDistance <= adaptiveOutlier) {
      // Measurement noise tuned by landmark confidence.
      // Higher confidence => lower R => stronger correction.
      const baseR = this.config.kalman.measurementNoise;
      const adaptiveR = baseR / clamp(measurement.confidence, 0.25, 1);
      this.#kalmanUpdate(measurement.x, measurement.y, adaptiveR);

      this.rawGazeX = measurement.x;
      this.rawGazeY = measurement.y;

      this.lastStableGazeX = this.state[0];
      this.lastStableGazeY = this.state[1];
      this.hasStableGaze = true;

      this.confidence = lerp(this.confidence, measurement.confidence, 0.32);
      this.lastMeasurementTs = ts;

      this.#pushSample(ts, this.state[0], this.state[1]);
      this.#computeBehaviorFeatures();
      this.#computeStruggleScore();
    } else {
      // Spike rejected: keep predicted state and decay confidence softly.
      this.#handleMissingMeasurement(ts, dtSec);
      this.confidence = clamp(this.confidence - 0.03, 0, 1);
    }

    this.smoothedGaze.x = this.state[0];
    this.smoothedGaze.y = this.state[1];

    this.#drawDebugOverlay();
  }

  /* =========================
   * Landmark Extraction + Hybrid Nose-Anchor Model
   * ========================= */
  #extractRelativeGaze(results) {
    const landmarks = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
    if (!landmarks || landmarks.length === 0) {
      return { valid: false, x: 0, y: 0, confidence: 0 };
    }

    const nose = landmarks[NOSE_BRIDGE_INDEX];
    if (!nose) {
      return { valid: false, x: 0, y: 0, confidence: 0 };
    }

    this._nose.x = nose.x;
    this._nose.y = nose.y;
    this._nose.valid = true;

    averageLandmark2D(landmarks, LEFT_IRIS_INDEXES, this._leftIris);
    averageLandmark2D(landmarks, RIGHT_IRIS_INDEXES, this._rightIris);

    const hasLeft = this._leftIris.valid;
    const hasRight = this._rightIris.valid;

    if (!hasLeft && !hasRight) {
      return { valid: false, x: 0, y: 0, confidence: 0 };
    }

    let gazeVecX = 0;
    let gazeVecY = 0;
    let interEyeDistance = this.lastInterEyeDistance;
    let roll = this.lastRoll;
    let confidence = 0.62;

    if (hasLeft && hasRight) {
      const leftVecX = this._leftIris.x - this._nose.x;
      const leftVecY = this._leftIris.y - this._nose.y;
      const rightVecX = this._rightIris.x - this._nose.x;
      const rightVecY = this._rightIris.y - this._nose.y;

      gazeVecX = (leftVecX + rightVecX) * 0.5;
      gazeVecY = (leftVecY + rightVecY) * 0.5;

      const eyeDx = this._rightIris.x - this._leftIris.x;
      const eyeDy = this._rightIris.y - this._leftIris.y;
      interEyeDistance = Math.max(hypot2(eyeDx, eyeDy), EPSILON);
      roll = Math.atan2(eyeDy, eyeDx);

      this.lastInterEyeDistance = interEyeDistance;
      this.lastRoll = roll;
      confidence = 0.9;
    } else {
      // Partial landmark fallback: single-eye relative vector.
      const eye = hasLeft ? this._leftIris : this._rightIris;
      gazeVecX = eye.x - this._nose.x;
      gazeVecY = eye.y - this._nose.y;
      confidence = 0.68;
    }

    if (!Number.isFinite(interEyeDistance) || interEyeDistance < EPSILON) {
      return { valid: false, x: 0, y: 0, confidence: 0 };
    }

    // Roll compensation to project to a stable reading plane:
    // - X axis follows reading progression
    // - Y axis follows vertical drift
    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);

    const rotatedX = gazeVecX * cosRoll + gazeVecY * sinRoll;
    const rotatedY = -gazeVecX * sinRoll + gazeVecY * cosRoll;

    // Dimensionless normalization to remove face-distance scale dependency.
    const normalizedX = rotatedX / interEyeDistance;
    const normalizedY = rotatedY / interEyeDistance;

    // Confidence shaping from geometric plausibility.
    const inFramePenalty = Math.max(
      0,
      Math.abs(this._nose.x - 0.5) * 1.6 - 0.42,
      Math.abs(this._nose.y - 0.5) * 1.8 - 0.45,
    );

    confidence *= clamp(1 - inFramePenalty, 0.15, 1);

    if (!hasLeft || !hasRight) {
      confidence *= 0.86;
    }

    return {
      valid: Number.isFinite(normalizedX) && Number.isFinite(normalizedY),
      x: normalizedX,
      y: normalizedY,
      confidence: clamp(confidence, 0, 1),
    };
  }

  /* =========================
   * Kalman Filter (Constant Velocity)
   * state = [x, y, vx, vy]
   * obs   = [gaze_x, gaze_y]
   * ========================= */
  #kalmanPredict(dtSec) {
    const dt = dtSec;

    // State prediction.
    this.state[0] += this.state[2] * dt;
    this.state[1] += this.state[3] * dt;

    // Build transition matrix A in-place.
    // [1 0 dt 0]
    // [0 1 0 dt]
    // [0 0 1  0]
    // [0 0 0  1]
    this.A[0] = 1; this.A[1] = 0; this.A[2] = dt; this.A[3] = 0;
    this.A[4] = 0; this.A[5] = 1; this.A[6] = 0; this.A[7] = dt;
    this.A[8] = 0; this.A[9] = 0; this.A[10] = 1; this.A[11] = 0;
    this.A[12] = 0; this.A[13] = 0; this.A[14] = 0; this.A[15] = 1;

    // AP = A * P
    this.#mul4x4(this.A, this.P, this.AP);

    // PPred = AP * A^T
    this.#mul4x4AT(this.AP, this.A, this.PPred);

    // Process noise tuning:
    // - qPos controls smoothness of position.
    // - qVel controls how quickly velocity can change.
    const qPos = this.config.kalman.processNoisePosition;
    const qVel = this.config.kalman.processNoiseVelocity;

    this.PPred[0] += qPos;
    this.PPred[5] += qPos;
    this.PPred[10] += qVel;
    this.PPred[15] += qVel;

    this.#copy16(this.PPred, this.P);
  }

  #kalmanUpdate(measuredX, measuredY, measurementNoise) {
    const p00 = this.P[0];
    const p01 = this.P[1];
    const p02 = this.P[2];
    const p03 = this.P[3];

    const p10 = this.P[4];
    const p11 = this.P[5];
    const p12 = this.P[6];
    const p13 = this.P[7];

    const p20 = this.P[8];
    const p21 = this.P[9];
    const p22 = this.P[10];
    const p23 = this.P[11];

    const p30 = this.P[12];
    const p31 = this.P[13];
    const p32 = this.P[14];
    const p33 = this.P[15];

    // Innovation y = z - Hx where H selects [x, y].
    const innovX = measuredX - this.state[0];
    const innovY = measuredY - this.state[1];

    // S = H P H^T + R (2x2)
    const s00 = p00 + measurementNoise;
    const s01 = p01;
    const s10 = p10;
    const s11 = p11 + measurementNoise;

    const det = s00 * s11 - s01 * s10;
    if (Math.abs(det) < 1e-10) {
      return;
    }

    const invDet = 1 / det;

    // K = P H^T S^-1 (4x2)
    const k00 = (p00 * s11 - p01 * s10) * invDet;
    const k01 = (-p00 * s01 + p01 * s00) * invDet;

    const k10 = (p10 * s11 - p11 * s10) * invDet;
    const k11 = (-p10 * s01 + p11 * s00) * invDet;

    const k20 = (p20 * s11 - p21 * s10) * invDet;
    const k21 = (-p20 * s01 + p21 * s00) * invDet;

    const k30 = (p30 * s11 - p31 * s10) * invDet;
    const k31 = (-p30 * s01 + p31 * s00) * invDet;

    // State correction.
    this.state[0] += k00 * innovX + k01 * innovY;
    this.state[1] += k10 * innovX + k11 * innovY;
    this.state[2] += k20 * innovX + k21 * innovY;
    this.state[3] += k30 * innovX + k31 * innovY;

    // Covariance correction: P = (I - K H) P
    // With H selecting first two rows, this becomes row-wise subtraction.
    this.P[0] = p00 - (k00 * p00 + k01 * p10);
    this.P[1] = p01 - (k00 * p01 + k01 * p11);
    this.P[2] = p02 - (k00 * p02 + k01 * p12);
    this.P[3] = p03 - (k00 * p03 + k01 * p13);

    this.P[4] = p10 - (k10 * p00 + k11 * p10);
    this.P[5] = p11 - (k10 * p01 + k11 * p11);
    this.P[6] = p12 - (k10 * p02 + k11 * p12);
    this.P[7] = p13 - (k10 * p03 + k11 * p13);

    this.P[8] = p20 - (k20 * p00 + k21 * p10);
    this.P[9] = p21 - (k20 * p01 + k21 * p11);
    this.P[10] = p22 - (k20 * p02 + k21 * p12);
    this.P[11] = p23 - (k20 * p03 + k21 * p13);

    this.P[12] = p30 - (k30 * p00 + k31 * p10);
    this.P[13] = p31 - (k30 * p01 + k31 * p11);
    this.P[14] = p32 - (k30 * p02 + k31 * p12);
    this.P[15] = p33 - (k30 * p03 + k31 * p13);

    // Keep covariance numerically symmetric.
    const p01s = (this.P[1] + this.P[4]) * 0.5;
    const p02s = (this.P[2] + this.P[8]) * 0.5;
    const p03s = (this.P[3] + this.P[12]) * 0.5;
    const p12s = (this.P[6] + this.P[9]) * 0.5;
    const p13s = (this.P[7] + this.P[13]) * 0.5;
    const p23s = (this.P[11] + this.P[14]) * 0.5;

    this.P[1] = p01s; this.P[4] = p01s;
    this.P[2] = p02s; this.P[8] = p02s;
    this.P[3] = p03s; this.P[12] = p03s;
    this.P[6] = p12s; this.P[9] = p12s;
    this.P[7] = p13s; this.P[13] = p13s;
    this.P[11] = p23s; this.P[14] = p23s;

    this.P[0] = Math.max(this.P[0], 1e-7);
    this.P[5] = Math.max(this.P[5], 1e-7);
    this.P[10] = Math.max(this.P[10], 1e-7);
    this.P[15] = Math.max(this.P[15], 1e-7);
  }

  #handleMissingMeasurement(ts, dtSec) {
    // Freeze to last stable gaze when face is not detected.
    if (this.hasStableGaze) {
      this.state[0] = this.lastStableGazeX;
      this.state[1] = this.lastStableGazeY;
      this.state[2] *= 0.78;
      this.state[3] *= 0.78;
    }

    const decay = this.config.confidenceDecayPerSecond * dtSec;
    this.confidence = clamp(this.confidence - decay, 0, 1);

    this.smoothedGaze.x = this.state[0];
    this.smoothedGaze.y = this.state[1];

    if (this.confidence < this.config.minConfidenceThreshold) {
      this.features.backtrack = this.features.backtrack * 0.98;
      this.features.volatility = this.features.volatility * 0.98;
      this.features.stagnation = this.features.stagnation * 0.98;
      this.scoreEma = this.scoreEma * 0.98;
    }

    this.lastMeasurementTs = ts;
  }

  #mul4x4(a, b, out) {
    for (let row = 0; row < 4; row += 1) {
      const r = row * 4;
      for (let col = 0; col < 4; col += 1) {
        out[r + col] =
          a[r] * b[col] +
          a[r + 1] * b[col + 4] +
          a[r + 2] * b[col + 8] +
          a[r + 3] * b[col + 12];
      }
    }
  }

  #mul4x4AT(a, b, out) {
    for (let row = 0; row < 4; row += 1) {
      const r = row * 4;
      for (let col = 0; col < 4; col += 1) {
        const c = col * 4;
        out[r + col] =
          a[r] * b[c] +
          a[r + 1] * b[c + 1] +
          a[r + 2] * b[c + 2] +
          a[r + 3] * b[c + 3];
      }
    }
  }

  #copy16(from, to) {
    for (let i = 0; i < 16; i += 1) {
      to[i] = from[i];
    }
  }

  /* =========================
   * Temporal Buffer (Time-based Sliding Window)
   * ========================= */
  #pushSample(ts, x, y) {
    let idx;

    if (this.bufferCount < this.bufferCapacity) {
      idx = (this.bufferHead + this.bufferCount) % this.bufferCapacity;
      this.bufferCount += 1;
    } else {
      idx = this.bufferHead;
      this.bufferHead = (this.bufferHead + 1) % this.bufferCapacity;
    }

    this.sampleT[idx] = ts;
    this.sampleX[idx] = x;
    this.sampleY[idx] = y;

    while (this.bufferCount > 1) {
      const oldestT = this.sampleT[this.bufferHead];
      if (ts - oldestT <= this.config.windowMs) {
        break;
      }
      this.bufferHead = (this.bufferHead + 1) % this.bufferCapacity;
      this.bufferCount -= 1;
    }
  }

  /* =========================
   * Feature Extraction
   * ========================= */
  #computeBehaviorFeatures() {
    if (this.bufferCount < 3) {
      return;
    }

    let meanX = 0;
    let meanY = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < this.bufferCount; i += 1) {
      const idx = (this.bufferHead + i) % this.bufferCapacity;
      const x = this.sampleX[idx];
      const y = this.sampleY[idx];

      meanX += x;
      meanY += y;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    meanX /= this.bufferCount;
    meanY /= this.bufferCount;

    let varX = 0;
    let varY = 0;
    let absDxSum = 0;
    let movementSamples = 0;

    for (let i = 0; i < this.bufferCount; i += 1) {
      const idx = (this.bufferHead + i) % this.bufferCapacity;
      const dxMean = this.sampleX[idx] - meanX;
      const dyMean = this.sampleY[idx] - meanY;

      varX += dxMean * dxMean;
      varY += dyMean * dyMean;

      if (i > 0) {
        const prevIdx = (this.bufferHead + i - 1) % this.bufferCapacity;
        absDxSum += Math.abs(this.sampleX[idx] - this.sampleX[prevIdx]);
        movementSamples += 1;
      }
    }

    varX /= this.bufferCount;
    varY /= this.bufferCount;

    const sigma = Math.sqrt(varX + varY);
    const rangeX = Math.max(EPSILON, maxX - minX);
    const rangeY = Math.max(EPSILON, maxY - minY);
    const dynamicRange = Math.max(rangeX, rangeY);

    // 7.1 Backtrack Ratio (regression-like behavior on horizontal progression)
    const adaptiveJitterThreshold = Math.max(0.0035, (absDxSum / Math.max(1, movementSamples)) * 0.48 + sigma * 0.25);

    let dominantSignAccumulator = 0;
    for (let i = 1; i < this.bufferCount; i += 1) {
      const idx = (this.bufferHead + i) % this.bufferCapacity;
      const prevIdx = (this.bufferHead + i - 1) % this.bufferCapacity;
      const dx = this.sampleX[idx] - this.sampleX[prevIdx];

      if (Math.abs(dx) <= adaptiveJitterThreshold) continue;
      dominantSignAccumulator += dx > 0 ? 1 : -1;
    }

    const dominantSign = dominantSignAccumulator >= 0 ? 1 : -1;

    let totalMovements = 0;
    let backwardMovements = 0;
    let previousSign = 0;

    for (let i = 1; i < this.bufferCount; i += 1) {
      const idx = (this.bufferHead + i) % this.bufferCapacity;
      const prevIdx = (this.bufferHead + i - 1) % this.bufferCapacity;
      const dx = this.sampleX[idx] - this.sampleX[prevIdx];

      if (Math.abs(dx) <= adaptiveJitterThreshold) continue;

      const sign = dx > 0 ? 1 : -1;
      totalMovements += 1;

      // Direction-change aware backward count.
      if (sign !== dominantSign && (previousSign === dominantSign || previousSign === 0)) {
        backwardMovements += 1;
      }

      previousSign = sign;
    }

    const backtrackRatio = totalMovements > 0 ? backwardMovements / totalMovements : 0;

    // 7.2 Fixation Volatility
    const rmsSpread = Math.sqrt(varX + varY);
    const normalizedVolatility = clamp((rmsSpread / (dynamicRange + EPSILON)) * 1.45, 0, 1);

    // 7.3 Stagnation Index
    // Adaptive radius from noise level prevents false stagnation on noisy webcams.
    const adaptiveRadius = clamp(0.012 + sigma * 1.2, 0.012, 0.09);

    const oldestIdx = this.bufferHead;
    const newestIdx = (this.bufferHead + this.bufferCount - 1) % this.bufferCapacity;
    const totalWindowTime = Math.max(1, this.sampleT[newestIdx] - this.sampleT[oldestIdx]);

    let insideTime = 0;
    for (let i = 1; i < this.bufferCount; i += 1) {
      const idx = (this.bufferHead + i) % this.bufferCapacity;
      const prevIdx = (this.bufferHead + i - 1) % this.bufferCapacity;

      const dt = this.sampleT[idx] - this.sampleT[prevIdx];
      const dist = hypot2(this.sampleX[idx] - meanX, this.sampleY[idx] - meanY);

      if (dist <= adaptiveRadius) {
        insideTime += dt;
      }
    }

    const stagnationIndex = clamp(insideTime / totalWindowTime, 0, 1);

    this.features.backtrack = clamp(backtrackRatio, 0, 1);
    this.features.volatility = clamp(normalizedVolatility, 0, 1);
    this.features.stagnation = clamp(stagnationIndex, 0, 1);
  }

  /* =========================
   * Struggle Score
   * ========================= */
  #computeStruggleScore() {
    const w = this.config.weights;
    const weightSum = Math.max(EPSILON, w.backtrack + w.volatility + w.stagnation);

    const rawScore =
      (w.backtrack * this.features.backtrack +
        w.volatility * this.features.volatility +
        w.stagnation * this.features.stagnation) /
      weightSum;

    const clampedRaw = clamp(rawScore, 0, 1);

    // EMA smooths score while preserving responsiveness.
    this.scoreEma = clamp(
      this.scoreEma + this.config.smoothingFactor * (clampedRaw - this.scoreEma),
      0,
      1,
    );
  }

  /* =========================
   * Debug Overlay
   * ========================= */
  #drawDebugOverlay() {
    if (!this.config.debug || !this.debugCanvas || !this.debugCtx) {
      return;
    }

    const width = this.videoElement.videoWidth || this.debugCanvas.width || 640;
    const height = this.videoElement.videoHeight || this.debugCanvas.height || 480;

    if (this.debugCanvas.width !== width || this.debugCanvas.height !== height) {
      this.debugCanvas.width = width;
      this.debugCanvas.height = height;
    }

    const ctx = this.debugCtx;
    ctx.clearRect(0, 0, width, height);

    // Draw motion trail from recent buffer samples.
    if (this.bufferCount > 1) {
      ctx.beginPath();
      for (let i = 0; i < this.bufferCount; i += 1) {
        const idx = (this.bufferHead + i) % this.bufferCapacity;
        const px = width * 0.5 + this.sampleX[idx] * width * 0.55;
        const py = height * 0.5 + this.sampleY[idx] * height * 0.55;

        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(0, 191, 255, 0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const gazePx = width * 0.5 + this.smoothedGaze.x * width * 0.55;
    const gazePy = height * 0.5 + this.smoothedGaze.y * height * 0.55;

    ctx.beginPath();
    ctx.arc(gazePx, gazePy, 6, 0, Math.PI * 2);
    ctx.fillStyle = this.confidence > 0.55 ? '#00e08f' : '#ffbf3f';
    ctx.fill();

    ctx.fillStyle = '#f4f7fb';
    ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(`backtrack: ${this.features.backtrack.toFixed(3)}`, 12, 20);
    ctx.fillText(`volatility: ${this.features.volatility.toFixed(3)}`, 12, 38);
    ctx.fillText(`stagnation: ${this.features.stagnation.toFixed(3)}`, 12, 56);
    ctx.fillText(`score: ${this.scoreEma.toFixed(3)}`, 12, 74);
    ctx.fillText(`confidence: ${this.confidence.toFixed(3)}`, 12, 92);
  }
}

export default QalamTracker;
