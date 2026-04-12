/**
 * CSSTokenEmitter.ts
 * RÔLE : Pont entre le moteur TypeScript et l'affichage React.
 * Injecte les variables CSS sur :root — l'UI les consomme automatiquement.
 * C'est le mécanisme le plus performant : aucun re-render React,
 * les transitions CSS natales assurent la fluidité à 60fps.
 *
 * PRINCIPE : Le moteur écrit → le navigateur lit → l'affichage change.
 */

 import type { AdaptationParams } from '../../shared/types';
 import { CSS_DEFAULTS } from '../../shared/constants';
 import { logger } from '../../shared/logger';
 
 /** Noms des variables CSS utilisées dans adaptation-tokens.css */
 const CSS_VARS = {
   fontFamily:    '--qs-font-family',
   fontSize:      '--qs-font-size',
   lineHeight:    '--qs-line-height',
   letterSpacing: '--qs-letter-spacing',
   wordSpacing:   '--qs-word-spacing',
   bgColor:       '--qs-bg-color',
   textColor:     '--qs-text-color',
   direction:     '--qs-direction',
   transition:    '--qs-transition-duration',
 } as const;
 
 export class CSSTokenEmitter {
   private root: HTMLElement;
   private currentParams: Partial<AdaptationParams> = {};
 
   constructor() {
     this.root = document.documentElement; // Cible :root
   }
 
   /**
    * Applique tous les paramètres d'adaptation en une seule passe.
    * Met d'abord à jour la durée de transition pour que le changement
    * suivant soit animé correctement.
    */
   apply(params: AdaptationParams): void {
     // 1. Définir la durée de transition AVANT les changements
     this.setVar(CSS_VARS.transition, `${params.transitionDuration}ms`);
 
     // 2. Appliquer chaque paramètre
     this.setVar(CSS_VARS.fontFamily,    this.resolveFontStack(params.fontFamily));
     this.setVar(CSS_VARS.fontSize,      params.fontSize);
     this.setVar(CSS_VARS.lineHeight,    String(params.lineHeight));
     this.setVar(CSS_VARS.letterSpacing, params.letterSpacing);
     this.setVar(CSS_VARS.wordSpacing,   params.wordSpacing);
     this.setVar(CSS_VARS.bgColor,       params.backgroundColor);
     this.setVar(CSS_VARS.textColor,     params.textColor);
     this.setVar(CSS_VARS.direction,     params.direction);
 
     this.currentParams = { ...params };
 
     logger.debug('CSSTokenEmitter', 'Variables CSS mises à jour', {
       fontFamily: params.fontFamily,
       lineHeight: params.lineHeight,
     });
   }
 
   /**
    * Applique une seule variable CSS (pour les mises à jour partielles)
    */
   set(varName: string, value: string): void {
     this.root.style.setProperty(varName, value);
   }
 
   /**
    * Réinitialise toutes les variables à leurs valeurs par défaut
    */
   reset(): void {
     this.setVar(CSS_VARS.transition,    '600ms');
     this.setVar(CSS_VARS.fontFamily,    CSS_DEFAULTS.fontFamily);
     this.setVar(CSS_VARS.fontSize,      CSS_DEFAULTS.fontSize);
     this.setVar(CSS_VARS.lineHeight,    String(CSS_DEFAULTS.lineHeight));
     this.setVar(CSS_VARS.letterSpacing, CSS_DEFAULTS.letterSpacing);
     this.setVar(CSS_VARS.wordSpacing,   CSS_DEFAULTS.wordSpacing);
     this.setVar(CSS_VARS.bgColor,       CSS_DEFAULTS.backgroundColor);
     this.setVar(CSS_VARS.textColor,     CSS_DEFAULTS.textColor);
     this.currentParams = {};
     logger.debug('CSSTokenEmitter', 'Variables CSS réinitialisées');
   }
 
   /**
    * Lit la valeur actuelle d'une variable CSS
    */
   get(varName: string): string {
     return this.root.style.getPropertyValue(varName).trim();
   }
 
   /** Retourne les paramètres actuellement appliqués */
   getCurrent(): Partial<AdaptationParams> {
     return { ...this.currentParams };
   }
 
   // ─── Helpers privés ──────────────────────────────────────────────────────
 
   private setVar(name: string, value: string): void {
     this.root.style.setProperty(name, value);
   }
 
   /**
    * Construit la font-stack CSS complète avec fallbacks
    * OpenDyslexic → fallback accessible → serif générique
    */
   private resolveFontStack(fontFamily: string): string {
     const stacks: Record<string, string> = {
       OpenDyslexic:         '"OpenDyslexic", "Comic Sans MS", cursive',
       AtkinsonHyperlegible: '"Atkinson Hyperlegible", "Verdana", sans-serif',
       inherit:              'inherit',
       system:               '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
     };
     return stacks[fontFamily] ?? fontFamily;
   }
 }