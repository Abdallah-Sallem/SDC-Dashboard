/**
 * BilingualHandler.ts
 * RÔLE : Gère la direction de lecture en temps réel (RTL ↔ LTR).
 * Détecte automatiquement si le texte affiché est en arabe (RTL)
 * ou en français (LTR) et ajuste l'attribut `dir` du document,
 * les marges, l'alignement du texte et les icônes de navigation.
 *
 * Spécificité Qalam-Sense : les deux langues peuvent coexister
 * sur le même écran (texte mixte arabe/français).
 */

 import { CSSTokenEmitter } from './CSSTokenEmitter';
 import { detectLanguage } from '../../shared/utils';
 import type { ReadingLanguage, ReadingDirection } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 export class BilingualHandler {
   private currentDirection: ReadingDirection = 'ltr';
   private emitter: CSSTokenEmitter;
 
   constructor() {
     this.emitter = new CSSTokenEmitter();
   }
 
   /**
    * Met à jour la direction de lecture selon la langue.
    * Appelé par TextAdapterEngine à chaque signal de difficulté.
    */
   update(language: ReadingLanguage): void {
     const newDirection: ReadingDirection = language === 'ar' ? 'rtl' : 'ltr';
 
     // Éviter les mises à jour inutiles
     if (newDirection === this.currentDirection) return;
 
     this.applyDirection(newDirection);
     this.currentDirection = newDirection;
 
     logger.info('BilingualHandler', `Direction changée → ${newDirection}`, { language });
   }
 
   /**
    * Détecte la langue d'un bloc de texte et applique la direction.
    * Utilisé par le composant BilingualText.tsx pour les blocs mixtes.
    */
   applyToElement(element: HTMLElement, text: string): void {
     const language = detectLanguage(text);
     const direction: ReadingDirection = language === 'ar' ? 'rtl' : 'ltr';
 
     element.setAttribute('dir', direction);
     element.setAttribute('lang', language);
 
     // Alignement du texte selon la direction
     element.style.textAlign = direction === 'rtl' ? 'right' : 'left';
   }
 
   /**
    * Applique la direction globale à l'ensemble du document
    */
   private applyDirection(direction: ReadingDirection): void {
     // 1. Attribut HTML `dir` — lu par les lecteurs d'écran
     document.documentElement.setAttribute('dir', direction);
     document.documentElement.setAttribute('lang', direction === 'rtl' ? 'ar' : 'fr');
 
     // 2. Variable CSS pour les composants qui en ont besoin
     this.emitter.set('--qs-direction', direction);
     this.emitter.set('--qs-text-align', direction === 'rtl' ? 'right' : 'left');
 
     // 3. Variables de marge pour les éléments directionnels
     if (direction === 'rtl') {
       this.emitter.set('--qs-margin-start', '0');
       this.emitter.set('--qs-margin-end',   'auto');
       this.emitter.set('--qs-padding-start','1rem');
       this.emitter.set('--qs-padding-end',  '0');
     } else {
       this.emitter.set('--qs-margin-start', 'auto');
       this.emitter.set('--qs-margin-end',   '0');
       this.emitter.set('--qs-padding-start','0');
       this.emitter.set('--qs-padding-end',  '1rem');
     }
   }
 
   /** Force une direction quelle que soit la détection automatique */
  /** Force une direction quelle que soit la détection automatique */
  forceDirection(direction: ReadingDirection): void {
    this.applyDirection(direction);
    this.currentDirection = direction;
    logger.info('BilingualHandler', `Direction forcée : ${direction}`);
  }

  getDirection(): ReadingDirection {
    return this.currentDirection;
  }
}