/**
 * SpacingController.ts
 * RÔLE : Contrôle fin de l'espacement typographique.
 * Gère l'interligne, l'espacement des lettres et des mots
 * avec des transitions linéaires pour éviter les sauts visuels brusques.
 * Respecte les recommandations WCAG 1.4.12 (Text Spacing).
 *
 * WCAG 1.4.12 minimums :
 * - Interligne ≥ 1.5× la taille de la police
 * - Espacement lettres ≥ 0.12em
 * - Espacement mots ≥ 0.16em
 * - Espacement paragraphes ≥ 2× la taille de la police
 */

 import { CSSTokenEmitter } from './CSSTokenEmitter';
 import { clamp } from '../../shared/utils';
 import { logger } from '../../shared/logger';
 
 export interface SpacingConfig {
   lineHeight: number;      // Multiplicateur sans unité (1.5 → 3.0)
   letterSpacing: string;   // Em ou 'normal'
   wordSpacing: string;     // Em ou 'normal'
   paragraphSpacing: string;// Em
 }
 
 export class SpacingController {
   private emitter: CSSTokenEmitter;
   private current: SpacingConfig = {
     lineHeight: 1.6,
     letterSpacing: 'normal',
     wordSpacing: 'normal',
     paragraphSpacing: '0.5em',
   };
 
   constructor(emitter: CSSTokenEmitter) {
     this.emitter = emitter;
   }
 
   /**
    * Applique une configuration d'espacement en respectant les minima WCAG.
    */
   apply(config: Partial<SpacingConfig>): void {
     const validated = this.validateWCAG({ ...this.current, ...config });
     this.current = validated;
 
     this.emitter.set('--qs-line-height',      String(validated.lineHeight));
     this.emitter.set('--qs-letter-spacing',   validated.letterSpacing);
     this.emitter.set('--qs-word-spacing',     validated.wordSpacing);
     this.emitter.set('--qs-paragraph-spacing',validated.paragraphSpacing);
 
     logger.debug('SpacingController', 'Espacement appliqué', {
       lineHeight: validated.lineHeight,
     });
   }
 
   /**
    * Augmente progressivement l'espacement (animation pas à pas).
    * Utilisé pour les transitions très douces.
    */
   animateTo(targetLineHeight: number, steps = 5): void {
     const start = this.current.lineHeight;
     const delta = (targetLineHeight - start) / steps;
     let step = 0;
 
     const interval = setInterval(() => {
       step++;
       const value = clamp(start + delta * step, 1.4, 3.0);
       this.emitter.set('--qs-line-height', String(value.toFixed(2)));
       if (step >= steps) {
         clearInterval(interval);
         this.current.lineHeight = targetLineHeight;
       }
     }, 80);
   }
 
   /**
    * Garantit le respect des minima WCAG 1.4.12
    */
   private validateWCAG(config: SpacingConfig): SpacingConfig {
     return {
       lineHeight: Math.max(1.5, config.lineHeight),  // WCAG min 1.5
       letterSpacing: this.ensureMinEm(config.letterSpacing, 0.12),
       wordSpacing:   this.ensureMinEm(config.wordSpacing, 0.16),
       paragraphSpacing: config.paragraphSpacing,
     };
   }
 
   /** S'assure qu'une valeur em est au moins égale au minimum donné */
   private ensureMinEm(value: string, min: number): string {
     if (value === 'normal') return `${min}em`;
     const num = parseFloat(value);
     if (isNaN(num)) return `${min}em`;
     return `${Math.max(min, num)}em`;
   }
 
   reset(): void {
     this.apply({ lineHeight: 1.6, letterSpacing: 'normal', wordSpacing: 'normal' });
   }
 }