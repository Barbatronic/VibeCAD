/**
 * Stockage local des projets dans IndexedDB (navigateur). Les données restent sur l'appareil ;
 * rien n'est transmis. Le stockage du navigateur peut être effacé ou saturé : l'interface
 * rappelle de télécharger une copie du projet (« Enregistrer sous… »).
 */
import type { Id } from '../domain/model';

const DB_NAME = 'vibecad';
const DB_VERSION = 1;

export interface ProjectRecord {
  id: Id;
  name: string;
  /** Date du dernier enregistrement explicite. */
  savedAt: string;
  /** Contenu au format natif (texte JSON). */
  text: string;
  size: number;
}

export type ProjectSummary = Omit<ProjectRecord, 'text'>;

export interface AutosaveRecord {
  projectId: Id;
  name: string;
  savedAt: string;
  text: string;
  /** Date de l'enregistrement explicite dont dérive cette sauvegarde (null : jamais enregistré). */
  basedOnSavedAt: string | null;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Erreur IndexedDB'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Erreur IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB interrompue'));
  });
}

export class ProjectStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(factory: IDBFactory = globalThis.indexedDB): Promise<ProjectStore> {
    return new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error('IndexedDB indisponible'));
        return;
      }
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('autosaves')) db.createObjectStore('autosaves', { keyPath: 'projectId' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(new ProjectStore(req.result));
      req.onerror = () => reject(req.error ?? new Error('Ouverture IndexedDB impossible'));
      req.onblocked = () => reject(new Error('La base locale est utilisée par un autre onglet.'));
    });
  }

  private async put(store: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await transactionDone(tx);
  }

  private async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    return (await promisify(tx.objectStore(store).get(key))) as T | undefined;
  }

  private async delete(store: string, key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const tx = this.db.transaction('projects', 'readonly');
    const all = (await promisify(tx.objectStore('projects').getAll())) as ProjectRecord[];
    return all
      .map(({ text: _text, ...summary }) => summary)
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  getProject(id: Id): Promise<ProjectRecord | undefined> {
    return this.get('projects', id);
  }

  putProject(record: ProjectRecord): Promise<void> {
    return this.put('projects', record);
  }

  async deleteProject(id: Id): Promise<void> {
    await this.delete('projects', id);
    await this.delete('autosaves', id);
  }

  getAutosave(projectId: Id): Promise<AutosaveRecord | undefined> {
    return this.get('autosaves', projectId);
  }

  async listAutosaves(): Promise<Omit<AutosaveRecord, 'text'>[]> {
    const tx = this.db.transaction('autosaves', 'readonly');
    const all = (await promisify(tx.objectStore('autosaves').getAll())) as AutosaveRecord[];
    return all.map(({ text: _text, ...rest }) => rest).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  putAutosave(record: AutosaveRecord): Promise<void> {
    return this.put('autosaves', record);
  }

  deleteAutosave(projectId: Id): Promise<void> {
    return this.delete('autosaves', projectId);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    const rec = await this.get<{ key: string; value: T }>('settings', key);
    return rec?.value;
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.put('settings', { key, value });
  }

  close(): void {
    this.db.close();
  }
}

export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/** Demande au navigateur de ne pas effacer le stockage automatiquement (si possible). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
