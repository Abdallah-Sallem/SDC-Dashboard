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
import type { AdaptationParams, StudentProfile, TeacherText } from '../../shared/types';


interface AdaptiveReaderProps {
  profile:       StudentProfile;
  text:          TeacherText;
  sessionId:     string;
  onSessionEnd?: (wordsRead: number) => void;
}

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

const Word: React.FC<{ word: string; isDyslexic: boolean; isRTL: boolean }> = ({
  word, isDyslexic, isRTL,
}) => {
  const isAlpha = /\p{L}/u.test(word);
  if (!isDyslexic || !isAlpha) return <span>{word}</span>;
  const syllables = isRTL ? [word] : splitSyllablesFr(word);
  if (syllables.length <= 1) return <span>{word}</span>;
  return (
    <span>
      {syllables.map((syl, i) => (
        <span key={i} style={{ color: SYLLABLE_COLORS[i % 2], fontWeight: 500 }}>{syl}</span>
      ))}
    </span>
  );
};

const ReadingParagraph: React.FC<{
  text: string; isDyslexic: boolean; isRTL: boolean; isActive: boolean;
}> = ({ text, isDyslexic, isRTL, isActive }) => (
  <p style={{
    marginBottom:  'var(--qs-paragraph-spacing, 1em)',
    padding:       '4px 8px 4px 6px',
    borderRadius:  6,
    background:    isActive ? 'rgba(29,158,117,0.07)' : 'transparent',
    borderLeft:    isActive ? '3px solid #1D9E75' : '3px solid transparent',
    transition:    'background 0.3s, border-color 0.3s',
    cursor:        'pointer',
    lineHeight:    'var(--qs-line-height)',
    wordSpacing:   'var(--qs-word-spacing)',
    letterSpacing: 'var(--qs-letter-spacing)',
  }}>
    {text.split(/(\s+)/).map((token, i) =>
      /^\s+$/.test(token)
        ? <span key={i}>{token}</span>
        : <Word key={i} word={token} isDyslexic={isDyslexic} isRTL={isRTL} />
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
  const startTimeRef = useRef<number>(0);

  const [started,    setStarted]    = useState(false);
  const [ended,      setEnded]      = useState(false);
  const [endReason,  setEndReason]  = useState<'completed' | 'timeout'>('completed');
  const [activePara, setActivePara] = useState(0);
  const [elapsed,    setElapsed]    = useState(0);

  const maxDuration = getMaxDuration(profile.age);

  // ✅ Syllabes pour dyslexia ET unknown
  const isDyslexic =
    profile.neurodivergenceTypes.includes('dyslexia') ||
    profile.neurodivergenceTypes.includes('unknown');

  const { currentParams, isActive: adapterActive } = useTextAdapter(profile, sessionId);
  const { start: startTracking, hasPermission, noConsent } = useEyeTracking(
    profile.id, sessionId, profile);
  const { direction, isRTL, updateForText } = useBilingual(text.content);

  const aidLevel = useMemo(() => inferAidLevel(currentParams), [currentParams]);
  const aidTone = useMemo(() => {
    if (aidLevel === 'HIGH') {
      return {
        label: 'Niveau HIGH: texte agrandi + espacement + aide couleur',
        bg: '#EAF4FF',
        fg: '#0F2A43',
      };
    }
    if (aidLevel === 'MEDIUM') {
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
  }, [aidLevel]);

  const paragraphs = text.content.split(/\n\n+/).filter(p => p.trim().length > 0);
  const totalWords = text.content.split(/\s+/).length;

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
  }, [startTracking, text.content, updateForText]);

  const goNext = useCallback(() => {
    if (activePara === paragraphs.length - 1) {
      handleEnd('completed');
    } else {
      setActivePara(p => p + 1);
    }
  }, [activePara, paragraphs.length, handleEnd]);

  const goPrev = useCallback(() => setActivePara(p => Math.max(p - 1, 0)), []);

  useEffect(() => {
    if (!started || ended) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [started, ended, goNext, goPrev]);

  const readerStyle: React.CSSProperties = {
    fontFamily:      'var(--qs-font-family)',
    fontSize:        'var(--qs-font-size)',
    lineHeight:      'var(--qs-line-height)',
    letterSpacing:   'var(--qs-letter-spacing)',
    wordSpacing:     'var(--qs-word-spacing)',
    backgroundColor: 'var(--qs-bg-color)',
    color:           'var(--qs-text-color)',
    direction,
    textAlign:       isRTL ? 'right' : 'left',
    transition:
      'font-size var(--qs-transition-duration, 500ms) ease, ' +
      'line-height var(--qs-transition-duration, 500ms) ease, ' +
      'letter-spacing var(--qs-transition-duration, 500ms) ease, ' +
      'word-spacing var(--qs-transition-duration, 500ms) ease, ' +
      'background-color var(--qs-transition-duration, 500ms) ease, ' +
      'color var(--qs-transition-duration, 500ms) ease',
    borderRadius:    12,
    padding:         '1.5rem',
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

  return (
    <div style={{ position: 'relative' }}>
      <AdaptationIndicator isActive={adapterActive && aidLevel !== 'LOW'} />

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
              aidLevel === 'HIGH' ? '#1D5FA5' : aidLevel === 'MEDIUM' ? '#BA7517' : '#8A8880',
            display: 'inline-block',
          }}
        />
        {aidTone.label}
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
          <div key={i} onClick={() => setActivePara(i)} style={{ cursor: 'pointer' }}>
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
            />
          </div>
        ))}
      </article>

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