import { describe, expect, test, beforeEach } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const backup = await import('./cloudBackup');
const {
  describeCloudStatus,
  formatCloudAgo,
  isUnlocked,
  lock,
  unlock,
  recordBackupSuccess,
  recordBackupError,
  cloudState,
} = backup;
import type { CloudBackupState } from '../types';

/**
 * Cloud orchestration pins that need no account: status derivation, labels,
 * key-cache lifecycle, and outcome recording. The passphrase never lands in
 * storage — assert that too.
 */

const base: CloudBackupState = {
  enabled: false,
  auto: false,
  lastBackupAt: null,
  lastError: null,
  puterUsername: null,
};

beforeEach(() => {
  lock();
  localStorage.removeItem('sessionmap_settings');
});

describe('cloud status', () => {
  test('disabled hides everything', () => {
    expect(describeCloudStatus(base).kind).toBe('disabled');
  });

  test('enabled but locked waits for the passphrase, keeping history', () => {
    const s = describeCloudStatus({
      ...base,
      enabled: true,
      lastBackupAt: '2026-10-01T10:00:00Z',
    });
    expect(s.kind).toBe('locked');
    expect(s.lastBackupAt).toBe('2026-10-01T10:00:00Z');
  });

  test('unlocked: error beats ok, ok beats never', () => {
    unlock('frase secreta bem longa aqui');
    try {
      expect(
        describeCloudStatus({ ...base, enabled: true, lastError: 'x' }).kind
      ).toBe('error');
      expect(
        describeCloudStatus({ ...base, enabled: true, lastBackupAt: '2026-10-01T10:00:00Z' }).kind
      ).toBe('ok');
      expect(describeCloudStatus({ ...base, enabled: true }).kind).toBe('never');
    } finally {
      lock();
    }
  });

  test('locking drops the key from memory', () => {
    unlock('frase secreta bem longa aqui');
    expect(isUnlocked()).toBe(true);
    lock();
    expect(isUnlocked()).toBe(false);
  });
});

describe('footer labels', () => {
  const now = new Date('2026-10-06T12:00:00Z').getTime();
  test('relative time in host words', () => {
    expect(formatCloudAgo(now, null)).toBe('nunca');
    expect(formatCloudAgo(now, '2026-10-06T11:59:30Z')).toBe('agora há pouco');
    expect(formatCloudAgo(now, '2026-10-06T11:20:00Z')).toBe('há 40min');
    expect(formatCloudAgo(now, '2026-10-06T09:00:00Z')).toBe('há 3h');
    expect(formatCloudAgo(now, '2026-10-03T12:00:00Z')).toBe('há 3d');
    expect(formatCloudAgo(now, '2026-09-20T12:00:00Z')).toBe('20/09');
  });

  test('one shared label for footer and top bar', async () => {
    const { cloudBadgeLabel, describeCloudStatus } = backup;
    const label = (s: Parameters<typeof describeCloudStatus>[0]) =>
      cloudBadgeLabel(describeCloudStatus(s));
    // Locked outranks everything: without the passphrase there is no
    // "never" and no "ok", only waiting.
    expect(label({ ...base, enabled: true })).toBe('nuvem: aguardando senha');
    unlock('frase secreta bem longa aqui');
    try {
      expect(label({ ...base, enabled: true })).toBe('nuvem: nunca enviado');
      // Relative to the wall clock, never to a fixed date: the suite must
      // pass in any year, not just the one it was written in.
      const halfMinuteAgo = new Date(Date.now() - 30_000).toISOString();
      expect(label({ ...base, enabled: true, lastBackupAt: halfMinuteAgo })).toBe(
        'nuvem agora há pouco'
      );
      expect(label({ ...base, enabled: true, lastError: 'x' })).toBe(
        'nuvem: erro no último envio'
      );
    } finally {
      lock();
    }
  });
});

describe('outcome recording', () => {
  test('success stamps time, clears error, keeps username', () => {
    recordBackupSuccess('anfitriao');
    const s = cloudState();
    expect(typeof s.lastBackupAt).toBe('string');
    expect(s.lastError).toBeNull();
    expect(s.puterUsername).toBe('anfitriao');
    // And nothing secret was persisted alongside.
    const raw = String(localStorage.getItem('sessionmap_settings'));
    expect(raw).not.toContain('frase');
    expect(raw).not.toContain('senha');
  });

  test('no passphrase-shaped secret reaches ANY persisted key', () => {
    // The canary goes through memory only (unlock + a success record). Then
    // every sessionmap_* key is scanned: a future code path that persists
    // the passphrase breaks this test instead of shipping the leak.
    const canary = 'canario-senha-nuvem-inexistente-xyz';
    unlock(canary);
    try {
      recordBackupSuccess('anfitriao');
      const leaked: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('sessionmap_')) continue;
        if (String(localStorage.getItem(key)).includes(canary)) leaked.push(key);
      }
      expect(leaked).toEqual([]);
    } finally {
      lock();
    }
  });

  test('error records the sentence, keeps the last good backup', () => {
    recordBackupSuccess('anfitriao');
    const at = cloudState().lastBackupAt;
    recordBackupError('Sem conexão.');
    const s = cloudState();
    expect(s.lastError).toBe('Sem conexão.');
    expect(s.lastBackupAt).toBe(at);
  });
});
