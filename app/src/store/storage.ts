// ─── Storage Engine ──────────────────────────────────────────────────────────
// IndexedDB-based storage replacing localStorage for project persistence.
// IndexedDB supports:
// - No 5MB limit (100MB+ supported)
// - Async operations (non-blocking)
// - Structured data (no JSON.stringify needed)
// - Multiple object stores (projects, settings, symbols, etc.)

import type { SchematicState, BoardState, SchNet } from '../types';
import type { DesignRulesConfig } from './designRules';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectMetadata {
  name: string;
  version: string;
  createdAt: string;
  modifiedAt: string;
  author: string;
  description: string;
}

export interface ProjectData {
  metadata: ProjectMetadata;
  schematic: SchematicState;
  board: BoardState;
  nets: SchNet[];
  designRules: DesignRulesConfig;
}

export interface ProjectMeta {
  id: string;
  name: string;
  modifiedAt: string;
  createdAt: string;
  componentCount: number;
  netCount: number;
  thumbnail?: string; // base64 data URL
}

export interface StorageEngine {
  init(): Promise<void>;
  saveProject(id: string, data: ProjectData): Promise<void>;
  loadProject(id: string): Promise<ProjectData | null>;
  listProjects(): Promise<ProjectMeta[]>;
  deleteProject(id: string): Promise<void>;
  saveSettings(settings: any): Promise<void>;
  loadSettings(): Promise<any>;
  saveCustomSymbol(id: string, data: any): Promise<void>;
  loadCustomSymbols(): Promise<any[]>;
  saveCustomFootprint(id: string, data: any): Promise<void>;
  loadCustomFootprints(): Promise<any[]>;
  cacheKicadSymbol(id: string, data: any): Promise<void>;
  loadCachedKicadSymbol(id: string): Promise<any | null>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DB_NAME = 'routeai';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_PROJECT_META = 'project_meta';
const STORE_SETTINGS = 'settings';
const STORE_CUSTOM_SYMBOLS = 'custom_symbols';
const STORE_CUSTOM_FOOTPRINTS = 'custom_footprints';
const STORE_KICAD_SYMBOL_CACHE = 'kicad_symbol_cache';

// ─── IndexedDB Implementation ────────────────────────────────────────────────

class IndexedDBStorage implements StorageEngine {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Full project data
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }

        // Lightweight project metadata index
        if (!db.objectStoreNames.contains(STORE_PROJECT_META)) {
          const metaStore = db.createObjectStore(STORE_PROJECT_META, { keyPath: 'id' });
          metaStore.createIndex('modifiedAt', 'modifiedAt', { unique: false });
          metaStore.createIndex('name', 'name', { unique: false });
        }

        // User preferences
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }

        // User-created symbols
        if (!db.objectStoreNames.contains(STORE_CUSTOM_SYMBOLS)) {
          db.createObjectStore(STORE_CUSTOM_SYMBOLS, { keyPath: 'id' });
        }

        // User-created footprints
        if (!db.objectStoreNames.contains(STORE_CUSTOM_FOOTPRINTS)) {
          db.createObjectStore(STORE_CUSTOM_FOOTPRINTS, { keyPath: 'id' });
        }

        // Cached KiCad symbol fetches
        if (!db.objectStoreNames.contains(STORE_KICAD_SYMBOL_CACHE)) {
          db.createObjectStore(STORE_KICAD_SYMBOL_CACHE, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };
    });
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) {
      throw new Error('IndexedDB not initialized. Call init() first.');
    }
    return this.db;
  }

  private tx(
    storeNames: string | string[],
    mode: IDBTransactionMode,
  ): IDBTransaction {
    return this.ensureDb().transaction(storeNames, mode);
  }

  private putRecord(storeName: string, record: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private getRecord<T>(storeName: string, key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.tx(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  private getAllRecords<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.tx(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  private deleteRecord(storeName: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  async saveProject(id: string, data: ProjectData): Promise<void> {
    // Save full project data
    await this.putRecord(STORE_PROJECTS, { id, ...data });

    // Save lightweight metadata
    const meta: ProjectMeta & { id: string } = {
      id,
      name: data.metadata.name,
      modifiedAt: data.metadata.modifiedAt,
      createdAt: data.metadata.createdAt,
      componentCount: data.schematic.components.length,
      netCount: data.nets.length,
    };
    await this.putRecord(STORE_PROJECT_META, meta);
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    const record = await this.getRecord<{ id: string } & ProjectData>(
      STORE_PROJECTS,
      id,
    );
    if (!record) return null;
    // Strip the synthetic 'id' key used as keyPath
    const { id: _id, ...data } = record;
    return data as ProjectData;
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const metas = await this.getAllRecords<ProjectMeta>(STORE_PROJECT_META);
    // Sort by most recently modified first
    return metas.sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );
  }

  async deleteProject(id: string): Promise<void> {
    await this.deleteRecord(STORE_PROJECTS, id);
    await this.deleteRecord(STORE_PROJECT_META, id);
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async saveSettings(settings: any): Promise<void> {
    await this.putRecord(STORE_SETTINGS, { key: 'user_settings', ...settings });
  }

  async loadSettings(): Promise<any> {
    const record = await this.getRecord<any>(STORE_SETTINGS, 'user_settings');
    if (!record) return null;
    const { key: _key, ...settings } = record;
    return settings;
  }

  // ── Custom Symbols ───────────────────────────────────────────────────────

  async saveCustomSymbol(id: string, data: any): Promise<void> {
    await this.putRecord(STORE_CUSTOM_SYMBOLS, { id, ...data });
  }

  async loadCustomSymbols(): Promise<any[]> {
    return this.getAllRecords(STORE_CUSTOM_SYMBOLS);
  }

  // ── Custom Footprints ────────────────────────────────────────────────────

  async saveCustomFootprint(id: string, data: any): Promise<void> {
    await this.putRecord(STORE_CUSTOM_FOOTPRINTS, { id, ...data });
  }

  async loadCustomFootprints(): Promise<any[]> {
    return this.getAllRecords(STORE_CUSTOM_FOOTPRINTS);
  }

  // ── KiCad Symbol Cache ───────────────────────────────────────────────────

  async cacheKicadSymbol(id: string, data: any): Promise<void> {
    await this.putRecord(STORE_KICAD_SYMBOL_CACHE, {
      id,
      data,
      cachedAt: new Date().toISOString(),
    });
  }

  async loadCachedKicadSymbol(id: string): Promise<any | null> {
    const record = await this.getRecord<{ id: string; data: any }>(
      STORE_KICAD_SYMBOL_CACHE,
      id,
    );
    return record?.data ?? null;
  }
}

// ─── LocalStorage Fallback ───────────────────────────────────────────────────
// For browsers that do not support IndexedDB (rare, but possible in
// private/incognito modes of some older browsers).

class LocalStorageFallback implements StorageEngine {
  private prefix = 'routeai_';

  async init(): Promise<void> {
    // Nothing to initialize
  }

  async saveProject(id: string, data: ProjectData): Promise<void> {
    try {
      localStorage.setItem(
        `${this.prefix}project_${id}`,
        JSON.stringify(data),
      );
      // Update meta index
      const metas = await this.listProjects();
      const existing = metas.findIndex((m) => m.id === id);
      const meta: ProjectMeta = {
        id,
        name: data.metadata.name,
        modifiedAt: data.metadata.modifiedAt,
        createdAt: data.metadata.createdAt,
        componentCount: data.schematic.components.length,
        netCount: data.nets.length,
      };
      if (existing >= 0) {
        metas[existing] = meta;
      } else {
        metas.unshift(meta);
      }
      localStorage.setItem(
        `${this.prefix}project_index`,
        JSON.stringify(metas),
      );
    } catch (e) {
      console.warn('LocalStorage fallback: failed to save project:', e);
    }
  }

  async loadProject(id: string): Promise<ProjectData | null> {
    try {
      const raw = localStorage.getItem(`${this.prefix}project_${id}`);
      if (!raw) return null;
      return JSON.parse(raw) as ProjectData;
    } catch {
      return null;
    }
  }

  async listProjects(): Promise<ProjectMeta[]> {
    try {
      const raw = localStorage.getItem(`${this.prefix}project_index`);
      if (!raw) return [];
      return JSON.parse(raw) as ProjectMeta[];
    } catch {
      return [];
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      localStorage.removeItem(`${this.prefix}project_${id}`);
      const metas = await this.listProjects();
      const filtered = metas.filter((m) => m.id !== id);
      localStorage.setItem(
        `${this.prefix}project_index`,
        JSON.stringify(filtered),
      );
    } catch {
      // ignore
    }
  }

  async saveSettings(settings: any): Promise<void> {
    try {
      localStorage.setItem(
        `${this.prefix}settings`,
        JSON.stringify(settings),
      );
    } catch {
      // ignore
    }
  }

  async loadSettings(): Promise<any> {
    try {
      const raw = localStorage.getItem(`${this.prefix}settings`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async saveCustomSymbol(id: string, data: any): Promise<void> {
    try {
      const all = await this.loadCustomSymbols();
      const idx = all.findIndex((s: any) => s.id === id);
      const record = { id, ...data };
      if (idx >= 0) all[idx] = record;
      else all.push(record);
      localStorage.setItem(`${this.prefix}custom_symbols`, JSON.stringify(all));
    } catch {
      // ignore
    }
  }

  async loadCustomSymbols(): Promise<any[]> {
    try {
      const raw = localStorage.getItem(`${this.prefix}custom_symbols`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async saveCustomFootprint(id: string, data: any): Promise<void> {
    try {
      const all = await this.loadCustomFootprints();
      const idx = all.findIndex((f: any) => f.id === id);
      const record = { id, ...data };
      if (idx >= 0) all[idx] = record;
      else all.push(record);
      localStorage.setItem(
        `${this.prefix}custom_footprints`,
        JSON.stringify(all),
      );
    } catch {
      // ignore
    }
  }

  async loadCustomFootprints(): Promise<any[]> {
    try {
      const raw = localStorage.getItem(`${this.prefix}custom_footprints`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  async cacheKicadSymbol(id: string, data: any): Promise<void> {
    try {
      const cache = this.loadKicadCache();
      cache[id] = { data, cachedAt: new Date().toISOString() };
      localStorage.setItem(
        `${this.prefix}kicad_cache`,
        JSON.stringify(cache),
      );
    } catch {
      // ignore
    }
  }

  async loadCachedKicadSymbol(id: string): Promise<any | null> {
    try {
      const cache = this.loadKicadCache();
      return cache[id]?.data ?? null;
    } catch {
      return null;
    }
  }

  private loadKicadCache(): Record<string, { data: any; cachedAt: string }> {
    try {
      const raw = localStorage.getItem(`${this.prefix}kicad_cache`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _storage: StorageEngine | null = null;

/**
 * Auto-detect best available storage and return a singleton engine.
 * Prefers IndexedDB; falls back to localStorage if unavailable.
 */
export function createStorage(): StorageEngine {
  if (_storage) return _storage;

  if (typeof indexedDB !== 'undefined') {
    _storage = new IndexedDBStorage();
  } else {
    console.warn(
      'IndexedDB not available, falling back to localStorage. ' +
        'Large projects may exceed the 5MB storage quota.',
    );
    _storage = new LocalStorageFallback();
  }

  return _storage;
}

/**
 * Get the storage engine singleton. Throws if createStorage() has not been called.
 */
export function getStorage(): StorageEngine {
  if (!_storage) {
    _storage = createStorage();
  }
  return _storage;
}

/**
 * Migrate existing localStorage autosave data into IndexedDB.
 * Called once during app initialization. Removes the old key after migration.
 */
export async function migrateFromLocalStorage(): Promise<boolean> {
  const LEGACY_KEY = 'routeai_project_autosave';
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw) as ProjectData;
    if (!data.metadata || !data.schematic || !data.board) return false;

    const storage = getStorage();
    await storage.init();
    await storage.saveProject('autosave', data);

    // Remove old localStorage entry to free space
    localStorage.removeItem(LEGACY_KEY);
    console.info('Migrated autosave from localStorage to IndexedDB.');
    return true;
  } catch (e) {
    console.warn('Failed to migrate from localStorage:', e);
    return false;
  }
}
