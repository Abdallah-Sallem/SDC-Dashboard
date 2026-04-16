/**
 * AdaptiveReader.tsx
 * CORRECTIONS :
 * - Syllabes colorées pour dyslexia ET unknown
 * - Écran de fin avec stats (mots lus, durée)
 * - Timer selon l'âge avec avertissement < 2 min
 * - Bouton "Terminer" sur le dernier paragraphe
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useTextAdapter }      from '../hooks/useTextAdapter';
import { useEyeTracking }      from '../hooks/useEyeTracking';
import { useBilingual }        from '../hooks/useBilingual';
import { AdaptationIndicator } from './AdaptationIndicator';
import { ReadingProgress }     from './ReadingProgress';
import { EventBus }            from '../../core/event-bus/EventBus';
import { QalamAdaptiveController } from '../../core/text-adapter/QalamAdaptiveController';
import {
  detectStruggle,
  expectedFixationDuration,
  STRUGGLE_CONSTANTS,
  type SaccadeSample,
  type StruggleBand,
} from '../../core/ai-engine/detectStruggle';
import type {
  AdaptationParams,
  DetectorDebugPayload,
  DetectorMode,
  GazePointData,
  StudentProfile,
  TeacherText,
} from '../../shared/types';


interface AdaptiveReaderProps {
  profile:       StudentProfile;
  text:          TeacherText;
  sessionId:     string;
  onSessionEnd?: (wordsRead: number) => void;
}

const DETECTOR_MODE_STORAGE_KEY = 'qs_detector_mode';

// ── Durée max selon l'âge ─────────────────────────────────────────────────────
function getMaxDuration(age: number): number {
  if (age <= 7)  return 10 * 60 * 1000;
  if (age <= 10) return 15 * 60 * 1000;
  if (age <= 13) return 20 * 60 * 1000;
  return          30 * 60 * 1000;
}

function formatTime(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatScore(score: number | undefined): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return '--';
  return score.toFixed(3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const ZOOM_MIN_SCALE = 1;
const ZOOM_MAX_SCALE = 1.08;
const ZOOM_LERP_ALPHA = 0.08;
const ZOOM_ORIGIN_LERP = 0.12;
const ZOOM_TARGET_COOLDOWN_MS = 900;
const ZOOM_STABILITY_MIN = 0.70;
const ZOOM_MIN_CONFIDENCE = 0.62;
const ZOOM_STABLE_HOLD_MS = 320;
const ZOOM_SCORE_ALPHA = 0.12;

function scoreToZoom(score: number, triggerThreshold: number): number {
  const effectiveThreshold = clamp(triggerThreshold, 0.2, 0.9);
  const normalized = clamp((score - effectiveThreshold) / Math.max(0.08, 1 - effectiveThreshold), 0, 1);
  return ZOOM_MIN_SCALE + normalized * (ZOOM_MAX_SCALE - ZOOM_MIN_SCALE);
}

interface CursorPoint {
  x: number;
  y: number;
  confidence: number;
}

interface AdaptiveUiState {
  fontScale: number;
  wordSpacing: number;
  isAssistActive: boolean;
}

const CURSOR_MIN_CONFIDENCE = 0.50;
const CURSOR_DEADZONE_PX = 3;
const CURSOR_MAX_STEP_PX = 85;
const CURSOR_EMA_ALPHA = 0.11;
const CURSOR_SETTLE_ALPHA = 0.04;
const CURSOR_CONFIDENCE_EMA = 0.18;
const CURSOR_CONFIDENCE_SHOW = 0.56;
const CURSOR_CONFIDENCE_HOLD_MS = 420;

const OUT_OF_TEXT_ZONE_TRIGGER_MS = 420;
const COMBINED_SCORE_ALPHA = 0.22;
const PARAGRAPH_FOCUS_MIN_SCALE = 1;
const PARAGRAPH_FOCUS_EARLY_SCALE = 1.06;
const PARAGRAPH_FOCUS_HIGH_SCALE = 1.13;
const PARAGRAPH_FOCUS_OUTSIDE_SCALE = 1.16;
const PARAGRAPH_FOCUS_RISE_ALPHA = 0.18;
const PARAGRAPH_FOCUS_FALL_ALPHA = 0.06;

interface RuleDebugState {
  score: number;
  band: StruggleBand;
  fixationDurationMs: number;
  expectedFixationMs: number;
  triggerFixationMs: number;
  regressionCount: number;
  velocityRejected: boolean;
  outsideTextZone: boolean;
}

interface RuntimeStruggleState {
  previousSample: CursorPoint | null;
  previousSampleTs: number;
  fixationWordId: string;
  fixationWordStartTs: number;
  meanFixationDurationMs: number;
  saccades: SaccadeSample[];
  outOfTextZoneStartTs: number;
}

function classifyBand(score: number): StruggleBand {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'early';
  return 'smooth';
}

function estimateWordComplexity(word: string): number {
  const letters = (word.match(/\p{L}/gu) ?? []).join('');
  if (!letters) return 0.2;

  const length = letters.length;
  const normalizedLength = clamp((length - 4) / 8, 0, 1);

  const complexClusters =
    (letters.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]{3,}/g) ?? []).length;
  const clusterScore = clamp(complexClusters * 0.2, 0, 0.45);

  return clamp(normalizedLength + clusterScore, 0, 1);
}

const ASSIST_FONT_SCALE_MIN = 1;
const ASSIST_FONT_SCALE_MAX = 1.15;
const ASSIST_WORD_SCALE_MIN = 1;
const ASSIST_WORD_SCALE_MAX = 1.2;
const ASSIST_WORD_SPACING_BASE_EM = 0.1;
const READER_TRANSITION_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function parseEm(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.endsWith('em')) return null;
  const parsed = Number.parseFloat(trimmed.replace('em', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAssistOverride(
  adaptive: AdaptiveUiState,
  baseWordSpacing?: string
): Partial<React.CSSProperties> {
  if (!adaptive.isAssistActive) return {};

  const fontScale = clamp(adaptive.fontScale, ASSIST_FONT_SCALE_MIN, ASSIST_FONT_SCALE_MAX);
  const wordScale = clamp(adaptive.wordSpacing, ASSIST_WORD_SCALE_MIN, ASSIST_WORD_SCALE_MAX);
  const baseEm = parseEm(baseWordSpacing);
  const baselineEm = baseEm && baseEm > 0 ? baseEm : ASSIST_WORD_SPACING_BASE_EM;
  const wordSpacingEm = baselineEm * wordScale;

  return {
    fontSize: `calc(var(--qs-font-size) * ${fontScale.toFixed(3)})`,
    wordSpacing: `${wordSpacingEm.toFixed(3)}em`,
  };
}

    function stabilizeCursor(prev: CursorPoint | null, incoming: CursorPoint): CursorPoint {
  if (!prev) return incoming;

  const dx = incoming.x - prev.x;
  const dy = incoming.y - prev.y;
  const distance = Math.hypot(dx, dy);

  const confidenceFactor = clamp(
    (incoming.confidence - CURSOR_MIN_CONFIDENCE) / 0.45,
    0,
    1
  );
  const dynamicDeadzone = CURSOR_DEADZONE_PX + (1 - confidenceFactor) * 3;
  const dynamicMaxStep = clamp(
    CURSOR_MAX_STEP_PX - (1 - confidenceFactor) * 25,
    45,
    CURSOR_MAX_STEP_PX
  );

  // Deadzone anti-jitter: ignore micro-mouvements parasites.
  if (distance <= dynamicDeadzone) {
    // Même dans la deadzone, on garde un léger "pull" vers la position réelle
    // pour éviter de rester bloqué quelques pixels à côté de la cible.
    const settleAlpha = clamp(
      CURSOR_SETTLE_ALPHA + confidenceFactor * 0.06,
      CURSOR_SETTLE_ALPHA,
      0.14
    );

    return {
      x: prev.x + (incoming.x - prev.x) * settleAlpha,
      y: prev.y + (incoming.y - prev.y) * settleAlpha,
      confidence: clamp(prev.confidence * 0.72 + incoming.confidence * 0.28, 0, 1),
    };
  }

  let targetX = incoming.x;
  let targetY = incoming.y;

  // Capping évite les sauts brusques de curseur entre deux frames.
  if (distance > dynamicMaxStep) {
    const ratio = dynamicMaxStep / distance;
    targetX = prev.x + dx * ratio;
    targetY = prev.y + dy * ratio;
  }

  const adaptiveAlpha = clamp(
    CURSOR_EMA_ALPHA + confidenceFactor * 0.08,
    CURSOR_EMA_ALPHA,
    0.18
  );

  return {
    x: prev.x + (targetX - prev.x) * adaptiveAlpha,
    y: prev.y + (targetY - prev.y) * adaptiveAlpha,
    confidence: clamp(prev.confidence * 0.65 + incoming.confidence * 0.35, 0, 1),
  };
}

type ReaderAidLevel = 'LOW' | 'MEDIUM' | 'HIGH';

function inferAidLevel(params: AdaptationParams | null): ReaderAidLevel {
  if (!params) return 'LOW';

  const fontScale = Number.parseFloat(params.fontSize);
  const hasStrongContrast = params.contrastLevel === 'high' || params.contrastLevel === 'maximum';
  if ((Number.isFinite(fontScale) && fontScale >= 1.1) || params.lineHeight >= 2.0 || hasStrongContrast) {
    return 'HIGH';
  }

  if (params.lineHeight > 1.65 || params.letterSpacing !== 'normal' || params.wordSpacing !== 'normal') {
    return 'MEDIUM';
  }

  return 'LOW';
}

const AID_LEVEL_RANK: Record<ReaderAidLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

function maxAidLevel(a: ReaderAidLevel, b: ReaderAidLevel): ReaderAidLevel {
  return AID_LEVEL_RANK[a] >= AID_LEVEL_RANK[b] ? a : b;
}

// ── Découpage syllabique ──────────────────────────────────────────────────────
function splitSyllablesFr(word: string): string[] {
  const vowels = 'aeiouyàâéèêëîïôùûüœæAEIOUYÀÂÉÈÊËÎÏÔÙÛÜŒÆ';
  const result: string[] = [];
  let current = '';
  for (let i = 0; i < word.length; i++) {
    current += word[i];
    const isVowel         = vowels.includes(word[i]);
    const nextIsConsonant = word[i + 1] && !vowels.includes(word[i + 1]);
    const nextNextIsVowel = word[i + 2] && vowels.includes(word[i + 2]);
    if (isVowel && nextIsConsonant && nextNextIsVowel && current.length > 1) {
      result.push(current);
      current = '';
    }
  }
  if (current) result.push(current);
  return result.length > 1 ? result : [word];
}

const SYLLABLE_COLORS = ['#1D5FA5', '#8B2A8B'];

const Word: React.FC<{ word: string; isDyslexic: boolean; isRTL: boolean; wordIndex: number; }> = ({
  word, isDyslexic, isRTL, wordIndex
}) => {
  const isAlpha = /\p{L}/u.test(word);
  const wordId = `word-${wordIndex}`;

  if (!isDyslexic || !isAlpha) {
    return <span id={wordId} className="adaptive-word">{word}</span>;
  }

  const syllables = isRTL ? [word] : splitSyllablesFr(word);
  if (syllables.length <= 1) {
    return <span id={wordId} className="adaptive-word">{word}</span>;
  }

  return (
    <span id={wordId} className="adaptive-word">
      {syllables.map((syl, i) => (
        <span key={i} style={{ color: SYLLABLE_COLORS[i % 2], fontWeight: 500 }}>{syl}</span>
      ))}
    </span>
  );
};

const ReadingParagraph: React.FC<{
  text: string;
  isDyslexic: boolean;
  isRTL: boolean;
  isActive: boolean;
  paragraphIndex: number;
}> = ({ text, isDyslexic, isRTL, isActive, paragraphIndex }) => (
  <p style={{
    marginBottom:  'var(--qs-paragraph-spacing, 1em)',
    padding:       '4px 8px 4px 6px',
    borderRadius:  6,
    background:    isActive ? 'rgba(29,158,117,0.07)' : 'transparent',
    borderLeft:    isActive ? '3px solid #1D9E75' : '3px solid transparent',
    cursor:        'pointer',
    lineHeight:    'var(--qs-line-height)',
    wordSpacing:   'var(--qs-word-spacing)',
    letterSpacing: 'var(--qs-letter-spacing)',
    transition:    'background 0.3s, border-color 0.3s, letter-spacing 180ms ease, word-spacing 180ms ease',
  }} data-paragraph-index={paragraphIndex}>
    {text.split(/(\s+)/).map((token, i) =>
      /^\s+$/.test(token)
        ? <span key={i}>{token}</span>
        : <Word key={i} word={token} isDyslexic={isDyslexic} isRTL={isRTL} wordIndex={paragraphIndex * 1000 + i} />
    )}
  </p>
);

// ── Écran démarrage ───────────────────────────────────────────────────────────
const StartScreen: React.FC<{
  title: string; profile: StudentProfile; hasConsent: boolean; onStart: () => void;
}> = ({ title, profile, hasConsent, onStart }) => {
  const minutes = Math.floor(getMaxDuration(profile.age) / 60000);
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 480, margin: '0 auto' }}>
      <div style={{
        width: 72, height: 72, borderRadius: 16, background: '#E1F5EE',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, marginBottom: '1.5rem',
      }}>📖</div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: '#085041', marginBottom: '0.5rem' }}>
        {title}
      </h2>
      <p style={{ color: '#888780', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
        Bonjour {profile.name} ! Installe-toi confortablement.
      </p>
      <div style={{
        padding: '0.75rem 1rem',
        background: hasConsent ? '#E1F5EE' : '#F1EFE8',
        borderRadius: 10, fontSize: '0.82rem',
        color: hasConsent ? '#085041' : '#5F5E5A',
        marginBottom: '1.5rem', lineHeight: 1.5,
      }}>
        {hasConsent
          ? '📷 La caméra va s\'activer pour suivre ta lecture.'
          : '📖 Mode sans caméra — l\'app s\'adapte quand même.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: '2rem' }}>
        {[
          { icon: '💡', text: 'Bonne lumière' },
          { icon: '📐', text: 'Écran droit' },
          { icon: `⏱️`, text: `Max ${minutes} min` },
        ].map(tip => (
          <div key={tip.text} style={{
            background: '#F8F7F4', borderRadius: 10,
            padding: '0.75rem 0.5rem', fontSize: '0.78rem', color: '#5F5E5A',
          }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{tip.icon}</div>
            {tip.text}
          </div>
        ))}
      </div>
      <button
        onClick={onStart}
        style={{
          width: '100%', padding: '1rem', background: '#1D9E75',
          color: '#fff', border: 'none', borderRadius: 14,
          fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#0F6E56')}
        onMouseLeave={e => (e.currentTarget.style.background = '#1D9E75')}
      >
        Commencer la lecture →
      </button>
    </div>
  );
};

// ── Écran de fin ──────────────────────────────────────────────────────────────
const EndScreen: React.FC<{
  profile:   StudentProfile;
  wordsRead: number;
  elapsed:   number;
  reason:    'completed' | 'timeout';
  onExit:    () => void;
}> = ({ profile, wordsRead, elapsed, reason, onExit }) => (
  <div style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: 480, margin: '0 auto' }}>
    <div style={{
      width: 80, height: 80, borderRadius: '50%', background: '#E1F5EE',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 40, marginBottom: '1.5rem',
    }}>
      {reason === 'completed' ? '🎉' : '⏰'}
    </div>

    <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: '#085041', marginBottom: '0.5rem' }}>
      {reason === 'completed' ? `Bravo ${profile.name} !` : 'Temps écoulé !'}
    </h2>

    <p style={{ color: '#888780', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.6 }}>
      {reason === 'completed'
        ? 'Tu as lu tout le texte. Excellent travail !'
        : `Tu as lu pendant ${formatTime(elapsed)}. Il est temps de faire une pause !`}
    </p>

    {/* Stats */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: '2rem' }}>
      {[
        { label: 'Mots lus',        value: String(wordsRead) },
        { label: 'Temps de lecture', value: formatTime(elapsed) },
      ].map(stat => (
        <div key={stat.label} style={{ background: '#F1EFE8', borderRadius: 12, padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#888780', marginBottom: 4 }}>{stat.label}</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#085041' }}>{stat.value}</div>
        </div>
      ))}
    </div>

    {reason === 'timeout' && (
      <div style={{
        padding: '0.75rem 1rem', background: '#FFF8E7',
        borderRadius: 10, fontSize: '0.82rem', color: '#633806',
        marginBottom: '1.5rem', lineHeight: 1.5,
      }}>
        ☕ Prends une pause de 5-10 minutes avant de continuer.
      </div>
    )}

    <button
      onClick={onExit}
      style={{
        width: '100%', padding: '0.875rem', background: '#1D9E75',
        color: '#fff', border: 'none', borderRadius: 12,
        fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
      }}
    >
      Retour à l'accueil
    </button>
  </div>
);

// ── Composant principal ───────────────────────────────────────────────────────
export const AdaptiveReader: React.FC<AdaptiveReaderProps> = ({
  profile, text, sessionId, onSessionEnd,
}) => {
  const containerRef = useRef<HTMLElement>(null);
  const zoomFrameRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);
  const zoomStateRef = useRef<{
    currentScale: number;
    targetScale: number;
    originX: number;
    originY: number;
    lastTargetUpdateAt: number;
    stableSince: number;
    scoreSmoothed: number;
    rafId: number | null;
  }>({
    currentScale: 1,
    targetScale: 1,
    originX: 50,
    originY: 50,
    lastTargetUpdateAt: 0,
    stableSince: 0,
    scoreSmoothed: 0,
    rafId: null,
  });
  const adaptiveControllerRef = useRef<QalamAdaptiveController | null>(null);
  const lastAdaptiveUpdateRef = useRef(0);
  const gazePointRef = useRef<CursorPoint | null>(null);
  const gazeConfidenceRef = useRef<number>(0);
  const combinedScoreRef = useRef(0);
  const lastConfidentAtRef = useRef<number>(0);
  const struggleRuntimeRef = useRef<RuntimeStruggleState>({
    previousSample: null,
    previousSampleTs: 0,
    fixationWordId: '',
    fixationWordStartTs: 0,
    meanFixationDurationMs: 280,
    saccades: [],
    outOfTextZoneStartTs: 0,
  });

  const [started,    setStarted]    = useState(false);
  const [ended,      setEnded]      = useState(false);
  const [endReason,  setEndReason]  = useState<'completed' | 'timeout'>('completed');
  const [activePara, setActivePara] = useState(0);
  const [elapsed,    setElapsed]    = useState(0);
  const [gazePoint,  setGazePoint]  = useState<CursorPoint | null>(null);
  const [paragraphFocusScale, setParagraphFocusScale] = useState(PARAGRAPH_FOCUS_MIN_SCALE);
  const [combinedStruggleScore, setCombinedStruggleScore] = useState(0);
  const [combinedStruggleBand, setCombinedStruggleBand] = useState<StruggleBand>('smooth');
  const [adaptiveUiState, setAdaptiveUiState] = useState<AdaptiveUiState>({
    fontScale: 1,
    wordSpacing: 1,
    isAssistActive: false,
  });
  const [ruleDebugState, setRuleDebugState] = useState<RuleDebugState>({
    score: 0,
    band: 'smooth',
    fixationDurationMs: 0,
    expectedFixationMs: expectedFixationDuration(4),
    triggerFixationMs:
      expectedFixationDuration(4) * STRUGGLE_CONSTANTS.FIXATION_TRIGGER_MULTIPLIER,
    regressionCount: 0,
    velocityRejected: false,
    outsideTextZone: false,
  });
  const [detectorMode, setDetectorMode] = useState<DetectorMode>(() => {
    try {
      const stored = localStorage.getItem(DETECTOR_MODE_STORAGE_KEY);
      return stored === 'heuristic' ? 'heuristic' : 'hybrid';
    } catch {
      return 'hybrid';
    }
  });
  const [detectorDebug, setDetectorDebug] = useState<DetectorDebugPayload | null>(null);

  const maxDuration = getMaxDuration(profile.age);

  // ✅ Syllabes pour dyslexia ET unknown
  const isDyslexic =
    profile.neurodivergenceTypes.includes('dyslexia') ||
    profile.neurodivergenceTypes.includes('unknown');

  const { currentParams, isActive: adapterActive } = useTextAdapter(profile, sessionId);
  const { start: startTracking, hasPermission, noConsent, recalibrate } = useEyeTracking(
    profile.id, sessionId, profile);
  const { direction, isRTL, updateForText } = useBilingual(text.content);

  const aidLevel = useMemo(() => inferAidLevel(currentParams), [currentParams]);
  const paragraphs = text.content.split(/\n\n+/).filter(p => p.trim().length > 0);
  const totalWords = text.content.split(/\s+/).length;
  const modelScore = detectorDebug?.adjustedScore ?? detectorDebug?.selectedScore ?? 0;
  const assistLevel = useMemo(() => {
    if (!adaptiveUiState.isAssistActive) return 'LOW';
    return adaptiveUiState.fontScale >= 1.1 ? 'HIGH' : 'MEDIUM';
  }, [adaptiveUiState.fontScale, adaptiveUiState.isAssistActive]);
  const effectiveAidLevel = useMemo(
    () => maxAidLevel(aidLevel, assistLevel),
    [aidLevel, assistLevel]
  );
  const readerOverride = useMemo(
    () => buildAssistOverride(adaptiveUiState, currentParams?.wordSpacing),
    [adaptiveUiState, currentParams?.wordSpacing]
  );

  const aidTone = useMemo(() => {
    if (effectiveAidLevel === 'HIGH') {
      return {
        label: 'Niveau HIGH: texte agrandi + espacement + aide couleur',
        bg: '#EAF4FF',
        fg: '#0F2A43',
      };
    }
    if (effectiveAidLevel === 'MEDIUM') {
      return {
        label: 'Niveau MEDIUM: espacement légèrement augmenté',
        bg: '#FFF6E8',
        fg: '#6B4A11',
      };
    }
    return {
      label: 'Niveau LOW: lecture normale',
      bg: '#F8F7F4',
      fg: '#5F5E5A',
    };
  }, [effectiveAidLevel]);

  // Timer
  useEffect(() => {
    if (!started || ended) return;
    const interval = setInterval(() => {
      const el = Date.now() - startTimeRef.current;
      setElapsed(el);
      if (el >= maxDuration) handleEnd('timeout');
    }, 1000);
    return () => clearInterval(interval);
  }, [started, ended, maxDuration]);

  const handleEnd = useCallback((reason: 'completed' | 'timeout') => {
    if (ended) return;
    setEnded(true);
    setEndReason(reason);
    onSessionEnd?.(totalWords);
  }, [ended, onSessionEnd, totalWords]);

  const handleStart = useCallback(async () => {
    setStarted(true);
    startTimeRef.current = Date.now();
    updateForText(text.content);
    await startTracking();
    EventBus.emit('detector:mode', { mode: detectorMode }, sessionId);
  }, [detectorMode, sessionId, startTracking, text.content, updateForText]);

  const handleDetectorModeChange = useCallback((mode: DetectorMode) => {
    setDetectorMode(mode);
    try {
      localStorage.setItem(DETECTOR_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in private mode contexts.
    }
    EventBus.emit('detector:mode', { mode }, sessionId);
  }, [sessionId]);

  const goNext = useCallback(() => {
    if (activePara === paragraphs.length - 1) {
      handleEnd('completed');
    } else {
      setActivePara(p => p + 1);
    }
    setParagraphFocusScale(PARAGRAPH_FOCUS_MIN_SCALE);
  }, [activePara, paragraphs.length, handleEnd]);

  const goPrev = useCallback(() => {
    setActivePara(p => Math.max(p - 1, 0));
    setParagraphFocusScale(PARAGRAPH_FOCUS_MIN_SCALE);
  }, []);

  useEffect(() => {
    const runtime = struggleRuntimeRef.current;
    runtime.fixationWordId = '';
    runtime.fixationWordStartTs = 0;
    runtime.outOfTextZoneStartTs = 0;
  }, [activePara]);

  useEffect(() => {
    if (!started || ended) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [started, ended, goNext, goPrev]);

  // Affiche un curseur live là où le regard est estimé.
  useEffect(() => {
    if (!started || ended) return;

    const unsub = EventBus.on<GazePointData>('gaze:point', (event) => {
      if (event.sessionId !== sessionId) return;

      const now = event.payload.timestamp ?? Date.now();
      const runtime = struggleRuntimeRef.current;

      const incoming: CursorPoint = {
        x: event.payload.x,
        y: event.payload.y,
        confidence: event.payload.confidence,
      };

      const velocity = event.payload.velocity ?? 0;

      const previousConfidence = gazeConfidenceRef.current || incoming.confidence;
      const smoothedConfidence =
        previousConfidence + (incoming.confidence - previousConfidence) * CURSOR_CONFIDENCE_EMA;
      gazeConfidenceRef.current = smoothedConfidence;

      if (smoothedConfidence >= CURSOR_CONFIDENCE_SHOW) {
        lastConfidentAtRef.current = now;
      }

      const holdWindowActive = now - lastConfidentAtRef.current <= CURSOR_CONFIDENCE_HOLD_MS;
      const adjustedIncoming = {
        ...incoming,
        confidence: smoothedConfidence,
      };

      let nextGazePoint: CursorPoint | null = null;

      if (smoothedConfidence < CURSOR_MIN_CONFIDENCE && !holdWindowActive) {
        const prev = gazePointRef.current ?? {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
          confidence: smoothedConfidence,
        };
        nextGazePoint = prev
          ? {
              ...prev,
              confidence: clamp(prev.confidence * 0.96 + smoothedConfidence * 0.04, 0, 1),
            }
          : null;

        gazePointRef.current = nextGazePoint;
        setGazePoint(nextGazePoint);
        return;
      }

      nextGazePoint = stabilizeCursor(gazePointRef.current, adjustedIncoming);
      gazePointRef.current = nextGazePoint;
      setGazePoint(nextGazePoint);

      if (!nextGazePoint || !containerRef.current) return;

      if (runtime.previousSample) {
        runtime.saccades.push({
          dx: nextGazePoint.x - runtime.previousSample.x,
          timestamp: now,
        });
        if (runtime.saccades.length > 16) {
          runtime.saccades.splice(0, runtime.saccades.length - 16);
        }
      }

      runtime.previousSample = nextGazePoint;
      runtime.previousSampleTs = now;

      const readingRect = containerRef.current.getBoundingClientRect();
      const insideTextZone =
        nextGazePoint.x >= readingRect.left &&
        nextGazePoint.x <= readingRect.right &&
        nextGazePoint.y >= readingRect.top &&
        nextGazePoint.y <= readingRect.bottom;

      if (!insideTextZone && nextGazePoint.confidence >= 0.6) {
        if (runtime.outOfTextZoneStartTs === 0) {
          runtime.outOfTextZoneStartTs = now;
        }
      } else {
        runtime.outOfTextZoneStartTs = 0;
      }

      const outsideTextZone =
        runtime.outOfTextZoneStartTs > 0 &&
        now - runtime.outOfTextZoneStartTs >= OUT_OF_TEXT_ZONE_TRIGGER_MS;

      const hoveredElement = document.elementFromPoint(nextGazePoint.x, nextGazePoint.y) as HTMLElement | null;
      const paragraphAnchor = hoveredElement?.closest('[data-paragraph-index]') as HTMLElement | null;
      const paragraphIndex = paragraphAnchor ? Number(paragraphAnchor.dataset.paragraphIndex) : -1;

      const hoveredWordElement =
        paragraphIndex === activePara
          ? (hoveredElement?.closest('.adaptive-word') as HTMLElement | null)
          : null;

      const hoveredWordId = hoveredWordElement?.id ?? '';
      const hoveredWordText = hoveredWordElement?.textContent?.trim() ?? '';
      const hoveredWordCharCount = Math.max(
        1,
        (hoveredWordText.match(/\p{L}/gu) ?? []).length || hoveredWordText.length || 1
      );

      let fixationDurationMs = 0;
      if (hoveredWordId) {
        if (runtime.fixationWordId !== hoveredWordId) {
          if (runtime.fixationWordId && runtime.fixationWordStartTs > 0) {
            const previousFixation = Math.max(0, now - runtime.fixationWordStartTs);
            runtime.meanFixationDurationMs =
              runtime.meanFixationDurationMs * 0.84 + previousFixation * 0.16;
          }

          runtime.fixationWordId = hoveredWordId;
          runtime.fixationWordStartTs = now;
        }

        fixationDurationMs = Math.max(0, now - runtime.fixationWordStartTs);
      } else {
        runtime.fixationWordId = '';
        runtime.fixationWordStartTs = 0;
      }

      const struggleResult = detectStruggle({
        now,
        fixationDurationMs,
        wordCharCount: hoveredWordCharCount,
        gazeVelocity: velocity,
        meanFixationDurationMs: runtime.meanFixationDurationMs,
        wordComplexity: estimateWordComplexity(hoveredWordText),
        saccades: runtime.saccades,
      });

      const ruleScore = outsideTextZone ? 1 : struggleResult.score;
      const ruleBand: StruggleBand = outsideTextZone ? 'high' : struggleResult.band;

      const combinedScore = clamp(modelScore * 0.55 + ruleScore * 0.45, 0, 1);
      const nextCombinedScore =
        combinedScoreRef.current + (combinedScore - combinedScoreRef.current) * COMBINED_SCORE_ALPHA;
      combinedScoreRef.current = nextCombinedScore;
      const combinedBand: StruggleBand = outsideTextZone ? 'high' : classifyBand(nextCombinedScore);

      setRuleDebugState({
        score: ruleScore,
        band: ruleBand,
        fixationDurationMs,
        expectedFixationMs: struggleResult.expectedFixationDurationMs,
        triggerFixationMs: struggleResult.fixationTriggerDurationMs,
        regressionCount: struggleResult.regressionCount,
        velocityRejected: struggleResult.velocityRejected,
        outsideTextZone,
      });

      setCombinedStruggleScore(nextCombinedScore);
      setCombinedStruggleBand((prev) => (prev === combinedBand ? prev : combinedBand));

      const controller = adaptiveControllerRef.current ?? new QalamAdaptiveController();
      adaptiveControllerRef.current = controller;
      const deltaTimeMs = lastAdaptiveUpdateRef.current === 0
        ? 16
        : Math.max(0, now - lastAdaptiveUpdateRef.current);
      lastAdaptiveUpdateRef.current = now;
      const adaptiveOutput = controller.update(combinedScore, smoothedConfidence, deltaTimeMs);

      setAdaptiveUiState((prev) => {
        if (
          Math.abs(prev.fontScale - adaptiveOutput.fontScale) < 0.002 &&
          Math.abs(prev.wordSpacing - adaptiveOutput.wordSpacing) < 0.002 &&
          prev.isAssistActive === adaptiveOutput.isAssistActive
        ) {
          return prev;
        }
        return adaptiveOutput;
      });

      const fixationTriggered = fixationDurationMs > struggleResult.fixationTriggerDurationMs;
      let paragraphTargetScale = PARAGRAPH_FOCUS_MIN_SCALE;

      if (outsideTextZone) {
        paragraphTargetScale = PARAGRAPH_FOCUS_OUTSIDE_SCALE;
      } else if (combinedBand === 'high') {
        paragraphTargetScale = PARAGRAPH_FOCUS_HIGH_SCALE;
      } else if (combinedBand === 'early' || fixationTriggered) {
        paragraphTargetScale = PARAGRAPH_FOCUS_EARLY_SCALE;
      }

      if (fixationTriggered) {
        paragraphTargetScale = Math.min(
          PARAGRAPH_FOCUS_OUTSIDE_SCALE,
          paragraphTargetScale + 0.02
        );
      }

      setParagraphFocusScale((prev) => {
        const alpha = paragraphTargetScale > prev
          ? PARAGRAPH_FOCUS_RISE_ALPHA
          : PARAGRAPH_FOCUS_FALL_ALPHA;
        const next = prev + (paragraphTargetScale - prev) * alpha;
        return clamp(next, PARAGRAPH_FOCUS_MIN_SCALE, PARAGRAPH_FOCUS_OUTSIDE_SCALE);
      });
    });

    return () => {
      unsub();
      gazePointRef.current = null;
      gazeConfidenceRef.current = 0;
      lastConfidentAtRef.current = 0;
      setGazePoint(null);
    };
  }, [activePara, ended, modelScore, sessionId, started]);

  useEffect(() => {
    if (!started || ended) return;
    if (gazePointRef.current) return;

    const centerPoint: CursorPoint = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      confidence: CURSOR_MIN_CONFIDENCE,
    };

    gazePointRef.current = centerPoint;
    setGazePoint(centerPoint);
  }, [ended, started]);

  useEffect(() => {
    if (!started || ended) return;

    const unsub = EventBus.on<DetectorDebugPayload>('detector:debug', (event) => {
      if (event.sessionId !== sessionId) return;
      setDetectorDebug(event.payload);
    });

    return () => {
      unsub();
      setDetectorDebug(null);
    };
  }, [started, ended, sessionId]);

  // Met à jour la cible de zoom uniquement si le signal est stable.
  useEffect(() => {
    if (!started || ended) return;

    const zoomState = zoomStateRef.current;
    const score = combinedStruggleScore;
    const triggerThreshold = combinedStruggleBand === 'high' ? 0.64 : 0.5;
    const gazeStability = detectorDebug?.gazeStability ?? 1;
    const confidenceOk = (gazePoint?.confidence ?? 1) >= ZOOM_MIN_CONFIDENCE;
    const outsideTextZone = ruleDebugState.outsideTextZone;
    const now = Date.now();

    zoomState.scoreSmoothed += (score - zoomState.scoreSmoothed) * ZOOM_SCORE_ALPHA;

    const isStable = gazeStability >= ZOOM_STABILITY_MIN && confidenceOk;
    if (isStable) {
      if (zoomState.stableSince === 0) zoomState.stableSince = now;
    } else {
      zoomState.stableSince = 0;
    }

    const stableLongEnough =
      zoomState.stableSince > 0 && now - zoomState.stableSince >= ZOOM_STABLE_HOLD_MS;

    const shouldZoom =
      (combinedStruggleBand !== 'smooth' || outsideTextZone) &&
      stableLongEnough;

    const zoomScore = outsideTextZone
      ? Math.max(zoomState.scoreSmoothed, 0.75)
      : zoomState.scoreSmoothed;

    const targetScale = shouldZoom
      ? scoreToZoom(zoomScore, triggerThreshold)
      : ZOOM_MIN_SCALE;
    const targetChanged = Math.abs(targetScale - zoomState.targetScale) > 0.01;
    const canUpdateTarget =
      now - zoomState.lastTargetUpdateAt >= ZOOM_TARGET_COOLDOWN_MS ||
      targetScale < zoomState.targetScale;

    if (targetChanged && canUpdateTarget) {
      zoomState.targetScale = targetScale;
      zoomState.lastTargetUpdateAt = now;
    }

    if (gazePoint && containerRef.current && confidenceOk) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        const relativeX = ((gazePoint.x - rect.left) / rect.width) * 100;
        const relativeY = ((gazePoint.y - rect.top) / rect.height) * 100;
        const boundedX = clamp(relativeX, 14, 86);
        const boundedY = clamp(relativeY, 18, 82);

        zoomState.originX += (boundedX - zoomState.originX) * ZOOM_ORIGIN_LERP;
        zoomState.originY += (boundedY - zoomState.originY) * ZOOM_ORIGIN_LERP;
      }
    }
  }, [combinedStruggleBand, combinedStruggleScore, detectorDebug, ended, gazePoint, ruleDebugState.outsideTextZone, started]);

  // Animation continue via requestAnimationFrame pour un zoom fluide sans saccades.
  useEffect(() => {
    if (!started || ended) return;

    let isMounted = true;

    const tick = () => {
      if (!isMounted) return;

      const article = containerRef.current;
      const frame = zoomFrameRef.current;
      const zoomState = zoomStateRef.current;

      zoomState.currentScale +=
        (zoomState.targetScale - zoomState.currentScale) * ZOOM_LERP_ALPHA;

      if (Math.abs(zoomState.targetScale - zoomState.currentScale) < 0.0008) {
        zoomState.currentScale = zoomState.targetScale;
      }

      if (article) {
        article.style.transformOrigin = `${zoomState.originX.toFixed(1)}% ${zoomState.originY.toFixed(1)}%`;
        article.style.transform = `scale(${zoomState.currentScale.toFixed(4)})`;
        article.style.willChange = 'transform';
      }

      if (article && frame) {
        const baseHeight = article.offsetHeight;
        const scaleGain = Math.max(0, zoomState.currentScale - 1);
        if (baseHeight > 0 && scaleGain > 0) {
          const originY = clamp(zoomState.originY / 100, 0, 1);
          const extraTop = baseHeight * scaleGain * originY;
          const extraBottom = baseHeight * scaleGain * (1 - originY);
          frame.style.paddingTop = `${extraTop.toFixed(1)}px`;
          frame.style.paddingBottom = `${extraBottom.toFixed(1)}px`;
        } else {
          frame.style.paddingTop = '0px';
          frame.style.paddingBottom = '0px';
        }
      }

      zoomState.rafId = requestAnimationFrame(tick);
    };

    zoomStateRef.current.rafId = requestAnimationFrame(tick);

    return () => {
      isMounted = false;

      if (zoomStateRef.current.rafId !== null) {
        cancelAnimationFrame(zoomStateRef.current.rafId);
        zoomStateRef.current.rafId = null;
      }

      const article = containerRef.current;
      if (article) {
        article.style.transform = 'scale(1)';
        article.style.transformOrigin = '50% 50%';
        article.style.willChange = 'auto';
      }

      const frame = zoomFrameRef.current;
      if (frame) {
        frame.style.paddingTop = '0px';
        frame.style.paddingBottom = '0px';
      }

      zoomStateRef.current.currentScale = 1;
      zoomStateRef.current.targetScale = 1;
      zoomStateRef.current.originX = 50;
      zoomStateRef.current.originY = 50;
    };
  }, [ended, started]);

  const readerStyle: React.CSSProperties = {
    fontFamily:      'var(--qs-font-family)',
    fontSize:        readerOverride.fontSize ?? 'var(--qs-font-size)',
    lineHeight:      readerOverride.lineHeight ?? 'var(--qs-line-height)',
    letterSpacing:   readerOverride.letterSpacing ?? 'var(--qs-letter-spacing)',
    wordSpacing:     readerOverride.wordSpacing ?? 'var(--qs-word-spacing)',
    backgroundColor: 'var(--qs-bg-color)',
    color:           'var(--qs-text-color)',
    direction,
    textAlign:       isRTL ? 'right' : 'left',
    wordBreak:       'break-word',
    boxSizing:       'border-box',
    transition:
      `font-size var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}, ` +
      `line-height var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}, ` +
      `letter-spacing var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}, ` +
      `word-spacing var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}, ` +
      `background-color var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}, ` +
      `color var(--qs-transition-duration, 500ms) ${READER_TRANSITION_EASE}`,
    borderRadius:    12,
    padding:         '1.5rem',
    transform:       'scale(1)',
    transformOrigin: '50% 50%',
  };

  if (!started) return (
    <StartScreen
      title={text.title}
      profile={profile}
      hasConsent={!noConsent && hasPermission !== false}
      onStart={handleStart}
    />
  );

  if (ended) return (
    <EndScreen
      profile={profile}
      wordsRead={totalWords}
      elapsed={elapsed}
      reason={endReason}
      onExit={() => onSessionEnd?.(totalWords)}
    />
  );

  const timeLeft    = Math.max(0, maxDuration - elapsed);
  const timeWarning = timeLeft < 2 * 60 * 1000;
  const showGazeCursor = hasPermission === true && gazePoint !== null;
  const cursorConfidence = gazePoint?.confidence ?? 0;
  const cursorBlend = clamp((cursorConfidence - 0.25) / 0.65, 0, 1);
  const cursorOpacity = clamp(0.45 + cursorBlend * 0.55, 0.45, 1);
  const cursorR = Math.round(186 + (29 - 186) * cursorBlend);
  const cursorG = Math.round(117 + (158 - 117) * cursorBlend);
  const cursorB = Math.round(23 + (117 - 23) * cursorBlend);
  const cursorColor = `rgb(${cursorR}, ${cursorG}, ${cursorB})`;
  const cursorFill = `rgba(${cursorR}, ${cursorG}, ${cursorB}, ${0.08 + cursorBlend * 0.14})`;
  const cursorGlow = `0 0 0 6px rgba(${cursorR}, ${cursorG}, ${cursorB}, ${0.06 + cursorBlend * 0.10})`;
  const liveZoom = zoomStateRef.current.currentScale;

  return (
    <div style={{ position: 'relative' }}>
      <AdaptationIndicator isActive={adapterActive && effectiveAidLevel !== 'LOW'} />

      {showGazeCursor && gazePoint && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            left: gazePoint.x,
            top: gazePoint.y,
            transform: 'translate(-50%, -50%)',
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: `2px solid ${cursorColor}`,
            background: cursorFill,
            pointerEvents: 'none',
            zIndex: 9999,
            transition: 'left 120ms ease-out, top 120ms ease-out, opacity 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
            boxShadow: cursorGlow,
            opacity: cursorOpacity,
          }}
        />
      )}

      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          borderRadius: 99,
          marginBottom: '0.75rem',
          background: aidTone.bg,
          color: aidTone.fg,
          fontSize: '0.76rem',
          fontWeight: 500,
          transition: 'background-color 400ms ease, color 400ms ease, opacity 400ms ease',
          opacity: adapterActive ? 1 : 0.92,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background:
              effectiveAidLevel === 'HIGH'
                ? '#1D5FA5'
                : effectiveAidLevel === 'MEDIUM'
                  ? '#BA7517'
                  : '#8A8880',
            display: 'inline-block',
          }}
        />
        {aidTone.label}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 10,
        marginBottom: '0.75rem',
      }}>
        <div style={{
          border: '1px solid #D7E6F2',
          borderRadius: 10,
          padding: '0.6rem 0.75rem',
          background: '#F7FBFF',
        }}>
          <div style={{ fontSize: '0.72rem', color: '#4B6A83', marginBottom: 6, fontWeight: 600 }}>
            Mode de détection (runtime)
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => handleDetectorModeChange('heuristic')}
              style={{
                flex: 1,
                border: detectorMode === 'heuristic' ? '1px solid #085041' : '1px solid #BFD5C8',
                background: detectorMode === 'heuristic' ? '#E1F5EE' : '#FFFFFF',
                color: '#085041',
                borderRadius: 8,
                padding: '0.35rem 0.4rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Heuristic
            </button>
            <button
              onClick={() => handleDetectorModeChange('hybrid')}
              style={{
                flex: 1,
                border: detectorMode === 'hybrid' ? '1px solid #085041' : '1px solid #BFD5C8',
                background: detectorMode === 'hybrid' ? '#E1F5EE' : '#FFFFFF',
                color: '#085041',
                borderRadius: 8,
                padding: '0.35rem 0.4rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Hybrid model
            </button>
          </div>
          <button
            onClick={() => recalibrate()}
            style={{
              width: '100%',
              marginTop: 8,
              border: '1px solid #C9D9E7',
              background: '#FFFFFF',
              color: '#25557B',
              borderRadius: 8,
              padding: '0.35rem 0.4rem',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Recalibrer le suivi du regard"
          >
            Recalibrer le regard
          </button>
        </div>

        <div style={{
          border: '1px solid #E5E2D7',
          borderRadius: 10,
          padding: '0.6rem 0.75rem',
          background: '#FFFDF8',
        }}>
          <div style={{ fontSize: '0.72rem', color: '#6E6653', marginBottom: 6, fontWeight: 600 }}>
            Debug score panel
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            fontSize: '0.74rem',
            color: '#4C463A',
          }}>
            <div style={{ background: '#F3F8FF', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Heuristic: <strong>{formatScore(detectorDebug?.heuristicScore)}</strong>
            </div>
            <div style={{ background: '#F3F8FF', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Hybrid: <strong>{formatScore(detectorDebug?.hybridScore)}</strong>
            </div>
            <div style={{ background: '#FFF7EA', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Model p: <strong>{formatScore(detectorDebug?.modelProbability)}</strong>
            </div>
            <div style={{ background: '#FFF7EA', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Final: <strong>{formatScore(detectorDebug?.adjustedScore ?? detectorDebug?.selectedScore)}</strong>
            </div>
            <div style={{ background: '#EAF4FF', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Rule: <strong>{formatScore(ruleDebugState.score)}</strong>
            </div>
            <div style={{ background: '#EAF4FF', borderRadius: 6, padding: '0.35rem 0.45rem' }}>
              Combined: <strong>{formatScore(combinedStruggleScore)}</strong>
            </div>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#6E6653' }}>
            Type: <strong>{detectorDebug?.dominantType ?? '--'}</strong> · Trigger:
            <strong style={{ color: detectorDebug?.triggered ? '#0F6E56' : '#8A8880', marginLeft: 3 }}>
              {detectorDebug?.triggered ? 'ON' : 'OFF'}
            </strong>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#6E6653' }}>
            Rule band: <strong>{ruleDebugState.band.toUpperCase()}</strong> ·
            Combined band: <strong>{combinedStruggleBand.toUpperCase()}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#6E6653' }}>
            Fixation: <strong>{Math.round(ruleDebugState.fixationDurationMs)}ms</strong> /
            <strong>{Math.round(ruleDebugState.triggerFixationMs)}ms</strong> ·
            Regressions: <strong>{ruleDebugState.regressionCount}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#6E6653' }}>
            Noise rejected: <strong>{ruleDebugState.velocityRejected ? 'YES' : 'NO'}</strong> ·
            Outside text: <strong>{ruleDebugState.outsideTextZone ? 'YES' : 'NO'}</strong>
          </div>
          <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#6E6653' }}>
            Th: <strong>{formatScore(detectorDebug?.triggerThreshold)}</strong> /
            <strong>{formatScore(detectorDebug?.releaseThreshold)}</strong> ·
            Base: <strong>{formatScore(detectorDebug?.baselineMean)}</strong> ±
            <strong>{formatScore(detectorDebug?.baselineStd)}</strong>
          </div>
          <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#6E6653' }}>
            Stability: <strong>{formatScore(detectorDebug?.gazeStability)}</strong> ·
            Article zoom: <strong>{liveZoom.toFixed(3)}x</strong> ·
            Paragraph zoom: <strong>{paragraphFocusScale.toFixed(3)}x</strong>
          </div>
        </div>
      </div>

      <ReadingProgress textLength={text.content.length} containerRef={containerRef} />

      {/* Timer */}
      <div style={{
        textAlign: 'right', fontSize: '0.78rem', marginBottom: '0.5rem',
        color: timeWarning ? '#A32D2D' : '#B4B2A9',
        fontWeight: timeWarning ? 500 : 400,
      }}>
        {timeWarning ? '⚠️ ' : ''}Temps restant : {formatTime(timeLeft)}
      </div>

      {/* Bannière caméra */}
      {hasPermission === false && !noConsent && (
        <div style={{
          padding: '0.5rem 1rem', background: '#FFF8E7',
          borderLeft: '3px solid #BA7517', marginBottom: '1rem',
          fontSize: '0.875rem', color: '#633806',
        }}>
          Mode adaptation manuelle — caméra non disponible
        </div>
      )}

      {/* Zone lecture */}
      <div ref={zoomFrameRef} style={{ borderRadius: 14, overflow: 'hidden' }}>
        <article
          ref={containerRef}
          className="qs-reader"
          style={readerStyle}
          lang={isRTL ? 'ar' : 'fr'}
          dir={direction}
          tabIndex={0}
        >
          <h1 style={{ marginBottom: '1.5em', fontSize: '1.4em', fontWeight: 600 }}>
            {text.title}
          </h1>

          {paragraphs.map((para, i) => (
            <div
              key={i}
              onClick={() => setActivePara(i)}
              data-paragraph-index={i}
              style={{
                cursor: 'pointer',
                transform: `scale(${(i === activePara ? paragraphFocusScale : 1).toFixed(4)})`,
                transformOrigin: isRTL ? 'right top' : 'left top',
                transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {i === activePara && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  marginBottom: 2, color: '#1D9E75',
                  fontSize: '0.78rem', fontWeight: 500,
                }}>
                  <span>▶ Tu lis ici</span>
                  <span style={{ fontSize: '0.7rem', color: '#B4B2A9', fontWeight: 400 }}>
                    {i + 1} / {paragraphs.length}
                  </span>
                </div>
              )}
              <ReadingParagraph
                text={para}
                isDyslexic={isDyslexic}
                isRTL={isRTL}
                isActive={i === activePara}
                paragraphIndex={i}
              />
            </div>
          ))}
        </article>
      </div>

      {/* Navigation */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginTop: '1.5rem', gap: 12,
      }}>
        <button
          onClick={goPrev}
          disabled={activePara === 0}
          style={{
            padding: '0.6rem 1.25rem', border: '1.5px solid #D3D1C7',
            borderRadius: 10, background: 'transparent',
            cursor: activePara === 0 ? 'not-allowed' : 'pointer',
            color: activePara === 0 ? '#B4B2A9' : '#085041',
            fontSize: '0.9rem', fontWeight: 500,
          }}
        >← Précédent</button>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {paragraphs.map((_, i) => (
            <div
              key={i}
              onClick={() => setActivePara(i)}
              style={{
                width: i === activePara ? 20 : 8, height: 8,
                borderRadius: 4, cursor: 'pointer',
                background: i === activePara ? '#1D9E75' : i < activePara ? '#9FE1CB' : '#D3D1C7',
                transition: 'all 0.2s',
              }}
            />
          ))}
        </div>

        <button
          onClick={goNext}
          style={{
            padding: '0.6rem 1.25rem', border: 'none', borderRadius: 10,
            background: activePara === paragraphs.length - 1 ? '#085041' : '#1D9E75',
            color: '#fff', cursor: 'pointer',
            fontSize: '0.9rem', fontWeight: 500,
          }}
        >
          {activePara === paragraphs.length - 1 ? 'Terminer ✓' : 'Suivant →'}
        </button>
      </div>

      <p style={{ textAlign: 'center', fontSize: '0.72rem', color: '#B4B2A9', marginTop: '0.75rem' }}>
        Touches ← → pour naviguer
      </p>
    </div>
  );
};