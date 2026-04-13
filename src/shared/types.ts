/**
 * types.ts — VERSION MISE À JOUR
 * Ajout de 'language:changed' et 'bias:detected' dans QalamEventType
 */

export type UserRole = 'student' | 'parent' | 'teacher' | 'admin';

export interface ParentProfile {
  id:          string;
  name:        string;
  childrenIds: string[];
  createdAt:   Date;
}

export type NeurodivergenceType =
  | 'dyslexia' | 'dyscalculia' | 'adhd' | 'autism' | 'none' | 'unknown';

export type ReadingLanguage  = 'ar' | 'fr' | 'mixed';
export type ReadingDirection = 'rtl' | 'ltr';

export interface StudentProfile {
  id:                   string;
  name:                 string;
  age:                  number;
  language:             ReadingLanguage;
  neurodivergenceTypes: NeurodivergenceType[];
  adaptationThreshold:  number;
  preferredFont:        FontFamily;
  parentId?:            string;
  createdAt:            Date;
  updatedAt:            Date;
}

export interface RawGazeData {
  x: number; y: number; timestamp: number;
}

export interface GazePointData {
  x: number;
  y: number;
  timestamp: number;
  confidence: number;
  blinkRate?: number;
  headStability?: number;
  trackingLossRate?: number;
  fixationInstability?: number;
}

export type TrackingLostReason = 'face_lost' | 'camera_off';

export interface TrackingLostPayload {
  reason: TrackingLostReason;
  timestamp: number;
}

export interface GazeMetrics {
  saccadeSpeed:     number;
  fixationDuration: number;
  regressionCount:  number;
  blinkRate:        number;
  lineSkipRate:     number;
  fixationInstability: number;
  headStability: number;
  trackingLossRate: number;
  timestamp:        number;
}

export type DifficultyType =
  | 'dyslexia-visual' | 'fatigue' | 'attention' | 'line-tracking' | 'none';

export interface DifficultySignal {
  type:       DifficultyType;
  level:      number;
  confidence: number;
  language:   ReadingLanguage;
  timestamp:  number;
}

export type DetectorMode = 'heuristic' | 'hybrid';

export interface DetectorDebugPayload {
  mode: DetectorMode;
  heuristicScore: number;
  modelProbability: number;
  hybridScore: number;
  selectedScore: number;
  adjustedScore?: number;
  confidence: number;
  dominantType: DifficultyType;
  triggered: boolean;
  currentLevel?: AdaptiveDifficultyLevel;
  nextLevel?: AdaptiveDifficultyLevel;
  timestamp: number;
}

export type AdaptiveDifficultyLevel = 'none' | 'light' | 'moderate' | 'strong';

export interface AdaptiveLoopOutput {
  difficultyLevel: AdaptiveDifficultyLevel;
  actions: [string, string, string];
  difficultyScore: number;
}

export type FontFamily = 'OpenDyslexic' | 'AtkinsonHyperlegible' | 'inherit' | 'system';
export type ContrastLevel = 'normal' | 'high' | 'maximum';

export interface AdaptationParams {
  fontFamily:         FontFamily;
  fontSize:           string;
  lineHeight:         number;
  letterSpacing:      string;
  wordSpacing:        string;
  backgroundColor:    string;
  textColor:          string;
  contrastLevel:      ContrastLevel;
  direction:          ReadingDirection;
  transitionDuration: number;
}

// ✅ Ajout de 'language:changed' et 'bias:detected'
export type QalamEventType =
  | 'gaze:point'
  | 'gaze:metrics'
  | 'tracking_lost'
  | 'difficulty:detected'
  | 'detector:mode'
  | 'detector:debug'
  | 'adaptive:output'
  | 'adaptation:apply'
  | 'adaptation:reset'
  | 'profile:loaded'
  | 'profile:updated'
  | 'session:start'
  | 'session:end'
  | 'consent:granted'
  | 'consent:revoked'
  | 'language:changed'    // ✅ émis par BilingualHandler
  | 'bias:detected';      // ✅ émis par DifficultyDetector

export interface QalamEvent<T = unknown> {
  type:      QalamEventType;
  payload:   T;
  timestamp: number;
  sessionId: string;
}

export interface ReadingSession {
  id:                     string;
  studentId:              string;
  textId:                 string;
  startedAt:              Date;
  endedAt?:               Date;
  adaptationsApplied:     AdaptationParams[];
  averageDifficultyLevel: number;
  wordsRead:              number;
  language:               ReadingLanguage;
}

export type DifficultyLevel = 'facile' | 'moyen' | 'difficile';

export interface TeacherText {
  id:                 string;
  teacherId:          string;
  title:              string;
  content:            string;
  language:           ReadingLanguage;
  targetAge:          number;
  difficulty?:        DifficultyLevel;
  uploadedAt:         Date;
  assignedStudentIds: string[];
}