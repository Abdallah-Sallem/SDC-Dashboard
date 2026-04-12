/**
 * BiasChecker.ts
 * RÔLE : Surveille les biais du modèle IA.
 * Vérifie que le modèle ne sur-adapte pas ou sous-adapte pas
 * selon le profil neurologique ou la langue de l'élève.
 * Crucial pour l'équité — un élève tunisien arabophone ne doit pas
 * être désavantagé par un modèle entraîné sur des données occidentales.
 */

 import type { DifficultySignal, StudentProfile } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 interface BiasReport {
   hasBias: boolean;
   biasType?: 'over-detection' | 'under-detection' | 'language-bias';
   description?: string;
 }
 
 export class BiasChecker {
   private signalHistory: DifficultySignal[] = [];
   private profile: StudentProfile;
 
   constructor(profile: StudentProfile) {
     this.profile = profile;
   }
 
   /** Enregistre un signal pour analyse */
   record(signal: DifficultySignal): void {
     this.signalHistory.push(signal);
     if (this.signalHistory.length > 100) this.signalHistory.shift();
   }
 
   /**
    * Analyse les 100 derniers signaux pour détecter des biais systématiques.
    * À appeler périodiquement (ex: fin de session).
    */
   analyze(): BiasReport {
     if (this.signalHistory.length < 20) {
       return { hasBias: false };
     }
 
     const avgLevel =
       this.signalHistory.reduce((s, r) => s + r.level, 0) / this.signalHistory.length;
 
     // Sur-détection : niveau moyen trop haut → le modèle est trop sensible
     if (avgLevel > 0.75) {
       logger.warn('BiasChecker', 'Sur-détection possible', {
         avgLevel: avgLevel.toFixed(2),
         profile: this.profile.neurodivergenceTypes,
       });
       return {
         hasBias: true,
         biasType: 'over-detection',
         description: `Score moyen de ${(avgLevel * 100).toFixed(0)}% — seuil peut être trop bas`,
       };
     }
 
     // Biais linguistique : vérifier si le score change selon la langue
     const arSignals = this.signalHistory.filter((s) => s.language === 'ar');
     const frSignals = this.signalHistory.filter((s) => s.language === 'fr');
 
     if (arSignals.length > 5 && frSignals.length > 5) {
       const arAvg = arSignals.reduce((s, r) => s + r.level, 0) / arSignals.length;
       const frAvg = frSignals.reduce((s, r) => s + r.level, 0) / frSignals.length;
       if (Math.abs(arAvg - frAvg) > 0.25) {
         logger.warn('BiasChecker', 'Biais linguistique AR/FR détecté', {
           arAvg: arAvg.toFixed(2),
           frAvg: frAvg.toFixed(2),
         });
         return { hasBias: true, biasType: 'language-bias' };
       }
     }
 
     return { hasBias: false };
   }
 
   reset(): void {
     this.signalHistory = [];
   }
 }