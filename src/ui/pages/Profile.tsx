/**
 * Profile.tsx
 * RÔLE : Création et édition du profil élève.
 * Collecte uniquement les informations nécessaires (minimisation données).
 * Champ nom : prénom uniquement — jamais nom de famille.
 */

 import React, { useState } from 'react';
 import type { StudentProfile, NeurodivergenceType, ReadingLanguage } from '../../shared/types';
 
 interface ProfilePageProps {
   existing?: StudentProfile;
   onSave: (data: Omit<StudentProfile, 'id' | 'createdAt' | 'updatedAt'>) => void;
   onCancel: () => void;
 }
 
 const NEURODIVERGENCE_OPTIONS: { value: NeurodivergenceType; label: string }[] = [
   { value: 'dyslexia',    label: 'Dyslexie' },
   { value: 'adhd',        label: 'TDAH' },
   { value: 'autism',      label: 'Trouble du spectre autistique' },
   { value: 'dyscalculia', label: 'Dyscalculie' },
   { value: 'unknown',     label: 'Non diagnostiqué / inconnu' },
 ];
 
 export const Profile: React.FC<ProfilePageProps> = ({ existing, onSave, onCancel }) => {
   const [name,    setName]    = useState(existing?.name ?? '');
   const [age,     setAge]     = useState(existing?.age ?? 8);
   const [lang,    setLang]    = useState<ReadingLanguage>(existing?.language ?? 'fr');
   const [types,   setTypes]   = useState<NeurodivergenceType[]>(existing?.neurodivergenceTypes ?? ['unknown']);
 
   const toggleType = (type: NeurodivergenceType) => {
     setTypes((prev) =>
       prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
     );
   };
 
   const handleSubmit = () => {
     if (!name.trim()) return;
     onSave({
       name:                    name.trim(),
       age,
       language:                lang,
       neurodivergenceTypes:    types.length > 0 ? types : ['unknown'],
       adaptationThreshold:     0.4,
       preferredFont:           'inherit',
     });
   };
 
   return (
     <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
       <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888780', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
         ← Annuler
       </button>
       <h1 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#085041', marginBottom: '1.5rem' }}>
         {existing ? 'Modifier le profil' : 'Nouveau profil'}
       </h1>
 
       {/* Prénom */}
       <div style={{ marginBottom: '1rem' }}>
         <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: 4 }}>
           Prénom (uniquement)
         </label>
         <input
           type="text" value={name} onChange={(e) => setName(e.target.value)}
           placeholder="Ex : Yasmine"
           style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #D3D1C7', borderRadius: 8, fontSize: '0.9rem' }}
         />
         <p style={{ fontSize: '0.75rem', color: '#B4B2A9', marginTop: 4 }}>
           Prénom seulement — nom de famille non stocké
         </p>
       </div>
 
       {/* Âge */}
       <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
         <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>Âge :</label>
         <input
           type="number" min={5} max={18} value={age}
           onChange={(e) => setAge(Number(e.target.value))}
           style={{ width: 64, padding: '0.5rem', border: '1px solid #D3D1C7', borderRadius: 8, textAlign: 'center' }}
         />
         <span style={{ fontSize: '0.85rem', color: '#888780' }}>ans</span>
       </div>
 
       {/* Langue principale */}
       <div style={{ marginBottom: '1rem' }}>
         <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem' }}>
           Langue principale de lecture
         </label>
         {(['fr', 'ar', 'mixed'] as ReadingLanguage[]).map((l) => (
           <label key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
             <input type="radio" name="lang" value={l} checked={lang === l} onChange={() => setLang(l)} style={{ accentColor: '#1D9E75' }} />
             <span style={{ fontSize: '0.9rem' }}>
               {l === 'fr' ? 'Français' : l === 'ar' ? 'Arabe (عربي)' : 'Bilingue (AR/FR)'}
             </span>
           </label>
         ))}
       </div>
 
       {/* Profil neurologique */}
       <div style={{ marginBottom: '1.5rem' }}>
         <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: 4 }}>
           Profil (optionnel — aide à personnaliser les adaptations)
         </label>
         {NEURODIVERGENCE_OPTIONS.map(({ value, label }) => (
           <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem', cursor: 'pointer' }}>
             <input
               type="checkbox" checked={types.includes(value)}
               onChange={() => toggleType(value)}
               style={{ accentColor: '#1D9E75', width: 16, height: 16 }}
             />
             <span style={{ fontSize: '0.875rem' }}>{label}</span>
           </label>
         ))}
       </div>
 
       <button
         onClick={handleSubmit} disabled={!name.trim()}
         style={{
           width: '100%', padding: '0.7rem',
           background: name.trim() ? '#1D9E75' : '#D3D1C7',
           color: '#FFF', border: 'none', borderRadius: 10,
           fontWeight: 500, cursor: name.trim() ? 'pointer' : 'not-allowed',
           fontSize: '0.95rem',
         }}
       >
         {existing ? 'Mettre à jour' : 'Créer le profil'}
       </button>
     </div>
   );
 };