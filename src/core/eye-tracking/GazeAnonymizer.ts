/**
 * GazeAnonymizer.ts
 * RÔLE : PREMIÈRE LIGNE DE DÉFENSE DE LA VIE PRIVÉE.
 * Reçoit les coordonnées brutes (x, y) de la webcam et les supprime immédiatement.
 * Extrait uniquement des métriques statistiques non-identifiantes.
 * RÈGLE ABSOLUE : rawGaze ne sort JAMAIS de ce fichier.
 */

 import type { RawGazeData, GazeMetrics } from '../../shared/types';
 import { clamp } from '../../shared/utils';
 import { logger } from '../../shared/logger';
 
 // Buffer interne — effacé après chaque calcul
 const BUFFER_SIZE = 30; // ~1 seconde à 30fps
 
 export class GazeAnonymizer {
   private buffer: RawGazeData[] = [];
   private lastBlinkTime = 0;
   private blinkCount = 0;
   private sessionStartTime = Date.now();
   private prevX = 0;
   private regressionCount = 0;
 
   /**
    * Reçoit un point de regard brut et met à jour le buffer.
    * Les coordonnées (x, y) restent en mémoire tampon UNIQUEMENT
    * le temps du calcul, puis sont effacées.
    */
   process(rawGaze: RawGazeData): GazeMetrics | null {
     this.buffer.push(rawGaze);
 
     // Détecter régression (mouvement vers la gauche = relecture)
     if (rawGaze.x < this.prevX - 30) {
       this.regressionCount++;
     }
     this.prevX = rawGaze.x;
 
     // Calculer uniquement quand le buffer est plein (~1s de données)
     if (this.buffer.length < BUFFER_SIZE) return null;
 
     const metrics = this.computeMetrics([...this.buffer]);
 
     // EFFACEMENT IMMÉDIAT des données brutes
     this.buffer = [];
     this.regressionCount = 0;
 
     logger.debug('GazeAnonymizer', 'Métriques calculées, données brutes effacées');
 
     return metrics;
   }
 
   /**
    * Calcule les métriques à partir du buffer.
    * Cette fonction est privée — les coordonnées ne sortent pas.
    */
   private computeMetrics(frames: RawGazeData[]): GazeMetrics {
     return {
       saccadeSpeed: this.computeSaccadeSpeed(frames),
       fixationDuration: this.computeFixationDuration(frames),
       regressionCount: this.regressionCount,
       blinkRate: this.estimateBlinkRate(),
       lineSkipRate: this.computeLineSkipRate(frames),
      fixationInstability: 0,
      headStability: 1,
      trackingLossRate: 0,
       timestamp: Date.now(),
     };
   }
 
   /**
    * Vitesse moyenne des saccades (sauts oculaires rapides entre mots)
    * Formule : déplacement total / nombre de frames / intervalle
    */
   private computeSaccadeSpeed(frames: RawGazeData[]): number {
     if (frames.length < 2) return 0;
     let totalDisplacement = 0;
     for (let i = 1; i < frames.length; i++) {
       const dx = frames[i].x - frames[i - 1].x;
       const dy = frames[i].y - frames[i - 1].y;
       totalDisplacement += Math.sqrt(dx * dx + dy * dy);
     }
     const duration = frames[frames.length - 1].timestamp - frames[0].timestamp;
     return duration > 0 ? totalDisplacement / duration : 0;
   }
 
   /**
    * Durée moyenne de fixation (temps passé sur un mot)
    * Une fixation = séquence de frames sans mouvement significatif
    */
   private computeFixationDuration(frames: RawGazeData[]): number {
     const FIXATION_THRESHOLD = 20; // pixels — sous ce seuil = fixation
     let fixationFrames = 0;
     for (let i = 1; i < frames.length; i++) {
       const dx = Math.abs(frames[i].x - frames[i - 1].x);
       const dy = Math.abs(frames[i].y - frames[i - 1].y);
       if (Math.sqrt(dx * dx + dy * dy) < FIXATION_THRESHOLD) {
         fixationFrames++;
       }
     }
     const avgFrameInterval = 33; // ms (~30fps)
     return fixationFrames * avgFrameInterval;
   }
 
   /**
    * Estime le taux de clignement par minute
    * (utilisé comme indicateur de fatigue)
    */
   private estimateBlinkRate(): number {
     const elapsedMinutes = (Date.now() - this.sessionStartTime) / 60000;
     if (elapsedMinutes < 0.1) return 15; // Valeur par défaut
     return clamp(this.blinkCount / elapsedMinutes, 0, 60);
   }
 
   /**
    * Taux de saut de ligne (perdre sa place dans le texte)
    * Un saut brusque vers le bas > 40px = saut de ligne probable
    */
   private computeLineSkipRate(frames: RawGazeData[]): number {
     if (frames.length < 2) return 0;
     let skipCount = 0;
     for (let i = 1; i < frames.length; i++) {
       const dy = frames[i].y - frames[i - 1].y;
       if (dy > 40) skipCount++; // Saut vers le bas
     }
     return skipCount / frames.length;
   }
 
   /** À appeler quand un clignement est détecté par BlinkDetector */
   registerBlink(): void {
     this.blinkCount++;
     this.lastBlinkTime = Date.now();
   }
 
   /** Réinitialise les compteurs de session */
   resetSession(): void {
     this.buffer = [];
     this.blinkCount = 0;
     this.regressionCount = 0;
     this.sessionStartTime = Date.now();
     this.prevX = 0;
   }
 }