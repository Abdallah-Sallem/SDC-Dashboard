/**
 * ProfileMatcher.ts
 * RÔLE : Personnalise l'intensité des adaptations selon le profil neurologique.
 * Un élève avec diagnostic formel de dyslexie sévère reçoit des adaptations
 * plus prononcées dès un niveau de difficulté modéré.
 * Un élève "unknown" reçoit des adaptations progressives et douces.
 */

 import type { DifficultySignal, StudentProfile, NeurodivergenceType } from '../../shared/types';

 // Table des multiplicateurs d'intensité par profil et type de difficulté
 const INTENSITY_MATRIX: Record<NeurodivergenceType, Record<string, number>> = {
   dyslexia:      { 'dyslexia-visual': 1.4, fatigue: 1.1, attention: 1.0, 'line-tracking': 1.3 },
   adhd:          { 'dyslexia-visual': 0.9, fatigue: 1.2, attention: 1.5, 'line-tracking': 1.1 },
   autism:        { 'dyslexia-visual': 1.0, fatigue: 1.3, attention: 1.0, 'line-tracking': 1.0 },
   dyscalculia:   { 'dyslexia-visual': 1.0, fatigue: 1.0, attention: 1.0, 'line-tracking': 1.0 },
   none:          { 'dyslexia-visual': 0.7, fatigue: 0.8, attention: 0.8, 'line-tracking': 0.7 },
   unknown:       { 'dyslexia-visual': 0.9, fatigue: 0.9, attention: 0.9, 'line-tracking': 0.9 },
 };
 
 export class ProfileMatcher {
   private profile: StudentProfile;
 
   constructor(profile: StudentProfile) {
     this.profile = profile;
   }
 
   /**
    * Retourne le multiplicateur d'intensité pour un signal donné.
    * Si l'élève a plusieurs types de neurodivergence, prend le max.
    */
   getIntensity(signal: DifficultySignal): number {
     if (this.profile.neurodivergenceTypes.length === 0) {
       return INTENSITY_MATRIX.unknown[signal.type] ?? 1.0;
     }
 
     const intensities = this.profile.neurodivergenceTypes.map(
       (type) => INTENSITY_MATRIX[type]?.[signal.type] ?? 1.0
     );
 
     // Prendre la valeur maximale (adaptation la plus aidante)
     return Math.max(...intensities);
   }
 
   /**
    * Indique si ce profil doit avoir des adaptations préventives
    * (appliquées dès l'ouverture, avant même détection d'une difficulté)
    */
   needsPreventiveAdaptation(): boolean {
     return this.profile.neurodivergenceTypes.includes('dyslexia') ||
            this.profile.neurodivergenceTypes.includes('adhd');
   }
 
   /**
    * Retourne les paramètres préventifs de base pour ce profil
    */
   getPreventiveParams(): Partial<{ lineHeight: number; fontFamily: string }> {
     if (this.profile.neurodivergenceTypes.includes('dyslexia')) {
       return { lineHeight: 1.8, fontFamily: this.profile.preferredFont };
     }
     if (this.profile.neurodivergenceTypes.includes('adhd')) {
       return { lineHeight: 1.9 };
     }
     return {};
   }
 }