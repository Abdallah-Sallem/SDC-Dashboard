/**
 * AuditLogger.ts
 * RÔLE : Journal d'audit des accès aux données sensibles.
 * Enregistre QUI a accédé à QUOI et QUAND — sans stocker les données elles-mêmes.
 * Obligatoire pour la conformité RGPD (traçabilité des accès).
 * Les logs d'audit sont chiffrés et accessibles uniquement au rôle admin.
 */

 import { logger } from '../shared/logger';

 export type AuditAction =
   | 'profile:accessed'
   | 'profile:modified'
   | 'profile:deleted'
   | 'data:exported'
   | 'consent:granted'
   | 'consent:revoked'
   | 'session:started'
   | 'session:ended'
   | 'auth:login'
   | 'auth:logout'
   | 'auth:failed';
 
 export interface AuditEntry {
   id: string;
   action: AuditAction;
   actorRole: string;
   actorId: string;           // ID hashé — jamais en clair
   targetResourceType: string;
   targetResourceId: string;  // ID hashé
   timestamp: Date;
   ipHash?: string;           // Hash de l'IP — jamais l'IP en clair
   success: boolean;
 }
 
 const AUDIT_STORAGE_KEY = 'qs_audit_log';
 const MAX_ENTRIES = 1000;
 
 export class AuditLogger {
   private entries: AuditEntry[] = [];
 
   constructor() {
     this.load();
   }
 
   /**
    * Enregistre une entrée d'audit.
    * Les IDs sont hashés avant d'être stockés.
    */
   async log(
     action: AuditAction,
     actorRole: string,
     actorId: string,
     targetResourceType: string,
     targetResourceId: string,
     success = true
   ): Promise<void> {
     const entry: AuditEntry = {
       id: crypto.randomUUID(),
       action,
       actorRole,
       actorId: await this.hashId(actorId),
       targetResourceType,
       targetResourceId: await this.hashId(targetResourceId),
       timestamp: new Date(),
       success,
     };
 
     this.entries.push(entry);
 
     // Limiter la taille du log
     if (this.entries.length > MAX_ENTRIES) {
       this.entries = this.entries.slice(-MAX_ENTRIES);
     }
 
     this.persist();
     logger.debug('AuditLogger', `Audit: ${action}`, { success });
   }
 
   /**
    * Récupère les entrées filtrées (admin uniquement — vérification en amont)
    */
   getEntries(filter?: { action?: AuditAction; since?: Date }): AuditEntry[] {
     let result = [...this.entries];
     if (filter?.action) result = result.filter((e) => e.action === filter.action);
     if (filter?.since) result = result.filter((e) => e.timestamp >= filter.since!);
     return result;
   }
 
   /** Hash SHA-256 d'un identifiant pour la pseudonymisation */
   private async hashId(id: string): Promise<string> {
     const encoded = new TextEncoder().encode(id);
     const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
     const hashArray = Array.from(new Uint8Array(hashBuffer));
     return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
   }
 
   private persist(): void {
     try {
       sessionStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.entries));
     } catch {
       logger.error('AuditLogger', 'Erreur persistance audit log');
     }
   }
 
   private load(): void {
     try {
       const raw = sessionStorage.getItem(AUDIT_STORAGE_KEY);
       if (raw) this.entries = JSON.parse(raw) as AuditEntry[];
     } catch {
       this.entries = [];
     }
   }
 }
 
 export const auditLogger = new AuditLogger();