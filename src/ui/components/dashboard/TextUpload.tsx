/**
 * TextUpload.tsx
 * RÔLE : Interface permettant à l'enseignant d'uploader des textes
 * qui seront lus par les élèves dans le lecteur adaptatif.
 * Supporte l'arabe (RTL) et le français (LTR).
 * La détection de langue est automatique à la saisie.
 */

 import React, { useState, useRef } from 'react';
 import { detectLanguage } from '../../../shared/utils';
 import type { TeacherText, ReadingLanguage } from '../../../shared/types';
 
 interface TextUploadProps {
   onUploaded: (text: Omit<TeacherText, 'id' | 'uploadedAt'>) => void;
 }
 
 export const TextUpload: React.FC<TextUploadProps> = ({ onUploaded }) => {
   const [title,    setTitle]    = useState('');
   const [content,  setContent]  = useState('');
   const [targetAge, setTargetAge] = useState(10);
   const [detectedLang, setDetectedLang] = useState<ReadingLanguage>('fr');
   const [success, setSuccess] = useState(false);
   const fileRef = useRef<HTMLInputElement>(null);
 
   const handleContentChange = (value: string) => {
     setContent(value);
     if (value.length > 20) {
       setDetectedLang(detectLanguage(value));
     }
   };
 
   const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;
     const reader = new FileReader();
     reader.onload = (ev) => {
       const text = ev.target?.result as string;
       setContent(text);
       handleContentChange(text);
     };
     reader.readAsText(file, 'UTF-8');
   };
 
   const handleSubmit = () => {
     if (!title.trim() || !content.trim()) return;
 
     onUploaded({
       teacherId:         'current-teacher',  // Remplacé par l'auth réelle
       title:             title.trim(),
       content:           content.trim(),
       language:          detectedLang,
       targetAge,
       assignedStudentIds: [],
     });
 
     setTitle('');
     setContent('');
     setSuccess(true);
     setTimeout(() => setSuccess(false), 3000);
   };
 
   const isRTL = detectedLang === 'ar';
 
   return (
     <div>
       <p style={{ fontSize: '0.875rem', color: '#5F5E5A', marginBottom: '1rem', lineHeight: 1.6 }}>
         Ajoutez un texte que vos élèves liront dans le lecteur adaptatif.
         La langue est détectée automatiquement.
       </p>
 
       {/* Titre */}
       <div style={{ marginBottom: '0.875rem' }}>
         <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: '#444441', marginBottom: 4 }}>
           Titre du texte
         </label>
         <input
           type="text"
           value={title}
           onChange={(e) => setTitle(e.target.value)}
           placeholder="Ex : La petite histoire / القصة الصغيرة"
           style={{
             width: '100%', padding: '0.5rem 0.75rem',
             border: '1px solid #D3D1C7', borderRadius: 8,
             fontSize: '0.9rem', outline: 'none',
           }}
         />
       </div>
 
       {/* Contenu */}
       <div style={{ marginBottom: '0.875rem' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
           <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#444441' }}>
             Contenu
           </label>
           <span style={{
             fontSize: '0.75rem', padding: '2px 8px',
             background: isRTL ? '#EEEDFE' : '#E6F1FB',
             color: isRTL ? '#534AB7' : '#185FA5',
             borderRadius: 99,
           }}>
             {isRTL ? 'عربي — RTL' : 'Français — LTR'}
           </span>
         </div>
         <textarea
           value={content}
           onChange={(e) => handleContentChange(e.target.value)}
           dir={isRTL ? 'rtl' : 'ltr'}
           rows={8}
           placeholder={isRTL ? 'اكتب النص هنا...' : 'Écrivez ou collez le texte ici...'}
           style={{
             width: '100%', padding: '0.75rem',
             border: '1px solid #D3D1C7', borderRadius: 8,
             fontSize: '0.9rem', lineHeight: 1.7,
             resize: 'vertical', outline: 'none',
             textAlign: isRTL ? 'right' : 'left',
             fontFamily: isRTL ? '"Amiri", serif' : 'inherit',
           }}
         />
       </div>
 
       {/* Import depuis fichier */}
       <div style={{ marginBottom: '1rem' }}>
         <button
           onClick={() => fileRef.current?.click()}
           style={{
             padding: '0.4rem 0.875rem', border: '1px solid #D3D1C7',
             borderRadius: 8, background: 'transparent', cursor: 'pointer',
             fontSize: '0.8rem', color: '#5F5E5A',
           }}
         >
           Importer un fichier .txt
         </button>
         <input ref={fileRef} type="file" accept=".txt" onChange={handleFileLoad} style={{ display: 'none' }} />
       </div>
 
       {/* Âge cible */}
       <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
         <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#444441' }}>
           Âge cible :
         </label>
         <input
           type="number"
           min={5} max={18}
           value={targetAge}
           onChange={(e) => setTargetAge(Number(e.target.value))}
           style={{
             width: 64, padding: '0.35rem 0.5rem',
             border: '1px solid #D3D1C7', borderRadius: 8,
             fontSize: '0.9rem', textAlign: 'center',
           }}
         />
         <span style={{ fontSize: '0.8rem', color: '#888780' }}>ans</span>
       </div>
 
       {/* Bouton soumettre */}
       <button
         onClick={handleSubmit}
         disabled={!title.trim() || !content.trim()}
         style={{
           padding: '0.6rem 1.4rem', border: 'none',
           borderRadius: 8,
           background: title && content ? '#1D9E75' : '#D3D1C7',
           color: '#FFFFFF', cursor: title && content ? 'pointer' : 'not-allowed',
           fontWeight: 500, fontSize: '0.9rem',
         }}
       >
         Ajouter le texte
       </button>
 
       {/* Confirmation */}
       {success && (
         <div style={{
           marginTop: '0.875rem', padding: '0.6rem 1rem',
           background: '#E1F5EE', borderRadius: 8,
           fontSize: '0.875rem', color: '#085041',
         }}>
           Texte ajouté avec succès !
         </div>
       )}
     </div>
   );
 };