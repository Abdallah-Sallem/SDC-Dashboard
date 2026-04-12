/**
 * logger.ts
 * RÔLE : Logger centralisé pour tout le projet.
 * RÈGLE DE SÉCURITÉ : Ce logger ne doit JAMAIS recevoir de données personnelles
 * (noms, coordonnées, données biométriques). Uniquement des événements techniques.
 */

 type LogLevel = 'debug' | 'info' | 'warn' | 'error';

 interface LogEntry {
   level: LogLevel;
   module: string;
   message: string;
   data?: Record<string, unknown>;
   timestamp: string;
 }
 
 class QalamLogger {
    private isDev = typeof process !== 'undefined' 
    ? process.env.NODE_ENV !== 'production'
    : true;
 
   private format(entry: LogEntry): string {
     return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}`;
   }
 
   private log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
     const entry: LogEntry = {
       level,
       module,
       message,
       data,
       timestamp: new Date().toISOString(),
     };
 
     // En développement : afficher dans la console
     if (this.isDev) {
       const formatted = this.format(entry);
       if (level === 'error') console.error(formatted, data ?? '');
       else if (level === 'warn') console.warn(formatted, data ?? '');
       else console.log(formatted, data ?? '');
     }
 
     // En production : stocker uniquement les erreurs (sans données perso)
     if (!this.isDev && (level === 'error' || level === 'warn')) {
       this.storeLocally(entry);
     }
   }
 
   /** Stocke les logs d'erreur localement pour le débogage (sans données perso) */
   private storeLocally(entry: LogEntry) {
     try {
       const logs = JSON.parse(sessionStorage.getItem('qs_logs') ?? '[]') as LogEntry[];
       logs.push(entry);
       // Garder seulement les 100 derniers logs
       if (logs.length > 100) logs.splice(0, logs.length - 100);
       sessionStorage.setItem('qs_logs', JSON.stringify(logs));
     } catch {
       // Silencieux — le stockage n'est pas critique
     }
   }
 
   debug(module: string, message: string, data?: Record<string, unknown>) {
     this.log('debug', module, message, data);
   }
 
   info(module: string, message: string, data?: Record<string, unknown>) {
     this.log('info', module, message, data);
   }
 
   warn(module: string, message: string, data?: Record<string, unknown>) {
     this.log('warn', module, message, data);
   }
 
   error(module: string, message: string, data?: Record<string, unknown>) {
     this.log('error', module, message, data);
   }
 }
 
 // Instance unique partagée dans tout le projet (Singleton)
 export const logger = new QalamLogger();