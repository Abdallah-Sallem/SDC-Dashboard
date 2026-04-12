/**
 * TransitionEngine.ts
 * RÔLE : Orchestre l'ordre d'application des changements visuels
 * pour rendre les adaptations non-intrusives et fluides.
 * ORDRE IMPORTANT :
 *   1. Durée de transition (prépare le CSS)
 *   2. Police (changement le plus notable — en premier)
 *   3. Espacement (100ms après)
 *   4. Couleurs (200ms après — le moins perturbant)
 * Cet ordre minimise l'effet de "flash" visuel pour l'élève.
 */

 import { CSSTokenEmitter } from './CSSTokenEmitter';
 import type { AdaptationParams } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 export class TransitionEngine {
   private emitter: CSSTokenEmitter;
   private pendingTimers: ReturnType<typeof setTimeout>[] = [];
 
   constructor(emitter: CSSTokenEmitter) {
     this.emitter = emitter;
   }
 
   /**
    * Applique les paramètres en séquence pour une transition fluide.
    */
   apply(params: AdaptationParams): void {
     // Annuler les transitions en cours si une nouvelle arrive
     this.cancelPending();
 
     const d = params.transitionDuration;
 
     // Étape 1 : Immédiat — définir la durée des transitions CSS
     this.emitter.set('--qs-transition-duration', `${d}ms`);
 
     // Étape 2 : Immédiat — Police (changement le plus visible en premier)
     this.emitter.apply(params); // CSSTokenEmitter applique tout d'un coup...
 
     // ...mais on anime l'espacement séparément pour plus de douceur
     const t1 = setTimeout(() => {
       this.emitter.set('--qs-line-height',    String(params.lineHeight));
       this.emitter.set('--qs-letter-spacing', params.letterSpacing);
       this.emitter.set('--qs-word-spacing',   params.wordSpacing);
     }, 100);
 
     // Étape 3 : Couleurs en dernier (moins perturbant)
     const t2 = setTimeout(() => {
       this.emitter.set('--qs-bg-color',   params.backgroundColor);
       this.emitter.set('--qs-text-color', params.textColor);
     }, 200);
 
     this.pendingTimers.push(t1, t2);
 
     logger.debug('TransitionEngine', `Transition démarrée (${d}ms)`);
   }
 
   /** Remet les valeurs par défaut avec une transition douce */
   reset(): void {
     this.cancelPending();
     this.emitter.set('--qs-transition-duration', '600ms');
 
     const t = setTimeout(() => {
       this.emitter.reset();
     }, 50);
     this.pendingTimers.push(t);
   }
 
   private cancelPending(): void {
     this.pendingTimers.forEach(clearTimeout);
     this.pendingTimers = [];
   }
 }