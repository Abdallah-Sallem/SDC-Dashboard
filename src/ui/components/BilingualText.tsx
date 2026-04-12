/**
 * BilingualText.tsx
 * RÔLE : Composant d'affichage de texte mixte arabe/français.
 * Détecte automatiquement la langue de chaque segment de texte
 * et applique la direction correcte à chaque bloc indépendamment.
 * Utilisé pour les textes qui mélangent les deux langues.
 *
 * EXEMPLE :
 *   <BilingualText text="Bonjour. مرحباً. Comment ça va ?" />
 *   → "Bonjour." en LTR, "مرحباً." en RTL, "Comment ça va ?" en LTR
 */

 import React, { useMemo } from 'react';
 import { detectLanguage } from '../../shared/utils';
 import type { ReadingDirection } from '../../shared/types';
 
 interface BilingualTextProps {
   text: string;
   className?: string;
   style?: React.CSSProperties;
 }
 
 interface TextSegment {
   content: string;
   direction: ReadingDirection;
   lang: string;
 }
 
 /**
  * Découpe un texte en segments homogènes (arabe ou français)
  * en détectant les transitions de script.
  */
 function splitIntoSegments(text: string): TextSegment[] {
   if (!text) return [];
 
   // Découper sur les phrases (point, point d'exclamation, retour à la ligne)
   const sentences = text.split(/(?<=[.!?\n])\s+/);
 
   return sentences
     .filter((s) => s.trim().length > 0)
     .map((sentence) => {
       const lang = detectLanguage(sentence);
       return {
         content: sentence,
         direction: lang === 'ar' ? 'rtl' : 'ltr',
         lang: lang === 'ar' ? 'ar' : 'fr',
       };
     });
 }
 
 export const BilingualText: React.FC<BilingualTextProps> = ({
   text,
   className,
   style,
 }) => {
   const segments = useMemo(() => splitIntoSegments(text), [text]);
 
   // Si le texte est homogène — afficher directement sans découpage
   const isHomogeneous =
     segments.length === 0 ||
     new Set(segments.map((s) => s.direction)).size === 1;
 
   if (isHomogeneous) {
     const direction = segments[0]?.direction ?? 'ltr';
     return (
       <span
         className={className}
         style={{ direction, textAlign: direction === 'rtl' ? 'right' : 'left', ...style }}
         lang={segments[0]?.lang ?? 'fr'}
       >
         {text}
       </span>
     );
   }
 
   // Texte mixte — afficher chaque segment avec sa direction
   return (
     <span className={className} style={style}>
       {segments.map((segment, i) => (
         <span
           key={i}
           dir={segment.direction}
           lang={segment.lang}
           style={{
             display: 'inline',
             direction: segment.direction,
             unicodeBidi: 'isolate', // Isolation bidirectionnelle CSS
           }}
         >
           {segment.content}{' '}
         </span>
       ))}
     </span>
   );
 };