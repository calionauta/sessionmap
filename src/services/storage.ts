import { Client, MindMap, MindMapNode, Settings } from '../types';
import { formatSessionTimestamp, generateNodeId } from '../utils/tree';

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
  liveTextMode: 'live',
  thinBarAlwaysVisible: false,
  focusDwellSeconds: 3,
  autoFitOnAdd: true,
  clientFontScale: 1.0,
  focusZoomMode: true, // Default to true so therapist can see focus zoom in action!
};

const DEFAULT_SAMPLE_CLIENT: Client = {
  id: 'c_ana_m',
  name: 'Ana M.',
  createdAt: '2026-09-28T09:00:00Z',
  notes: 'Sessões semanais · Foco em equilíbrio trabalho e família',
};

const SAMPLE_SESSION_DATE = '28/09/2026 14:08:17';

const INITIAL_SAMPLE_MAP: MindMap = {
  schema: 1,
  id: 'm_sample_anam_1',
  clientId: DEFAULT_SAMPLE_CLIENT.id,
  clientName: DEFAULT_SAMPLE_CLIENT.name,
  sessionDate: SAMPLE_SESSION_DATE,
  title: SAMPLE_SESSION_DATE,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  root: {
    id: 'n_root',
    text: SAMPLE_SESSION_DATE,
    collapsed: false,
    children: [
      {
        id: 'n_trab',
        text: 'Trabalho',
        collapsed: false,
        children: [
          { id: 'n_t1', text: 'cansaço no fim do dia', children: [] },
          { id: 'n_t2', text: 'chefe cobra prazos curtos', children: [] },
        ],
      },
      {
        id: 'n_fam',
        text: 'Família',
        collapsed: false,
        children: [
          { id: 'n_f1', text: 'mãe apoia e escuta', children: [] },
          { id: 'n_f2', text: 'rotina com o irmão', children: [] },
        ],
      },
      {
        id: 'n_amig',
        text: 'Amigos',
        collapsed: false,
        children: [
          { id: 'n_a1', text: 'reencontro no sábado', children: [] },
        ],
      },
    ],
  },
  view: { zoom: 1, x: 0, y: 0 },
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
// the old settings nor the new ones, and migrationState='unavailable'
// additionally suppresses the sample seed, so the app would open empty.
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

/** Sample data must never be seeded on top of a legacy database we could not read. */
function canSeedDefaults(): boolean {
  return migrationState !== 'unavailable';
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
        let clients: Client[] = req.result || [];
        if (clients.length === 0 && canSeedDefaults()) {
          saveClient(DEFAULT_SAMPLE_CLIENT);
          clients = [DEFAULT_SAMPLE_CLIENT];
        }
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
    const defaultList = [DEFAULT_SAMPLE_CLIENT];
    localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(defaultList));
    return defaultList;
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
    const clients = await getAllClients();
    const idx = clients.findIndex((c) => c.id === client.id);
    if (idx >= 0) clients[idx] = client;
    else clients.push(client);
    localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(clients));
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
    const clients = await getAllClients();
    const filtered = clients.filter((c) => c.id !== clientId);
    localStorage.setItem(LOCAL_CLIENTS_KEY, JSON.stringify(filtered));
  }
}

export function getActiveClientId(): string | null {
  return localStorage.getItem(ACTIVE_CLIENT_KEY);
}

export function setActiveClientId(id: string): void {
  localStorage.setItem(ACTIVE_CLIENT_KEY, id);
}

// =================== SESSION / MINDMAP OPERATIONS ===================

export function createNewSession(clientId: string, clientName: string): MindMap {
  const timestamp = formatSessionTimestamp();
  const newId = `m_${Date.now().toString(36)}`;
  return {
    schema: 1,
    id: newId,
    clientId,
    clientName,
    sessionDate: timestamp,
    title: timestamp,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    root: {
      id: generateNodeId(),
      text: timestamp,
      children: [
        { id: generateNodeId(), text: 'Ponto Inicial', children: [] },
      ],
    },
    view: { zoom: 1, x: 0, y: 0 },
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
        if (maps.length === 0 && canSeedDefaults()) {
          saveMap(INITIAL_SAMPLE_MAP);
          maps = [INITIAL_SAMPLE_MAP];
        }
        // Normalize maps to ensure client fields exist
        maps = maps.map((m) => ({
          ...m,
          clientId: m.clientId || DEFAULT_SAMPLE_CLIENT.id,
          clientName: m.clientName || 'Cliente',
          sessionDate: m.sessionDate || m.title || formatSessionTimestamp(new Date(m.createdAt)),
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
    const defaultList = [INITIAL_SAMPLE_MAP];
    localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(defaultList));
    return defaultList;
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

export async function saveMap(map: MindMap): Promise<void> {
  const updatedMap: MindMap = {
    ...map,
    updatedAt: new Date().toISOString(),
  };

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
    const maps = await getAllMaps();
    const idx = maps.findIndex((m) => m.id === updatedMap.id);
    if (idx >= 0) maps[idx] = updatedMap;
    else maps.push(updatedMap);
    localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(maps));
  }

  try {
    localStorage.setItem(CACHED_ACTIVE_MAP_KEY, JSON.stringify(updatedMap));
    localStorage.setItem(ACTIVE_MAP_KEY, updatedMap.id);
  } catch {
    // quota
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
    const maps = await getAllMaps();
    const filtered = maps.filter((m) => m.id !== id);
    localStorage.setItem(LOCAL_MAPS_KEY, JSON.stringify(filtered));
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
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
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
