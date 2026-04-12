/**
 * LocalDB.ts
 * RÔLE : Base de données locale chiffrée.
 * Abstraction au-dessus de IndexedDB (via Dexie.js en Phase 1,
 * wa-sqlite en Phase 2) avec chiffrement automatique de toutes
 * les données avant écriture.
 * Aucune donnée en clair sur le disque.
 */

 import { Encryptor } from '../security/Encryptor';
 import { logger } from '../shared/logger';
 import { DB_NAME, DB_VERSION } from '../shared/constants';
 
 interface EncryptedRecord {
   id: string;
   table: string;
   iv: string;
   ciphertext: string;
   createdAt: number;
   updatedAt: number;
 }
 
 export class LocalDB {
   private encryptor: Encryptor;
   private db: IDBDatabase | null = null;
 
   constructor(encryptor: Encryptor) {
     this.encryptor = encryptor;
   }
 
   /**
    * Ouvre la base de données IndexedDB.
    * À appeler une seule fois au démarrage, après l'authentification.
    */
   async open(): Promise<void> {
     return new Promise((resolve, reject) => {
       const request = indexedDB.open(DB_NAME, DB_VERSION);
 
       request.onupgradeneeded = (event) => {
         const db = (event.target as IDBOpenDBRequest).result;
 
         // Une seule table générique — toutes les données chiffrées dedans
         if (!db.objectStoreNames.contains('encrypted_records')) {
           const store = db.createObjectStore('encrypted_records', { keyPath: 'id' });
           store.createIndex('table', 'table', { unique: false });
           store.createIndex('createdAt', 'createdAt', { unique: false });
         }
       };
 
       request.onsuccess = () => {
         this.db = request.result;
         logger.info('LocalDB', 'Base de données ouverte');
         resolve();
       };
 
       request.onerror = () => {
         logger.error('LocalDB', 'Erreur ouverture base de données');
         reject(request.error);
       };
     });
   }
 
   /**
    * Sauvegarde un enregistrement chiffré.
    */
   async save(table: string, id: string, data: unknown): Promise<void> {
     if (!this.db) throw new Error('LocalDB non initialisée');
     if (!this.encryptor.checkIsReady()) throw new Error('Encryptor non initialisé');
     const { iv, ciphertext } = await this.encryptor.encrypt(data);
 
     const record: EncryptedRecord = {
       id: `${table}:${id}`,
       table,
       iv,
       ciphertext,
       createdAt: Date.now(),
       updatedAt: Date.now(),
     };
 
     return new Promise((resolve, reject) => {
       const tx = this.db!.transaction('encrypted_records', 'readwrite');
       const store = tx.objectStore('encrypted_records');
       const request = store.put(record);
       request.onsuccess = () => resolve();
       request.onerror = () => reject(request.error);
     });
   }
 
   /**
    * Lit et déchiffre un enregistrement.
    */
   async load<T>(table: string, id: string): Promise<T | null> {
     if (!this.db) throw new Error('LocalDB non initialisée');
 
     return new Promise((resolve, reject) => {
       const tx = this.db!.transaction('encrypted_records', 'readonly');
       const store = tx.objectStore('encrypted_records');
       const request = store.get(`${table}:${id}`);
 
       request.onsuccess = async () => {
         const record = request.result as EncryptedRecord | undefined;
         if (!record) { resolve(null); return; }
         const data = await this.encryptor.decrypt<T>(record.iv, record.ciphertext);
         resolve(data);
       };
       request.onerror = () => reject(request.error);
     });
   }
 
   /**
    * Charge tous les enregistrements d'une table.
    */
   async loadAll<T>(table: string): Promise<T[]> {
     if (!this.db) throw new Error('LocalDB non initialisée');
 
     return new Promise((resolve, reject) => {
       const tx = this.db!.transaction('encrypted_records', 'readonly');
       const store = tx.objectStore('encrypted_records');
       const index = store.index('table');
       const request = index.getAll(table);
 
       request.onsuccess = async () => {
         const records = request.result as EncryptedRecord[];
         const decrypted = await Promise.all(
           records.map((r) => this.encryptor.decrypt<T>(r.iv, r.ciphertext))
         );
         resolve(decrypted.filter((d) => d !== null) as T[]);
       };
       request.onerror = () => reject(request.error);
     });
   }
 
   /**
    * Supprime un enregistrement (droit à l'effacement RGPD).
    */
   async delete(table: string, id: string): Promise<void> {
     if (!this.db) throw new Error('LocalDB non initialisée');
 
     return new Promise((resolve, reject) => {
       const tx = this.db!.transaction('encrypted_records', 'readwrite');
       const store = tx.objectStore('encrypted_records');
       const request = store.delete(`${table}:${id}`);
       request.onsuccess = () => {
         logger.info('LocalDB', `Enregistrement supprimé`, { table, id });
         resolve();
       };
       request.onerror = () => reject(request.error);
     });
   }
 
   /** Ferme la connexion à la base */
   close(): void {
     this.db?.close();
     this.db = null;
   }
 }