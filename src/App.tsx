import { useState, useEffect, FC } from 'react';
import { Login }           from './ui/pages/Login';
import { Home }            from './ui/pages/Home';
import { Reader }          from './ui/pages/Reader';
import { Profile }         from './ui/pages/Profile';
import { Settings }        from './ui/pages/Settings';
import { TeacherView }     from './ui/components/dashboard/TeacherView';
import { ParentDashboard } from './ui/components/dashboard/ParentDashboard';
import { authManager }     from './auth/AuthManager';
import type { StudentProfile, TeacherText, UserRole, ParentProfile } from './shared/types';

type Page =
  | 'login' | 'home' | 'text-select'
  | 'reader' | 'profile' | 'settings'
  | 'teacher' | 'parent-dashboard';

const STORAGE_TEXTS    = 'qs_teacher_texts';
const STORAGE_PROFILES = 'qs_student_profiles';
const STORAGE_STUDENTS = 'qs_created_students';

// ─── Helpers storage ─────────────────────────────────────────────────────────

function loadFromStorage<T>(key: string): T[] {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; }
  catch { return []; }
}

function saveToStorage<T>(key: string, data: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /**/ }
}

// ✅ Récupère les métadonnées (âge, langue) saisies par le prof pour un élève
function getStudentMeta(childId: string): { age: number; language: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENTS);
    if (!raw) return null;
    const list: { id: string; age: number; language: string }[] = JSON.parse(raw);
    return list.find(s => s.id === childId) ?? null;
  } catch { return null; }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export const App: FC = () => {
  const [page,          setPage]         = useState<Page>('login');
  const [role,          setRole]         = useState<UserRole | null>(null);
  const [profiles,      setProfiles]     = useState<StudentProfile[]>(() => loadFromStorage(STORAGE_PROFILES));
  const [parent,        setParent]       = useState<ParentProfile | null>(null);
  const [activeProfile, setActive]       = useState<StudentProfile | null>(null);
  const [activeText,    setText]         = useState<TeacherText | null>(null);
  const [teacherTexts,  setTeacherTexts] = useState<TeacherText[]>(() => loadFromStorage(STORAGE_TEXTS));

  useEffect(() => { saveToStorage(STORAGE_TEXTS,    teacherTexts); }, [teacherTexts]);
  useEffect(() => { saveToStorage(STORAGE_PROFILES, profiles);     }, [profiles]);

  // ── Déconnexion ───────────────────────────────────────────────
  const handleLogout = () => {
    authManager.logout();
    setRole(null); setActive(null); setText(null); setParent(null);
    setPage('login');
  };

  // ── Connexion réussie ─────────────────────────────────────────
  const handleLoginSuccess = (userRole: UserRole, userId: string) => {
    setRole(userRole);

    if (userRole === 'teacher') {
      setPage('teacher');
      return;
    }

    if (userRole === 'parent') {
      setParent({
        id:          userId,
        name:        authManager.getCurrentName(),
        childrenIds: authManager.getAccount(userId)?.linkedIds ?? [],
        createdAt:   new Date(),
      });
      setPage('parent-dashboard');
      return;
    }

    if (userRole === 'student') {
      const existing = profiles.find(p => p.id === userId);
      if (existing) {
        setActive(existing);
      } else {
        // ✅ Récupérer âge + langue depuis les données du prof
        const meta = getStudentMeta(userId);
        const p: StudentProfile = {
          id:                   userId,
          name:                 authManager.getCurrentName(),
          age:                  meta?.age      ?? 10,
          language:             (meta?.language ?? 'fr') as any,
          neurodivergenceTypes: ['unknown'],
          adaptationThreshold:  0.6,
          preferredFont:        'inherit',
          createdAt:            new Date(),
          updatedAt:            new Date(),
        };
        setProfiles(prev => [...prev, p]);
        setActive(p);
      }
      setPage('text-select');
    }
  };

  // ── Assigner un texte à des élèves ────────────────────────────
  const handleAssignText = (textId: string, studentIds: string[]) => {
    setTeacherTexts(prev => prev.map(t =>
      t.id === textId ? { ...t, assignedStudentIds: studentIds } : t
    ));
  };

  // ── Parent lie un enfant par son ID ──────────────────────────
  const handleLinkChild = (childId: string) => {
    const account = authManager.getAccount(childId);
    if (!account) return;

    // ✅ Récupérer âge + langue depuis les données saisies par le prof
    const meta = getStudentMeta(childId);

    if (!profiles.find(p => p.id === childId)) {
      const childProfile: StudentProfile = {
        id:                   childId,
        name:                 account.displayName,
        age:                  meta?.age      ?? 10,       // ✅ âge réel
        language:             (meta?.language ?? 'fr') as any, // ✅ langue réelle
        neurodivergenceTypes: ['unknown'],
        adaptationThreshold:  0.6,
        preferredFont:        'inherit',
        parentId:             parent?.id,
        createdAt:            new Date(),
        updatedAt:            new Date(),
      };
      setProfiles(prev => [...prev, childProfile]);
    } else {
      // Profil existant — mettre à jour parentId + corriger âge/langue si nécessaire
      setProfiles(prev => prev.map(p =>
        p.id === childId
          ? {
              ...p,
              parentId: parent?.id,
              age:      meta?.age      ?? p.age,
              language: (meta?.language ?? p.language) as any,
            }
          : p
      ));
    }

    if (parent) {
      setParent({ ...parent, childrenIds: [...parent.childrenIds, childId] });
    }
  };

  // ── LOGIN ─────────────────────────────────────────────────────
  if (page === 'login') return <Login onSuccess={handleLoginSuccess} />;

  // ── ENSEIGNANT ────────────────────────────────────────────────
  if (page === 'teacher') return (
    <div>
      <TopBar name={authManager.getCurrentName()} role="teacher" onLogout={handleLogout} />
      <TeacherView
        texts={teacherTexts}
        onTextUploaded={(data) => {
          const full: TeacherText = {
            ...data,
            id:         crypto.randomUUID(),
            uploadedAt: new Date(),
          };
          setTeacherTexts(prev => [...prev, full]);
        }}
        onAssignText={handleAssignText}
        onBack={handleLogout}
      />
    </div>
  );

  // ── ÉLÈVE : sélection texte ───────────────────────────────────
  if (page === 'text-select' && activeProfile) {
    const myTexts = teacherTexts.filter(t =>
      (t.assignedStudentIds ?? []).includes(activeProfile.id)
    );
    return (
      <div style={{ fontFamily: 'inherit' }}>
        <TopBar name={authManager.getCurrentName()} role="student" onLogout={handleLogout} />
        <TextSelectScreen
          studentName={activeProfile.name}
          texts={myTexts}
          onSelectText={(t) => { setText(t); setPage('reader'); }}
        />
      </div>
    );
  }

  // ── LECTEUR ───────────────────────────────────────────────────
  if (page === 'reader' && activeProfile && activeText) return (
    <Reader
      profile={activeProfile}
      text={activeText}
      onExit={() => setPage('text-select')}
    />
  );

  // ── PARENT DASHBOARD ──────────────────────────────────────────
  if (page === 'parent-dashboard') return (
    <div style={{ fontFamily: 'inherit' }}>
      <TopBar name={authManager.getCurrentName()} role="parent" onLogout={handleLogout} />
      <ParentDashboard
        children={parent ? profiles.filter(p => p.parentId === parent.id) : []}
        onLinkChild={handleLinkChild}
        onDeleteData={() => alert('Suppression à implémenter')}
        onBack={handleLogout}
      />
    </div>
  );

  // ── SETTINGS ──────────────────────────────────────────────────
  if (page === 'settings' && activeProfile) return (
    <div style={{ fontFamily: 'inherit' }}>
      <TopBar name={authManager.getCurrentName()} role={role ?? 'student'} onLogout={handleLogout} />
      <Settings
        profile={activeProfile}
        onUpdate={(u) => setActive(p => p ? { ...p, ...u } : p)}
        onRevokeConsent={() => setPage('home')}
        onBack={() => setPage('home')}
      />
    </div>
  );

  return <Login onSuccess={handleLoginSuccess} />;
};

// ── TextSelectScreen ──────────────────────────────────────────────────────────

const TextSelectScreen: FC<{
  studentName: string;
  texts:       TeacherText[];
  onSelectText:(t: TeacherText) => void;
}> = ({ studentName, texts, onSelectText }) => (
  <div style={{ maxWidth: 480, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'inherit' }}>
    <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16, background: '#E1F5EE',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: '0.75rem',
      }}>ق</div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: '#085041' }}>
        Bonjour, {studentName} 👋
      </h1>
      <p style={{ color: '#888780', fontSize: '0.9rem', marginTop: 4 }}>
        Quel texte veux-tu lire aujourd'hui ?
      </p>
    </div>

    {texts.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {texts.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectText(t)}
            style={{
              display: 'flex', alignItems: 'center', gap: '1rem',
              padding: '1rem 1.25rem', border: '1.5px solid #D3D1C7',
              borderRadius: 14, background: '#fff', cursor: 'pointer', textAlign: 'left',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#1D9E75';
              e.currentTarget.style.boxShadow   = '0 2px 8px rgba(29,158,117,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#D3D1C7';
              e.currentTarget.style.boxShadow   = 'none';
            }}
          >
            <span style={{ fontSize: 28 }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#085041' }}>
                {t.title}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#888780', marginTop: 2 }}>
                {t.language === 'ar' ? 'Arabe' : 'Français'}
                {t.difficulty ? ` · ${t.difficulty}` : ''}
                {` · Pour ${t.targetAge} ans`}
              </div>
            </div>
            <span style={{ color: '#1D9E75', fontWeight: 500, fontSize: '0.85rem' }}>Lire →</span>
          </button>
        ))}
      </div>
    ) : (
      <div style={{
        textAlign: 'center', padding: '3rem 1rem',
        background: '#FAFAF8', borderRadius: 16, border: '1.5px dashed #D3D1C7',
      }}>
        <div style={{ fontSize: 40, marginBottom: '0.75rem' }}>⏳</div>
        <div style={{ fontWeight: 500, color: '#444441', marginBottom: 4 }}>
          Pas encore de texte disponible
        </div>
        <div style={{ fontSize: '0.85rem', color: '#888780' }}>
          Ton enseignant n'a pas encore assigné de texte.
        </div>
      </div>
    )}
  </div>
);

// ── TopBar ────────────────────────────────────────────────────────────────────

const roleLabels: Record<UserRole, string> = {
  student: 'Élève',
  parent:  'Parent',
  teacher: 'Enseignant',
  admin:   'Administrateur',
};

const TopBar: FC<{ name: string; role: UserRole; onLogout: () => void }> = ({
  name, role, onLogout,
}) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.6rem 1.25rem', background: '#FFFFFF',
    borderBottom: '1px solid #E8E8E6', position: 'sticky', top: 0, zIndex: 100,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: '#E1F5EE',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 600, color: '#085041',
      }}>ق</div>
      <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#085041' }}>Qalam-Sense</span>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1A1A1A' }}>{name}</div>
        <div style={{ fontSize: '0.75rem', color: '#888780' }}>{roleLabels[role]}</div>
      </div>
      <button
        onClick={onLogout}
        style={{
          padding: '0.4rem 0.875rem', border: '1px solid #D3D1C7',
          borderRadius: 8, background: 'transparent', cursor: 'pointer',
          fontSize: '0.8rem', color: '#5F5E5A',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background  = '#FCEBEB';
          e.currentTarget.style.borderColor = '#F09595';
          e.currentTarget.style.color       = '#A32D2D';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background  = 'transparent';
          e.currentTarget.style.borderColor = '#D3D1C7';
          e.currentTarget.style.color       = '#5F5E5A';
        }}
      >
        Déconnexion
      </button>
    </div>
  </div>
);