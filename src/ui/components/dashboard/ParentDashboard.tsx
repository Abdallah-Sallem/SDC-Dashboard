/**
 * ParentDashboard.tsx
 * VERSION COMPLÈTE :
 * - Vraies stats depuis SessionRepository
 * - Liste détaillée de chaque session (date, mots, durée, difficulté)
 * - Alerte orthophoniste si difficulté élevée sur 3+ sessions récentes
 * - Durée recommandée selon l'âge de l'enfant
 * - Consentement caméra
 */

import { useState, useEffect, FC } from 'react';
import { authManager }       from '../../../auth/AuthManager';
import { ConsentManager }    from '../../../security/ConsentManager';
import { SessionRepository } from '../../../storage/SessionRepository';
import { LocalDB }           from '../../../storage/LocalDB';
import { Encryptor }         from '../../../security/Encryptor';
import type { StudentProfile, ReadingSession } from '../../../shared/types';

const LOCAL_DB_PASSWORD = 'qalam-sense-local-key';

// ── Durée recommandée selon l'âge ────────────────────────────────────────────
function getRecommendedDuration(age: number): { minutes: number; label: string } {
  if (age <= 7)  return { minutes: 10, label: '10 min' };
  if (age <= 10) return { minutes: 15, label: '15 min' };
  if (age <= 13) return { minutes: 20, label: '20 min' };
  return          { minutes: 30, label: '30 min' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatDuration(start: Date | string, end?: Date | string): string {
  if (!end) return '—';
  const ms  = new Date(end).getTime() - new Date(start).getTime();
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

function diffColor(level: number): string {
  if (level < 0.3) return '#0F6E56';
  if (level < 0.6) return '#854F0B';
  return '#A32D2D';
}

function diffLabel(level: number): string {
  if (level < 0.3) return 'Faible';
  if (level < 0.6) return 'Modéré';
  return 'Élevé';
}

// ── Interfaces ────────────────────────────────────────────────────────────────
interface DashboardStats {
  totalSessions:      number;
  avgDifficulty:      number;
  totalWordsRead:     number;
  mostCommonLanguage: string;
}

interface ParentDashboardProps {
  children:     StudentProfile[];
  onLinkChild:  (childId: string) => void;
  onDeleteData: () => void;
  onBack:       () => void;
}

// ── StatCard ──────────────────────────────────────────────────────────────────
const StatCard: FC<{ label: string; value: string | number; color?: string }> = ({
  label, value, color = '#085041',
}) => (
  <div style={{ background: '#F1EFE8', borderRadius: 10, padding: '0.75rem' }}>
    <div style={{ fontSize: '0.72rem', color: '#888780', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: '1.25rem', fontWeight: 600, color }}>{value}</div>
  </div>
);

// ── Vue détail enfant ────────────────────────────────────────────────────────
const ChildDetail: FC<{
  child:    StudentProfile;
  onBack:   () => void;
  onDelete: () => void;
}> = ({ child, onBack, onDelete }) => {
  const [stats,      setStats]      = useState<DashboardStats | null>(null);
  const [sessions,   setSessions]   = useState<ReadingSession[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [dbError,    setDbError]    = useState(false);
  const [activeTab,  setActiveTab]  = useState<'stats' | 'sessions' | 'camera'>('stats');

  const [consentMgr]               = useState(() => new ConsentManager());
  const [eyeConsent,  setEyeConsent]  = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [consentSaved, setConsentSaved] = useState(false);

  const duration = getRecommendedDuration(child.age);

  // Charger consentement
  useEffect(() => {
    const rec = consentMgr.getRecord(child.id);
    setEyeConsent(rec?.eyeTrackingConsent  ?? false);
    setDataConsent(rec?.dataStorageConsent ?? false);
    setConsentSaved(consentMgr.isValid(child.id));
  }, [child.id]);

  // Charger sessions depuis LocalDB
  useEffect(() => {
    const load = async () => {
      try {
        const encryptor = new Encryptor();
        const salt = Encryptor.generateSalt();
        await encryptor.deriveKey(LOCAL_DB_PASSWORD, salt);
        const db   = new LocalDB(encryptor);
        await db.open();
        const repo = new SessionRepository(db);

        const [s, list] = await Promise.all([
          repo.getStats(child.id),
          repo.findByStudent(child.id),
        ]);

        setStats(s);
        setSessions(list.sort((a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        ));
      } catch {
        setDbError(true);
        setStats({ totalSessions: 0, avgDifficulty: 0, totalWordsRead: 0, mostCommonLanguage: child.language });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [child.id]);

  const handleSaveConsent = () => {
    const parentId = authManager.getCurrentUserId() ?? 'parent';
    consentMgr.grantConsent(child.id, parentId, {
      eyeTrackingConsent:  eyeConsent,
      dataStorageConsent:  dataConsent,
    });
    setConsentSaved(true);
  };

  const handleRevokeConsent = () => {
    consentMgr.revokeConsent(child.id);
    setEyeConsent(false);
    setDataConsent(false);
    setConsentSaved(false);
  };

  // Alerte ortho : 3+ sessions difficiles parmi les 5 dernières
  const hardRecent = sessions.slice(0, 5).filter(s => s.averageDifficultyLevel > 0.6).length;

  const tab = (t: 'stats' | 'sessions' | 'camera'): React.CSSProperties => ({
    padding: '0.5rem 1rem', border: 'none',
    borderBottom: activeTab === t ? '2px solid #1D9E75' : '2px solid transparent',
    background: 'transparent', cursor: 'pointer',
    fontWeight: activeTab === t ? 500 : 400,
    color: activeTab === t ? '#085041' : '#888780',
    fontSize: '0.875rem', transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '1.5rem', maxWidth: 560, margin: '0 auto', fontFamily: 'inherit' }}>
      <button onClick={onBack} style={backBtn}>← Retour</button>

      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.25rem' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%', background: '#E1F5EE',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 600, color: '#085041', fontSize: '1.2rem',
        }}>
          {child.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 style={{ color: '#085041', margin: 0, fontSize: '1.1rem' }}>{child.name}</h2>
          <p style={{ fontSize: '0.78rem', color: '#888780', margin: 0 }}>
            {child.age} ans · {child.language === 'ar' ? 'Arabe' : child.language === 'fr' ? 'Français' : 'Bilingue'}
            · Durée recommandée : {duration.label}
          </p>
        </div>
      </div>

      {/* Alerte orthophoniste */}
      {hardRecent >= 3 && (
        <div style={{
          padding: '0.875rem 1rem', background: '#FFF8E7',
          borderLeft: '4px solid #BA7517', borderRadius: '0 10px 10px 0',
          marginBottom: '1.25rem', fontSize: '0.875rem', color: '#633806', lineHeight: 1.6,
        }}>
          <strong>⚠️ Difficulté persistante</strong><br />
          {child.name} a eu un niveau de difficulté élevé lors de {hardRecent} des 5 dernières sessions.
          Une consultation avec un orthophoniste pourrait être bénéfique.
        </div>
      )}

      {/* Onglets */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E8E8E6', marginBottom: '1.25rem' }}>
        <button style={tab('stats')}    onClick={() => setActiveTab('stats')}>Résumé</button>
        <button style={tab('sessions')} onClick={() => setActiveTab('sessions')}>
          Sessions ({sessions.length})
        </button>
        <button style={tab('camera')}   onClick={() => setActiveTab('camera')}>
          📷 Caméra {consentMgr.canUseEyeTracking(child.id) ? '✓' : ''}
        </button>
      </div>

      {/* ── Résumé ───────────────────────────────────────────── */}
      {activeTab === 'stats' && (
        loading ? (
          <div style={{ textAlign: 'center', color: '#888780', padding: '2rem' }}>Chargement…</div>
        ) : (
          <>
            {dbError && (
              <div style={{
                padding: '0.6rem 1rem', background: '#FFF8E7',
                borderRadius: 8, fontSize: '0.8rem', color: '#854F0B', marginBottom: '1rem',
              }}>
                ⚠️ Données locales indisponibles — les sessions ne sont pas chiffrées avec cette clé.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: '1.25rem' }}>
              <StatCard label="Sessions totales" value={stats?.totalSessions ?? 0} />
              <StatCard label="Mots lus"         value={(stats?.totalWordsRead ?? 0).toLocaleString('fr-FR')} />
              <StatCard
                label="Difficulté moyenne"
                value={diffLabel(stats?.avgDifficulty ?? 0)}
                color={diffColor(stats?.avgDifficulty ?? 0)}
              />
              <StatCard
                label="Langue principale"
                value={stats?.mostCommonLanguage === 'ar' ? 'Arabe' : 'Français'}
              />
            </div>

            {/* Aperçu 3 dernières sessions */}
            {sessions.length > 0 ? (
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.875rem', color: '#085041', marginBottom: 8 }}>
                  Dernières sessions
                </div>
                {sessions.slice(0, 3).map(s => (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.6rem 0.875rem', background: '#F8F7F4',
                    borderRadius: 8, marginBottom: 6, fontSize: '0.82rem',
                  }}>
                    <span style={{ color: '#444441' }}>{formatDate(s.startedAt)}</span>
                    <span style={{ color: '#888780' }}>{s.wordsRead} mots · {formatDuration(s.startedAt, s.endedAt)}</span>
                    <span style={{ color: diffColor(s.averageDifficultyLevel), fontWeight: 500 }}>
                      {diffLabel(s.averageDifficultyLevel)}
                    </span>
                  </div>
                ))}
                {sessions.length > 3 && (
                  <button
                    onClick={() => setActiveTab('sessions')}
                    style={{
                      width: '100%', padding: '0.5rem',
                      border: '1px solid #D3D1C7', borderRadius: 8,
                      background: 'transparent', cursor: 'pointer',
                      fontSize: '0.82rem', color: '#5F5E5A', marginTop: 4,
                    }}
                  >
                    Voir toutes les {sessions.length} sessions →
                  </button>
                )}
              </div>
            ) : (
              <div style={{
                textAlign: 'center', padding: '2rem', background: '#FAFAF8',
                borderRadius: 12, border: '1.5px dashed #D3D1C7',
                color: '#B4B2A9', fontSize: '0.875rem',
              }}>
                Aucune session enregistrée pour l'instant.
              </div>
            )}
          </>
        )
      )}

      {/* ── Toutes les sessions ───────────────────────────────── */}
      {activeTab === 'sessions' && (
        sessions.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '2rem', background: '#FAFAF8',
            borderRadius: 12, border: '1.5px dashed #D3D1C7',
            color: '#B4B2A9', fontSize: '0.875rem',
          }}>
            Aucune session enregistrée.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map((s, i) => (
              <div key={s.id} style={{
                padding: '0.875rem 1rem', background: '#fff',
                border: `1px solid ${s.averageDifficultyLevel > 0.6 ? '#F09595' : '#E8E8E6'}`,
                borderRadius: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem', color: '#085041' }}>
                    Session {sessions.length - i}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: '#888780' }}>
                    {formatDate(s.startedAt)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 8 }}>
                  {[
                    { label: 'Mots lus',  value: String(s.wordsRead) },
                    { label: 'Durée',     value: formatDuration(s.startedAt, s.endedAt) },
                    { label: 'Difficulté', value: diffLabel(s.averageDifficultyLevel), color: diffColor(s.averageDifficultyLevel) },
                  ].map(card => (
                    <div key={card.label} style={{
                      background: '#F1EFE8', borderRadius: 8, padding: '0.5rem', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '0.68rem', color: '#888780' }}>{card.label}</div>
                      <div style={{ fontWeight: 600, color: card.color ?? '#085041', fontSize: '0.9rem' }}>
                        {card.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.72rem', padding: '2px 8px',
                    background: '#E6F1FB', color: '#185FA5', borderRadius: 99,
                  }}>
                    {s.language === 'ar' ? 'Arabe' : 'Français'}
                  </span>
                  {s.adaptationsApplied.length > 0 && (
                    <span style={{
                      fontSize: '0.72rem', padding: '2px 8px',
                      background: '#E1F5EE', color: '#085041', borderRadius: 99,
                    }}>
                      {s.adaptationsApplied.length} adaptation(s)
                    </span>
                  )}
                  {s.averageDifficultyLevel > 0.6 && (
                    <span style={{
                      fontSize: '0.72rem', padding: '2px 8px',
                      background: '#FCEBEB', color: '#A32D2D', borderRadius: 99,
                    }}>
                      ⚠️ Difficulté élevée
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Caméra / Consentement ─────────────────────────────── */}
      {activeTab === 'camera' && (
        <div style={{
          background: '#F8F7F4', borderRadius: 12, padding: '1.25rem',
          border: `1.5px solid ${consentMgr.canUseEyeTracking(child.id) ? '#1D9E75' : '#D3D1C7'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
            <span style={{ fontSize: 18 }}>📷</span>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#085041' }}>
              Autorisation de la caméra
            </span>
            {consentMgr.canUseEyeTracking(child.id) && (
              <span style={{
                marginLeft: 'auto', fontSize: '0.72rem', padding: '2px 8px',
                background: '#E1F5EE', color: '#085041', borderRadius: 99, fontWeight: 500,
              }}>Autorisé ✓</span>
            )}
          </div>
          <p style={{ fontSize: '0.82rem', color: '#5F5E5A', marginBottom: '1rem', lineHeight: 1.6 }}>
            La caméra permet de détecter les difficultés de lecture de <strong>{child.name}</strong> via ses mouvements oculaires.
            Aucune image n'est stockée — uniquement des métriques anonymisées localement.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1rem' }}>
            {[
              { checked: eyeConsent, set: setEyeConsent, label: `J'autorise la caméra pour le suivi oculaire de ${child.name}` },
              { checked: dataConsent, set: setDataConsent, label: `J'autorise le stockage local des données (anonymisées, sur cet appareil uniquement)` },
            ].map((item, idx) => (
              <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={e => { item.set(e.target.checked); setConsentSaved(false); }}
                  style={{ accentColor: '#1D9E75', width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
                />
                <span style={{ fontSize: '0.85rem', color: '#444441', lineHeight: 1.5 }}>{item.label}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleSaveConsent}
              disabled={consentSaved}
              style={{
                flex: 1, padding: '0.6rem',
                background: consentSaved ? '#B4B2A9' : '#1D9E75',
                color: '#fff', border: 'none', borderRadius: 8,
                cursor: consentSaved ? 'default' : 'pointer',
                fontSize: '0.875rem', fontWeight: 500,
              }}
            >
              {consentSaved ? 'Enregistré ✓' : 'Enregistrer'}
            </button>
            {consentMgr.isValid(child.id) && (
              <button onClick={handleRevokeConsent} style={{
                padding: '0.6rem 1rem', border: '1px solid #F09595',
                borderRadius: 8, background: 'transparent',
                cursor: 'pointer', fontSize: '0.875rem', color: '#A32D2D',
              }}>
                Révoquer
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: '1.5rem' }}>
        <button onClick={onDelete} style={{
          width: '100%', padding: '0.6rem', border: '1px solid #F09595',
          borderRadius: 8, background: 'transparent', cursor: 'pointer',
          color: '#A32D2D', fontSize: '0.875rem',
        }}>
          Supprimer toutes les données de {child.name}
        </button>
      </div>
    </div>
  );
};

// ─── Composant principal ──────────────────────────────────────────────────────
export const ParentDashboard: FC<ParentDashboardProps> = ({
  children, onLinkChild, onDeleteData, onBack,
}) => {
  const [selected,     setSelected]     = useState<StudentProfile | null>(null);
  const [childIdInput, setChildIdInput] = useState('');
  const [linkError,    setLinkError]    = useState('');
  const [linking,      setLinking]      = useState(false);
  const consentMgr = new ConsentManager();

  const handleLink = async () => {
    if (!childIdInput.trim()) return;
    setLinking(true); setLinkError('');
    try {
      const account = authManager.getAccount(childIdInput.trim());
      if (!account || account.role !== 'student') {
        setLinkError("Identifiant introuvable. Vérifiez l'ID donné par l'enseignant.");
        return;
      }
      if (children.find(c => c.id === childIdInput.trim())) {
        setLinkError('Cet élève est déjà lié.');
        return;
      }
      onLinkChild(childIdInput.trim());
      setChildIdInput('');
    } finally { setLinking(false); }
  };

  if (selected) {
    return (
      <ChildDetail
        child={selected}
        onBack={() => setSelected(null)}
        onDelete={() => { onDeleteData(); setSelected(null); }}
      />
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 480, margin: '0 auto', fontFamily: 'inherit' }}>
      <button onClick={onBack} style={backBtn}>← Retour</button>
      <h2 style={{ color: '#085041', marginBottom: '0.25rem' }}>Espace parent 👨‍👩‍👧</h2>
      <p style={{ fontSize: '0.8rem', color: '#888780', marginBottom: '1.5rem' }}>
        Suivez les progrès de votre enfant
      </p>

      {/* Lier un enfant */}
      <div style={{
        background: '#F8F7F4', borderRadius: 12, padding: '1.25rem',
        marginBottom: '1.5rem', border: '1px solid #E8E8E6',
      }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#085041', marginBottom: 4 }}>
          Lier un enfant
        </div>
        <p style={{ fontSize: '0.8rem', color: '#888780', marginBottom: '0.875rem', lineHeight: 1.5 }}>
          Entrez l'identifiant élève fourni par l'enseignant.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" value={childIdInput}
            onChange={e => { setChildIdInput(e.target.value); setLinkError(''); }}
            placeholder="Identifiant élève (UUID)"
            style={{
              flex: 1, padding: '0.6rem 0.875rem',
              border: `1px solid ${linkError ? '#F09595' : '#D3D1C7'}`,
              borderRadius: 8, fontSize: '0.85rem', outline: 'none',
            }}
          />
          <button
            onClick={handleLink}
            disabled={!childIdInput.trim() || linking}
            style={{
              padding: '0.6rem 1rem',
              background: childIdInput.trim() ? '#1D9E75' : '#D3D1C7',
              color: '#fff', border: 'none', borderRadius: 8,
              cursor: childIdInput.trim() ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem', fontWeight: 500,
            }}
          >
            {linking ? '...' : 'Lier'}
          </button>
        </div>
        {linkError && (
          <div style={{
            marginTop: 6, fontSize: '0.8rem', color: '#A32D2D',
            background: '#FCEBEB', borderRadius: 6, padding: '0.5rem 0.75rem',
          }}>{linkError}</div>
        )}
      </div>

      {/* Liste enfants */}
      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#085041', marginBottom: '0.75rem' }}>
        Mes enfants ({children.length})
      </div>
      {children.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '2rem', background: '#FAFAF8',
          borderRadius: 12, border: '1.5px dashed #D3D1C7',
          color: '#B4B2A9', fontSize: '0.875rem',
        }}>
          Aucun enfant lié — entrez l'identifiant ci-dessus
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {children.map(child => {
            const hasConsent = consentMgr.canUseEyeTracking(child.id);
            const rec = getRecommendedDuration(child.age);
            return (
              <div
                key={child.id}
                onClick={() => setSelected(child)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.875rem',
                  padding: '0.875rem 1rem', border: '1px solid #D3D1C7',
                  borderRadius: 12, background: '#fff', cursor: 'pointer', transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#1D9E75')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#D3D1C7')}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', background: '#E1F5EE',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 600, color: '#085041', fontSize: '1rem',
                }}>
                  {child.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: '0.95rem' }}>{child.name}</div>
                  <div style={{ fontSize: '0.78rem', color: '#888780', marginTop: 1 }}>
                    {child.age} ans · max {rec.label} · {child.language === 'ar' ? 'Arabe' : 'Français'}
                  </div>
                </div>
                <span style={{
                  fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99,
                  background: hasConsent ? '#E1F5EE' : '#FCEBEB',
                  color: hasConsent ? '#085041' : '#A32D2D', fontWeight: 500,
                }}>
                  {hasConsent ? '📷 Autorisé' : '📷 À autoriser'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const backBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#888780', fontSize: '0.9rem', marginBottom: '1rem', padding: 0,
};