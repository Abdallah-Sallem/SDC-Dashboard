/**
 * SessionRepository.ts
 * RÔLE : Stockage et récupération des sessions de lecture.
 * Conserve l'historique des sessions pour les tableaux de bord
 * parents/enseignants. Purge automatique des données > 30 jours.
 */

 import { LocalDB } from './LocalDB';
 import { DataMinimizer } from '../security/DataMinimizer';
 import type { ReadingSession } from '../shared/types';
 import { generateId } from '../shared/utils';
 import { logger } from '../shared/logger';
 
 const SESSIONS_TABLE = 'sessions';
 
 export class SessionRepository {
   private db: LocalDB;
   private minimizer: DataMinimizer;
 
   constructor(db: LocalDB) {
     this.db = db;
     this.minimizer = new DataMinimizer();
   }
 
   async create(data: Omit<ReadingSession, 'id'>): Promise<ReadingSession> {
     const session: ReadingSession = { ...data, id: generateId() };
     const minimized = this.minimizer.minimizeSession(session);
     await this.db.save(SESSIONS_TABLE, session.id, minimized);
     logger.info('SessionRepository', 'Session créée', { id: session.id });
     return session;
   }
 
   async update(id: string, data: Partial<ReadingSession>): Promise<void> {
     const existing = await this.db.load<ReadingSession>(SESSIONS_TABLE, id);
     if (!existing) throw new Error(`Session ${id} introuvable`);
     const updated = { ...existing, ...data };
     await this.db.save(SESSIONS_TABLE, id, this.minimizer.minimizeSession(updated));
   }
 
   async findByStudent(studentId: string): Promise<ReadingSession[]> {
     const all = await this.db.loadAll<ReadingSession>(SESSIONS_TABLE);
     const forStudent = all.filter((s) => s.studentId === studentId);
     // Purge automatique au chargement
     return this.minimizer.purgeOldSessions(forStudent);
   }
 
   /** Calcule les statistiques agrégées pour le tableau de bord */
   async getStats(studentId: string): Promise<{
     totalSessions: number;
     avgDifficulty: number;
     totalWordsRead: number;
     mostCommonLanguage: string;
   }> {
     const sessions = await this.findByStudent(studentId);
     if (sessions.length === 0) {
       return { totalSessions: 0, avgDifficulty: 0, totalWordsRead: 0, mostCommonLanguage: 'fr' };
     }
 
     const avgDifficulty =
       sessions.reduce((s, r) => s + r.averageDifficultyLevel, 0) / sessions.length;
     const totalWordsRead = sessions.reduce((s, r) => s + (r.wordsRead ?? 0), 0);
     const arCount = sessions.filter((s) => s.language === 'ar').length;
 
     return {
       totalSessions: sessions.length,
       avgDifficulty: Math.round(avgDifficulty * 100) / 100,
       totalWordsRead,
       mostCommonLanguage: arCount > sessions.length / 2 ? 'ar' : 'fr',
     };
   }
 }