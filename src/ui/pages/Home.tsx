/**
 * Home.tsx
 * RÔLE : Page d'accueil — sélection du profil selon le rôle connecté.
 */

import { useState, FC } from 'react';
import { ConsentDialog }  from '../components/ConsentDialog';
import { ConsentManager } from '../../security/ConsentManager';
import type {
  StudentProfile,
  TeacherText,
  UserRole,
} from '../../shared/types';

interface HomeProps {
  role:            UserRole;
  profiles:        StudentProfile[];
  availableTexts:  TeacherText[];
  onSelectProfile: (profile: StudentProfile, text?: TeacherText) => void;
  onCreateProfile: () => void;
  onBack:          () => void;
}

export const Home: FC<HomeProps> = ({
  role,
  profiles,
  availableTexts,
  onSelectProfile,
  onCreateProfile,
  onBack,
}) => {
  const [pendingProfile, setPendingProfile] = useState<StudentProfile | null>(null);
  const [selectedText,   setSelectedText]   = useState<TeacherText | null>(null);
  const consentMgr = new ConsentManager();

  const handleSelect = (profile: StudentProfile, text?: TeacherText) => {
    if (!consentMgr.isValid(profile.id)) {
      setPendingProfile(profile);
      setSelectedText(text ?? null);
    } else {
      onSelectProfile(profile, text);
    }
  };

  return (
    <div style={{
      maxWidth:   480,
      margin:     '0 auto',
      padding:    '2rem 1rem',
      fontFamily: 'inherit',
    }}>

      {/* Retour */}
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none',
          cursor: 'pointer', color: '#888780',
          fontSize: '0.9rem', marginBottom: '1.5rem', padding: 0,
        }}
      >
        ← Retour
      </button>

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: '#E1F5EE', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 28, marginBottom: '0.75rem',
        }}>
          ق
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#085041' }}>
          Qalam-Sense
        </h1>
        <p style={{ color: '#888780', fontSize: '0.9rem', marginTop: 4 }}>
          {role === 'parent'
            ? 'Profil de votre enfant'
            : 'Qui lit aujourd\'hui ?'}
        </p>
      </div>

      {/* Liste profils */}
      {profiles.length > 0 ? (
        <div style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           10,
          marginBottom:  '1.5rem',
        }}>
          {profiles.map((p) => (
            <div key={p.id}>

              {/* Carte profil */}
              <button
                onClick={() => handleSelect(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.875rem',
                  padding: '0.875rem 1rem', border: '1px solid #D3D1C7',
                  borderRadius: 12, background: '#FFFFFF', cursor: 'pointer',
                  textAlign: 'left', width: '100%',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1D9E75')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#D3D1C7')}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#E1F5EE', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, color: '#085041',
                  fontSize: '1rem', flexShrink: 0,
                }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.95rem' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#888780', marginTop: 1 }}>
                    {p.age} ans · {
                      p.language === 'ar' ? 'Arabe' :
                      p.language === 'fr' ? 'Français' : 'Bilingue'
                    }
                  </div>
                </div>
              </button>

              {/* Textes disponibles (élève uniquement) */}
              {role === 'student' && availableTexts.length > 0 && (
                <div style={{ paddingLeft: '1rem', marginTop: 6 }}>
                  {availableTexts.map((text) => (
                    <button
                      key={text.id}
                      onClick={() => handleSelect(p, text)}
                      style={{
                        display: 'block', width: '100%',
                        padding: '0.5rem 0.875rem', marginBottom: 4,
                        border: '1px solid #E1F5EE', borderRadius: 8,
                        background: '#F8FFFC', cursor: 'pointer',
                        textAlign: 'left', fontSize: '0.85rem', color: '#085041',
                      }}
                    >
                      Lire : {text.title}
                    </button>
                  ))}
                </div>
              )}

            </div>
          ))}
        </div>
      ) : (
        <div style={{
          textAlign: 'center', padding: '2rem',
          color: '#B4B2A9', marginBottom: '1.5rem',
        }}>
          Aucun profil — créez-en un pour commencer
        </div>
      )}

      {/* Bouton créer profil */}
      {(role === 'student' || role === 'parent') && (
        <button
          onClick={onCreateProfile}
          style={{
            width: '100%', padding: '0.75rem',
            border: '1.5px dashed #D3D1C7', borderRadius: 12,
            background: 'transparent', cursor: 'pointer',
            color: '#888780', fontSize: '0.9rem',
          }}
        >
          + Créer un nouveau profil
        </button>
      )}

      {/* Dialogue consentement */}
      {pendingProfile && (
        <ConsentDialog
          studentId={pendingProfile.id}
          studentName={pendingProfile.name}
          onAccepted={() => {
            const text = selectedText ?? undefined;
            setPendingProfile(null);
            setSelectedText(null);
            onSelectProfile(pendingProfile, text);
          }}
          onDeclined={() => {
            setPendingProfile(null);
            setSelectedText(null);
          }}
          language={pendingProfile.language === 'ar' ? 'ar' : 'fr'}
        />
      )}
    </div>
  );
};