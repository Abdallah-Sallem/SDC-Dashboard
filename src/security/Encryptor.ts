/**
 * Encryptor.ts - VERSION 100% COMPATIBLE TypeScript ✅
 */

import { logger } from '../shared/logger';

const ENCRYPTION_ALGORITHM  = 'AES-GCM';
const ENCRYPTION_KEY_LENGTH  = 256;
const PBKDF2_ITERATIONS      = 310_000;

// ✅ HELPER CRITIQUE : Force ArrayBuffer pur (pas SharedArrayBuffer)
function toCryptoBuffer(bufferLike: ArrayBufferLike): ArrayBuffer {
  const uint8 = new Uint8Array(bufferLike);
  // ✅ Copie explicite → ArrayBuffer garanti
  const result = new ArrayBuffer(uint8.length);
  new Uint8Array(result).set(uint8);
  return result;
}

export class Encryptor {
  private key: CryptoKey | null = null;

  async deriveKey(password: string, salt: Uint8Array): Promise<void> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // ✅ SOLUTION DÉFINITIVE
    this.key = await crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       toCryptoBuffer(salt.buffer),  // ✅ TYPE ArrayBuffer garanti
        iterations: PBKDF2_ITERATIONS,
        hash:       'SHA-256',
      },
      keyMaterial,
      { name: ENCRYPTION_ALGORITHM, length: ENCRYPTION_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: unknown): Promise<{ iv: string; ciphertext: string }> {
    if (!this.key) throw new Error('Encryptor : clé non initialisée');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: ENCRYPTION_ALGORITHM, iv },
      this.key,
      encoded
    );

    return {
      iv: this.bufferToBase64(iv),
      ciphertext: this.bufferToBase64(new Uint8Array(ciphertextBuffer)),
    };
  }

  async decrypt<T>(iv: string, ciphertext: string): Promise<T | null> {
    if (!this.key) throw new Error('Encryptor : clé non initialisée');

    try {
      const ivBuffer = this.base64ToBuffer(iv);
      const ciphertextBuffer = this.base64ToBuffer(ciphertext);

      // ✅ SOLUTION DÉFINITIVE
      const decryptedBuffer = await crypto.subtle.decrypt(
        { 
          name: ENCRYPTION_ALGORITHM, 
          iv: toCryptoBuffer(ivBuffer.buffer)  // ✅ TYPE ArrayBuffer garanti
        },
        this.key,
        toCryptoBuffer(ciphertextBuffer.buffer)  // ✅ TYPE ArrayBuffer garanti
      );

      const decoded = new TextDecoder().decode(decryptedBuffer);
      return JSON.parse(decoded) as T;
    } catch (error) {
      logger.error('Encryptor', 'Échec déchiffrement', { error });  // ✅ CORRIGÉ
      return null;
    }
  }

  static generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  private bufferToBase64(buffer: Uint8Array): string {
    return btoa(String.fromCharCode(...Array.from(buffer)));
  }

  private base64ToBuffer(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  clearKey(): void {
    this.key = null;
    logger.info('Encryptor', 'Clé effacée de la mémoire');
  }

  checkIsReady(): boolean {
    return this.key !== null;
  }
}