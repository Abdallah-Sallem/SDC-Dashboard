/**
 * AdaptationRules.ts
 * RÔLE : Table de règles d'adaptation par type de difficulté.
 * Pour chaque type (dyslexie visuelle, fatigue, attention, suivi de ligne),
 * définit précisément quels paramètres CSS appliquer et à quelle intensité.
 * Facile à modifier sans toucher à la logique du moteur.
 */

 import type {
    AdaptationParams,
    DifficultySignal,
    DifficultyType,
    StudentProfile,
  } from '../../shared/types';
  import {
    CSS_DEFAULTS,
    CSS_ADAPT_LIGHT,
    CSS_ADAPT_MODERATE,
    CSS_ADAPT_STRONG,
    DIFFICULTY_THRESHOLD_LIGHT,
    DIFFICULTY_THRESHOLD_MODERATE,
    DIFFICULTY_THRESHOLD_STRONG,
  } from '../../shared/constants';
  
  export class AdaptationRules {
    private profile: StudentProfile;
  
    constructor(profile: StudentProfile) {
      this.profile = profile;
    }
  
    /**
     * Calcule les paramètres d'adaptation selon le signal et l'intensité.
     * @param signal Signal de difficulté avec type et niveau
     * @param intensity Multiplicateur personnalisé [0.5..1.5] depuis ProfileMatcher
     */
    compute(signal: DifficultySignal, intensity: number = 1.0): AdaptationParams {
      const effectiveLevel = Math.min(1, signal.level * intensity);
      const baseParams = this.getBaseParams(signal.type, effectiveLevel);
  
      return {
        ...baseParams,
        direction: signal.language === 'ar' ? 'rtl' : 'ltr',
        transitionDuration: this.getTransitionDuration(effectiveLevel),
      };
    }
  
    /**
     * Sélectionne les paramètres de base selon le type et le niveau
     */
    private getBaseParams(
      type: DifficultyType,
      level: number
    ): Omit<AdaptationParams, 'direction' | 'transitionDuration'> {
      // Sélection du tier d'adaptation selon le niveau
      const tier = this.getTier(level);
  
      const RULES: Record<DifficultyType, Record<'light' | 'moderate' | 'strong', Partial<AdaptationParams>>> = {
        'dyslexia-visual': {
          light: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: CSS_ADAPT_LIGHT.lineHeight,
            letterSpacing: CSS_ADAPT_LIGHT.letterSpacing,
            wordSpacing: CSS_ADAPT_LIGHT.wordSpacing,
            backgroundColor: CSS_ADAPT_LIGHT.backgroundColor,
            textColor: '#1A1A1A',
            fontSize: CSS_DEFAULTS.fontSize,
            contrastLevel: 'normal',
          },
          moderate: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: CSS_ADAPT_MODERATE.lineHeight,
            letterSpacing: CSS_ADAPT_MODERATE.letterSpacing,
            wordSpacing: CSS_ADAPT_MODERATE.wordSpacing,
            backgroundColor: CSS_ADAPT_MODERATE.backgroundColor,
            textColor: '#111111',
            fontSize: '1.05rem',
            contrastLevel: 'high',
          },
          strong: {
            fontFamily: 'OpenDyslexic',
            lineHeight: CSS_ADAPT_STRONG.lineHeight,
            letterSpacing: CSS_ADAPT_STRONG.letterSpacing,
            wordSpacing: CSS_ADAPT_STRONG.wordSpacing,
            backgroundColor: CSS_ADAPT_STRONG.backgroundColor,
            textColor: '#000000',
            fontSize: CSS_ADAPT_STRONG.fontSize,
            contrastLevel: 'maximum',
          },
        },
  
        fatigue: {
          light: {
            fontFamily: this.profile.preferredFont,
            lineHeight: 1.7,
            letterSpacing: '0.03em',
            wordSpacing: '0.08em',
            backgroundColor: '#FFFEF0',  // Fond légèrement chaud
            textColor: '#1A1A1A',
            fontSize: '1.02rem',
            contrastLevel: 'normal',
          },
          moderate: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: 1.9,
            letterSpacing: '0.05em',
            wordSpacing: '0.12em',
            backgroundColor: '#FFF8E1',  // Plus chaud
            textColor: '#1A1A1A',
            fontSize: '1.08rem',
            contrastLevel: 'normal',
          },
          strong: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: 2.1,
            letterSpacing: '0.08em',
            wordSpacing: '0.18em',
            backgroundColor: '#FFF3CD',
            textColor: '#1A1A1A',
            fontSize: '1.15rem',
            contrastLevel: 'high',
          },
        },
  
        attention: {
          light: {
            fontFamily: this.profile.preferredFont,
            lineHeight: 1.8,
            letterSpacing: '0.04em',
            wordSpacing: '0.1em',
            backgroundColor: '#F0F8FF',  // Fond bleu très léger, apaisant
            textColor: '#1A1A1A',
            fontSize: CSS_DEFAULTS.fontSize,
            contrastLevel: 'normal',
          },
          moderate: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: 2.0,
            letterSpacing: '0.08em',
            wordSpacing: '0.2em',
            backgroundColor: '#E8F4F8',
            textColor: '#111111',
            fontSize: '1.05rem',
            contrastLevel: 'high',
          },
          strong: {
            fontFamily: 'OpenDyslexic',
            lineHeight: 2.2,
            letterSpacing: '0.12em',
            wordSpacing: '0.28em',
            backgroundColor: '#E0EFF8',
            textColor: '#000000',
            fontSize: '1.1rem',
            contrastLevel: 'high',
          },
        },
  
        'line-tracking': {
          light: {
            fontFamily: this.profile.preferredFont,
            lineHeight: 2.0,   // Interligne généreux pour retrouver sa ligne
            letterSpacing: '0.05em',
            wordSpacing: '0.15em',
            backgroundColor: '#FFFEF5',
            textColor: '#1A1A1A',
            fontSize: CSS_DEFAULTS.fontSize,
            contrastLevel: 'normal',
          },
          moderate: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: 2.3,
            letterSpacing: '0.08em',
            wordSpacing: '0.2em',
            backgroundColor: '#FFFFF0',
            textColor: '#111111',
            fontSize: '1.05rem',
            contrastLevel: 'high',
          },
          strong: {
            fontFamily: 'AtkinsonHyperlegible',
            lineHeight: 2.6,
            letterSpacing: '0.1em',
            wordSpacing: '0.25em',
            backgroundColor: '#FFFDE7',
            textColor: '#000000',
            fontSize: '1.1rem',
            contrastLevel: 'high',
          },
        },
  
        none: {
          light: { ...CSS_DEFAULTS, fontFamily: 'inherit', contrastLevel: 'normal' },
          moderate: { ...CSS_DEFAULTS, fontFamily: 'inherit', contrastLevel: 'normal' },
          strong: { ...CSS_DEFAULTS, fontFamily: 'inherit', contrastLevel: 'normal' },
        },
      };
  
      const rule = RULES[type][tier];
      return {
        fontFamily: rule.fontFamily ?? 'inherit',
        fontSize: rule.fontSize ?? '1rem',
        lineHeight: rule.lineHeight ?? 1.6,
        letterSpacing: rule.letterSpacing ?? 'normal',
        wordSpacing: rule.wordSpacing ?? 'normal',
        backgroundColor: rule.backgroundColor ?? '#FFFFFF',
        textColor: rule.textColor ?? '#1A1A1A',
        contrastLevel: rule.contrastLevel ?? 'normal',
      };
    }
  
    private getTier(level: number): 'light' | 'moderate' | 'strong' {
      if (level >= DIFFICULTY_THRESHOLD_STRONG) return 'strong';
      if (level >= DIFFICULTY_THRESHOLD_MODERATE) return 'moderate';
      return 'light';
    }
  
    private getTransitionDuration(level: number): number {
      if (level >= DIFFICULTY_THRESHOLD_STRONG) return 300;
      if (level >= DIFFICULTY_THRESHOLD_MODERATE) return 500;
      return 700; // Léger = transition plus lente = moins intrusif
    }
  }