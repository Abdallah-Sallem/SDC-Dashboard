/**
 * utils.ts
 * RÔLE : Fonctions utilitaires pures et réutilisables dans tout le projet.
 * Chaque fonction est indépendante, testable unitairement, sans effets de bord.
 */

 import type { ReadingLanguage, ReadingDirection } from './types';

 // ─── Identifiants ────────────────────────────────────────────────────────────
 
 /**
  * Génère un identifiant unique basé sur crypto.randomUUID()
  * Plus sûr que Math.random() pour les identifiants de session
  */
 export function generateId(): string {
   return crypto.randomUUID();
 }
 
 // ─── Langue & direction ──────────────────────────────────────────────────────
 
 /**
  * Détecte si un texte est principalement en arabe (RTL)
  * Utilise les codes Unicode des caractères arabes (U+0600 à U+06FF)
  */
 export function detectLanguage(text: string): ReadingLanguage {
   const arabicPattern = /[\u0600-\u06FF]/g;
   const arabicMatches = text.match(arabicPattern)?.length ?? 0;
   const ratio = arabicMatches / text.replace(/\s/g, '').length;
 
   if (ratio > 0.6) return 'ar';
   if (ratio > 0.2) return 'mixed';
   return 'fr';
 }
 
 /**
  * Retourne la direction de lecture selon la langue
  */
 export function getDirection(language: ReadingLanguage): ReadingDirection {
   return language === 'ar' ? 'rtl' : 'ltr';
 }
 
 // ─── Manipulation du temps ───────────────────────────────────────────────────
 
 /**
  * Crée une fonction de temporisation (debounce)
  * Évite de déclencher une adaptation à chaque frame d'eye-tracking
  * @param fn Fonction à temporiser
  * @param delay Délai en ms
  */
 export function debounce<T extends (...args: unknown[]) => void>(
   fn: T,
   delay: number
 ): (...args: Parameters<T>) => void {
   let timer: ReturnType<typeof setTimeout>;
   return (...args: Parameters<T>) => {
     clearTimeout(timer);
     timer = setTimeout(() => fn(...args), delay);
   };
 }
 
 /**
  * Crée une fonction de limitation de fréquence (throttle)
  * Limite les appels au moteur IA à une fois par intervalle
  */
 export function throttle<T extends (...args: unknown[]) => void>(
   fn: T,
   interval: number
 ): (...args: Parameters<T>) => void {
   let lastCall = 0;
   return (...args: Parameters<T>) => {
     const now = Date.now();
     if (now - lastCall >= interval) {
       lastCall = now;
       fn(...args);
     }
   };
 }
 
 /**
  * Formatte une durée en ms en chaîne lisible (ex: "2m 34s")
  */
 export function formatDuration(ms: number): string {
   const seconds = Math.floor(ms / 1000);
   const minutes = Math.floor(seconds / 60);
   const remainingSeconds = seconds % 60;
   if (minutes === 0) return `${remainingSeconds}s`;
   return `${minutes}m ${remainingSeconds}s`;
 }
 
 // ─── Calculs d'accessibilité ─────────────────────────────────────────────────
 
 /**
  * Calcule le ratio de contraste WCAG entre deux couleurs
  * Ratio minimum : 4.5:1 (AA) ou 7:1 (AAA)
  * @param foreground Couleur du texte en hex (#RRGGBB)
  * @param background Couleur de fond en hex (#RRGGBB)
  */
 export function calculateContrastRatio(foreground: string, background: string): number {
   const lumFg = getRelativeLuminance(foreground);
   const lumBg = getRelativeLuminance(background);
   const lighter = Math.max(lumFg, lumBg);
   const darker = Math.min(lumFg, lumBg);
   return (lighter + 0.05) / (darker + 0.05);
 }
 
 function getRelativeLuminance(hex: string): number {
   const rgb = hexToRgb(hex);
   const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
     const s = c / 255;
     return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
   });
   return 0.2126 * r + 0.7152 * g + 0.0722 * b;
 }
 
 function hexToRgb(hex: string): { r: number; g: number; b: number } {
   const clean = hex.replace('#', '');
   return {
     r: parseInt(clean.substring(0, 2), 16),
     g: parseInt(clean.substring(2, 4), 16),
     b: parseInt(clean.substring(4, 6), 16),
   };
 }
 
 /**
  * Vérifie si un ratio de contraste satisfait le niveau WCAG demandé
  */
 export function meetsWCAG(ratio: number, level: 'AA' | 'AAA' = 'AA'): boolean {
   return level === 'AA' ? ratio >= 4.5 : ratio >= 7.0;
 }
 
 // ─── Validation ──────────────────────────────────────────────────────────────
 
 /**
  * Valide qu'un score est bien dans la plage [0..1]
  */
 export function isValidScore(score: unknown): score is number {
   return typeof score === 'number' && score >= 0 && score <= 1;
 }
 
 /**
  * Clamp une valeur entre min et max
  */
 export function clamp(value: number, min: number, max: number): number {
   return Math.max(min, Math.min(max, value));
 }
 
 // ─── Anonymisation ───────────────────────────────────────────────────────────
 
 /**
  * Supprime tous les champs identifiants d'un objet pour les logs
  * Utilisé avant tout envoi de données dans les logs de debug
  */
 export function anonymizeForLog<T extends Record<string, unknown>>(
   obj: T,
   sensitiveFields: (keyof T)[] = ['name', 'id', 'email', 'x', 'y']
 ): Partial<T> {
   const result = { ...obj };
   for (const field of sensitiveFields) {
     delete result[field];
   }
   return result;
 }