/**
 * SyncService.ts
 * RÔLE : Synchronisation cloud OPTIONNELLE et chiffrée E2E.
 * Les données sont chiffrées sur l'appareil AVANT d'être envoyées.
 * Le serveur ne voit jamais les données en clair — il stocke uniquement
 * des blobs chiffrés. La clé de déchiffrement reste sur l'appareil.
 *
 * ACTIVATION : Opt-in uniquement, après consentement explicite du parent.
 */

 import { Encryptor } from '../security/Encryptor';
 import { logger } from '../shared/logger';
 
 interface SyncPayload {
   studentId: string;      // ID hashé côté serveur
   dataType: string;
   iv: string;
   ciphertext: string;     // Données déjà chiffrées côté client
   syncedAt: number;
 }
 
 export class SyncService {
   private encryptor: Encryptor;
   private apiUrl: string;
   private isEnabled = false;
 
   constructor(encryptor: Encryptor, apiUrl = '') {
     this.encryptor = encryptor;
     this.apiUrl = apiUrl;
   }
 
   /** Active la synchronisation (après consentement) */
   enable(): void {
     if (!this.apiUrl) {
       logger.warn('SyncService', 'URL API non configurée — sync désactivée');
       return;
     }
     this.isEnabled = true;
     logger.info('SyncService', 'Synchronisation activée');
   }
 
   disable(): void {
     this.isEnabled = false;
     logger.info('SyncService', 'Synchronisation désactivée');
   }
 
   /**
    * Synchronise un profil vers le cloud.
    * Le profil est chiffré AVANT l'envoi — le serveur ne lit rien.
    */
   async syncProfile(studentId: string, profileData: unknown): Promise<boolean> {
     if (!this.isEnabled) return false;
     
if (!this.encryptor.checkIsReady()) {
       logger.error('SyncService', 'Encryptor non prêt — sync annulée');
       return false;
     }
 
     try {
       const { iv, ciphertext } = await this.encryptor.encrypt(profileData);
 
       const payload: SyncPayload = {
         studentId: await this.hashId(studentId),
         dataType: 'profile',
         iv,
         ciphertext,
         syncedAt: Date.now(),
       };
 
       const response = await fetch(`${this.apiUrl}/sync`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload),
       });
 
       if (!response.ok) throw new Error(`HTTP ${response.status}`);
 
       logger.info('SyncService', 'Profil synchronisé');
       return true;
     } catch (err) {
       logger.error('SyncService', 'Erreur synchronisation', { error: String(err) });
       return false;
     }
   }
 
   private async hashId(id: string): Promise<string> {
     const encoded = new TextEncoder().encode(id + 'qalam_salt');
     const hash = await crypto.subtle.digest('SHA-256', encoded);
     return Array.from(new Uint8Array(hash))
       .map((b) => b.toString(16).padStart(2, '0'))
       .join('')
       .slice(0, 24);
   }
 
   checkEnabled(): boolean {
    return this.isEnabled;
  }
 }