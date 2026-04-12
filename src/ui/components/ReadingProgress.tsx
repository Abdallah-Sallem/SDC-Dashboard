/**
 * ReadingProgress.tsx
 * RÔLE : Barre de progression visuelle de la lecture.
 * Mesure la position de défilement de l'élève dans le texte
 * pour afficher sa progression. Motivant pour les élèves.
 * Accessible : annonce le pourcentage aux lecteurs d'écran.
 */

 import React, { useState, useEffect, RefObject } from 'react';

 interface ReadingProgressProps {
   textLength: number;
   containerRef: RefObject<HTMLElement | null>;
 }
 
 export const ReadingProgress: React.FC<ReadingProgressProps> = ({
   containerRef,
 }) => {
   const [progress, setProgress] = useState(0);
 
   useEffect(() => {
     const updateProgress = () => {
       const el = containerRef.current;
       if (!el) return;
 
       const { top, height } = el.getBoundingClientRect();
       const viewportHeight = window.innerHeight;
       const scrolled = Math.max(0, viewportHeight - top);
       const pct = Math.min(100, Math.round((scrolled / height) * 100));
       setProgress(pct);
     };
 
     window.addEventListener('scroll', updateProgress, { passive: true });
     updateProgress(); // Calcul initial
 
     return () => window.removeEventListener('scroll', updateProgress);
   }, [containerRef]);
 
   return (
     <div
       role="progressbar"
       aria-valuenow={progress}
       aria-valuemin={0}
       aria-valuemax={100}
       aria-label={`Progression de lecture : ${progress}%`}
       style={{
         position: 'fixed',
         top: 0,
         left: 0,
         right: 0,
         height: 3,
         background: '#E1F5EE',
         zIndex: 999,
       }}
     >
       <div
         style={{
           height: '100%',
           width: `${progress}%`,
           background: '#1D9E75',
           transition: 'width 0.2s ease',
           borderRadius: '0 2px 2px 0',
         }}
       />
     </div>
   );
 };