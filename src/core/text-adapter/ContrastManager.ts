/**
 * ContrastManager.ts
 * RÔLE : Garantit que le texte reste toujours lisible en calculant
 * et ajustant les ratios de contraste selon WCAG 2.2.
 * Pour chaque combinaison texte/fond proposée par AdaptationRules,
 * vérifie qu'on atteint au minimum AA (4.5:1) ou AAA (7:1).
 */

 import { calculateContrastRatio, meetsWCAG } from '../../shared/utils';
 import { CSSTokenEmitter } from './CSSTokenEmitter';
 import type { ContrastLevel } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 // Palettes de couleurs validées WCAG pour chaque niveau de contraste
 const HIGH_CONTRAST_PAIRS: Array<{ text: string; bg: string }> = [
   { text: '#000000', bg: '#FFFFFF' },   // ratio 21:1
   { text: '#1A1A1A', bg: '#FFFEF5' },   // ratio ~18:1 (fond crème)
   { text: '#0D0D0D', bg: '#F0F4FF' },   // ratio ~19:1 (fond bleu pâle)
   { text: '#000000', bg: '#FFF8E7' },   // ratio 20:1 (fond jaune pâle)
 ];
 
 export class ContrastManager {
   private emitter: CSSTokenEmitter;
 
   constructor(emitter: CSSTokenEmitter) {
     this.emitter = emitter;
   }
 
   /**
    * Vérifie et ajuste la paire texte/fond pour garantir le contraste.
    * @returns La paire validée (potentiellement ajustée)
    */
   enforce(
     textColor: string,
     bgColor: string,
     level: ContrastLevel
   ): { textColor: string; bgColor: string } {
     const ratio = calculateContrastRatio(textColor, bgColor);
     const required = level === 'maximum' ? 'AAA' : 'AA';
 
     if (meetsWCAG(ratio, required)) {
       return { textColor, bgColor }; // Déjà conforme
     }
 
     // Chercher une paire conforme dans les palettes validées
     const safePair = HIGH_CONTRAST_PAIRS.find((p) =>
       meetsWCAG(calculateContrastRatio(p.text, p.bg), required)
     );
 
     if (safePair) {
       logger.warn('ContrastManager', `Contraste insuffisant (${ratio.toFixed(1)}:1) — fallback appliqué`);
       return { textColor: safePair.text, bgColor: safePair.bg };
     }
 
     // Dernier recours : noir sur blanc
     return { textColor: '#000000', bgColor: '#FFFFFF' };
   }
 
   /**
    * Applique directement une paire contraste sur le document
    */
   apply(textColor: string, bgColor: string, level: ContrastLevel): void {
     const safe = this.enforce(textColor, bgColor, level);
     this.emitter.set('--qs-text-color', safe.textColor);
     this.emitter.set('--qs-bg-color', safe.bgColor);
   }
 }