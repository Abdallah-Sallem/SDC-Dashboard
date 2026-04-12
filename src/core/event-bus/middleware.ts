/**
 * middleware.ts
 * RÔLE : Couche intermédiaire du bus d'événements.
 * Intercepte les événements pour les logger, les filtrer ou les transformer
 * SANS modifier la logique métier des modules.
 * Ex : logger tous les événements de difficulté pour le débogage.
 */

 import { EventBus } from './EventBus';
 import { logger } from '../../shared/logger';
 import type { AdaptiveLoopOutput, DifficultySignal, GazeMetrics } from '../../shared/types';
 
 /**
  * Active les middlewares de débogage
  * À appeler une seule fois au démarrage de l'application (en dev uniquement)
  */
 export function installDebugMiddleware(): void {
   // Logger les métriques d'eye-tracking toutes les 30 frames (~1s)
   let gazeFrameCount = 0;
   EventBus.on<GazeMetrics>('gaze:metrics', (event) => {
     gazeFrameCount++;
     if (gazeFrameCount % 30 === 0) {
       logger.debug('Middleware', 'Métriques gaze (sample)', {
         saccadeSpeed: event.payload.saccadeSpeed,
         blinkRate: event.payload.blinkRate,
         // Jamais de x/y ici — déjà anonymisés en amont
       });
     }
   });
 
   // Logger toutes les détections de difficulté
   EventBus.on<DifficultySignal>('difficulty:detected', (event) => {
     logger.info('Middleware', 'Difficulté détectée', {
       type: event.payload.type,
       level: event.payload.level.toFixed(2),
       confidence: event.payload.confidence.toFixed(2),
     });
   });
 
   // Logger les adaptations appliquées
   EventBus.on('adaptation:apply', (event) => {
     logger.info('Middleware', 'Adaptation appliquée', {
       sessionId: event.sessionId,
     });
   });

   EventBus.on<AdaptiveLoopOutput>('adaptive:output', (event) => {
     logger.info('Middleware', 'Sortie boucle adaptative', {
       level: event.payload.difficultyLevel,
       score: event.payload.difficultyScore.toFixed(2),
     });
   });
 
   logger.info('Middleware', 'Middlewares de débogage installés');
 }
 
 /**
  * Active le middleware de performance
  * Mesure le temps entre détection et application de l'adaptation
  */
 export function installPerformanceMiddleware(): void {
   const detectionTimestamps = new Map<string, number>();
 
   EventBus.on<DifficultySignal>('difficulty:detected', (event) => {
     detectionTimestamps.set(event.sessionId, event.timestamp);
   });
 
   EventBus.on('adaptation:apply', (event) => {
     const detectionTime = detectionTimestamps.get(event.sessionId);
     if (detectionTime) {
       const latency = Date.now() - detectionTime;
       if (latency > 150) {
         logger.warn('Middleware', `Latence adaptation élevée: ${latency}ms`, {
           sessionId: event.sessionId,
         });
       }
       detectionTimestamps.delete(event.sessionId);
     }
   });
 }