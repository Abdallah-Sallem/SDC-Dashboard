/**
 * SaccadeDetector.ts
 * RÔLE : Analyse les saccades oculaires (sauts rapides entre mots/lignes).
 * Une saccade lente ou erratique indique une difficulté de décodage visuel.
 */

 import type { GazeMetrics } from '../../shared/types';
 import {
   DIFFICULTY_THRESHOLD_LIGHT,
   DIFFICULTY_THRESHOLD_MODERATE,
 } from '../../shared/constants';
 
 export interface SaccadeAnalysis {
   isNormal: boolean;
   difficultyScore: number; // [0..1]
   description: string;
 }
 
 export function analyzeSaccades(metrics: GazeMetrics): SaccadeAnalysis {
   // Saccade normale : 30–700 pixels/ms
   const NORMAL_MIN = 30;
   const NORMAL_MAX = 700;
 
   const speed = metrics.saccadeSpeed;
   let difficultyScore = 0;
 
   if (speed < NORMAL_MIN) {
     // Trop lent = difficulté à progresser dans la ligne
     difficultyScore = Math.min(1, (NORMAL_MIN - speed) / NORMAL_MIN);
   } else if (speed > NORMAL_MAX) {
     // Trop rapide = skip de mots (perd la compréhension)
     difficultyScore = Math.min(1, (speed - NORMAL_MAX) / NORMAL_MAX);
   }
 
   // Les régressions (retours en arrière) aggravent le score
   if (metrics.regressionCount > 3) {
     difficultyScore = Math.min(1, difficultyScore + metrics.regressionCount * 0.08);
   }
 
   return {
     isNormal: difficultyScore < DIFFICULTY_THRESHOLD_LIGHT,
     difficultyScore,
     description:
       speed < NORMAL_MIN
         ? 'Progression lente — difficulté de décodage'
         : speed > NORMAL_MAX
         ? 'Sauts trop rapides — perte de compréhension'
         : 'Saccades normales',
   };
 }