/**
 * SessionGuard.ts
 * RÔLE : Protège les pages selon le rôle connecté.
 * À utiliser dans App.tsx avant d'afficher une page protégée.
 */

import { authManager }  from './AuthManager';
import type { UserRole } from '../shared/types';

export class SessionGuard {

  /**
   * Vérifie qu'un utilisateur est connecté
   */
  static isLoggedIn(): boolean {
    return authManager.isAuthenticated();
  }

  /**
   * Vérifie qu'un utilisateur a le bon rôle
   */
  static hasRole(role: UserRole): boolean {
    return authManager.isAuthenticated() &&
           authManager.getCurrentRole() === role;
  }

  /**
   * Vérifie qu'un parent a accès à un profil élève spécifique
   */
  static canAccessStudent(studentId: string): boolean {
    if (!authManager.isAuthenticated()) return false;

    const role    = authManager.getCurrentRole();
    const userId  = authManager.getCurrentUserId();

    // L'élève accède uniquement à son propre profil
    if (role === 'student') return userId === studentId;

    // Parent → vérifie que l'élève est bien son enfant
    if (role === 'parent') {
      const account = authManager.getAccount(userId ?? '');
      return account?.linkedIds.includes(studentId) ?? false;
    }

    // Enseignant et admin → accès à tous (données anonymisées)
    if (role === 'teacher' || role === 'admin') return true;

    return false;
  }
}