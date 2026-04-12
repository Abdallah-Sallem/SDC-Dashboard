/**
 * useBilingual.ts
 * RÔLE : Hook React pour la gestion de la direction de lecture.
 * Détecte automatiquement la langue d'un texte et expose
 * la direction courante (rtl/ltr) aux composants qui en ont besoin.
 * Synchronise avec BilingualHandler du moteur d'adaptation.
 */

 import { useState, useCallback, useEffect } from 'react';
 import { BilingualHandler } from '../../core/text-adapter/BilingualHandler';
 import { detectLanguage } from '../../shared/utils';
 import type { ReadingDirection, ReadingLanguage } from '../../shared/types';
 
 interface BilingualState {
   direction: ReadingDirection;
   language: ReadingLanguage;
 }
 
 export function useBilingual(initialText?: string) {
   const handlerRef = new BilingualHandler();
 
   const [state, setState] = useState<BilingualState>(() => {
     if (!initialText) return { direction: 'ltr', language: 'fr' };
     const lang = detectLanguage(initialText);
     return { direction: lang === 'ar' ? 'rtl' : 'ltr', language: lang };
   });
 
   /** Met à jour la direction selon un nouveau texte */
   const updateForText = useCallback((text: string) => {
     const language = detectLanguage(text);
     const direction: ReadingDirection = language === 'ar' ? 'rtl' : 'ltr';
     handlerRef.update(language);
     setState({ direction, language });
   }, []);
 
   /** Force une direction manuellement (paramètre utilisateur) */
   const forceDirection = useCallback((direction: ReadingDirection) => {
     handlerRef.forceDirection(direction);
     setState((s) => ({ ...s, direction }));
   }, []);
 
   // Synchroniser au montage si un texte initial est fourni
   useEffect(() => {
     if (initialText) updateForText(initialText);
   }, []);
 
   return {
     direction: state.direction,
     language: state.language,
     isRTL: state.direction === 'rtl',
     updateForText,
     forceDirection,
   };
 }