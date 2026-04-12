/**
 * ConsentManager.ts
 * RÔLE : Gestion stricte des consentements RGPD et COPPA.
 * Pour des élèves mineurs, le consentement parental est obligatoire
 * avant d'activer l'eye-tracking ou de stocker des données.
 * Sans consentement = mode dégradé (adaptations statiques uniquement).
 */

 import { EventBus } from '../core/event-bus/EventBus';
 import { logger } from '../shared/logger';
 
 export interface ConsentRecord {
   studentId: string;
   parentConsent: boolean;      // Consentement du parent/tuteur
   eyeTrackingConsent: boolean; // Consentement spécifique eye-tracking
   dataStorageConsent: boolean; // Consentement stockage local
   grantedAt: Date;
   grantedBy: string;           // ID du parent (jamais le nom)
   version: string;             // Version des CGU acceptées
 }
 
 const CONSENT_STORAGE_KEY = 'qs_consents';
 const CURRENT_CONSENT_VERSION = '1.0';
 
 export class ConsentManager {
   private consents = new Map<string, ConsentRecord>();
 
   constructor() {
     this.loadFromStorage();
   }
 
   /**
    * Enregistre le consentement parental pour un élève.
    * À appeler après que le parent a lu et accepté les CGU.
    */
   grantConsent(
     studentId: string,
     parentId: string,
     options: Pick<ConsentRecord, 'eyeTrackingConsent' | 'dataStorageConsent'>
   ): void {
     const record: ConsentRecord = {
       studentId,
       parentConsent: true,
       eyeTrackingConsent: options.eyeTrackingConsent,
       dataStorageConsent: options.dataStorageConsent,
       grantedAt: new Date(),
       grantedBy: parentId,
       version: CURRENT_CONSENT_VERSION,
     };
 
     this.consents.set(studentId, record);
     this.persistToStorage();
 
     EventBus.emit('consent:granted', { studentId });
     logger.info('ConsentManager', 'Consentement accordé', { studentId });
   }
 
   /**
    * Révoque tous les consentements et supprime les données associées.
    * Droit à l'effacement RGPD Article 17.
    */
   revokeConsent(studentId: string): void {
     this.consents.delete(studentId);
     this.persistToStorage();
     EventBus.emit('consent:revoked', { studentId });
     logger.info('ConsentManager', 'Consentement révoqué — données à supprimer', { studentId });
   }
 
   /** L'élève peut-il utiliser l'eye-tracking ? */
   canUseEyeTracking(studentId: string): boolean {
     const record = this.consents.get(studentId);
     return record?.parentConsent === true && record?.eyeTrackingConsent === true;
   }
 
   /** Les données peuvent-elles être stockées localement ? */
   canStoreData(studentId: string): boolean {
     const record = this.consents.get(studentId);
     return record?.parentConsent === true && record?.dataStorageConsent === true;
   }
 
   /** Le consentement est-il toujours valide ? (version à jour) */
   isValid(studentId: string): boolean {
     const record = this.consents.get(studentId);
     return record?.version === CURRENT_CONSENT_VERSION;
   }
 
   getRecord(studentId: string): ConsentRecord | undefined {
     return this.consents.get(studentId);
   }
 
   // ─── Persistance ─────────────────────────────────────────────────────────
   // Les consentements sont stockés en clair (pas de données perso, uniquement des flags)
 
   private persistToStorage(): void {
     try {
       const data = Array.from(this.consents.entries());
       localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(data));
     } catch {
       logger.error('ConsentManager', 'Erreur persistance consentements');
     }
   }
 
   private loadFromStorage(): void {
     try {
       const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
       if (!raw) return;
       const data = JSON.parse(raw) as [string, ConsentRecord][];
       this.consents = new Map(data);
       logger.info('ConsentManager', `${this.consents.size} consentement(s) chargé(s)`);
     } catch {
       logger.error('ConsentManager', 'Erreur chargement consentements');
     }
   }
 }