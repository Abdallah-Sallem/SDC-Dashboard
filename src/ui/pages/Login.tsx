import { useState, FC } from 'react';
import { authManager }  from '../../auth/AuthManager';
import type { UserRole } from '../../shared/types';

type LoginMode = 'pin' | 'password';
type RegRole   = 'parent' | 'teacher';

interface LoginProps {
  onSuccess: (role: UserRole, userId: string) => void;
}

export const Login: FC<LoginProps> = ({ onSuccess }) => {
  const [mode,     setMode]    = useState<LoginMode>('password');
  const [regRole,  setRegRole] = useState<RegRole>('parent');
  const [isReg,    setIsReg]   = useState(false);

  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [name,      setName]      = useState('');
  const [studentId, setStudentId] = useState('');
  const [pin,       setPin]       = useState('');

  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setError(''); setEmail(''); setPassword('');
    setName(''); setStudentId(''); setPin('');
  };

  // ── Connexion ────────────────────────────────────────────────────
  const handleLogin = async () => {
    setLoading(true); setError('');
    try {
      const result = mode === 'pin'
        ? await authManager.loginWithPIN(studentId, pin)
        : await authManager.loginWithPassword(email, password);

      if (result.success) {
        onSuccess(authManager.getCurrentRole()!, authManager.getCurrentUserId()!);
      } else {
        setError(result.error ?? 'Erreur de connexion');
      }
    } catch { setError('Une erreur est survenue'); }
    finally  { setLoading(false); }
  };

  // ── Inscription (parent / enseignant seulement) ──────────────────
  const handleRegister = async () => {
    setLoading(true); setError('');
    try {
      if (regRole === 'teacher') {
        await authManager.createTeacherAccount(email, password, name);
      } else {
        await authManager.createParentAccount(email, password, name);
      }
      const result = await authManager.loginWithPassword(email, password);
      if (result.success) {
        onSuccess(authManager.getCurrentRole()!, authManager.getCurrentUserId()!);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création compte');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '3rem 1.5rem', fontFamily: 'inherit' }}>

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, background: '#E1F5EE',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, margin: '0 auto 0.75rem',
        }}>ق</div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: '#085041', margin: 0 }}>
          Qalam-Sense
        </h1>
        <p style={{ color: '#888780', fontSize: '0.875rem', marginTop: 4 }}>
          {isReg ? 'Créer un compte' : 'Connexion à votre compte'}
        </p>
      </div>

      {/* Toggle connexion / inscription — masqué pour élève */}
      {mode === 'password' && (
        <div style={{
          display: 'flex', background: '#F1EFE8',
          borderRadius: 10, padding: 4, marginBottom: '1.5rem',
        }}>
          {[false, true].map((reg) => (
            <button key={String(reg)}
              onClick={() => { setIsReg(reg); reset(); }}
              style={{
                flex: 1, padding: '0.5rem', border: 'none', borderRadius: 8,
                background: isReg === reg ? '#FFFFFF' : 'transparent',
                color: isReg === reg ? '#085041' : '#888780',
                fontWeight: isReg === reg ? 500 : 400,
                cursor: 'pointer', fontSize: '0.875rem',
              }}>
              {reg ? 'Créer un compte' : 'Se connecter'}
            </button>
          ))}
        </div>
      )}

      {/* Toggle PIN / mot de passe */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
        <button onClick={() => { setMode('password'); setIsReg(false); reset(); }} style={{
          flex: 1, padding: '0.5rem',
          border: `1.5px solid ${mode === 'password' ? '#1D9E75' : '#D3D1C7'}`,
          borderRadius: 8,
          background: mode === 'password' ? '#E1F5EE' : 'transparent',
          color: mode === 'password' ? '#085041' : '#888780',
          cursor: 'pointer', fontSize: '0.85rem',
          fontWeight: mode === 'password' ? 500 : 400,
        }}>
          Parent / Enseignant
        </button>
        <button onClick={() => { setMode('pin'); setIsReg(false); reset(); }} style={{
          flex: 1, padding: '0.5rem',
          border: `1.5px solid ${mode === 'pin' ? '#1D9E75' : '#D3D1C7'}`,
          borderRadius: 8,
          background: mode === 'pin' ? '#E1F5EE' : 'transparent',
          color: mode === 'pin' ? '#085041' : '#888780',
          cursor: 'pointer', fontSize: '0.85rem',
          fontWeight: mode === 'pin' ? 500 : 400,
        }}>
          Élève (PIN)
        </button>
      </div>

      {/* ── Formulaire élève PIN (connexion uniquement) ──────────── */}
      {mode === 'pin' && (
        <div>
          <div style={{
            padding: '0.75rem 1rem', background: '#F1EFE8',
            borderRadius: 8, marginBottom: '1.25rem',
            fontSize: '0.82rem', color: '#5F5E5A', lineHeight: 1.5,
          }}>
            👋 Ton identifiant et ton PIN t'ont été donnés par ton enseignant ou ton parent.
          </div>

          <div style={{ marginBottom: '0.875rem' }}>
            <label style={labelStyle}>Identifiant élève</label>
            <input type="text" value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="Ton identifiant"
              style={inputStyle} />
          </div>

          <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
            <label style={{ ...labelStyle, display: 'block', marginBottom: '0.75rem' }}>
              Code PIN (4 chiffres)
            </label>
            <input
              type="password" inputMode="numeric" maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              style={{
                width: 120, padding: '0.75rem',
                border: '2px solid #D3D1C7', borderRadius: 12,
                fontSize: '1.8rem', textAlign: 'center',
                letterSpacing: '0.5rem', outline: 'none',
              }}
            />
          </div>
        </div>
      )}

      {/* ── Formulaire parent / enseignant ──────────────────────── */}
      {mode === 'password' && (
        <div>
          {isReg && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Je suis</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['parent', 'teacher'] as RegRole[]).map((r) => (
                  <button key={r} onClick={() => setRegRole(r)} style={{
                    flex: 1, padding: '0.5rem',
                    border: `1.5px solid ${regRole === r ? '#1D9E75' : '#D3D1C7'}`,
                    borderRadius: 8,
                    background: regRole === r ? '#E1F5EE' : 'transparent',
                    color: regRole === r ? '#085041' : '#888780',
                    cursor: 'pointer', fontSize: '0.85rem',
                    fontWeight: regRole === r ? 500 : 400,
                  }}>
                    {r === 'parent' ? '👨‍👩‍👧 Parent' : '🏫 Enseignant'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isReg && (
            <div style={{ marginBottom: '0.875rem' }}>
              <label style={labelStyle}>Votre prénom</label>
              <input type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex : Fatima" style={inputStyle} />
            </div>
          )}

          <div style={{ marginBottom: '0.875rem' }}>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="exemple@email.com" style={inputStyle} />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>
              {isReg ? 'Mot de passe (6 caractères min.)' : 'Mot de passe'}
            </label>
            <input type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" style={inputStyle} />
          </div>
        </div>
      )}

      {/* Erreur */}
      {error && (
        <div style={{
          padding: '0.6rem 0.875rem', background: '#FCEBEB',
          color: '#A32D2D', borderRadius: 8,
          fontSize: '0.875rem', marginBottom: '1rem', lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      {/* Bouton principal */}
      <button
        onClick={isReg ? handleRegister : handleLogin}
        disabled={loading}
        style={{
          width: '100%', padding: '0.75rem',
          background: loading ? '#B4B2A9' : '#1D9E75',
          color: '#FFFFFF', border: 'none', borderRadius: 10,
          fontWeight: 500, fontSize: '0.95rem',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Chargement…' : isReg ? 'Créer mon compte' : 'Se connecter'}
      </button>

      <p style={{
        textAlign: 'center', fontSize: '0.75rem',
        color: '#B4B2A9', marginTop: '1.25rem', lineHeight: 1.5,
      }}>
        Vos données sont stockées uniquement sur cet appareil.<br />
        Aucune information personnelle n'est envoyée sur internet.
      </p>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.85rem',
  fontWeight: 500, color: '#444441', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem',
  border: '1px solid #D3D1C7', borderRadius: 8,
  fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
};