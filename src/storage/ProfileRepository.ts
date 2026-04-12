/**
 * ProfileRepository.ts
 * RÔLE : Accès aux données des profils élèves.
 * Couche d'abstraction entre la logique métier et le stockage chiffré.
 * Toutes les opérations passent par LocalDB (donc chiffrées).
 * Associe aussi les textes uploadés par les enseignants aux élèves.
 */

 import { LocalDB } from './LocalDB';
 import { DataMinimizer } from '../security/DataMinimizer';
 import type { StudentProfile, TeacherText } from '../shared/types';
 import { generateId } from '../shared/utils';
 import { logger } from '../shared/logger';
 
 const PROFILES_TABLE = 'profiles';
 const TEXTS_TABLE = 'teacher_texts';
 
 export class ProfileRepository {
   private db: LocalDB;
   private minimizer: DataMinimizer;
 
   constructor(db: LocalDB) {
     this.db = db;
     this.minimizer = new DataMinimizer();
   }
 
   /** Crée un nouveau profil élève */
   async create(data: Omit<StudentProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<StudentProfile> {
     const profile: StudentProfile = {
       ...data,
       id: generateId(),
       createdAt: new Date(),
       updatedAt: new Date(),
     };
 
     const minimized = this.minimizer.minimizeProfile(profile);
     await this.db.save(PROFILES_TABLE, profile.id, minimized);
 
     logger.info('ProfileRepository', 'Profil créé', { id: profile.id });
     return profile;
   }
 
   /** Récupère un profil par son ID */
   async findById(id: string): Promise<StudentProfile | null> {
     return this.db.load<StudentProfile>(PROFILES_TABLE, id);
   }
 
   /** Met à jour un profil */
   async update(id: string, data: Partial<StudentProfile>): Promise<void> {
     const existing = await this.findById(id);
     if (!existing) throw new Error(`Profil ${id} introuvable`);
 
     const updated: StudentProfile = { ...existing, ...data, updatedAt: new Date() };
     await this.db.save(PROFILES_TABLE, id, this.minimizer.minimizeProfile(updated));
   }
 
   /** Supprime définitivement un profil (droit à l'effacement) */
   async delete(id: string): Promise<void> {
     await this.db.delete(PROFILES_TABLE, id);
     logger.info('ProfileRepository', 'Profil supprimé', { id });
   }
 
   /** Récupère tous les textes assignés à un élève */
   async getAssignedTexts(studentId: string): Promise<TeacherText[]> {
     const all = await this.db.loadAll<TeacherText>(TEXTS_TABLE);
     return all.filter((t) => t.assignedStudentIds.includes(studentId));
   }
 
   /** Sauvegarde un texte uploadé par l'enseignant */
   async saveText(text: Omit<TeacherText, 'id' | 'uploadedAt'>): Promise<TeacherText> {
     const full: TeacherText = {
       ...text,
       id: generateId(),
       uploadedAt: new Date(),
     };
     await this.db.save(TEXTS_TABLE, full.id, full);
     return full;
   }
 }