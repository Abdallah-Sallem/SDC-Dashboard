/**
 * events.ts
 * RÔLE : Catalogue de tous les événements du système.
 * Fonctions helper pour créer des événements typés et cohérents.
 */

 import type {
   GazePointData,
    GazeMetrics,
   TrackingLostPayload,
    DifficultySignal,
   AdaptiveLoopOutput,
    AdaptationParams,
    StudentProfile,
    ReadingSession,
  } from '../../shared/types';
  
  // ─── Factories d'événements ──────────────────────────────────────────────────
  // Chaque fonction crée un payload prêt à être émis sur le bus
  
  export const Events = {
    gazePoint: (point: GazePointData) => ({
      type: 'gaze:point' as const,
      payload: point,
    }),

    gazeMetrics: (metrics: GazeMetrics) => ({
      type: 'gaze:metrics' as const,
      payload: metrics,
    }),

    trackingLost: (payload: TrackingLostPayload) => ({
      type: 'tracking_lost' as const,
      payload,
    }),
  
    difficultyDetected: (signal: DifficultySignal) => ({
      type: 'difficulty:detected' as const,
      payload: signal,
    }),

    adaptiveOutput: (output: AdaptiveLoopOutput) => ({
      type: 'adaptive:output' as const,
      payload: output,
    }),
  
    adaptationApply: (params: AdaptationParams) => ({
      type: 'adaptation:apply' as const,
      payload: params,
    }),
  
    adaptationReset: () => ({
      type: 'adaptation:reset' as const,
      payload: null,
    }),
  
    profileLoaded: (profile: StudentProfile) => ({
      type: 'profile:loaded' as const,
      payload: profile,
    }),
  
    sessionStart: (session: Pick<ReadingSession, 'id' | 'studentId' | 'textId'>) => ({
      type: 'session:start' as const,
      payload: session,
    }),
  
    sessionEnd: (sessionId: string) => ({
      type: 'session:end' as const,
      payload: { sessionId },
    }),
  
    consentGranted: (studentId: string) => ({
      type: 'consent:granted' as const,
      payload: { studentId },
    }),
  };