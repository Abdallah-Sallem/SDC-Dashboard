/**
 * TextAdapterEngine.ts
 * RÔLE : ORCHESTRATEUR CENTRAL du module d'adaptation.
 * C'est le chef d'orchestre : écoute les signaux de difficulté,
 * consulte les règles, pilote les sous-modules (CSS, police, contraste...)
 * et envoie les paramètres finaux à l'interface.
 * Il ne touche JAMAIS directement l'UI — tout passe par CSSTokenEmitter.
 */

import { EventBus } from '../event-bus/EventBus';
import { CSSTokenEmitter } from './CSSTokenEmitter';
import { BilingualHandler } from './BilingualHandler';
import { ProfileMatcher } from './ProfileMatcher';
import { TransitionEngine } from './TransitionEngine';
import { CSS_DEFAULTS } from '../../shared/constants';
import type {
  AdaptationParams,
  DifficultySignal,
  ReadingLanguage,
  StudentProfile,
} from '../../shared/types';
import { logger } from '../../shared/logger';

type UiDifficultyLevel = 'LOW' | 'MEDIUM' | 'HIGH';

const STABILITY_WINDOW_MS = 1300;
const RECOVERY_STEP_MS = 850;

export class TextAdapterEngine {
  private emitter: CSSTokenEmitter;
  private bilingual: BilingualHandler;
  private matcher: ProfileMatcher;
  private transitions: TransitionEngine;
  private profile: StudentProfile;
  private sessionId = '';
  private isActive = false;
  private lastAdaptation: AdaptationParams | null = null;

  private currentLevel: UiDifficultyLevel = 'LOW';
  private pendingLevel: UiDifficultyLevel | null = null;
  private pendingSince = 0;
  private pendingScore = 0;
  private pendingLanguage: ReadingLanguage;
  private lastLanguage: ReadingLanguage;

  // Désabonnements — à appeler dans stop()
  private unsubDifficulty: (() => void) | null = null;
  private unsubReset: (() => void) | null = null;
  private unsubProfile: (() => void) | null = null;

  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(profile: StudentProfile, sessionId: string) {
    this.sessionId = sessionId;
    this.profile = profile;
    this.emitter = new CSSTokenEmitter();
    this.bilingual = new BilingualHandler();
    this.matcher = new ProfileMatcher(profile);
    this.transitions = new TransitionEngine(this.emitter);
    this.pendingLanguage = profile.language;
    this.lastLanguage = profile.language;
  }

  /** Démarre l'écoute des événements et active les adaptations */
  start(): void {
    this.unsubDifficulty = EventBus.on<DifficultySignal>('difficulty:detected', (event) => {
      this.handleDifficulty(event.payload);
    });

    this.unsubReset = EventBus.on('adaptation:reset', () => this.reset());

    this.unsubProfile = EventBus.on<StudentProfile>('profile:updated', (event) => {
      this.profile = event.payload;
      this.matcher = new ProfileMatcher(event.payload);
    });

    this.isActive = true;
    logger.info('TextAdapterEngine', 'Démarré', { sessionId: this.sessionId });
  }

  /**
   * Traite les signaux de difficulté avec anti-oscillation.
   * Le niveau est appliqué uniquement s'il reste stable sur une fenêtre temporelle.
   */
  private handleDifficulty(signal: DifficultySignal): void {
    if (!this.isActive) return;

    const intensity = this.matcher.getIntensity(signal);
    const effectiveScore = this.clamp(signal.level * intensity, 0, 1);
    const targetLevel = this.scoreToLevel(effectiveScore);

    this.lastLanguage = signal.language;

    if (this.levelRank(targetLevel) > this.levelRank(this.currentLevel)) {
      this.cancelRecovery();
    }

    if (targetLevel === this.currentLevel) {
      this.clearPendingLevel();
      return;
    }

    if (this.pendingLevel !== targetLevel) {
      this.pendingLevel = targetLevel;
      this.pendingSince = Date.now();
    }

    this.pendingScore = effectiveScore;
    this.pendingLanguage = signal.language;
    this.scheduleStableCommit();
  }

  /** Remet les paramètres à leur valeur par défaut de manière progressive */
  reset(): void {
    this.clearPendingLevel();
    this.cancelRecovery();

    if (this.currentLevel === 'LOW') {
      this.transitions.reset();
      this.lastAdaptation = null;
      logger.info('TextAdapterEngine', 'Paramètres déjà au niveau LOW');
      return;
    }

    this.recoverTowards('LOW', this.lastLanguage, 0);
    logger.info('TextAdapterEngine', 'Recovery vers LOW demandé');
  }

  /** Arrête le moteur et se désabonne du bus */
  stop(): void {
    this.unsubDifficulty?.();
    this.unsubReset?.();
    this.unsubProfile?.();
    this.clearPendingLevel();
    this.cancelRecovery();
    this.transitions.reset();
    this.lastAdaptation = null;
    this.currentLevel = 'LOW';
    this.isActive = false;
    logger.info('TextAdapterEngine', 'Arrêté');
  }

  private scheduleStableCommit(): void {
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);

    this.stabilityTimer = setTimeout(() => {
      if (!this.pendingLevel || !this.isActive) return;

      const stableFor = Date.now() - this.pendingSince;
      if (stableFor < STABILITY_WINDOW_MS) {
        this.scheduleStableCommit();
        return;
      }

      const targetLevel = this.pendingLevel;
      const targetScore = this.pendingScore;
      const targetLanguage = this.pendingLanguage;
      this.clearPendingLevel();

      if (targetLevel === this.currentLevel) return;

      if (this.levelRank(targetLevel) < this.levelRank(this.currentLevel)) {
        this.recoverTowards(targetLevel, targetLanguage, targetScore);
      } else {
        this.applyLevel(targetLevel, targetLanguage, targetScore);
      }
    }, STABILITY_WINDOW_MS);
  }

  private recoverTowards(targetLevel: UiDifficultyLevel, language: ReadingLanguage, score: number): void {
    this.cancelRecovery();

    const step = () => {
      if (!this.isActive) return;
      if (this.levelRank(this.currentLevel) <= this.levelRank(targetLevel)) return;

      const nextLevel = this.rankToLevel(this.levelRank(this.currentLevel) - 1);
      this.applyLevel(nextLevel, language, score);

      if (nextLevel !== targetLevel) {
        this.recoveryTimer = setTimeout(step, RECOVERY_STEP_MS);
      }
    };

    step();
  }

  private applyLevel(level: UiDifficultyLevel, language: ReadingLanguage, score: number): void {
    const params = this.paramsForLevel(level, language);

    if (this.isSameAdaptation(params)) {
      this.currentLevel = level;
      return;
    }

    this.bilingual.update(language);
    this.transitions.apply(params);
    this.lastAdaptation = params;
    this.currentLevel = level;

    EventBus.emit('adaptation:apply', params, this.sessionId);

    logger.info('TextAdapterEngine', 'Adaptation appliquée', {
      level,
      score: score.toFixed(2),
      transitionMs: params.transitionDuration,
    });
  }

  private paramsForLevel(level: UiDifficultyLevel, language: ReadingLanguage): AdaptationParams {
    if (level === 'LOW') {
      return {
        fontFamily: this.profile.preferredFont ?? 'inherit',
        fontSize: CSS_DEFAULTS.fontSize,
        lineHeight: CSS_DEFAULTS.lineHeight,
        letterSpacing: CSS_DEFAULTS.letterSpacing,
        wordSpacing: CSS_DEFAULTS.wordSpacing,
        backgroundColor: CSS_DEFAULTS.backgroundColor,
        textColor: CSS_DEFAULTS.textColor,
        contrastLevel: 'normal',
        direction: language === 'ar' ? 'rtl' : 'ltr',
        transitionDuration: 600,
      };
    }

    if (level === 'MEDIUM') {
      return {
        fontFamily: this.profile.preferredFont ?? 'inherit',
        fontSize: '1.08rem',
        lineHeight: 1.85,
        letterSpacing: '0.03em',
        wordSpacing: '0.10em',
        backgroundColor: '#FFFEFA',
        textColor: '#1A1A1A',
        contrastLevel: 'normal',
        direction: language === 'ar' ? 'rtl' : 'ltr',
        transitionDuration: 500,
      };
    }

    return {
      fontFamily: 'AtkinsonHyperlegible',
      fontSize: '1.24rem',
      lineHeight: 2.2,
      letterSpacing: '0.08em',
      wordSpacing: '0.22em',
      backgroundColor: '#F3F9FF',
      textColor: '#0F2A43',
      contrastLevel: 'high',
      direction: language === 'ar' ? 'rtl' : 'ltr',
      transitionDuration: 350,
    };
  }

  private scoreToLevel(score: number): UiDifficultyLevel {
    if (score >= 0.70) return 'HIGH';
    if (score >= 0.42) return 'MEDIUM';
    return 'LOW';
  }

  private levelRank(level: UiDifficultyLevel): number {
    if (level === 'LOW') return 0;
    if (level === 'MEDIUM') return 1;
    return 2;
  }

  private rankToLevel(rank: number): UiDifficultyLevel {
    if (rank <= 0) return 'LOW';
    if (rank === 1) return 'MEDIUM';
    return 'HIGH';
  }

  private clearPendingLevel(): void {
    this.pendingLevel = null;
    this.pendingScore = 0;
    this.pendingSince = 0;
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }

  /** Vérifie si l'adaptation demandée est identique à la précédente */
  private isSameAdaptation(params: AdaptationParams): boolean {
    if (!this.lastAdaptation) return false;
    return (
      this.lastAdaptation.fontFamily === params.fontFamily &&
      this.lastAdaptation.fontSize === params.fontSize &&
      this.lastAdaptation.lineHeight === params.lineHeight &&
      this.lastAdaptation.letterSpacing === params.letterSpacing &&
      this.lastAdaptation.wordSpacing === params.wordSpacing &&
      this.lastAdaptation.backgroundColor === params.backgroundColor &&
      this.lastAdaptation.textColor === params.textColor
    );
  }
}