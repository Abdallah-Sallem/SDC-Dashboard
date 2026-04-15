/**
 * Reader.tsx
 * RÔLE : Page de lecture principale — contient AdaptiveReader.
 * Corrigé : initialise l'Encryptor avec deriveKey() avant d'ouvrir LocalDB.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AdaptiveReader }    from '../components/AdaptiveReader';
import { SessionRepository } from '../../storage/SessionRepository';
import { LocalDB }           from '../../storage/LocalDB';
import { Encryptor }         from '../../security/Encryptor';
import { ConsentManager }    from '../../security/ConsentManager';
import { EventBus }          from '../../core/event-bus/EventBus';
import { generateId }        from '../../shared/utils';
import type { StudentProfile, TeacherText } from '../../shared/types';

interface ReaderPageProps {
  profile:  StudentProfile;
  text:     TeacherText;
  onExit:   () => void;
}

// Clé de dérivation fixe pour le stockage local (pas d'auth côté élève)
// En production, utiliser l'ID de session ou un secret stocké côté parent
const LOCAL_DB_PASSWORD = 'qalam-sense-local-key';

export const Reader: React.FC<ReaderPageProps> = ({ profile, text, onExit }) => {
  const sessionId  = useRef(generateId()).current;
  const repoRef    = useRef<SessionRepository | null>(null);
  const [dbReady,  setDbReady]  = useState(false);
  const [dbError,  setDbError]  = useState<string | null>(null);

  // ── Vérifier le consentement eye-tracking ──────────────────────
  const consentMgr     = new ConsentManager();
  const hasEyeConsent  = consentMgr.canUseEyeTracking(profile.id);

  // ── Initialiser LocalDB avec Encryptor correctement dérivé ─────
  useEffect(() => {
    const init = async () => {
      try {
        const encryptor = new Encryptor();

        // ✅ CORRECTION PRINCIPALE : dériver la clé avant d'utiliser LocalDB
        const salt = Encryptor.generateSalt();
        await encryptor.deriveKey(LOCAL_DB_PASSWORD, salt);

        const db = new LocalDB(encryptor);
        await db.open();
        repoRef.current = new SessionRepository(db);

        await repoRef.current.create({
          studentId:              profile.id,
          textId:                 text.id,
          startedAt:              new Date(),
          adaptationsApplied:     [],
          averageDifficultyLevel: 0,
          wordsRead:              0,
          language:               profile.language,
        });

        EventBus.emit('session:start', {
          id: sessionId, studentId: profile.id, textId: text.id,
        }, sessionId);

        setDbReady(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setDbError(msg);
        // ✅ On continue quand même — la lecture fonctionne sans DB
        setDbReady(true);
        console.warn('Reader: DB init failed, continuing without storage:', msg);
      }
    };

    init();

    return () => {
      EventBus.emit('session:end', { sessionId }, sessionId);
    };
  }, []);

  const handleSessionEnd = async (wordsRead: number) => {
    if (repoRef.current) {
      try {
        await repoRef.current.update(sessionId, {
          endedAt: new Date(),
          wordsRead,
        });
      } catch (err) {
        console.warn('Reader: session save failed:', err);
      }
    }
  };

  return (
    <div style={{ minHeight: '100vh', fontFamily: 'inherit' }}>

      {/* Barre de navigation */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #E8E8E6',
        padding: '0.6rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button
          onClick={onExit}
          style={{
            padding: '0.4rem 0.875rem', border: '1px solid #D3D1C7',
            borderRadius: 8, background: 'transparent', cursor: 'pointer',
            fontSize: '0.85rem', color: '#5F5E5A',
          }}
        >
          ← Retour
        </button>
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#444441' }}>
          {profile.name} · {text.title}
        </span>
        <span style={{ fontSize: '0.75rem', color: '#B4B2A9' }}>
          {text.language === 'ar' ? 'عربي' : 'Français'}
        </span>
      </nav>

      {/* Avertissement DB si erreur non bloquante */}
      {dbError && (
        <div style={{
          padding: '0.4rem 1.25rem',
          background: '#FFF8E7', borderBottom: '1px solid #F0D080',
          fontSize: '0.78rem', color: '#854F0B',
        }}>
          ⚠️ Stockage local indisponible — la session ne sera pas sauvegardée
        </div>
      )}

      {/* ✅ Bannière si consentement caméra manquant */}
      {!hasEyeConsent && (
        <div style={{
          padding: '0.6rem 1.25rem',
          background: '#F1EFE8',
          borderBottom: '1px solid #D3D1C7',
          fontSize: '0.82rem', color: '#5F5E5A',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>ℹ️</span>
          <span>
            Le consentement parental eye-tracking n'est pas enregistré. Au démarrage,
            le navigateur peut quand même demander l'accès caméra pour cette session.
          </span>
        </div>
      )}

      {/* Lecteur adaptatif */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {dbReady && (
          <AdaptiveReader
            profile={profile}
            text={text}
            sessionId={sessionId}
            onSessionEnd={handleSessionEnd}
          />
        )}
      </div>
    </div>
  );
};