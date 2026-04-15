# Reading Difficulty Detection Model - Implementation Guide for Claude Sonnet 4.6

## Project Context

**Project**: Qalam-Sense - Adaptive reading platform for multilingual content (French/Arabic)  
**Objective**: Detect word-level reading difficulty using eye-tracking data and trigger real-time UI adaptations  
**Target Language for v0**: French (transfer learning from ETDD70 Czech dataset)  
**Platform Integration**: React/TypeScript dashboard with existing adaptive UI system

## Reference Dataset

**ETDD70 Dataset** (13332134 folder):
- 70 Czech children (35 dyslexic, 35 non-dyslexic), ages 9-10
- 3 reading tasks: syllables (T1), meaningful text (T4), pseudo-text (T5)
- 250 Hz binocular eye-tracking data
- 840 CSV files with: raw gaze, fixations, saccades, computed metrics
- Best model achieved ~90% classification accuracy
- Available at: https://doi.org/10.5281/zenodo.13332134

## System Architecture Context

```
Eye-Tracking Data (250 Hz)
    ↓
[AI-Engine] ← Your model goes here (src/core/ai-engine)
    ↓
Difficulty Signal: {wordId, difficulty_level: LOW|MEDIUM|HIGH, confidence}
    ↓
[Text-Adapter] (src/core/text-adapter)
    ↓
UI Changes: font-size, letter-spacing, line-height, contrast
```

**Existing Infrastructure**:
- `src/core/eye-tracking`: Gaze collection, filtering, smoothing
- `src/core/event-bus`: Strongly-typed event exchange
- `src/core/text-adapter`: CSS token management, anti-oscillation gating
- `src/ui`: Student reader view, text rendering with word-level DOM markers

## Model Requirements & Specifications

### Input Specification

**Real-time gaze stream** (from eye-tracking module):
```typescript
interface GazeDataPoint {
  timestamp: number;           // ms since task start
  gazePosX: number;           // pixel X coordinate
  gazePosY: number;           // pixel Y coordinate
  confidence: 0-1;            // tracking confidence
  eye: 'LEFT' | 'RIGHT' | 'BOTH';
  pupilDiameter?: number;     // optional
}

// Emitted every ~40ms (250 Hz sampling)
```

**Word-level document context**:
```typescript
interface Word {
  id: string;                 // unique identifier
  text: string;               // "bonjour", "conversation"
  language: 'FR' | 'AR';      // language
  position: {
    x: number;               // pixel position on screen
    y: number;
    width: number;
    height: number;
  };
  attributes: {
    wordLength: number;       // character count
    syllableCount: number;    // linguistic feature
    frequencyRank?: number;   // common vs rare words
    isCompound?: boolean;     // e.g., "arc-en-ciel"
  };
}
```

### Output Specification

**Per-word difficulty signal**:
```typescript
interface WordDifficultySignal {
  wordId: string;
  difficultyLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;         // 0-1, for filtering/hysteresis
  metrics: {
    fixationCount: number;
    totalFixationDuration_ms: number;
    meanFixationDuration_ms: number;
    regression_count: number;  // eye returns to word
    saccadeAmplitude_avg: number;
    timeSpentMs: number;
  };
  timestamp: number;          // when this signal was computed
}
```

### Difficulty Level Definitions

Based on ETDD70 metrics, compute difficulty thresholds:

```
LOW (fluent reading):
  - Mean fixation duration: 200-300ms
  - Fixations per word: 1-2
  - No regressions
  - Large saccade amplitudes (forward progress)

MEDIUM (moderate difficulty):
  - Mean fixation duration: 300-500ms
  - Fixations per word: 2-3
  - 1-2 regressions
  - Mixed saccade patterns

HIGH (struggling):
  - Mean fixation duration: >500ms
  - Fixations per word: >3
  - Multiple regressions (>2)
  - Small/erratic saccade patterns
```

**Hysteresis/Anti-Oscillation**: Don't flip levels rapidly. Require 2-3 consecutive signals at new level or confidence >0.75.

## Implementation Roadmap

### Phase 1: Data Pipeline & Feature Extraction (Days 1-3)

**Task 1.1**: Load & preprocess ETDD70 Czech data
- Parse raw gaze, fixations, saccades, metrics CSVs
- Align gaze points with word ROIs
- Create training dataset: (word_features, reading_metrics) → difficulty_label

**Task 1.2**: Design feature extraction engine
```python
def extract_reading_features(gaze_points, word_roi, duration_window):
    """
    Returns feature vector:
    - Fixation count, duration statistics (mean, std, min, max)
    - Saccade amplitude, velocity statistics  
    - Regression count (backward eye movements)
    - Pupil diameter changes (cognitive load proxy)
    - Time spent on word vs expected baseline
    """
```

**Task 1.3**: Compute baseline metrics per word type
- Average reading speed per word length (French)
- Expected fixation count by frequency rank
- Create anomaly detection baseline

### Phase 2: Model Development (Days 4-7)

**Task 2.1**: Choose & justify model architecture

**Option A (Recommended for v0):** Lightweight Decision Tree + Heuristics
- Pros: Fast inference, interpretable, low computational cost
- Cons: Less adaptive to individual differences
- Use case: Real-time on-device, browser-based
- Threshold-based rules on fixation duration, regression count, saccade velocity

**Option B:** Neural Network (LSTM/Transformer)
- Pros: Better at capturing temporal patterns, learns individual patterns
- Cons: Requires more training data, more compute
- Use case: If you get custom French data later
- Input: sequence of gaze points; Output: word difficulty probability

**Recommendation for v0**: Start with **Option A** (Decision Tree), add Option B layer later.

**Task 2.2**: Train on ETDD70 (transfer learning approach)
```
1. Use Czech ETDD70 data to establish baseline thresholds
2. Map Czech linguistic features → French approximations
3. Test feature importance: which metrics matter most?
4. Create confidence calibration curves
```

**Task 2.3**: Implement decision logic in TypeScript
```typescript
class ReadingDifficultyDetector {
  private features: ReadingFeatures;
  private thresholds: DifficultyThresholds;
  private confidenceBuffer: DifficultySignal[]; // for hysteresis
  
  analyzeWord(
    gazeEvents: GazeDataPoint[],
    word: Word,
    userProfile?: { readingLevel: 'beginner' | 'intermediate' | 'fluent' }
  ): WordDifficultySignal
}
```

### Phase 3: Integration with Dashboard (Days 8-10)

**Task 3.1**: Wire model into `src/core/ai-engine/`
- Subscribe to eye-tracking event stream
- Buffer gaze points per word
- Emit `WORD_DIFFICULTY_DETECTED` event on word exit

**Task 3.2**: Connect to text-adapter 
```typescript
// src/core/text-adapter/index.ts
eventBus.on('WORD_DIFFICULTY_DETECTED', (signal) => {
  textAdapter.applyAdaptation(signal.wordId, signal.difficultyLevel);
});
```

**Task 3.3**: Implement UI response logic
```typescript
// Adaptation mapping
const adaptationLevels = {
  LOW: { 
    fontSize: '1em', 
    letterSpacing: '0.02em', 
    lineHeight: 1.5 
  },
  MEDIUM: { 
    fontSize: '1.1em', 
    letterSpacing: '0.05em', 
    lineHeight: 1.8,
    backgroundColor: 'rgba(255, 255, 0, 0.05)' // subtle highlight
  },
  HIGH: { 
    fontSize: '1.2em', 
    letterSpacing: '0.08em', 
    lineHeight: 2,
    backgroundColor: 'rgba(255, 200, 0, 0.15)',
    fontWeight: 500
  }
};
```

**Task 3.4**: Add persistence & session logging
- Log detected difficulties per session for teacher analytics
- Encrypted local storage (per privacy policy)

### Phase 4: Testing & Calibration (Days 11-12)

**Task 4.1**: Collect French test data
- Recruit 5-10 French-speaking students (younger/older age groups)
- 15-min reading sessions with eye-tracking + annotations ("this was hard")
- Create validation set

**Task 4.2**: Calibrate thresholds
- Compare model predictions vs. ground truth ("hard words")
- Adjust fixation duration thresholds for French reading patterns
- Tune confidence weights

**Task 4.3**: A/B test UI adaptations
- Control group: no UI changes
- Variant group: auto-adapted text (model-driven)
- Measure: reading fluency, comprehension, subjective difficulty ratings

## Technical Specifications

### Code Structure

```
src/core/ai-engine/
├── detectors/
│   ├── readingDifficultyDetector.ts    # Main model class
│   ├── featureExtractor.ts             # Gaze → features
│   └── thresholdCalibrator.ts          # v0: decision tree rules
├── models/
│   └── types.ts                        # Interfaces, enums
├── utils/
│   ├── smoothing.ts                    # Kalman filter for gaze
│   ├── statisticalUtils.ts             # mean, std, percentiles
│   └── hypothesisTests.ts              # anomaly detection
└── index.ts                             # Export, initialization

src/core/text-adapter/
├── adaptationRules.ts
└── cssTokenEmitter.ts

tests/
├── readingDifficultyDetector.test.ts
└── integration/
    └── eyeTracking.integration.test.ts
```

### API Contract

```typescript
// Initialize at app startup
const detector = new ReadingDifficultyDetector({
  language: 'FR',  // or 'AR'
  modelVariant: 'v0-decision-tree',  // or 'v1-neural' later
  confidenceThreshold: 0.7,
  hysteresisWindow: 3,  // require 3 consecutive signals
});

// Subscribe to eye-tracking stream
eyeTracker.on('gaze', (gazePoint) => {
  detector.updateGazeBuffer(gazePoint);
});

// When word exits visible region or new word enters
detector.analyzeWord(word);  // Returns: WordDifficultySignal

// Signal triggers adaptation
eventBus.emit('WORD_DIFFICULTY_DETECTED', signal);
```

### Performance Requirements

- **Latency**: <100ms from word exit to difficulty signal (real-time)
- **Throughput**: 60+ FPS compatible (gaze update every ~16ms)
- **Memory**: <50MB total (browser environment)
- **CPU**: <5% on modern CPU (non-blocking, Web Workers optional)

## Data Schema for Training

### CSV Input Format (prepared from ETDD70)

```csv
subject_id,language,wordId,text,wordLength,syllableCount,frequencyRank,
fixationCount,totalFixationDurationMs,meanFixationDurationMs,
regressionCount,saccadeAmplitudeAvg,timeSpentMs,difficulty_label,is_dyslexic

1003,CZ,w1,ma,2,1,high,1,252,252,0,159.5,252,LOW,0
1003,CZ,w2,si,2,1,high,2,363,181,0,82.8,363,LOW,0
1009,CZ,w1,ma,2,1,high,3,780,260,2,45.3,780,HIGH,1
```

### Transfer to French

Mapping rules:
```
Czech → French approximation:
- wordLength: Direct transfer (character count universal)
- syllableCount: Use French syllabification rules
- frequencyRank: Use French word frequency corpus (Lexique)
- reading_speed: Adjust baseline by ~10% (French slightly slower than Czech)
- difficulty_thresholds: Same ETDD70 thresholds initially, then tune
```

## Success Criteria (v0)

- [ ] Model detects HIGH difficulty words with >75% precision
- [ ] Model detects LOW difficulty words with >80% precision
- [ ] UI adaptations apply within 150ms of detection
- [ ] No "oscillation" (stability >2s per word)
- [ ] Works with 250 Hz eye-tracking stream in real-time
- [ ] Adapts gracefully with eye-tracking loss (<5% false positives)
- [ ] Teacher dashboard shows difficulty heatmap per word

## Future Enhancements (v1+)

1. **User-specific calibration**: Learn individual student's "normal" reading pattern
2. **Contextual difficulty**: Adjust thresholds based on prior words, sentence complexity
3. **Cognitive load proxy**: Use pupil dilation to supplement fixation metrics
4. **Arabic support**: Add RTL script handling, Arabic-specific linguistic features
5. **Multi-modal learning**: Combine with comprehension questions
6. **Neural model**: LSTM on gaze sequences for better temporal patterns
7. **Teacher feedback loop**: Teachers mark "actually hard?"→ model retrains

## Dependencies & Libraries

```json
{
  "devDependencies": {
    "tensorflow.js": "^4.11.0",      // If using neural model
    "simple-statistics": "^7.8.3",   // Statistical functions
    "date-fns": "^2.30.0"            // Time utilities
  }
}
```

For v0 (decision tree), only native TypeScript + existing event bus needed.

## References & Resources

- ETDD70 Paper: Sedmidubsky et al. (2024) - SISAP Conference
- ETDD70 Dataset: https://doi.org/10.5281/zenodo.13332134
- French Lexicon: Lexique database (https://www.lexique.org/) for word frequency
- Eye-tracking reading research: Rayner, K. (1998). Eye movements in reading and information processing
- Dyslexia reading patterns: Shaywitz & Shaywitz (2005)

## Questions for Clarification

1. **Minimum French training data**: How many students can you recruit for calibration?
2. **Hardware**: Will students use webcam-based eye-trackers or specialized hardware?
3. **Reading level**: Target age group? (affects thresholds, curriculum difficulty)
4. **UI preferences**: What adaptations matter most? (font size vs. spacing vs. contrast)
5. **Privacy**: Are sessions logged for retrospective analysis or real-time only?

---

**Document Version**: 1.0  
**Date**: April 13, 2026  
**Status**: Ready for Claude Sonnet 4.6 implementation  
**Estimated Dev Time**: 12-14 days (v0)
