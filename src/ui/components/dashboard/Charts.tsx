/**
 * Charts.tsx
 * RÔLE : Visualisations des données agrégées pour l'enseignant.
 * Graphiques simples (barres) montrant la difficulté moyenne
 * par langue. Construit en SVG pur — aucune dépendance externe.
 * Toujours données anonymisées.
 */

 import React from 'react';

 interface ChartsProps {
   arDifficulty: number;  // [0..1]
   frDifficulty: number;  // [0..1]
 }
 
 export const Charts: React.FC<ChartsProps> = ({ arDifficulty, frDifficulty }) => {
   const bars = [
     { label: 'Arabe (AR)',    value: arDifficulty, color: '#534AB7' },
     { label: 'Français (FR)', value: frDifficulty, color: '#185FA5' },
   ];
 
   return (
     <div style={{
       background: '#F8F7F4',
       borderRadius: 10,
       padding: '1rem',
     }}>
       <div style={{ fontSize: '0.8rem', fontWeight: 500, color: '#444441', marginBottom: '0.875rem' }}>
         Niveau de difficulté moyen par langue (classe)
       </div>
 
       {bars.map((bar) => (
         <div key={bar.label} style={{ marginBottom: '0.75rem' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
             <span style={{ fontSize: '0.8rem', color: '#5F5E5A' }}>{bar.label}</span>
             <span style={{ fontSize: '0.8rem', fontWeight: 500, color: bar.color }}>
               {Math.round(bar.value * 100)}%
             </span>
           </div>
           <div style={{ height: 10, background: '#E8E8E6', borderRadius: 5, overflow: 'hidden' }}>
             <div
               style={{
                 height: '100%',
                 width: `${Math.round(bar.value * 100)}%`,
                 background: bar.color,
                 borderRadius: 5,
                 transition: 'width 0.6s ease',
               }}
               role="img"
               aria-label={`${bar.label} : ${Math.round(bar.value * 100)}%`}
             />
           </div>
         </div>
       ))}
 
       <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#B4B2A9' }}>
         Données anonymisées — agrégation sur toute la classe
       </div>
     </div>
   );
 };