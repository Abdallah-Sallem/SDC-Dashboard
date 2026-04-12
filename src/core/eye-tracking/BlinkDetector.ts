/**
 * BlinkDetector.ts
 * RÔLE : Détecte la fatigue oculaire via le taux de clignement.
 * Taux normal : 15–20 clignements/min.
 * Taux élevé (>25) OU très faible (<8) = fatigue ou stress visuel.
 * S'intègre avec GazeAnonymizer via registerBlink().
 */

 import type { GazeMetrics } from '../../shared/types';
 import {
   BLINK_RATE_NORMAL_MIN,
   BLINK_RATE_NORMAL_MAX,
 } from '../../shared/constants';
 
 export interface BlinkAnalysis {
   fatigueScore: number;   // [0..1]
   recommendation: string;
 }
 
 export function analyzeBlinkRate(metrics: GazeMetrics): BlinkAnalysis {
   const rate = metrics.blinkRate;
 
   // Trop peu de clignements = yeux secs, fixation intense (fatigue)
   if (rate < BLINK_RATE_NORMAL_MIN) {
     const score = (BLINK_RATE_NORMAL_MIN - rate) / BLINK_RATE_NORMAL_MIN;
     return {
       fatigueScore: Math.min(1, score),
       recommendation: 'Yeux secs détectés — suggérer une pause',
     };
   }
 
   // Trop de clignements = fatigue marquée
   if (rate > BLINK_RATE_NORMAL_MAX) {
     const score = (rate - BLINK_RATE_NORMAL_MAX) / 20;
     return {
       fatigueScore: Math.min(1, score),
       recommendation: 'Fatigue oculaire — réduire luminosité et taille du texte',
     };
   }
 
   return { fatigueScore: 0, recommendation: '' };
 }