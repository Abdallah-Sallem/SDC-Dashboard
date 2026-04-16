import { useState, FC } from 'react';
import { Charts }      from './Charts';
import { TextUpload }  from './TextUpload';
import { authManager } from '../../../auth/AuthManager';
import type { TeacherText } from '../../../shared/types';

type TeacherTab = 'overview' | 'texts' | 'students';

interface ClassStats {
  studentCount:            number;
  avgDifficultyByLanguage: { ar: number; fr: number };
  adaptationUsagePercent:  number;
  sessionsThisWeek:        number;
}

interface CreatedStudent {
  id:       string;
  name:     string;
  pin:      string;
  age:      number;        // ✅ AJOUT
  language: string;        // ✅ AJOUT
}

interface TeacherViewProps {
  classStats?:    ClassStats;
  texts:          TeacherText[];
  onTextUploaded: (text: Omit<TeacherText, 'id' | 'uploadedAt'>) => void;
  onAssignText:   (textId: string, studentIds: string[]) => void;
  onBack:         () => void;
}

const DEFAULT_STATS: ClassStats = {
  studentCount:            28,
  avgDifficultyByLanguage: { ar: 0.35, fr: 0.42 },
  adaptationUsagePercent:  65,
  sessionsThisWeek:        142,
};

const generatePIN = (): string =>
  String(Math.floor(1000 + Math.random() * 9000));

const STORAGE_STUDENTS = 'qs_created_students';

function loadStudents(): CreatedStudent[] {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENTS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStudents(students: CreatedStudent[]): void {
  localStorage.setItem(STORAGE_STUDENTS, JSON.stringify(students));
}

export const TeacherView: FC<TeacherViewProps> = ({
  classStats = DEFAULT_STATS,
  texts,
  onTextUploaded,
  onAssignText,
  onBack,
}) => {
  const [activeTab,        setActiveTab]        = useState<TeacherTab>('overview');
  const [studentName,      setStudentName]      = useState('');
  const [studentAge,       setStudentAge]       = useState<number>(10);   // ✅ AJOUT
  const [studentLanguage,  setStudentLanguage]  = useState<'fr' | 'ar' | 'mixed'>('fr'); // ✅ AJOUT
  const [createdStudents,  setCreatedStudents]  = useState<CreatedStudent[]>(loadStudents);
  const [creating,         setCreating]         = useState(false);
  const [copiedId,         setCopiedId]         = useState<string | null>(null);

  const [assigningText,     setAssigningText]    = useState<TeacherText | null>(null);
  const [selectedStudents,  setSelectedStudents] = useState<string[]>([]);

  const tabStyle = (tab: TeacherTab): React.CSSProperties => ({
    padding:      '0.5rem 1.1rem',
    border:       'none',
    borderBottom: activeTab === tab ? '2px solid #1D9E75' : '2px solid transparent',
    background:   'transparent',
    cursor:       'pointer',
    fontWeight:   activeTab === tab ? 500 : 400,
    color:        activeTab === tab ? '#085041' : '#888780',
    fontSize:     '0.9rem',
    transition:   'all 0.15s',
  });

  // ✅ Créer un élève avec âge et langue
  const handleCreateStudent = async () => {
    if (!studentName.trim()) return;
    setCreating(true);
    try {
      const pin = generatePIN();
      const id  = crypto.randomUUID();
      await authManager.createStudentAccount(id, studentName.trim(), pin);

      const newStudent: CreatedStudent = {
        id,
        name:     studentName.trim(),
        pin,
        age:      studentAge,
        language: studentLanguage,
      };

      const updated = [...createdStudents, newStudent];
      setCreatedStudents(updated);
      saveStudents(updated);

      // Réinitialiser le formulaire
      setStudentName('');
      setStudentAge(10);
      setStudentLanguage('fr');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur création élève');
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (student: CreatedStudent) => {
    navigator.clipboard.writeText(
      `Identifiant : ${student.id}\nPIN : ${student.pin}`
    );
    setCopiedId(student.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openAssign = (text: TeacherText) => {
    setAssigningText(text);
    setSelectedStudents(text.assignedStudentIds ?? []);
  };

  const toggleStudent = (id: string) => {
    setSelectedStudents(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleConfirmAssign = () => {
    if (!assigningText) return;
    onAssignText(assigningText.id, selectedStudents);
    setAssigningText(null);
  };

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'inherit', maxWidth: 700, margin: '0 auto' }}>

      <button onClick={onBack} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: '#888780', fontSize: '0.9rem', marginBottom: '1.25rem', padding: 0,
      }}>← Retour</button>

      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#085041', margin: 0 }}>
          Tableau de bord enseignant
        </h2>
        <p style={{ fontSize: '0.8rem', color: '#B4B2A9', marginTop: 2 }}>
          Données anonymisées — aucun profil individuel visible
        </p>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E8E8E6', marginBottom: '1.25rem' }}>
        <button style={tabStyle('overview')}  onClick={() => setActiveTab('overview')}>Vue d'ensemble</button>
        <button style={tabStyle('texts')}     onClick={() => setActiveTab('texts')}>Textes</button>
        <button style={tabStyle('students')}  onClick={() => setActiveTab('students')}>Mes élèves</button>
      </div>

      {/* ── Vue d'ensemble ─────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: '1.25rem' }}>
            {[
              { label: 'Élèves créés',           value: String(createdStudents.length) },
              { label: 'Sessions cette semaine',  value: String(classStats.sessionsThisWeek) },
              { label: 'Élèves avec adaptations', value: `${classStats.adaptationUsagePercent}%` },
              { label: 'Textes uploadés',         value: String(texts.length) },
            ].map((m) => (
              <div key={m.label} style={{ background: '#F1EFE8', borderRadius: 10, padding: '0.875rem 1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#888780', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 500, color: '#085041' }}>{m.value}</div>
              </div>
            ))}
          </div>
          <Charts
            arDifficulty={classStats.avgDifficultyByLanguage.ar}
            frDifficulty={classStats.avgDifficultyByLanguage.fr}
          />
        </>
      )}

      {/* ── Textes ─────────────────────────────────────────── */}
      {activeTab === 'texts' && (
        <div>
          <TextUpload onUploaded={onTextUploaded} />
          {texts.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#085041', marginBottom: '0.875rem' }}>
                Textes uploadés
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {texts.map((t) => {
                  const assignedNames = createdStudents
                    .filter(s => (t.assignedStudentIds ?? []).includes(s.id))
                    .map(s => s.name);
                  return (
                    <div key={t.id} style={{
                      padding: '0.875rem 1rem', border: '1px solid #E8E8E6',
                      borderRadius: 10, background: '#fff',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.9rem', color: '#085041' }}>{t.title}</div>
                          <div style={{ fontSize: '0.78rem', color: '#888780', marginTop: 2 }}>
                            {t.language === 'ar' ? 'Arabe' : 'Français'} · {t.targetAge} ans
                          </div>
                          <div style={{ marginTop: 6 }}>
                            {assignedNames.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {assignedNames.map(name => (
                                  <span key={name} style={{
                                    fontSize: '0.72rem', padding: '2px 8px',
                                    background: '#E1F5EE', color: '#085041',
                                    borderRadius: 99, fontWeight: 500,
                                  }}>{name}</span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#B4B2A9' }}>Non assigné</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => openAssign(t)}
                          disabled={createdStudents.length === 0}
                          style={{
                            padding: '0.4rem 0.875rem', border: '1px solid #1D9E75',
                            borderRadius: 8, background: '#E1F5EE', color: '#085041',
                            cursor: createdStudents.length > 0 ? 'pointer' : 'not-allowed',
                            fontSize: '0.8rem', fontWeight: 500,
                            whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 12,
                          }}
                        >Assigner</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Mes élèves ─────────────────────────────────────── */}
      {activeTab === 'students' && (
        <div>
          <p style={{ fontSize: '0.875rem', color: '#5F5E5A', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Créez un compte pour chaque élève. L'identifiant et le PIN sont à remettre à l'élève et à son parent.
          </p>

          {/* ✅ Formulaire enrichi avec âge + langue */}
          <div style={{
            background: '#F8F7F4', borderRadius: 12,
            padding: '1.25rem', marginBottom: '1.5rem',
            border: '1px solid #E8E8E6',
          }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#085041', marginBottom: '1rem' }}>
              Nouvel élève
            </div>

            {/* Prénom */}
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>Prénom</label>
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateStudent()}
                placeholder="Ex : Yasmine"
                style={inputStyle}
              />
            </div>

            {/* Âge + Langue sur la même ligne */}
            <div style={{ display: 'flex', gap: 12, marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Âge</label>
                <input
                  type="number"
                  min={5} max={18}
                  value={studentAge}
                  onChange={(e) => setStudentAge(Number(e.target.value))}
                  style={{ ...inputStyle, textAlign: 'center' }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={labelStyle}>Langue principale</label>
                <select
                  value={studentLanguage}
                  onChange={(e) => setStudentLanguage(e.target.value as 'fr' | 'ar' | 'mixed')}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="fr">Français</option>
                  <option value="ar">Arabe (عربي)</option>
                  <option value="mixed">Bilingue (AR/FR)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleCreateStudent}
              disabled={!studentName.trim() || creating}
              style={{
                width: '100%', padding: '0.6rem',
                background: studentName.trim() ? '#1D9E75' : '#D3D1C7',
                color: '#fff', border: 'none', borderRadius: 8,
                fontWeight: 500, fontSize: '0.9rem',
                cursor: studentName.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {creating ? 'Création...' : '+ Créer le compte élève'}
            </button>
          </div>

          {/* Liste élèves */}
          {createdStudents.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '2rem',
              background: '#FAFAF8', borderRadius: 12,
              border: '1.5px dashed #D3D1C7', color: '#B4B2A9', fontSize: '0.875rem',
            }}>
              Aucun élève créé pour l'instant
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {createdStudents.map((s) => (
                <div key={s.id} style={{
                  padding: '0.875rem 1rem',
                  background: '#fff', border: '1px solid #E8E8E6', borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#085041' }}>
                        {s.name}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#888780', marginLeft: 8 }}>
                        {s.age} ans · {s.language === 'ar' ? 'Arabe' : s.language === 'fr' ? 'Français' : 'Bilingue'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: '1rem', fontWeight: 700, color: '#1D9E75',
                        fontFamily: 'monospace', letterSpacing: '0.15rem',
                      }}>
                        PIN : {s.pin}
                      </span>
                      <button
                        onClick={() => copyToClipboard(s)}
                        style={{
                          padding: '0.35rem 0.6rem',
                          border: '1px solid #D3D1C7', borderRadius: 6,
                          background: copiedId === s.id ? '#E1F5EE' : 'transparent',
                          color: copiedId === s.id ? '#085041' : '#5F5E5A',
                          cursor: 'pointer', fontSize: '0.78rem',
                        }}
                      >
                        {copiedId === s.id ? '✓ Copié' : 'Copier ID+PIN'}
                      </button>
                    </div>
                  </div>
                  <div style={{
                    fontSize: '0.72rem', color: '#5F5E5A', fontFamily: 'monospace',
                    background: '#F1EFE8', borderRadius: 6, padding: '3px 8px',
                    overflowX: 'auto', whiteSpace: 'nowrap',
                  }}>
                    ID : {s.id}
                  </div>
                </div>
              ))}
              <p style={{ fontSize: '0.78rem', color: '#B4B2A9', marginTop: 4, lineHeight: 1.5 }}>
                ⚠️ Notez bien les PINs — ils ne sont pas récupérables.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Modal assignation ───────────────────────────────── */}
      {assigningText && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 200,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16,
            padding: '1.5rem', width: 360, maxWidth: '90vw',
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#085041', marginBottom: 4 }}>
              Assigner "{assigningText.title}"
            </h3>
            <p style={{ fontSize: '0.8rem', color: '#888780', marginBottom: '1rem' }}>
              Sélectionnez les élèves qui liront ce texte
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1.25rem' }}>
              {createdStudents.map((s) => (
                <label key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '0.6rem 0.875rem',
                  border: `1.5px solid ${selectedStudents.includes(s.id) ? '#1D9E75' : '#E8E8E6'}`,
                  borderRadius: 8, cursor: 'pointer',
                  background: selectedStudents.includes(s.id) ? '#F0FBF6' : '#fff',
                  transition: 'all 0.15s',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedStudents.includes(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    style={{ accentColor: '#1D9E75', width: 16, height: 16 }}
                  />
                  <span style={{ fontWeight: 500, fontSize: '0.9rem', color: '#085041' }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: '#888780', marginLeft: 'auto' }}>
                    {s.age} ans
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAssigningText(null)} style={{
                flex: 1, padding: '0.6rem', border: '1px solid #D3D1C7',
                borderRadius: 8, background: 'transparent', cursor: 'pointer',
                fontSize: '0.9rem', color: '#5F5E5A',
              }}>Annuler</button>
              <button onClick={handleConfirmAssign} style={{
                flex: 1, padding: '0.6rem', border: 'none', borderRadius: 8,
                background: '#1D9E75', color: '#fff',
                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
              }}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem',
  fontWeight: 500, color: '#444441', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.55rem 0.75rem',
  border: '1px solid #D3D1C7', borderRadius: 8,
  fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
};