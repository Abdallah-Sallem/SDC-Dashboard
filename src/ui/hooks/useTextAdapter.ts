/**
 * useTextAdapter.ts
 * RÔLE : Hook React qui connecte le TextAdapterEngine à un composant.
 * Gère le cycle de vie du moteur (démarrage/arrêt) et expose
 * les paramètres d'adaptation actifs en temps réel.
 */

 import { useEffect, useRef, useState } from 'react';
 import { TextAdapterEngine } from '../../core/text-adapter/TextAdapterEngine';
 import { EventBus } from '../../core/event-bus/EventBus';
 import type { AdaptationParams, StudentProfile } from '../../shared/types';
 
 export function useTextAdapter(profile: StudentProfile, sessionId: string) {
   const engineRef = useRef<TextAdapterEngine | null>(null);
   const [currentParams, setCurrentParams] = useState<AdaptationParams | null>(null);
   const [isActive, setIsActive] = useState(false);
 
   useEffect(() => {
     // Créer et démarrer le moteur
     const engine = new TextAdapterEngine(profile, sessionId);
     engine.start();
     engineRef.current = engine;
     setIsActive(true);
 
     // Écouter les adaptations appliquées pour mettre à jour l'état React
     const unsub = EventBus.on<AdaptationParams>('adaptation:apply', (event) => {
       setCurrentParams(event.payload);
     });
 
     return () => {
       unsub();
       engine.stop();
       setIsActive(false);
     };
   }, [profile.id, sessionId]);
 
   /** Réinitialise manuellement les adaptations */
   const resetAdaptations = () => {
     EventBus.emit('adaptation:reset', null, sessionId);
     setCurrentParams(null);
   };
 
   return { currentParams, isActive, resetAdaptations };
 }