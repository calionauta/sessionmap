/**
 * Orchestrates the encrypted Puter backup.
 *
 * Data flow, always in this order, never skipping a step:
 *   local records -> buildFullBackup() -> JSON -> encryptBackup(passphrase)
 *   -> puter.fs.write. The reverse for restore. Plaintext never touches the
 *   network, and the passphrase never touches storage: it lives in the
 *   module-level slot below, which dies with the tab.
 *
 * Auto-backup is deliberately conservative: it runs only when the feature
 * is enabled AND set to automatic AND the tab holds the passphrase AND the
 * browser is online AND the Puter session is live. Anything else skips
 * silently — a background job must never pop a login window.
 */

import { CloudBackupState } from '../types';
import {
  buildFullBackup,
  restoreFullBackup,
  getSettings,
  saveSettings,
  type RestoreCounts,
} from './storage';
import {
  decryptBackup,
  encryptBackup,
  isCryptoAvailable,
  parseEncryptedBackup,
} from './cloudCrypto';
import {
  getUsername,
  isSignedIn,
  listBackupFiles,
  loadPuter,
  puterErrorMessage,
  readBackup,
  signIn,
  writeBackup,
  type CloudFile,
  type Puter,
} from './puterCloud';

export const AUTO_BACKUP_IDLE_MS = 60_000;

/** Tab memory only. Reload the page and it is gone — by design. */
let cachedPassphrase: string | null = null;

export function isUnlocked(): boolean {
  return cachedPassphrase !== null;
}

export function unlock(passphrase: string): void {
  cachedPassphrase = passphrase;
}

export function lock(): void {
  cachedPassphrase = null;
}

export function cloudState(): CloudBackupState {
  return getSettings().cloudBackup;
}

function patchCloudState(patch: Partial<CloudBackupState>): CloudBackupState {
  const next = { ...getSettings().cloudBackup, ...patch };
  saveSettings({ ...getSettings(), cloudBackup: next });
  return next;
}

export function recordBackupSuccess(username: string | null): CloudBackupState {
  return patchCloudState({
    lastBackupAt: new Date().toISOString(),
    lastError: null,
    ...(username ? { puterUsername: username } : {}),
  });
}

export function recordBackupError(message: string): CloudBackupState {
  return patchCloudState({ lastError: message });
}

export function clearBackupError(): CloudBackupState {
  return patchCloudState({ lastError: null });
}

/** Proves a passphrase by sealing and opening a probe: no network, no
 *  side effects. Used when enabling, before anything is trusted. */
export async function provePassphrase(passphrase: string): Promise<void> {
  const probe = `sessionmap-probe:${Date.now()}`;
  const enc = await encryptBackup(probe, passphrase);
  const back = await decryptBackup(enc, passphrase);
  if (back !== probe) throw new Error('Falha na verificação da senha.');
}

export interface BackupResult {
  bytes: number;
  username: string | null;
}

/**
 * Full manual backup: sign in (inside the click gesture), seal, upload,
 * record. Throws with a human sentence on any failure.
 */
export async function backupNow(api: Puter, passphrase: string): Promise<BackupResult> {  if (!isCryptoAvailable()) {
    throw new Error('Sem Web Crypto aqui (HTTP sem localhost?) — backup em nuvem indisponível.');
  }
  if (!isSignedIn(api)) await signIn(api);
  const envelope = await buildFullBackup();
  const sealed = await encryptBackup(JSON.stringify(envelope), passphrase);
  const text = JSON.stringify(sealed);
  try {
    await writeBackup(api, text);
  } catch (err) {
    throw new Error(puterErrorMessage(err));
  }
  return { bytes: text.length, username: await getUsername(api) };
}

/**
 * Backup with the remembered session key. The auto tick and one-click
 * manual sends go through here; anything else passes an explicit
 * passphrase to backupNow. Throws when locked — callers treat that as
 * "skip silently" (auto) or "ask for the password" (manual).
 */
export async function backupWithCachedPassphrase(api: Puter): Promise<BackupResult> {
  if (!cachedPassphrase) throw new Error('locked');
  if (!isCryptoAvailable()) {
    throw new Error('Sem Web Crypto aqui (HTTP sem localhost?) — backup em nuvem indisponível.');
  }
  const envelope = await buildFullBackup();
  const sealed = await encryptBackup(JSON.stringify(envelope), cachedPassphrase);
  const text = JSON.stringify(sealed);
  try {
    await writeBackup(api, text);
  } catch (err) {
    throw new Error(puterErrorMessage(err));
  }
  return { bytes: text.length, username: await getUsername(api) };
}

export interface RestorePreview {
  maps: number;
  clients: number;
  modalities: number;
  templates: number;
  exportedAt: string | null;
}

/** Downloads + decrypts + COUNTS, without writing a single record. The
 *  caller confirms the counts, then calls applyRestore. */
export async function previewRestore(api: Puter, passphrase: string): Promise<RestorePreview> {
  let text: string;
  try {
    text = await readBackup(api);
  } catch (err) {
    throw new Error(puterErrorMessage(err));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('O arquivo na nuvem não é um backup válido.');
  }
  let json: string;
  try {
    json = await decryptBackup(parseEncryptedBackup(parsed), passphrase);
  } catch {
    throw new Error('Senha incorreta ou arquivo adulterado.');
  }
  let env: {
    maps?: unknown[];
    clients?: unknown[];
    modalities?: unknown[];
    templates?: unknown[];
    exportedAt?: string;
  };
  try {
    env = JSON.parse(json);
  } catch {
    throw new Error('O conteúdo descriptografado não é um backup válido.');
  }
  if (!env || !Array.isArray(env.maps)) {
    throw new Error('O conteúdo descriptografado não é um backup válido.');
  }
  return {
    maps: env.maps.length,
    clients: Array.isArray(env.clients) ? env.clients.length : 0,
    modalities: Array.isArray(env.modalities) ? env.modalities.length : 0,
    templates: Array.isArray(env.templates) ? env.templates.length : 0,
    exportedAt: typeof env.exportedAt === 'string' ? env.exportedAt : null,
  };
}

/** Writes the (already previewed) payload. Kept separate so a mis-click
 *  can never be the thing that overwrites the practice. */
export async function applyRestore(
  api: Puter,
  passphrase: string
): Promise<RestoreCounts> {
  const text = await readBackup(api);
  const json = await decryptBackup(parseEncryptedBackup(JSON.parse(text)), passphrase);
  return restoreFullBackup(JSON.parse(json));
}

export async function listRemoteFiles(api: Puter): Promise<CloudFile[]> {
  try {
    return await listBackupFiles(api);
  } catch (err) {
    throw new Error(puterErrorMessage(err));
  }
}

export type CloudStatusKind =
  | 'disabled'
  | 'locked'
  | 'error'
  | 'never'
  | 'ok';

export interface CloudStatus {
  kind: CloudStatusKind;
  lastBackupAt: string | null;
  lastError: string | null;
  username: string | null;
}

export function describeCloudStatus(state: CloudBackupState): CloudStatus {
  if (!state.enabled) return { kind: 'disabled', lastBackupAt: null, lastError: null, username: null };
  if (!isUnlocked()) {
    return { kind: 'locked', lastBackupAt: state.lastBackupAt, lastError: null, username: state.puterUsername };
  }
  if (state.lastError) {
    return { kind: 'error', lastBackupAt: state.lastBackupAt, lastError: state.lastError, username: state.puterUsername };
  }
  if (!state.lastBackupAt) {
    return { kind: 'never', lastBackupAt: null, lastError: null, username: state.puterUsername };
  }
  return { kind: 'ok', lastBackupAt: state.lastBackupAt, lastError: null, username: state.puterUsername };
}

/** Short human label for the footer indicator. */
export function formatCloudAgo(nowMs: number, iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * The auto-backup tick. Returns true when an upload happened. Never throws,
 * never prompts: anything less than fully-ready skips silently, and failures
 * are recorded for the footer instead of raised.
 */
export async function runAutoBackup(): Promise<boolean> {
  const state = cloudState();
  if (!state.enabled || !state.auto) return false;
  if (!isUnlocked() || !navigator.onLine) return false;
  let api: Puter;
  try {
    api = await loadPuter();
  } catch {
    return false;
  }
  // A background tick must never open a login popup (browsers block it and
  // it would ambush the therapist mid-session).
  if (!isSignedIn(api)) return false;
  try {
    await backupWithCachedPassphrase(api);
    recordBackupSuccess(await getUsername(api));
    return true;
  } catch (err) {
    recordBackupError(puterErrorMessage(err));
    return false;
  }
}
