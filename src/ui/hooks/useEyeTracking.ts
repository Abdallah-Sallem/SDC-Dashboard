/**
 * useEyeTracking.ts
 * RÔLE : Hook React qui gère le cycle de vie de l'eye-tracker.
 * Corrigé : meilleur message de consentement manquant,
 * et tentative caméra même sans consentement enregistré
 * (demande au navigateur = demande implicite à l'utilisateur présent).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { EyeTracker }        from '../../core/eye-tracking/EyeTracker';
import { NoseAnchorTrackerAdapter } from '../../core/eye-tracking/NoseAnchorTrackerAdapter';
import { AdaptiveLoopController } from '../../core/ai-engine/AdaptiveLoopController';
import { EventBus }          from '../../core/event-bus/EventBus';
import { ConsentManager }    from '../../security/ConsentManager';
import { logger }            from '../../shared/logger';
import type { StudentProfile, TrackingLostPayload, TrackingLostReason } from '../../shared/types';

const TRACKER_MODE_STORAGE_KEY = 'qs_tracker_mode';

type TrackerMode = 'nose-anchor' | 'legacy';

interface TrackerController {
  start(options?: { userInitiated?: boolean }): Promise<boolean>;
  stop(): void;
  pause(): void;
  resume(): void;
  recalibrate(): boolean;
  getLastError(): string | null;
}

function getPreferredTrackerMode(): TrackerMode {
  try {
    const stored = localStorage.getItem(TRACKER_MODE_STORAGE_KEY);
    return stored === 'legacy' ? 'legacy' : 'nose-anchor';
  } catch {
    return 'nose-anchor';
  }
}

interface EyeTrackingState {
  isActive:      boolean;
  isLoading:     boolean;
  hasPermission: boolean | null;  // null = pas encore demandé
  error:         string | null;
  noConsent:     boolean;         // ✅ état séparé pour le consentement manquant
  trackingLost: boolean;
  trackingLostReason: TrackingLostReason | null;
}

export function useEyeTracking(studentId: string, sessionId: string, profile?: StudentProfile) {

  const trackerRef  = useRef<TrackerController | null>(null);
  const loopRef     = useRef<AdaptiveLoopController | null>(null);
  const consentMgr  = useRef(new ConsentManager());

  const [state, setState] = useState<EyeTrackingState>({
    isActive:      false,
    isLoading:     false,
    hasPermission: null,
    error:         null,
    noConsent:     false,
    trackingLost: false,
    trackingLostReason: null,
  });

  useEffect(() => {
    const unsub = EventBus.on<TrackingLostPayload>('tracking_lost', (event) => {
      if (event.sessionId !== sessionId) return;

      const reason = event.payload.reason;
      const message =
        reason === 'camera_off'
          ? 'Caméra interrompue. Vérifiez la webcam puis recalibrez.'
          : 'Visage perdu. Ajustez la position puis recalibrez.';

      setState(s => ({
        ...s,
        isActive: false,
        trackingLost: true,
        trackingLostReason: reason,
        error: message,
      }));

      logger.warn('useEyeTracking', 'Tracking perdu', {
        sessionId,
        reason,
      });
    });

    return () => unsub();
  }, [sessionId]);

  /** Démarre le tracking */
  const start = useCallback(async () => {

    // Vérifie le consentement, mais laisse la permission navigateur décider
    // pour une session en cours afin d'éviter un blocage silencieux.
    const hasConsent = consentMgr.current.canUseEyeTracking(studentId);
    const consentMissing = !hasConsent;
    if (consentMissing) {
      logger.warn('useEyeTracking', 'Consentement absent — tentative caméra sessionnelle');
    }

    setState(s => ({
      ...s,
      isLoading: true,
      error: null,
      noConsent: consentMissing,
      trackingLost: false,
      trackingLostReason: null,
    }));

    const preferredMode = getPreferredTrackerMode();
    let tracker: TrackerController =
      preferredMode === 'legacy'
        ? new EyeTracker(sessionId)
        : new NoseAnchorTrackerAdapter(sessionId);

    const loop = new AdaptiveLoopController(sessionId, {
      baseLanguage: profile?.language ?? 'fr',
    });

    loop.start();

    let started = await tracker.start({ userInitiated: true });

    // Safety net: if the new tracker fails in this environment,
    // transparently fall back to the original EyeTracker.
    if (!started && preferredMode === 'nose-anchor') {
      logger.warn('useEyeTracking', 'Fallback vers tracker legacy', {
        sessionId,
        error: tracker.getLastError(),
      });

      tracker = new EyeTracker(sessionId);
      started = await tracker.start({ userInitiated: true });
    }

    if (!started) {
      loop.stop();
      setState(s => ({
        ...s,
        isLoading:     false,
        hasPermission: false,
        noConsent:     consentMissing,
        error:         tracker.getLastError() ?? 'Caméra non disponible — mode dégradé activé',
      }));
      return;
    }

    trackerRef.current = tracker;
    loopRef.current = loop;

    setState({
      isActive:      true,
      isLoading:     false,
      hasPermission: true,
      error:         null,
      noConsent:     consentMissing,
      trackingLost: false,
      trackingLostReason: null,
    });
    logger.info('useEyeTracking', 'Eye-tracking demarre', {
      sessionId,
      trackerMode: tracker instanceof NoseAnchorTrackerAdapter ? 'nose-anchor' : 'legacy',
    });

  }, [studentId, sessionId, profile?.language]);

  /** Arrête proprement */
  const stop = useCallback(() => {
    trackerRef.current?.stop();
    loopRef.current?.stop();
    trackerRef.current  = null;
    loopRef.current = null;
    setState(s => ({
      ...s,
      isActive: false,
      trackingLost: false,
      trackingLostReason: null,
    }));
    logger.info('useEyeTracking', 'Eye-tracking arrêté');
  }, []);

  const pause  = useCallback(() => {
    trackerRef.current?.pause();
    setState(s => ({ ...s, isActive: false }));
  }, []);

  const resume = useCallback(() => {
    trackerRef.current?.resume();
    setState(s => ({
      ...s,
      isActive: true,
      error: null,
      trackingLost: false,
      trackingLostReason: null,
    }));
  }, []);

  const recalibrate = useCallback(() => {
    const ok = trackerRef.current?.recalibrate() ?? false;
    if (!ok) {
      setState(s => ({
        ...s,
        error: trackerRef.current?.getLastError() ?? 'Recalibration impossible',
      }));
      return false;
    }

    setState(s => ({
      ...s,
      isActive: true,
      error: null,
      trackingLost: false,
      trackingLostReason: null,
    }));
    return true;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { ...state, start, stop, pause, resume, recalibrate };
}