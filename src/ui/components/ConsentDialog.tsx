/**
 * ConsentDialog.tsx
 * RÔLE : Dialogue de consentement parental RGPD/COPPA.
 * Affiché obligatoirement avant toute collecte de données.
 * Explique clairement ce qui est collecté, pourquoi et comment le supprimer.
 * Le parent choisit individuellement chaque type de consentement.
 */

 import React, { useState } from 'react';
 import { ConsentManager } from '../../security/ConsentManager';
 import { generateId } from '../../shared/utils';
 
 interface ConsentDialogProps {
   studentId: string;
   studentName: string;
   onAccepted: () => void;
   onDeclined: () => void;
   language?: 'fr' | 'ar';
 }
 
 export const ConsentDialog: React.FC<ConsentDialogProps> = ({
   studentId,
   studentName,
   onAccepted,
   onDeclined,
   language = 'fr',
 }) => {
   const [eyeTracking, setEyeTracking]   = useState(false);
   const [dataStorage, setDataStorage]   = useState(false);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const consentMgr = new ConsentManager();
   const isRTL = language === 'ar';
 
   const handleAccept = async () => {
     setIsSubmitting(true);
     consentMgr.grantConsent(studentId, generateId(), {
       eyeTrackingConsent: eyeTracking,
       dataStorageConsent: dataStorage,
     });
     setIsSubmitting(false);
     onAccepted();
   };
 
   const t = {
     fr: {
       title:      `Consentement parental — ${studentName}`,
       intro:      'Avant de commencer, nous avons besoin de votre accord sur les points suivants :',
       eyeLabel:   'Suivi du regard (eye-tracking)',
       eyeDesc:    'Analyse les mouvements des yeux pour détecter les difficultés de lecture. Les images de la caméra ne sont jamais stockées — uniquement des statistiques anonymes.',
       dataLabel:  'Sauvegarde du profil d\'adaptation',
       dataDesc:   'Mémorise les paramètres d\'affichage préférés de votre enfant pour les prochaines sessions. Données stockées uniquement sur cet appareil, chiffrées.',
       rights:     'Vous pouvez retirer votre consentement à tout moment dans les paramètres. Tous les droits RGPD s\'appliquent (accès, rectification, effacement).',
       decline:    'Refuser',
       accept:     'Accepter et continuer',
       required:   'Au moins l\'accès à l\'application de base est disponible sans consentement.',
     },
     ar: {
       title:      `موافقة ولي الأمر — ${studentName}`,
       intro:      'قبل البدء، نحتاج إلى موافقتك على النقاط التالية:',
       eyeLabel:   'تتبع حركة العيون',
       eyeDesc:    'يحلل حركات العيون للكشف عن صعوبات القراءة. لا يتم تخزين صور الكاميرا أبدًا — فقط إحصائيات مجهولة الهوية.',
       dataLabel:  'حفظ ملف التكيف',
       dataDesc:   'يحفظ إعدادات العرض المفضلة لطفلك للجلسات القادمة. البيانات مخزنة فقط على هذا الجهاز ومشفرة.',
       rights:     'يمكنك سحب موافقتك في أي وقت من الإعدادات. تسري جميع حقوق الخصوصية.',
       decline:    'رفض',
       accept:     'قبول والمتابعة',
       required:   'الوصول الأساسي للتطبيق متاح دون موافقة.',
     },
   }[language];
 
   return (
     <div
       role="dialog"
       aria-modal="true"
       aria-labelledby="consent-title"
       dir={isRTL ? 'rtl' : 'ltr'}
       style={{
         position: 'fixed', inset: 0,
         background: 'rgba(0,0,0,0.5)',
         display: 'flex', alignItems: 'center', justifyContent: 'center',
         zIndex: 9999, padding: '1rem',
       }}
     >
       <div
         style={{
           background: '#FFFFFF',
           borderRadius: 12,
           padding: '2rem',
           maxWidth: 520,
           width: '100%',
           maxHeight: '90vh',
           overflowY: 'auto',
         }}
       >
         <h2 id="consent-title" style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#085041' }}>
           {t.title}
         </h2>
         <p style={{ color: '#5F5E5A', marginBottom: '1.5rem', lineHeight: 1.6 }}>{t.intro}</p>
 
         {/* Consentement eye-tracking */}
         <label style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', cursor: 'pointer', alignItems: 'flex-start' }}>
           <input
             type="checkbox"
             checked={eyeTracking}
             onChange={(e) => setEyeTracking(e.target.checked)}
             style={{ marginTop: 3, width: 18, height: 18, accentColor: '#1D9E75', flexShrink: 0 }}
           />
           <div>
             <div style={{ fontWeight: 500, marginBottom: 4 }}>{t.eyeLabel}</div>
             <div style={{ fontSize: '0.875rem', color: '#888780', lineHeight: 1.5 }}>{t.eyeDesc}</div>
           </div>
         </label>
 
         {/* Consentement stockage */}
         <label style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', cursor: 'pointer', alignItems: 'flex-start' }}>
           <input
             type="checkbox"
             checked={dataStorage}
             onChange={(e) => setDataStorage(e.target.checked)}
             style={{ marginTop: 3, width: 18, height: 18, accentColor: '#1D9E75', flexShrink: 0 }}
           />
           <div>
             <div style={{ fontWeight: 500, marginBottom: 4 }}>{t.dataLabel}</div>
             <div style={{ fontSize: '0.875rem', color: '#888780', lineHeight: 1.5 }}>{t.dataDesc}</div>
           </div>
         </label>
 
         <p style={{ fontSize: '0.8rem', color: '#B4B2A9', marginBottom: '1.5rem', lineHeight: 1.5 }}>
           {t.rights}
         </p>
         <p style={{ fontSize: '0.8rem', color: '#B4B2A9', marginBottom: '1.5rem' }}>{t.required}</p>
 
         <div style={{ display: 'flex', gap: '0.75rem', justifyContent: isRTL ? 'flex-start' : 'flex-end' }}>
           <button
             onClick={onDeclined}
             style={{
               padding: '0.6rem 1.2rem', border: '1px solid #D3D1C7',
               borderRadius: 8, background: 'transparent', cursor: 'pointer',
               color: '#5F5E5A',
             }}
           >
             {t.decline}
           </button>
           <button
             onClick={handleAccept}
             disabled={isSubmitting}
             style={{
               padding: '0.6rem 1.4rem', border: 'none',
               borderRadius: 8, background: '#1D9E75', color: '#FFFFFF',
               cursor: isSubmitting ? 'wait' : 'pointer', fontWeight: 500,
             }}
           >
             {t.accept}
           </button>
         </div>
       </div>
     </div>
   );
 };