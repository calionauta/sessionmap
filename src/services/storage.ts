import { Client, MindMap, MindMapNode, Modality, SessionTemplate, Settings } from '../types';
import { generateNodeId, normalizeOutline, parseMarkdownToTree } from '../utils/tree';
import { formatSessionTimestamp } from '../utils/text';
import { OUTLINE_MIN_PERCENT, clampOutlineWidth } from '../utils/layout';

const DB_NAME = 'sessionmap_db';
// 3 = renamed database: every record is copied out of narratips_db on upgrade.
const DB_VERSION = 3;
const LEGACY_DB_NAME = 'narratips_db';
const STORE_MAPS = 'maps';
const STORE_CLIENTS = 'clients';
const STORE_SNAPSHOTS = 'snapshots';
const SETTINGS_KEY = 'sessionmap_settings';
const ACTIVE_MAP_KEY = 'sessionmap_active_map_id';
const ACTIVE_CLIENT_KEY = 'sessionmap_active_client_id';
const CACHED_ACTIVE_MAP_KEY = 'sessionmap_active_map';
const LOCAL_MAPS_KEY = 'sessionmap_maps';
const LOCAL_CLIENTS_KEY = 'sessionmap_clients';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'papel',
  // PT-first default: auto-detecting from the browser would flip seeded test
  // environments (happy-dom reports en-US) and surprise a Brazilian
  // product. EN arrives explicitly instead — one tap in Settings, or the
  // landing page's own choice (read on first run in getSettings). This
  // constant never changes; it is only the fallback.
  language: 'pt',
  liveTextMode: 'live',
  thinBarAlwaysVisible: false,
  autoFitOnAdd: true,
  clientFontScale: 1.0,
  focusZoomMode: true, // Default to true so host can see focus zoom in action!
  outlineFontScale: 1,
  // The map stays visible by default: hiding it is a per-session choice, and a
  // host who wants it gone every time can turn it on once.
  maximizeOutline: false,
  // Pane width, persisted. It used to be bare component state, so the split
  // reset itself on every reload and a host who widened the outline to
  // read a long topic had to drag it again every session. The bounds live in
  // utils/layout and are applied on read, so a value written by a build with a
  // different range cannot render the pane off screen.
  outlineWidthPercent: OUTLINE_MIN_PERCENT,
  cloudBackup: {
    enabled: false,
    auto: false,
    lastBackupAt: null,
    lastError: null,
    puterUsername: null,
  },
};

// =================== MIGRATION narratips_* -> sessionmap_* ===================
//
// Two one-time migrations live in this file and both can be deleted together
// once no installation can still hold narratips_* data:
//
//   1. IndexedDB — on the v2 -> v3 upgrade the new sessionmap_db is created and
//      every record of the legacy narratips_db is copied in. narratips_db is
//      deleted only after the copy transaction has COMMITTED, so a crash or a
//      blocked tab can never destroy the only copy of a clinical record.
//   2. localStorage — see migrateLegacyLocalStorageKeys() below.

const LS_MIGRATION_FLAG = 'sessionmap_keys_migrated';
const IDB_MIGRATION_FLAG = 'sessionmap_db_migrated';
const LS_MIGRATED_SUFFIXES = [
  'settings',
  'active_map',
  'active_map_id',
  'active_client_id',
  'maps',
  'clients',
];

// The destructive half is split from the safe half on purpose.
//
// Copying narratips_* to sessionmap_* is additive and can never lose data, so
// it runs eagerly at import: the pre-paint theme script in index.html needs
// sessionmap_settings to exist before first paint. DELETING the legacy keys is
// not additive, and it must wait until the IndexedDB migration is known good
// (below) — otherwise a failed IDB upgrade would leave the user with neither
// the old settings nor the new ones. An empty list simply stays empty,
// and the UI shows its own empty state.
function migrateLegacyLocalStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (localStorage.getItem(LS_MIGRATION_FLAG)) return;
    for (const suffix of LS_MIGRATED_SUFFIXES) {
      const legacyKey = `narratips_${suffix}`;
      const currentKey = `sessionmap_${suffix}`;
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) continue;
      // A value already written under the new key wins: it is newer.
      if (localStorage.getItem(currentKey) === null) {
        localStorage.setItem(currentKey, legacyValue);
      }
    }
  } catch {
    // Quota exceeded or storage disabled: try again later.
  }
}

/**
 * Removes the legacy keys. Called ONLY after migrateLegacyRecords() confirms
 * the IndexedDB copy succeeded, so a failure there leaves both key sets
 * intact and the migration can be retried on the next load.
 */
function dropLegacyLocalStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    for (const suffix of LS_MIGRATED_SUFFIXES) {
      localStorage.removeItem(`narratips_${suffix}`);
    }
    localStorage.setItem(LS_MIGRATION_FLAG, new Date().toISOString());
  } catch {
    // Keeping the legacy keys is harmless: the copy step is idempotent.
  }
}

migrateLegacyLocalStorageKeys();

/**
 * 'clean'       — no legacy database, seeding the sample data is safe.
 * 'migrated'    — legacy records were copied into sessionmap_db.
 * 'unavailable' — narratips_db exists but could not be read; never seed
 *                 defaults over it, because that would hide real records.
 */
type MigrationState = 'clean' | 'migrated' | 'unavailable';
let migrationState: MigrationState = 'clean';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens narratips_db without a version so reading it never upgrades it. */
function openLegacyDB(): Promise<{ db: IDBDatabase } | { unavailable: true } | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      resolve({ unavailable: true });
      return;
    }
    let settled = false;
    const done = (value: { db: IDBDatabase } | { unavailable: true } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // The database did not exist, so this open just created an empty one.
    // Delete it so a fresh install does not keep a stray narratips_db around.
    request.onupgradeneeded = () => {
      request.result.close();
      deleteLegacyDB();
      done(null);
    };
    request.onblocked = () => done({ unavailable: true });
    request.onerror = () => done({ unavailable: true });
    request.onsuccess = () => done({ db: request.result });
  });
}

function deleteLegacyDB(): void {
  try {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onblocked = () =>
      console.warn('[storage] narratips_db segue aberto em outra aba e será apagado quando ela fechar.');
    request.onerror = () => console.warn('[storage] não foi possível apagar narratips_db', request.error);
  } catch {
    // ignore
  }
}

/**
 * Copies every legacy object store into the freshly created sessionmap_db and
 * deletes narratips_db once the write transaction has committed.
 */
async function migrateLegacyRecords(db: IDBDatabase): Promise<void> {
  // Probing narratips_db creates an empty database when there is none, so the
  // whole probe runs at most once per installation.
  try {
    if (localStorage.getItem(IDB_MIGRATION_FLAG)) {
      migrationState = 'migrated';
      // The IDB copy already committed on an earlier run. The legacy
      // localStorage keys may still be around if that run predates the
      // split of the migration; drop them now that it is known safe.
      dropLegacyLocalStorageKeys();
      return;
    }
  } catch {
    // storage disabled: run the probe every time, it is idempotent
  }

  const opened = await openLegacyDB();
  if (!opened) {
    // No legacy database at all, so nothing was at risk. Any legacy
    // localStorage keys are orphans and can go.
    migrationState = 'clean';
    dropLegacyLocalStorageKeys();
    return;
  }
  if ('unavailable' in opened) {
    migrationState = 'unavailable';
    console.warn('[storage] narratips_db está em uso por outra aba; os dados antigos não foram migrados ainda.');
    return;
  }

  const legacy = opened.db;
  const legacyStores = Array.from(legacy.objectStoreNames);
  if (legacyStores.length === 0) {
    // Fresh install: openLegacyDB just created an empty database for us.
    legacy.close();
    deleteLegacyDB();
    migrationState = 'clean';
    return;
  }

  const storeNames = legacyStores.filter((name) => {
    const known = db.objectStoreNames.contains(name);
    if (!known) console.warn(`[storage] loja "${name}" de narratips_db não existe em sessionmap_db; ignorada.`);
    return known;
  });
  if (storeNames.length === 0) {
    legacy.close();
    migrationState = 'unavailable';
    return;
  }

  let copied = true;

  for (const name of storeNames) {
    // Read and write are two separate transactions on purpose. A readwrite
    // transaction created before its requests would auto-commit while we are
    // still awaiting the legacy read, so it is created and filled in the same
    // task instead — that keeps it alive for the whole write.
    let records: unknown[];
    try {
      records = await new Promise<unknown[]>((resolve, reject) => {
        const source = legacy.transaction(name, 'readonly').objectStore(name).getAll();
        source.onsuccess = () => resolve(source.result || []);
        source.onerror = () => reject(source.error);
      });
    } catch (err) {
      console.warn(`[storage] leitura de "${name}" em narratips_db falhou`, err);
      copied = false;
      break;
    }
    if (records.length === 0) continue;

    const written = await new Promise<boolean>((resolve) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(name, 'readwrite');
      } catch (err) {
        console.warn(`[storage] transação de cópia de "${name}" não pôde ser criada`, err);
        resolve(false);
        return;
      }
      try {
        const target = tx.objectStore(name);
        for (const record of records) target.put(record);
      } catch (err) {
        console.warn(`[storage] cópia de "${name}" interrompida`, err);
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });

    if (!written) {
      copied = false;
      break;
    }
  }
  legacy.close();

  if (!copied) {
    // narratips_db is deliberately left untouched: it is still the only copy.
    // The legacy localStorage keys are kept for the same reason.
    migrationState = 'unavailable';
    console.warn('[storage] a cópia de narratips_db falhou; os dados antigos permanecem intactos.');
    return;
  }

  deleteLegacyDB();
  // The IndexedDB copy is committed, so it is now safe to drop the legacy
  // localStorage keys. This runs last, after the only irreversible step has
  // already succeeded.
  dropLegacyLocalStorageKeys();
  try {
    localStorage.setItem(IDB_MIGRATION_FLAG, new Date().toISOString());
  } catch {
    // ignore
  }
  migrationState = 'migrated';
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_MAPS)) {
        db.createObjectStore(STORE_MAPS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CLIENTS)) {
        db.createObjectStore(STORE_CLIENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORE_SNAPSHOTS, {
          keyPath: 'id',
          autoIncrement: true,
        });
        snapStore.createIndex('mapId', 'mapId', { unique: false });
      }
      // The records themselves are copied by migrateLegacyRecords() right
      // after the schema transaction commits: the upgrade transaction cannot
      // stay open across the async open of a second database, so copying
      // inside onupgradeneeded would silently write nothing.
    };

    request.onsuccess = () => {
      const db = request.result;
      migrateLegacyRecords(db).then(
        () => resolve(db),
        (err) => {
          console.warn('[storage] migração de narratips_db falhou', err);
          migrationState = 'unavailable';
          resolve(db);
        },
      );
    };
    request.onerror = () => reject(request.error);
    // Without this the promise hangs FOREVER when another tab holds the
    // database (host window + client window is exactly two tabs), and
    // every getAll/save hangs with it: the footer sticks on "Gravando…" and
    // the user reads it as "parou de salvar". Rejecting drops the callers
    // into their localStorage fallback instead of hanging.
    request.onblocked = () => {
      console.warn('[storage] IndexedDB bloqueado por outra aba; usando fallback local.');
      reject(new Error('IndexedDB blocked by another tab'));
    };
  });

  // A rejected open must not poison every later call: the block is transient
  // (the other tab closes, the upgrade finishes), so a failure clears the
  // cache and the next operation retries. Without this, one blocked open
  // made "parou de salvar" permanent until reload.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

// =================== CLIENT OPERATIONS ===================

export async function getAllClients(): Promise<Client[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CLIENTS, 'readonly');
      const store = tx.objectStore(STORE_CLIENTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const clients: Client[] = req.result || [];
        // An empty list stays empty: first install shows the empty state,
        // and deleting the last record never resurrects a sample.
        resolve(clients.sort((a, b) => a.name.localeCompare(b.name)));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const local = localStorage.getItem(LOCAL_CLIENTS_KEY);
    if (local) {
      try {
        return JSON.parse(local);
      } catch {
        // empty
      }
    }
    return [];
  }
}

export async function saveClient(client: Client): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLIENTS, 'readwrite');
      const store = tx.objectStore(STORE_CLIENTS);
      const req = store.put(client);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fallback reads localStorage DIRECTLY. Calling getAllClients() here
    // would re-enter getDB() and hang the same way this call just did.
    try {
      const raw = localStorage.getItem(LOCAL_CLIENTS_KEY);
      const clients: Client[] = raw ? JSON.parse(raw) : [];
      const idx = clients.findIndex((c) => c.id === client.id);
      if (idx >= 0) clients[idx] = client;
      else clients.push(client);
      localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(clients));
    } catch {
      // storage disabled: nothing left to try
    }
  }
}

export async function deleteClient(clientId: string): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLIENTS, 'readwrite');
      const store = tx.objectStore(STORE_CLIENTS);
      const req = store.delete(clientId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(LOCAL_CLIENTS_KEY);
      const clients: Client[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(
        LOCAL_CLIENTS_KEY,
        JSON.stringify(clients.filter((c) => c.id !== clientId))
      );
    } catch {
      // storage disabled: nothing left to try
    }
  }
}

export function getActiveClientId(): string | null {
  return localStorage.getItem(ACTIVE_CLIENT_KEY);
}

export function setActiveClientId(id: string): void {
  localStorage.setItem(ACTIVE_CLIENT_KEY, id);
}

// =================== CLIENT NOTES ===================
//
// A free-text scratchpad that belongs to the CLIENT, not to any session. It
// survives starting, switching and deleting sessions, and it is deliberately
// never broadcast: the client window receives the MindMap over the sync
// channel and nothing else, so these notes cannot reach the shared screen even
// by accident. That is the whole point of them — the host's own working
// notes about the person, which must never be projected to the person.

export async function getClientNotes(clientId: string): Promise<string> {
  const client = (await getAllClients()).find((c) => c.id === clientId);
  return client?.notes ?? '';
}

export async function saveClientNotes(clientId: string, notes: string): Promise<void> {
  const client = (await getAllClients()).find((c) => c.id === clientId);
  if (!client) return;
  // A no-op write would still stamp updatedAt and re-broadcast nothing, so it
  // is skipped: autosave fires on every keystroke's debounce.
  if ((client.notes ?? '') === notes) return;
  await saveClient({ ...client, notes });
}

// =================== ARCHIVE ===================
//
// Archiving is never destructive: it stamps archivedAt and the record stays in
// the same object store, so restoring is a single field write and no clinical
// data is ever rewritten. Unarchiving a client also unarchives its sessions,
// otherwise a restored client would open with an empty history.

/** Sessions of an archived client are archived too, so the two never disagree. */
export async function archiveMap(id: string): Promise<void> {
  const map = await getMap(id);
  if (!map || map.archivedAt) return;
  await saveMap({ ...map, archivedAt: new Date().toISOString() });
}

export async function unarchiveMap(id: string): Promise<void> {
  const map = await getMap(id);
  if (!map || !map.archivedAt) return;
  await saveMap({ ...map, archivedAt: null });
}

export async function archiveClient(clientId: string): Promise<void> {
  const stamp = new Date().toISOString();
  const client = (await getAllClients()).find((c) => c.id === clientId);
  if (client && !client.archivedAt) {
    await saveClient({ ...client, archivedAt: stamp });
  }
  const maps = await getAllMaps();
  for (const m of maps) {
    if (m.clientId === clientId && !m.archivedAt) {
      await saveMap({ ...m, archivedAt: stamp });
    }
  }
}

export async function unarchiveClient(clientId: string): Promise<void> {
  const client = (await getAllClients()).find((c) => c.id === clientId);
  if (client?.archivedAt) {
    await saveClient({ ...client, archivedAt: null });
  }
  const maps = await getAllMaps();
  for (const m of maps) {
    if (m.clientId === clientId && m.archivedAt) {
      await saveMap({ ...m, archivedAt: null });
    }
  }
}

/**
 * Permanently removes a client together with every session they have, archived
 * or not. Destructive and irreversible: callers must confirm first.
 */
export async function deleteClientAndSessions(clientId: string): Promise<number> {
  const maps = await getAllMaps();
  const own = maps.filter((m) => m.clientId === clientId);
  for (const m of own) {
    await deleteMap(m.id);
  }
  await deleteClient(clientId);
  return own.length;
}

/** Convenience predicates so the UI never compares archivedAt itself. */
export function isArchived(record: { archivedAt?: string | null }): boolean {
  return Boolean(record.archivedAt);
}

/**
 * Removes nodes the user created but never filled in.
 *
 * A node with empty text and no children is a placeholder, never a real
 * thought: it carries no content, and the layout, the client balloons and
 * every export format would still render it as "Sem título". Dropping it on
 * blur is what makes "create a row and leave" cancel itself.
 *
 * A blank node that HAS children is kept, because it is now a structural
 * parent and deleting it would take its subtree with it.
 *
 * The root is never removed: an empty root is a valid state (a session whose
 * topic has not been typed yet) and removing it would throw away the session.
 *
 * Returns the same object when nothing changed, so callers can cheaply skip a
 * no-op update and its autosave.
 */
export function pruneEmptyLeaves(root: MindMapNode): MindMapNode {
  const walk = (node: MindMapNode, isRoot: boolean): MindMapNode | null => {
    const original = node.children || [];
    const kept: MindMapNode[] = [];
    for (const child of original) {
      const result = walk(child, false);
      if (result) kept.push(result);
    }

    const isBlankLeaf = !isRoot && node.text.trim() === '' && original.length === 0;
    if (isBlankLeaf) return null;

    if (
      kept.length === original.length &&
      kept.every((c, i) => c === original[i])
    ) {
      return node;
    }
    return { ...node, children: kept };
  };

  return walk(root, true) ?? root;
}

/**
 * Applies both outline rules at once: no blank node keeps children (the
 * children are lifted into its place), and blank childless leaves are dropped.
 *
 * Used where a whole tree is committed, so a map that already accumulated
 * stacked blank rows — from an import, a paste, or a build before the
 * invariant existed — is repaired rather than preserved.
 */
export function tidyOutline(root: MindMapNode): MindMapNode {
  return pruneEmptyLeaves(normalizeOutline(root));
}

// =================== SESSION / MINDMAP OPERATIONS ===================

export function createNewSession(
  clientId: string,
  clientName: string,
  opts?: {
    /** Catalog id. Null/undefined = unclassified (the old default). */
    modalityId?: string | null;
    /** Template body: parsed straight into the starting tree. */
    templateMarkdown?: string | null;
    /** Overrides the default timestamp title (e.g. "Sessão 3"). */
    title?: string | null;
  }
): MindMap {
  const timestamp = formatSessionTimestamp();
  const newId = `m_${Date.now().toString(36)}`;
  const body = opts?.templateMarkdown?.trim() ?? '';
  return {
    schema: 1,
    id: newId,
    clientId,
    clientName,
    sessionDate: timestamp,
    title: opts?.title?.trim() ? opts.title : timestamp,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modalityId: opts?.modalityId ?? null,
    root: body
      ? parseMarkdownToTree(body, timestamp)
      : {
          id: generateNodeId(),
          text: timestamp,
          // No seeded first child. "Ponto Inicial" was a placeholder that had to
          // be selected and replaced, and if it was not, it survived into the
          // canvas as a balloon the host never wrote and every export
          // contained. The root row is itself the first thing to type into, so an
          // empty session now opens with exactly one editable line.
          children: [],
        },
    view: { zoom: 1, cx: 0, cy: 0 },
  };
}

export async function getAllMaps(): Promise<MindMap[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MAPS, 'readonly');
      const store = tx.objectStore(STORE_MAPS);
      const req = store.getAll();
      req.onsuccess = () => {
        let maps: MindMap[] = req.result || [];
        // Normalize maps to ensure client fields exist. archivedAt is
        // normalized too, so pre-archive records (which have no field at
        // all) and restored ones (null) behave identically to archived ones.
        maps = maps.map((m) => ({
          ...m,
          clientId: m.clientId || 'c_sem_participante',
          clientName: m.clientName || 'Participante',
          sessionDate: m.sessionDate || m.title || formatSessionTimestamp(new Date(m.createdAt)),
          archivedAt: m.archivedAt ?? null,
        }));
        resolve(maps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const local = localStorage.getItem(LOCAL_MAPS_KEY);
    if (local) {
      try {
        return JSON.parse(local);
      } catch {
        // empty
      }
    }
    return [];
  }
}

export async function getMap(id: string): Promise<MindMap | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MAPS, 'readonly');
      const store = tx.objectStore(STORE_MAPS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    const maps = await getAllMaps();
    return maps.find((m) => m.id === id) || null;
  }
}

export async function saveMap(map: MindMap, opts?: { stamp?: boolean }): Promise<void> {
  const updatedMap: MindMap =
    opts?.stamp === false ? map : { ...map, updatedAt: new Date().toISOString() };

  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MAPS, 'readwrite');
      const store = tx.objectStore(STORE_MAPS);
      const req = store.put(updatedMap);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Same as saveClient: direct localStorage, never via getAllMaps().
    try {
      const raw = localStorage.getItem(LOCAL_MAPS_KEY);
      const maps: MindMap[] = raw ? JSON.parse(raw) : [];
      const idx = maps.findIndex((m) => m.id === updatedMap.id);
      if (idx >= 0) maps[idx] = updatedMap;
      else maps.push(updatedMap);
      localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(maps));
    } catch {
      // storage disabled: nothing left to try
    }
  }

  try {
    // A maintenance write (reclassifying a kind, restoring a pending root)
    // must not steal the recency order: only a real edit stamps updatedAt
    // and advertises itself as the active session.
    if (opts?.stamp !== false) {
      localStorage.setItem(CACHED_ACTIVE_MAP_KEY, JSON.stringify(updatedMap));
      localStorage.setItem(ACTIVE_MAP_KEY, updatedMap.id);
    }
  } catch {
    // quota
  }
}

// =================== PENDING ROOT (beforeunload) ===================
//
// The outline parses on a 400ms debounce and the autosave waits another
// 400ms, so the freshest keystrokes live only in the textarea DOM. A refresh
// or tab close inside that window used to drop them: async IndexedDB writes
// never complete inside beforeunload. The synchronous localStorage write
// below DOES complete, and refreshAllData() reconciles it on the next load:
// applied only when it is newer than what storage holds, then cleared, so a
// stale entry can never resurrect itself.

const PENDING_ROOT_KEY = 'sessionmap_pending_root';

export interface PendingRoot {
  mapId: string;
  root: MindMapNode;
  savedAt: string;
}

export function writePendingRoot(mapId: string, root: MindMapNode): void {
  try {
    const payload: PendingRoot = {
      mapId,
      root,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(PENDING_ROOT_KEY, JSON.stringify(payload));
  } catch {
    // quota or storage disabled: the debounced autosave already did its best
  }
}

export function readPendingRoot(): PendingRoot | null {
  try {
    const raw = localStorage.getItem(PENDING_ROOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRoot;
    if (!parsed || typeof parsed.mapId !== 'string' || !parsed.root) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingRoot(): void {
  try {
    localStorage.removeItem(PENDING_ROOT_KEY);
  } catch {
    // ignore
  }
}

/**
 * Applies a pending root left by beforeunload, if it is still newer than
 * storage. Returns true when something was written.
 */
export async function reconcilePendingRoot(): Promise<boolean> {
  const pending = readPendingRoot();
  if (!pending) return false;
  try {
    const stored = await getMap(pending.mapId);
    if (!stored) {
      clearPendingRoot();
      return false;
    }
    const same = JSON.stringify(stored.root) === JSON.stringify(pending.root);
    // Another tab may have saved after this entry was written: storage wins.
    const stale = (stored.updatedAt || '') > pending.savedAt;
    if (same || stale) {
      clearPendingRoot();
      return false;
    }
    await saveMap(
      { ...stored, root: tidyOutline(pending.root), updatedAt: new Date().toISOString() },
      { stamp: false }
    );
    clearPendingRoot();
    return true;
  } catch {
    // IDB hiccup: keep the entry so the next load retries.
    return false;
  }
}

export async function deleteMap(id: string): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MAPS, 'readwrite');
      const store = tx.objectStore(STORE_MAPS);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(LOCAL_MAPS_KEY);
      const maps: MindMap[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(
        LOCAL_MAPS_KEY,
        JSON.stringify(maps.filter((m) => m.id !== id))
      );
    } catch {
      // storage disabled: nothing left to try
    }
  }
}

export function getActiveMapId(): string | null {
  return localStorage.getItem(ACTIVE_MAP_KEY);
}

export function setActiveMapId(id: string): void {
  localStorage.setItem(ACTIVE_MAP_KEY, id);
}

export function getCachedActiveMap(): MindMap | null {
  try {
    const raw = localStorage.getItem(CACHED_ACTIVE_MAP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      /* The pane width is bounded on READ, not only on write. A value stored by
         a build whose range was different — or a number that arrived from
         somewhere else entirely — must not be able to render the pane off
         screen, and the only place that is guaranteed is the read. */
      return { ...merged, outlineWidthPercent: clampOutlineWidth(merged.outlineWidthPercent) };
    }
    // First run: no stored choice yet. The landing page's own key wins when
    // present — it holds what the user picked (or was detected) there — and
    // the PT default stands otherwise. Stored settings always win after.
    return { ...DEFAULT_SETTINGS, language: readLandingLanguage() ?? DEFAULT_SETTINGS.language };
  } catch {
    // fallback
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // fallback
  }
}

/**
 * The landing page's language key (`sessionmap_landing_lang`), shared both
 * ways: the landing writes the picked-or-detected language, the app reads it
 * on first run (see getSettings), and the app writes it back whenever the
 * in-app language changes — so returning to the landing keeps the app choice.
 * Plain strings, validated on read: anything else falls back to PT.
 */
const LANDING_LANG_KEY = 'sessionmap_landing_lang';

function readLandingLanguage(): Settings['language'] | null {
  try {
    const v = localStorage.getItem(LANDING_LANG_KEY);
    return v === 'pt' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

export function rememberLandingLanguage(lang: Settings['language']): void {
  try {
    localStorage.setItem(LANDING_LANG_KEY, lang);
  } catch {
    // Private mode: the app choice still applies, the landing just won't know.
  }
}

export async function saveSnapshot(mapId: string, root: MindMapNode): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(STORE_SNAPSHOTS);
    store.add({
      mapId,
      timestamp: new Date().toISOString(),
      root,
    });
  } catch {
    // ignore
  }
}

// =================== MODALITIES & TEMPLATES ===================
//
// The catalog lives in localStorage, not IndexedDB, on purpose: it is a few
// dozen small rows read on every render, and a schema upgrade plus an async
// load for that would buy nothing. Sessions reference it by id and degrade
// to "sem tipo" when the id is gone, so deleting a catalog entry never
// corrupts a clinical record.

const MODALITIES_KEY = 'sessionmap_modalities';
const TEMPLATES_KEY = 'sessionmap_templates';

/**
 * The catalog starts EMPTY on a fresh browser — no sample kinds, no sample
 * skeletons. Seeding "Mentoria / Consultoria / Reunião" taught every new
 * user that the catalog was fixed furniture instead of their own workspace:
 * nobody wondered where types come from, because three were always there.
 * An empty catalog with a guided empty state (see NewSessionDialog) turns
 * the first session into the moment the user discovers the catalog, instead
 * of never discovering it.
 *
 * Existing installs keep whatever they already have: this only changes the
 * first read on a machine that stored nothing yet. Backup/restore stays
 * additive, so an old file with seeds still merges them in.
 */
export function loadModalities(): Modality[] {
  try {
    const raw = localStorage.getItem(MODALITIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Modality[];
      if (Array.isArray(parsed)) return migrateModalityNames(parsed);
    }
  } catch {
    return [];
  }
  persistModalities([]);
  return [];
}

/**
 * One-time rename of the legacy catalog: the ids stay (sessions point
 * at them), only the display names go generic. Runs on read, so it applies
 * to existing installs without a migration pass — and it only touches rows
 * the user never renamed themselves.
 */
function migrateModalityNames(modalities: Modality[]): Modality[] {  let changed = false;
  const next = modalities.map((m) => {
    if (m.id === 'mod_terapia' && m.name === 'Terapia') {
      changed = true;
      return { ...m, name: 'Reunião' };
    }
    return m;
  });
  if (changed) persistModalities(next);
  return next;
}

/** Same one-time rename for the seeded template title. The body is kept as
 *  the user may have edited it — only an untouched title is retitled. */
function migrateTemplateNames(templates: SessionTemplate[]): SessionTemplate[] {
  let changed = false;
  const next = templates.map((t) => {
    if (t.id === 'tpl_seed_0' && t.title === 'Sessão de terapia') {
      changed = true;
      return { ...t, title: 'Reunião', modalityId: 'mod_terapia' };
    }
    return t;
  });
  if (changed) persistTemplates(next);
  return next;
}

export function persistModalities(modalities: Modality[]): void {
  try {
    localStorage.setItem(MODALITIES_KEY, JSON.stringify(modalities));
  } catch {
    // quota: the in-memory list still works for this session
  }
}

export function modalityName(modalities: Modality[], id: string | null | undefined): string | null {
  if (!id) return null;
  return modalities.find((m) => m.id === id)?.name ?? null;
}

/**
 * Deletes a catalog entry and unclassifies every session that used it.
 * Sessions are never deleted with their kind: the record stays, the label
 * goes, and the session reads "sem tipo" until reclassified.
 */
export async function deleteModalityAndClear(modalityId: string): Promise<void> {
  persistModalities(loadModalities().filter((m) => m.id !== modalityId));
  const maps = await getAllMaps();
  for (const m of maps) {
    if (m.modalityId === modalityId) {
      // No stamp: unlabelling is maintenance, not an edit, and stamping
      // every session would shove them all to the top of the recency order.
      await saveMap({ ...m, modalityId: null }, { stamp: false });
    }
  }
}

export function loadTemplates(): SessionTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionTemplate[];
      if (Array.isArray(parsed)) return migrateTemplateNames(parsed);
    }
  } catch {
    return [];
  }
  persistTemplates([]);
  return [];
}

export function persistTemplates(templates: SessionTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // quota: the in-memory list still works for this session
  }
}

/** Templates offered for a modality: its own plus the general ones. */
export function templatesFor(
  templates: SessionTemplate[],
  modalityId: string | null
): SessionTemplate[] {
  return templates.filter(
    (t) => t.modalityId === null || t.modalityId === modalityId
  );
}

/** The union of a client's sessions' kinds, for the badge on their row. */
export function clientModalityIds(
  maps: MindMap[],
  clientId: string
): string[] {
  const ids = new Set<string>();
  for (const m of maps) {
    if (m.clientId === clientId && m.modalityId && !isArchived(m)) ids.add(m.modalityId);
  }
  return [...ids];
}

// =================== FULL BACKUP (envelope + restore) ===================
//
// The old backup was a bare array of sessions: clients came along only as
// denormalized names inside each map, and the kind catalog plus the
// templates lived nowhere in the file. Restoring on a fresh machine showed
// every session as "sem tipo" and lost every skeleton. The envelope carries
// all four collections with a format version, and the restore reads both the
// envelope and the legacy bare array.

export const BACKUP_FORMAT = 1;

export interface BackupEnvelope {
  app: 'sessionmap';
  format: number;
  exportedAt: string;
  clients: Client[];
  maps: MindMap[];
  modalities: Modality[];
  templates: SessionTemplate[];
}

export async function buildFullBackup(): Promise<BackupEnvelope> {
  const [clients, maps] = await Promise.all([getAllClients(), getAllMaps()]);
  return {
    app: 'sessionmap',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    clients,
    maps,
    modalities: loadModalities(),
    templates: loadTemplates(),
  };
}

export interface RestoreCounts {
  clients: number;
  maps: number;
  modalities: number;
  templates: number;
}

/**
 * Merges a backup file into this browser. Accepts the envelope and the
 * legacy bare-array-of-sessions shape.
 *
 * Sessions and clients are restored by id (the file wins: it IS the restore
 * point). Catalog entries are ADDITIVE — only ids this browser does not have
 * are added, so a locally renamed kind is never renamed back by an old file.
 * Unknown-kind sessions degrade to "sem tipo" on their own.
 */
export async function restoreFullBackup(data: unknown): Promise<RestoreCounts> {
  const counts: RestoreCounts = { clients: 0, maps: 0, modalities: 0, templates: 0 };
  let clients: Client[] = [];
  let maps: MindMap[] = [];
  let modalities: Modality[] = [];
  let templates: SessionTemplate[] = [];

  if (Array.isArray(data)) {
    maps = data as MindMap[];
  } else if (
    data &&
    typeof data === 'object' &&
    (data as BackupEnvelope).app === 'sessionmap' &&
    Array.isArray((data as BackupEnvelope).maps)
  ) {
    const env = data as BackupEnvelope;
    clients = Array.isArray(env.clients) ? env.clients : [];
    maps = env.maps;
    modalities = Array.isArray(env.modalities) ? env.modalities : [];
    templates = Array.isArray(env.templates) ? env.templates : [];
  } else {
    throw new Error('Formato de backup não reconhecido');
  }

  for (const c of clients) {
    if (c && typeof c.id === 'string') {
      await saveClient(c);
      counts.clients += 1;
    }
  }
  // Sessions imply their clients: a legacy file has no client rows, so
  // ensure every referenced client exists before the maps land.
  const knownClientIds = new Set((await getAllClients()).map((c) => c.id));
  for (const m of maps) {
    if (!m || typeof m.id !== 'string') continue;
    if (m.clientId && !knownClientIds.has(m.clientId)) {
      await saveClient({
        id: m.clientId,
        name: m.clientName || 'Participante',
        createdAt: m.createdAt || new Date().toISOString(),
      });
      knownClientIds.add(m.clientId);
      counts.clients += 1;
    }
    // No stamp: a restore must not re-stamp every record (that would reorder
    // the recency list AND hijack the active session via ACTIVE_MAP_KEY).
    // The file's own updatedAt is the truth about recency.
    await saveMap(m, { stamp: false });
    counts.maps += 1;
  }

  if (modalities.length > 0) {
    const have = new Set(loadModalities().map((m) => m.id));
    const merged = migrateModalityNames([
      ...loadModalities(),
      ...modalities.filter((m) => m && typeof m.id === 'string' && !have.has(m.id)),
    ]);
    counts.modalities = merged.length - have.size;
    persistModalities(merged);
  }
  if (templates.length > 0) {
    const have = new Set(loadTemplates().map((t) => t.id));
    const merged = migrateTemplateNames([
      ...loadTemplates(),
      ...templates.filter((t) => t && typeof t.id === 'string' && !have.has(t.id)),
    ]);
    counts.templates = merged.length - have.size;
    persistTemplates(merged);
  }
  return counts;
}
