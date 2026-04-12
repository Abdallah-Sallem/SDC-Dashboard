/**
 * DifficultyDetector.ts
 * RÔLE : Fusionne toutes les analyses (saccades, fixations, clignements)
 * pour calculer un score de difficulté global et identifier son type.
 * En Phase 1 : règles heuristiques. En Phase 2 : modèle ONNX/TF Lite.
 * Écoute le bus 'gaze:metrics' et émet 'difficulty:detected'.
 */

 import { EventBus } from '../event-bus/EventBus';
 import { analyzeSaccades } from '../eye-tracking/SaccadeDetector';
 import { analyzeFixations } from '../eye-tracking/FixationAnalyzer';
 import { analyzeBlinkRate } from '../eye-tracking/BlinkDetector';
 import type { GazeMetrics, DifficultySignal, DifficultyType } from '../../shared/types';
 import { DIFFICULTY_THRESHOLD_LIGHT } from '../../shared/constants';
 import { logger } from '../../shared/logger';
 
 export class DifficultyDetector {
   private sessionId = '';
   private unsubscribe: (() => void) | null = null;
 
   constructor(sessionId: string) {
     this.sessionId = sessionId;
   }
 
   /** Démarre l'écoute des métriques */
   start(): void {
     this.unsubscribe = EventBus.on<GazeMetrics>(
       'gaze:metrics',
      (event) => {
        const signal = this.infer(event.payload);
        if (signal) {
          EventBus.emit('difficulty:detected', signal, this.sessionId);
        }
      }
     );
     logger.info('DifficultyDetector', 'Démarré', { sessionId: this.sessionId });
   }
 
  /**
   * Calcule un signal de difficulté à partir des métriques gaze.
   * Retourne null si le score est sous le seuil minimal.
   */
  infer(metrics: GazeMetrics): DifficultySignal | null {
     const saccade = analyzeSaccades(metrics);
     const fixation = analyzeFixations(metrics);
     const blink = analyzeBlinkRate(metrics);
 
     // Score global : combinaison pondérée des trois analyses
     const globalScore =
       saccade.difficultyScore * 0.4 +
       fixation.difficultyScore * 0.35 +
       blink.fatigueScore * 0.25;
 
     // Ne pas émettre si sous le seuil minimum
    if (globalScore < DIFFICULTY_THRESHOLD_LIGHT) return null;
 
    return {
       type: this.classifyType(saccade.difficultyScore, fixation.difficultyScore, blink.fatigueScore),
       level: globalScore,
       confidence: this.computeConfidence(saccade.difficultyScore, fixation.difficultyScore),
       language: 'fr', // Mis à jour par BilingualHandler en temps réel
       timestamp: Date.now(),
     };
   }
 
   /**
    * Identifie le type dominant de difficulté pour choisir la bonne adaptation
    */
   private classifyType(
     saccadeScore: number,
     fixationScore: number,
     fatigueScore: number
   ): DifficultyType {
     if (fatigueScore > 0.5) return 'fatigue';
     if (fixationScore > 0.6) return 'dyslexia-visual';
     if (saccadeScore > 0.5) return 'line-tracking';
     return 'attention';
   }
 
   /** Confiance = cohérence entre les deux indicateurs principaux */
   private computeConfidence(saccadeScore: number, fixationScore: number): number {
     const diff = Math.abs(saccadeScore - fixationScore);
     return Math.max(0.3, 1 - diff); // Plus ils concordent, plus la confiance est haute
   }
 
   stop(): void {
     this.unsubscribe?.();
     logger.info('DifficultyDetector', 'Arrêté');
   }
 }