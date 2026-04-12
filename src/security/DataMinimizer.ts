/**
 * DataMinimizer.ts
 * RÔLE : Applique le principe de minimisation des données (RGPD Art. 5.1.c).
 * Supprime les champs inutiles avant tout stockage ou affichage.
 * Aucune donnée ne doit être conservée au-delà de son utilité immédiate.
 */

 import type { ReadingSession, StudentProfile } from '../shared/types';
 import { logger } from '../shared/logger';
 
 export class DataMinimizer {
   /**
    * Prépare un profil élève pour le stockage :
    * supprime les champs non nécessaires à la persistance.
    */
   minimizeProfile(profile: StudentProfile): Omit<StudentProfile, 'name'> & { name: string } {
     // On conserve le prénom uniquement (jamais nom de famille)
     const firstName = profile.name.split(' ')[0];
     return { ...profile, name: firstName };
   }
 
   /**
    * Prépare une session pour le stockage :
    * garde les métriques agrégées, supprime les détails fins.
    */
   minimizeSession(session: ReadingSession): Partial<ReadingSession> {
     return {
       id: session.id,
       studentId: session.studentId,
       startedAt: session.startedAt,
       endedAt: session.endedAt,
       averageDifficultyLevel: session.averageDifficultyLevel,
       wordsRead: session.wordsRead,
       language: session.language,
       // adaptationsApplied — supprimé : trop granulaire
     };
   }
 
   /**
    * Anonymise des données pour le tableau de bord enseignant.
    * Remplace les IDs élèves par des identifiants non-traçables.
    */
   anonymizeForTeacher<T extends { studentId: string }>(
     records: T[]
   ): Array<Omit<T, 'studentId'> & { anonymousId: string }> {
     const idMap = new Map<string, string>();
     let counter = 1;
 
     return records.map((record) => {
       if (!idMap.has(record.studentId)) {
         idMap.set(record.studentId, `élève_${counter++}`);
       }
       const { studentId, ...rest } = record;
       return { ...rest, anonymousId: idMap.get(studentId)! };
     });
   }
 
   /**
    * Purge les données de session de plus de 30 jours.
    * Conformité RGPD — durée de conservation limitée.
    */
   purgeOldSessions(sessions: ReadingSession[]): ReadingSession[] {
     const thirtyDaysAgo = new Date();
     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
 
     const purged = sessions.filter((s) => s.startedAt > thirtyDaysAgo);
     const count = sessions.length - purged.length;
 
     if (count > 0) {
       logger.info('DataMinimizer', `${count} session(s) ancienne(s) purgée(s)`);
     }
     return purged;
   }
 }