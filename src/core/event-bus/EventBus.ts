/**
 * EventBus.ts
 * RÔLE : Système de communication découplé entre tous les modules.
 * Principe : les modules ne se connaissent pas directement.
 * L'eye-tracker émet un événement, le moteur IA l'écoute — sans import direct.
 * Cela permet de remplacer un module sans toucher aux autres.
 */

 import type { QalamEvent, QalamEventType } from '../../shared/types';
 import { logger } from '../../shared/logger';
 
 type EventHandler<T = unknown> = (event: QalamEvent<T>) => void;
 
 class EventBusClass {
   // Map : type d'événement → liste des handlers abonnés
   private handlers = new Map<QalamEventType, EventHandler[]>();
 
   /**
    * S'abonner à un type d'événement
    * @returns Fonction de désabonnement à appeler dans le cleanup
    */
   on<T>(type: QalamEventType, handler: EventHandler<T>): () => void {
     if (!this.handlers.has(type)) {
       this.handlers.set(type, []);
     }
     this.handlers.get(type)!.push(handler as EventHandler);
 
     logger.debug('EventBus', `Abonnement à "${type}"`);
 
     // Retourner la fonction de désabonnement
     return () => this.off(type, handler as EventHandler);
   }
 
   /**
    * Se désabonner d'un type d'événement
    */
   off<T>(type: QalamEventType, handler: EventHandler<T>): void {
     const list = this.handlers.get(type);
     if (!list) return;
     const index = list.indexOf(handler as EventHandler);
     if (index !== -1) list.splice(index, 1);
   }
 
   /**
    * Émettre un événement — tous les abonnés sont notifiés
    */
   emit<T>(type: QalamEventType, payload: T, sessionId: string = 'no-session'): void {
     const event: QalamEvent<T> = {
       type,
       payload,
       timestamp: Date.now(),
       sessionId,
     };
 
     logger.debug('EventBus', `Émission "${type}"`, { sessionId });
 
     const list = this.handlers.get(type);
     if (!list || list.length === 0) {
       logger.warn('EventBus', `Aucun abonné pour "${type}"`);
       return;
     }
 
     // Notifier tous les abonnés de façon sécurisée (try/catch par handler)
     for (const handler of list) {
       try {
         handler(event as QalamEvent);
       } catch (err) {
         logger.error('EventBus', `Erreur dans handler de "${type}"`, {
           error: String(err),
         });
       }
     }
   }
 
   /**
    * Supprimer tous les abonnements (utile lors du démontage de l'app)
    */
   clear(): void {
     this.handlers.clear();
     logger.info('EventBus', 'Tous les abonnements supprimés');
   }
 }
 
 // Instance unique — tous les modules partagent le même bus
 export const EventBus = new EventBusClass();