/**
 * PasswordHasher.ts
 * RÔLE : Hash sécurisé des mots de passe et PINs.
 * Utilise SHA-256 + sel unique — aucun mot de passe stocké en clair.
 */

export class PasswordHasher {

  /**
   * Hash un mot de passe avec son sel
   * @param password  Mot de passe ou PIN en clair
   * @param salt      Sel unique généré à la création du compte
   */
  static async hash(password: string, salt: string): Promise<string> {
    const encoded = new TextEncoder().encode(password + salt);
    const buffer  = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Génère un sel aléatoire unique
   * À appeler UNE SEULE FOIS à la création du compte
   */
  static generateSalt(): string {
    return crypto.randomUUID();
  }

  /**
   * Vérifie un mot de passe contre son hash stocké
   */
  static async verify(
    password:     string,
    salt:         string,
    storedHash:   string
  ): Promise<boolean> {
    const hash = await this.hash(password, salt);
    return hash === storedHash;
  }
}