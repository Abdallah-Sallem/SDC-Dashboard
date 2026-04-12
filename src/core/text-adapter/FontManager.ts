/**
 * FontManager.ts
 * RÔLE : Charge les polices dyslexie-friendly de façon asynchrone.
 * S'assure qu'une police est entièrement chargée avant de l'appliquer
 * pour éviter le FOUT (Flash Of Unstyled Text) qui perturbe la lecture.
 */

 import { logger } from '../../shared/logger';

 export class FontManager {
   private loadedFonts = new Set<string>();
 
   /**
    * Précharge toutes les polices au démarrage de l'application.
    * À appeler une seule fois dans main.tsx.
    */
   async preloadAll(): Promise<void> {
     await Promise.allSettled([
       this.load('OpenDyslexic'),
       this.load('AtkinsonHyperlegible'),
     ]);
     logger.info('FontManager', 'Polices préchargées');
   }
 
   /**
    * Charge une police spécifique et attend qu'elle soit disponible.
    * Utilise l'API FontFace native du navigateur.
    */
   async load(fontName: string): Promise<boolean> {
     if (this.loadedFonts.has(fontName)) return true;
 
     try {
       // Vérifier si la police est déjà dans le cache du navigateur
       await document.fonts.load(`1rem "${fontName}"`);
       this.loadedFonts.add(fontName);
       logger.debug('FontManager', `Police chargée : ${fontName}`);
       return true;
     } catch (err) {
       logger.warn('FontManager', `Échec chargement police : ${fontName}`, {
         error: String(err),
       });
       return false;
     }
   }
 
   /**
    * Vérifie si une police est disponible avant de l'appliquer.
    * Si non disponible, retourne le fallback.
    */
   async ensureAvailable(fontName: string, fallback = 'inherit'): Promise<string> {
     if (this.loadedFonts.has(fontName)) return fontName;
     const loaded = await this.load(fontName);
     return loaded ? fontName : fallback;
   }
 
   isLoaded(fontName: string): boolean {
     return this.loadedFonts.has(fontName);
   }
 }