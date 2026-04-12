/**
 * FixationAnalyzer.ts
 * RÔLE : Analyse la durée de fixation sur les mots.
 * Une fixation trop longue = mot difficile à décoder (dyslexie visuelle).
 * Une fixation trop courte = lecture superficielle (attention dispersée).
 */

 import type { GazeMetrics } from '../../shared/types';

 export interface FixationAnalysis {
   isNormal: boolean;
   difficultyScore: number;
   type: 'too-long' | 'too-short' | 'normal';
 }
 
 /** Durée normale de fixation : 150–400ms par mot */
 const FIXATION_NORMAL_MIN_MS = 150;
 const FIXATION_NORMAL_MAX_MS = 400;
 
 export function analyzeFixations(metrics: GazeMetrics): FixationAnalysis {
   const duration = metrics.fixationDuration;
 
   if (duration > FIXATION_NORMAL_MAX_MS) {
     const excess = (duration - FIXATION_NORMAL_MAX_MS) / 500;
     return {
       isNormal: false,
       difficultyScore: Math.min(1, excess),
       type: 'too-long',
     };
   }
 
   if (duration < FIXATION_NORMAL_MIN_MS && duration > 0) {
     const deficit = (FIXATION_NORMAL_MIN_MS - duration) / FIXATION_NORMAL_MIN_MS;
     return {
       isNormal: false,
       difficultyScore: Math.min(1, deficit * 0.6), // Moins grave
       type: 'too-short',
     };
   }
 
   return { isNormal: true, difficultyScore: 0, type: 'normal' };
 }