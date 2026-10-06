/**
 * Client-side encryption for the cloud backup.
 *
 * NOTHING leaves the browser unencrypted, ever: the backup JSON is sealed
 * here, and the cloud only ever sees { salt, iv, ct } — three blobs that are
 * indistinguishable from random bytes without the passphrase.
 *
 * Recipe (the 2026 consensus for zero-dependency browser crypto):
 *   - AES-256-GCM via Web Crypto: authenticated encryption, so tampering
 *     fails decryption instead of silently corrupting a restore.
 *   - PBKDF2-SHA-256 with 600k iterations (OWASP) to stretch the passphrase.
 *     Argon2id would resist GPU brute force better, but Web Crypto does not
 *     offer it, and a WASM dependency is not worth it for a backup file.
 *   - Fresh random salt (16B) and IV (12B) per backup. The IV is NEVER
 *     reused with the same key: same plaintext must never yield same
 *     ciphertext.
 *   - The passphrase and the derived key live in tab memory ONLY (see
 *     cloudBackup.ts). Persisting either next to the ciphertext would hand
 *     whoever reads the disk both the lock and the key.
 */

import type { Language } from '../i18n/strings';

export const CLOUD_CRYPTO_ALG = 'pbkdf2-sha256-600000/aes-gcm-256';
export const MIN_PASSPHRASE_LENGTH = 12;

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBackup {
  v: 1;
  alg: string;
  /** base64, random per backup. Not secret. */
  salt: string;
  /** base64, random per backup. Not secret. */
  iv: string;
  /** base64 AES-256-GCM ciphertext (auth tag included). */
  ct: string;
}

/** Web Crypto needs a secure context (HTTPS or localhost). Plain HTTP over
 *  LAN has no crypto.subtle, and the cloud feature must refuse to run there
 *  rather than upload plaintext. */
export function isCryptoAvailable(): boolean {
  try {
    return typeof crypto !== 'undefined' && !!crypto.subtle;
  } catch {
    return false;
  }
}

/** Returns why a passphrase is unacceptable, or null when it is fine. */
export function validatePassphrase(passphrase: string, lang: Language = 'pt'): string | null {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    return lang === 'en'
      ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters — a sentence only you know.`
      : `Use pelo menos ${MIN_PASSPHRASE_LENGTH} caracteres — uma frase que só você saiba.`;
  }
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBackup(
  plaintext: string,
  passphrase: string
): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    v: 1,
    alg: CLOUD_CRYPTO_ALG,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  };
}

/**
 * Throws when the passphrase is wrong OR the ciphertext was tampered with —
 * AES-GCM does not distinguish the two, and for a backup that is correct:
 * either way the file must not restore.
 */
export async function decryptBackup(
  enc: EncryptedBackup,
  passphrase: string
): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(enc.salt));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(enc.iv) as BufferSource },
    key,
    fromBase64(enc.ct) as BufferSource
  );
  return new TextDecoder().decode(pt);
}

/** Shape-checks a downloaded file before anything tries to decrypt it. */
export function parseEncryptedBackup(data: unknown): EncryptedBackup {
  if (!data || typeof data !== 'object') throw new Error('Arquivo inválido');
  const enc = data as Partial<EncryptedBackup>;
  if (
    enc.v !== 1 ||
    typeof enc.alg !== 'string' ||
    typeof enc.salt !== 'string' ||
    typeof enc.iv !== 'string' ||
    typeof enc.ct !== 'string'
  ) {
    throw new Error('Esse arquivo não é um backup criptografado do SessionMap');
  }
  return enc as EncryptedBackup;
}
