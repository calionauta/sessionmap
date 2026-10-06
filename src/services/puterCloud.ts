/**
 * Thin wrapper over puter.js for the cloud backup.
 *
 * Deliberately logic-free: every decision (what to upload, when, encrypted
 * with what) lives in cloudBackup.ts and cloudCrypto.ts, which are testable
 * without an account. This module only translates: load the SDK lazily, sign
 * in, and move bytes. It is imported dynamically, so the SDK never joins the
 * initial bundle — offline-first stays offline-first until the user opts in.
 *
 * Everything lands under `sessionmap/` inside the app's own sandboxed
 * directory (`~/AppData/<app>/`): the app cannot see outside it, and no
 * other app can see inside.
 */

import type { Puter } from '@heyputer/puter.js';

export type { Puter };

export const CLOUD_DIR = 'sessionmap';
export const BACKUP_FILENAME = 'backup.json.enc';
export const BACKUP_PATH = `${CLOUD_DIR}/${BACKUP_FILENAME}`;

export interface CloudFile {
  name: string;
  path: string;
  size: number | null;
  modified: string | null;
}

export interface CloudSpace {
  capacity: number;
  used: number;
}

let cached: Puter | null = null;

export async function loadPuter(): Promise<Puter> {
  if (cached) return cached;
  const mod = (await import('@heyputer/puter.js')) as unknown as {
    puter?: Puter;
    default?: Puter;
  };
  const api = mod.puter ?? mod.default ?? (globalThis as { puter?: Puter }).puter;
  if (!api) throw new Error('O Puter.js não carregou. Verifique a conexão e tente de novo.');
  cached = api;
  return api;
}

export function isSignedIn(api: Puter): boolean {
  try {
    return api.auth.isSignedIn();
  } catch {
    return false;
  }
}

/** Popup: must run inside a user gesture or the browser blocks it. */
export async function signIn(api: Puter): Promise<void> {
  await api.auth.signIn();
}

export function signOut(api: Puter): void {
  try {
    api.auth.signOut();
  } catch {
    // already out: nothing to do
  }
  cached = null;
}

export async function getUsername(api: Puter): Promise<string | null> {
  try {
    const user = await api.auth.getUser();
    return user?.username ?? null;
  } catch {
    return null;
  }
}

export async function writeBackup(api: Puter, text: string): Promise<void> {
  await api.fs.write(BACKUP_PATH, text, {
    overwrite: true,
    createMissingParents: true,
  });
}

export async function readBackup(api: Puter): Promise<string> {
  const blob: Blob = await api.fs.read(BACKUP_PATH);
  return blob.text();
}

/** The files under our directory, for the transparency listing. A missing
 *  directory means "nothing backed up yet", not an error. */
export async function listBackupFiles(api: Puter): Promise<CloudFile[]> {
  let items: Array<{
    name?: string;
    path?: string;
    size?: number | null;
    modified?: string;
    isDir?: boolean;
  }>;
  try {
    items = (await api.fs.readdir(CLOUD_DIR)) as typeof items;
  } catch {
    return [];
  }
  return (items ?? [])
    .filter((i) => !i.isDir)
    .map((i) => ({
      name: i.name ?? i.path ?? '?',
      path: i.path ?? `${CLOUD_DIR}/${i.name ?? ''}`,
      size: typeof i.size === 'number' ? i.size : null,
      modified: i.modified ?? null,
    }));
}

/** Deletes exactly the listed paths, one call. The caller lists first so
 *  the confirm dialog names what is about to go. */
export async function deleteBackupPaths(api: Puter, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await api.fs.delete(paths);
}

export async function getSpace(api: Puter): Promise<CloudSpace | null> {
  try {
    const space = await api.fs.space();
    if (typeof space?.capacity !== 'number' || typeof space?.used !== 'number') {
      return null;
    }
    return { capacity: space.capacity, used: space.used };
  } catch {
    return null;
  }
}

/** Turns puter error objects into sentences a host can act on. */
export function puterErrorMessage(err: unknown): string {
  // Offline first: a failed chunk import or fetch without connection is a
  // TypeError with no code, and "Failed to fetch" helps nobody.
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'Sem conexão. O backup local continua valendo.';
    }
  } catch {
    // ignore
  }
  const code =
    (err as { code?: unknown })?.code ?? (err as { error?: unknown })?.error ?? '';
  if (code === 'storage_limit_reached') {
    return 'Espaço do Puter esgotado — apague arquivos ou amplie a conta.';
  }
  if (code === 'auth_window_closed' || code === 'popup_blocked') {
    return 'Login cancelado. Tente de novo e conclua a janela do Puter.';
  }
  if (code === 'insufficient_funds' || code === 'subscription_required') {
    return 'A conta Puter precisa de créditos para esta operação.';
  }
  if (code === 'unsupported_origin') {
    return 'O Puter não funciona em file:// — sirva o app por http://localhost.';
  }
  if (!navigator.onLine) return 'Sem conexão. O backup local continua valendo.';
  const message = (err as { message?: unknown })?.message;
  if (typeof message === 'string' && message.trim()) return message;
  return 'Falha na nuvem. O backup local continua valendo — tente de novo.';
}
