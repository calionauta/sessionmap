import { Client, MindMap, MindMapNode, Settings } from '../types';
import { formatSessionTimestamp, generateNodeId } from '../utils/tree';

const DB_NAME = 'narratips_db';
const DB_VERSION = 2;
const STORE_MAPS = 'maps';
const STORE_CLIENTS = 'clients';
const STORE_SNAPSHOTS = 'snapshots';
const SETTINGS_KEY = 'narratips_settings';
const ACTIVE_MAP_KEY = 'narratips_active_map_id';
const ACTIVE_CLIENT_KEY = 'narratips_active_client_id';

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

let dbPromise: Promise<IDBDatabase> | null = null;

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
    };

    request.onsuccess = () => resolve(request.result);
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
        if (clients.length === 0) {
          saveClient(DEFAULT_SAMPLE_CLIENT);
          clients = [DEFAULT_SAMPLE_CLIENT];
        }
        resolve(clients.sort((a, b) => a.name.localeCompare(b.name)));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const local = localStorage.getItem('narratips_clients');
    if (local) {
      try {
        return JSON.parse(local);
      } catch {
        // empty
      }
    }
    const defaultList = [DEFAULT_SAMPLE_CLIENT];
    localStorage.setItem('narratips_clients', JSON.stringify(defaultList));
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
    localStorage.setItem('narratips_clients', JSON.stringify(clients));
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
    localStorage.setItem('narratips_clients', JSON.stringify(filtered));
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
        if (maps.length === 0) {
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
    const local = localStorage.getItem('narratips_maps');
    if (local) {
      try {
        return JSON.parse(local);
      } catch {
        // empty
      }
    }
    const defaultList = [INITIAL_SAMPLE_MAP];
    localStorage.setItem('narratips_maps', JSON.stringify(defaultList));
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
    localStorage.setItem('narratips_maps', JSON.stringify(maps));
  }

  try {
    localStorage.setItem('narratips_active_map', JSON.stringify(updatedMap));
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
    localStorage.setItem('narratips_maps', JSON.stringify(filtered));
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
    const raw = localStorage.getItem('narratips_active_map');
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
