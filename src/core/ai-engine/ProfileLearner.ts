/**
 * ProfileLearner.ts
 * RÔLE : Affine le profil d'adaptation de l'élève au fil du temps.
 * Observe quelles adaptations ont réduit les difficultés détectées
 * et ajuste les seuils pour cet élève spécifiquement.
 * Toute l'apprentissage reste 100% local — aucune donnée ne part en cloud.
 */

 import type { AdaptationParams, DifficultySignal, StudentProfile } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 interface AdaptationRecord {
   params: AdaptationParams;
   difficultyBefore: number;
   difficultyAfter?: number;
   timestamp: number;
 }
 
 export class ProfileLearner {
   private history: AdaptationRecord[] = [];
   private profile: StudentProfile;
 
   constructor(profile: StudentProfile) {
     this.profile = profile;
   }
 
   /** Enregistre qu'une adaptation a été appliquée */
   recordAdaptation(params: AdaptationParams, currentDifficulty: number): void {
     this.history.push({
       params,
       difficultyBefore: currentDifficulty,
       timestamp: Date.now(),
     });
 
     // Garder seulement les 50 derniers enregistrements
     if (this.history.length > 50) this.history.shift();
   }
 
   /** Met à jour le résultat d'une adaptation avec le score observé après */
   updateAdaptationResult(signal: DifficultySignal): void {
     const last = this.history[this.history.length - 1];
     if (last && !last.difficultyAfter) {
       last.difficultyAfter = signal.level;
     }
   }
 
   /**
    * Ajuste le seuil de sensibilité du profil selon l'efficacité observée.
    * Si les adaptations réduisent systématiquement la difficulté → seuil validé.
    * Si pas d'effet → augmenter la sensibilité (déclencher plus tôt).
    */
   refineThreshold(): number {
     const completed = this.history.filter((r) => r.difficultyAfter !== undefined);
     if (completed.length < 5) return this.profile.adaptationThreshold;
 
     const avgImprovement =
       completed.reduce((sum, r) => sum + (r.difficultyBefore - (r.difficultyAfter ?? 0)), 0) /
       completed.length;
 
     // Si l'amélioration moyenne est faible, déclencher plus tôt
     let newThreshold = this.profile.adaptationThreshold;
     if (avgImprovement < 0.1) {
       newThreshold = Math.max(0.1, this.profile.adaptationThreshold - 0.05);
       logger.info('ProfileLearner', 'Seuil abaissé (adaptations peu efficaces)', {
         old: this.profile.adaptationThreshold,
         new: newThreshold,
       });
     } else if (avgImprovement > 0.3) {
       newThreshold = Math.min(0.8, this.profile.adaptationThreshold + 0.05);
       logger.info('ProfileLearner', 'Seuil relevé (adaptations très efficaces)', {
         old: this.profile.adaptationThreshold,
         new: newThreshold,
       });
     }
 
     return newThreshold;
   }
 }