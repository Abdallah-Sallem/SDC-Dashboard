/**
 * AuthManager.ts
 * RÔLE : Gestion complète de l'authentification.
 * - Élève     → PIN 4 chiffres
 * - Parent    → email + mot de passe
 * - Enseignant→ email + mot de passe
 * Les mots de passe sont hashés (SHA-256 + sel) — jamais stockés en clair.
 * Les sessions expirent automatiquement.
 */

import { PasswordHasher } from './PasswordHasher';
import type { UserRole }  from '../shared/types';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface UserAccount {
  id:           string;
  role:         UserRole;
  email?:       string;      // Parents, enseignants
  displayName:  string;      // Prénom affiché
  passwordHash: string;      // SHA-256 + sel — jamais le mot de passe
  salt:         string;      // Sel unique par compte
  linkedIds:    string[];    // Parent → IDs enfants / Enseignant → IDs élèves
  createdAt:    string;
}

export interface AuthSession {
  userId:    string;
  role:      UserRole;
  name:      string;
  expiresAt: number;         // Timestamp expiration
}

// ─── Durées de session ────────────────────────────────────────────────────────

const SESSION_DURATION: Record<UserRole, number> = {
  student: 4  * 60 * 60 * 1000,   // 4 heures
  parent:  8  * 60 * 60 * 1000,   // 8 heures
  teacher: 10 * 60 * 60 * 1000,   // 10 heures
  admin:   2  * 60 * 60 * 1000,   // 2 heures
};

const STORAGE_KEY_ACCOUNTS = 'qs_accounts';
const STORAGE_KEY_SESSION  = 'qs_session';

// ─── Classe principale ────────────────────────────────────────────────────────

export class AuthManager {
  private accounts: Map<string, UserAccount> = new Map();
  private session:  AuthSession | null = null;

  constructor() {
    this.loadAccounts();
    this.loadSession();
  }

  // ── Connexion ───────────────────────────────────────────────────────────────

  /**
   * Connexion par email + mot de passe (parent, enseignant)
   */
  async loginWithPassword(
    email:    string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    const account = this.findByEmail(email);
    if (!account) {
      return { success: false, error: 'Email introuvable' };
    }

    const valid = await PasswordHasher.verify(
      password,
      account.salt,
      account.passwordHash
    );

    if (!valid) {
      return { success: false, error: 'Mot de passe incorrect' };
    }

    this.createSession(account);
    return { success: true };
  }

  /**
   * Connexion élève par ID + PIN
   */
  async loginWithPIN(
    studentId: string,
    pin:       string
  ): Promise<{ success: boolean; error?: string }> {
    // Valider format PIN
    if (!/^\d{4}$/.test(pin)) {
      return { success: false, error: 'Le PIN doit contenir 4 chiffres' };
    }

    const account = this.accounts.get(studentId);
    if (!account || account.role !== 'student') {
      return { success: false, error: 'Élève introuvable' };
    }

    const valid = await PasswordHasher.verify(
      pin,
      account.salt,
      account.passwordHash
    );

    if (!valid) {
      return { success: false, error: 'PIN incorrect' };
    }

    this.createSession(account);
    return { success: true };
  }

  // ── Création de comptes ─────────────────────────────────────────────────────

  /**
   * Crée un compte élève avec PIN
   */
  async createStudentAccount(
    studentId:   string,
    displayName: string,
    pin:         string
  ): Promise<UserAccount> {
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('Le PIN doit contenir exactement 4 chiffres');
    }

    const salt         = PasswordHasher.generateSalt();
    const passwordHash = await PasswordHasher.hash(pin, salt);

    const account: UserAccount = {
      id:          studentId,
      role:        'student',
      displayName,
      passwordHash,
      salt,
      linkedIds:   [],
      createdAt:   new Date().toISOString(),
    };

    this.accounts.set(studentId, account);
    this.saveAccounts();
    return account;
  }

  /**
   * Crée un compte parent avec email + mot de passe
   */
  async createParentAccount(
    email:       string,
    password:    string,
    displayName: string,
    childIds:    string[] = []
  ): Promise<UserAccount> {
    this.validatePassword(password);

    if (this.findByEmail(email)) {
      throw new Error('Un compte avec cet email existe déjà');
    }

    const salt         = PasswordHasher.generateSalt();
    const passwordHash = await PasswordHasher.hash(password, salt);

    const account: UserAccount = {
      id:          crypto.randomUUID(),
      role:        'parent',
      email,
      displayName,
      passwordHash,
      salt,
      linkedIds:   childIds,
      createdAt:   new Date().toISOString(),
    };

    this.accounts.set(account.id, account);
    this.saveAccounts();
    return account;
  }

  /**
   * Crée un compte enseignant avec email + mot de passe
   */
  async createTeacherAccount(
    email:       string,
    password:    string,
    displayName: string
  ): Promise<UserAccount> {
    this.validatePassword(password);

    if (this.findByEmail(email)) {
      throw new Error('Un compte avec cet email existe déjà');
    }

    const salt         = PasswordHasher.generateSalt();
    const passwordHash = await PasswordHasher.hash(password, salt);

    const account: UserAccount = {
      id:          crypto.randomUUID(),
      role:        'teacher',
      email,
      displayName,
      passwordHash,
      salt,
      linkedIds:   [],
      createdAt:   new Date().toISOString(),
    };

    this.accounts.set(account.id, account);
    this.saveAccounts();
    return account;
  }

  // ── Déconnexion ─────────────────────────────────────────────────────────────

  logout(): void {
    this.session = null;
    sessionStorage.removeItem(STORAGE_KEY_SESSION);
  }

  // ── Changement de mot de passe ──────────────────────────────────────────────

  async changePassword(
    userId:      string,
    oldPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const account = this.accounts.get(userId);
    if (!account) return { success: false, error: 'Compte introuvable' };

    const valid = await PasswordHasher.verify(
      oldPassword,
      account.salt,
      account.passwordHash
    );

    if (!valid) {
      return { success: false, error: 'Ancien mot de passe incorrect' };
    }

    this.validatePassword(newPassword);

    const newSalt = PasswordHasher.generateSalt();
    const newHash = await PasswordHasher.hash(newPassword, newSalt);

    account.passwordHash = newHash;
    account.salt         = newSalt;
    this.accounts.set(userId, account);
    this.saveAccounts();

    return { success: true };
  }

  // ── Getters ──────────────────────────────────────────────────────────────────

  isAuthenticated(): boolean {
    if (!this.session) return false;
    if (Date.now() > this.session.expiresAt) {
      this.logout();
      return false;
    }
    return true;
  }

  getCurrentRole(): UserRole | null {
    return this.session?.role ?? null;
  }

  getCurrentUserId(): string | null {
    return this.session?.userId ?? null;
  }

  getCurrentName(): string {
    return this.session?.name ?? '';
  }

  getAccount(userId: string): UserAccount | undefined {
    return this.accounts.get(userId);
  }

  getAllStudents(): UserAccount[] {
    return Array.from(this.accounts.values())
      .filter((a) => a.role === 'student');
  }

  // ── Helpers privés ───────────────────────────────────────────────────────────

  private createSession(account: UserAccount): void {
    this.session = {
      userId:    account.id,
      role:      account.role,
      name:      account.displayName,
      expiresAt: Date.now() + SESSION_DURATION[account.role],
    };
    sessionStorage.setItem(
      STORAGE_KEY_SESSION,
      JSON.stringify(this.session)
    );
  }

  private findByEmail(email: string): UserAccount | undefined {
    return Array.from(this.accounts.values())
      .find((a) => a.email?.toLowerCase() === email.toLowerCase());
  }

  private validatePassword(password: string): void {
    if (password.length < 6) {
      throw new Error('Le mot de passe doit contenir au moins 6 caractères');
    }
  }

  private saveAccounts(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY_ACCOUNTS,
        JSON.stringify(Array.from(this.accounts.entries()))
      );
    } catch {
      console.error('Erreur sauvegarde comptes');
    }
  }

  private loadAccounts(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
      if (!raw) return;
      const data = JSON.parse(raw) as [string, UserAccount][];
      this.accounts = new Map(data);
    } catch {
      this.accounts = new Map();
    }
  }

  private loadSession(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_SESSION);
      if (!raw) return;
      const session = JSON.parse(raw) as AuthSession;
      // Vérifier que la session n'est pas expirée
      if (Date.now() < session.expiresAt) {
        this.session = session;
      }
    } catch {
      this.session = null;
    }
  }
}

// Singleton partagé dans tout le projet
export const authManager = new AuthManager();