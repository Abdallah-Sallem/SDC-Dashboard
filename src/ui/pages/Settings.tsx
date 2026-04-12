/**
 * Settings.tsx
 * RÔLE : Page de paramètres utilisateur.
 * Permet à l'élève/parent de configurer manuellement les adaptations
 * et de gérer les consentements (droit au retrait RGPD).
 */

 import React, { useState } from 'react';
 import type { StudentProfile } from '../../shared/types';
 
 interface SettingsProps {
   profile: StudentProfile;
   onUpdate: (updates: Partial<StudentProfile>) => void;
   onRevokeConsent: () => void;
   onBack: () => void;
 }
 
 export const Settings: React.FC<SettingsProps> = ({
   profile, onUpdate, onRevokeConsent, onBack,
 }) => {
   const [threshold, setThreshold]  = useState(profile.adaptationThreshold);
   const [font,      setFont]       = useState(profile.preferredFont);
   const [saved,     setSaved]      = useState(false);
 
   const handleSave = () => {
     onUpdate({ adaptationThreshold: threshold, preferredFont: font });
     setSaved(true);
     setTimeout(() => setSaved(false), 2000);
   };
 
   return (
     <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
       <button onClick={onBack} style={{ marginBottom: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#888780', fontSize: '0.9rem' }}>
         ← Retour
       </button>
       <h1 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#085041', marginBottom: '1.5rem' }}>
         Paramètres — {profile.name}
       </h1>
 
       {/* Sensibilité d'adaptation */}
       <div style={{ marginBottom: '1.5rem' }}>
         <label style={{ display: 'block', fontWeight: 500, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
           Sensibilité d'adaptation
         </label>
         <p style={{ fontSize: '0.8rem', color: '#888780', marginBottom: '0.75rem', lineHeight: 1.5 }}>
           Plus la valeur est basse, plus les adaptations se déclenchent facilement.
         </p>
         <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
           <input
             type="range" min={0.1} max={0.9} step={0.05}
             value={threshold}
             onChange={(e) => setThreshold(Number(e.target.value))}
             style={{ flex: 1, accentColor: '#1D9E75' }}
           />
           <span style={{ minWidth: 36, textAlign: 'right', fontWeight: 500, fontSize: '0.9rem', color: '#085041' }}>
             {Math.round(threshold * 100)}%
           </span>
         </div>
       </div>
 
       {/* Police préférée */}
       <div style={{ marginBottom: '1.5rem' }}>
         <label style={{ display: 'block', fontWeight: 500, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
           Police préférée
         </label>
         {(['inherit', 'AtkinsonHyperlegible', 'OpenDyslexic'] as const).map((f) => (
           <label key={f} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem', cursor: 'pointer' }}>
             <input
               type="radio" name="font" value={f}
               checked={font === f}
               onChange={() => setFont(f)}
               style={{ accentColor: '#1D9E75' }}
             />
             <span style={{ fontSize: '0.9rem', fontFamily: f === 'inherit' ? 'inherit' : f }}>
               {f === 'inherit' ? 'Police système (défaut)' : f}
             </span>
           </label>
         ))}
       </div>
 
       <button onClick={handleSave} style={{
         width: '100%', padding: '0.7rem',
         background: '#1D9E75', color: '#FFF', border: 'none',
         borderRadius: 10, fontWeight: 500, cursor: 'pointer', fontSize: '0.95rem',
         marginBottom: '1rem',
       }}>
         {saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
       </button>
 
       {/* Zone RGPD */}
       <div style={{ borderTop: '1px solid #E8E8E6', paddingTop: '1.25rem', marginTop: '0.5rem' }}>
         <h2 style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.75rem', color: '#444441' }}>
           Confidentialité & droits RGPD
         </h2>
         <button
           onClick={onRevokeConsent}
           style={{
             padding: '0.5rem 1rem', border: '1px solid #F09595',
             borderRadius: 8, background: 'transparent', cursor: 'pointer',
             fontSize: '0.85rem', color: '#A32D2D',
           }}
         >
           Retirer mon consentement et supprimer mes données
         </button>
       </div>
     </div>
   );
 };