import { describe, expect, test } from 'bun:test';
import {
  CLOUD_CRYPTO_ALG,
  decryptBackup,
  encryptBackup,
  isCryptoAvailable,
  parseEncryptedBackup,
  validatePassphrase,
} from './cloudCrypto';

/**
 * The cloud only ever sees { salt, iv, ct }. These pins hold that promise:
 * round-trip with the right passphrase, failure with the wrong one or with
 * any tampering (AES-GCM authenticates), fresh randomness per backup, and
 * rejection of anything that is not our envelope.
 */

const PW = 'frase secreta bem longa do anfitrião';

describe('cloud crypto', () => {
  test('available in this runtime', () => {
    expect(isCryptoAvailable()).toBe(true);
  });

  test('round-trips the backup JSON', async () => {
    const plaintext = JSON.stringify({ app: 'sessionmap', maps: [{ id: 'm1' }] });
    const enc = await encryptBackup(plaintext, PW);
    expect(enc.v).toBe(1);
    expect(enc.alg).toBe(CLOUD_CRYPTO_ALG);
    expect(await decryptBackup(enc, PW)).toBe(plaintext);
  });

  test('wrong passphrase fails instead of corrupting', async () => {
    const enc = await encryptBackup('segredo', PW);
    await expect(decryptBackup(enc, 'senha errada bem longa aqui')).rejects.toThrow();
  });

  test('tampered ciphertext or iv fails (authentication)', async () => {
    const enc = await encryptBackup('segredo', PW);
    const ct = Uint8Array.from(atob(enc.ct), (c) => c.charCodeAt(0));
    ct[0] ^= 0xff;
    const tamperedCt = { ...enc, ct: btoa(String.fromCharCode(...ct)) };
    await expect(decryptBackup(tamperedCt, PW)).rejects.toThrow();

    const tamperedIv = { ...enc, iv: enc.iv.slice(0, -2) + (enc.iv.endsWith('A') ? 'BB' : 'AA') };
    await expect(decryptBackup(tamperedIv, PW)).rejects.toThrow();
  });

  test('every backup gets fresh salt and iv', async () => {
    const a = await encryptBackup('mesmo texto', PW);
    const b = await encryptBackup('mesmo texto', PW);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  test('passphrase floor', () => {
    expect(validatePassphrase('')).not.toBeNull();
    expect(validatePassphrase('curta')).not.toBeNull();
    expect(validatePassphrase('12345678901')).not.toBeNull();
    expect(validatePassphrase('123456789012')).toBeNull();
    expect(validatePassphrase(PW)).toBeNull();
  });

  test('non-envelopes are rejected before decrypt', () => {
    expect(() => parseEncryptedBackup(null)).toThrow();
    expect(() => parseEncryptedBackup({ v: 2, alg: 'x', salt: 's', iv: 'i', ct: 'c' })).toThrow();
    expect(() => parseEncryptedBackup({ v: 1, alg: CLOUD_CRYPTO_ALG })).toThrow();
    const ok = { v: 1 as const, alg: CLOUD_CRYPTO_ALG, salt: 's', iv: 'i', ct: 'c' };
    expect(parseEncryptedBackup(ok)).toEqual(ok);
  });
});
