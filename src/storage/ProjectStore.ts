export interface Project { id: string; name: string; createdAt: number; updatedAt: number }
export interface ProjectFile { projectId: string; path: string; content: string; updatedAt: number }

export interface ProjectStore {
  /** false when IndexedDB is unavailable and data lives only in memory. */
  readonly persistent: boolean;
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listFiles(projectId: string): Promise<ProjectFile[]>;
  getFile(projectId: string, path: string): Promise<ProjectFile | undefined>;
  saveFile(projectId: string, path: string, content: string): Promise<void>;
  deleteFile(projectId: string, path: string): Promise<void>;
  renameFile(projectId: string, from: string, to: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export const STARTER_MAIN = `# Shrike-Lite starter: blink the on-board MCU LED (GPIO4) and print to the terminal.
# Note: GPIO 0-3, 12 and 13 are wired to the FPGA link; avoid them in your own code.
from machine import Pin
import time

led = Pin(4, Pin.OUT)
for i in range(10):
    led.toggle()
    print("tick", i)
    time.sleep(0.5)
print("done")
`;

const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

async function seed(store: ProjectStore, name: string): Promise<Project> {
  const p = await store.createProject(name);
  await store.saveFile(p.id, 'main.py', STARTER_MAIN);
  return p;
}
export async function ensureProject(store: ProjectStore): Promise<Project> {
  const all = await store.listProjects();
  return all[0] ?? seed(store, 'My first project');
}
export { seed as createSeededProject };

// ---------------------------------------------------------------- IndexedDB

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

class IdbStore implements ProjectStore {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}

  static open(): Promise<IdbStore> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open('shrike-web-ide', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('files', { keyPath: ['projectId', 'path'] }).createIndex('byProject', 'projectId');
        db.createObjectStore('meta');
      };
      r.onsuccess = () => resolve(new IdbStore(r.result));
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  private tx(stores: string[], mode: IDBTransactionMode = 'readonly') { return this.db.transaction(stores, mode); }

  async listProjects() {
    const all = await req(this.tx(['projects']).objectStore('projects').getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }
  async createProject(name: string) {
    const now = Date.now();
    const p: Project = { id: uid(), name, createdAt: now, updatedAt: now };
    const t = this.tx(['projects'], 'readwrite'); t.objectStore('projects').put(p); await done(t);
    return p;
  }
  async renameProject(id: string, name: string) {
    const t = this.tx(['projects'], 'readwrite'); const s = t.objectStore('projects');
    const p = (await req(s.get(id))) as Project | undefined;
    if (p) s.put({ ...p, name, updatedAt: Date.now() });
    await done(t);
  }
  async deleteProject(id: string) {
    const t = this.tx(['projects', 'files'], 'readwrite');
    t.objectStore('projects').delete(id);
    const idx = t.objectStore('files').index('byProject');
    const keys = await req(idx.getAllKeys(id));
    keys.forEach((k) => t.objectStore('files').delete(k));
    await done(t);
  }
  async listFiles(projectId: string) {
    const all = await req(this.tx(['files']).objectStore('files').index('byProject').getAll(projectId) as IDBRequest<ProjectFile[]>);
    return all.sort((a, b) => a.path.localeCompare(b.path));
  }
  getFile(projectId: string, path: string) {
    return req(this.tx(['files']).objectStore('files').get([projectId, path]) as IDBRequest<ProjectFile | undefined>);
  }
  async saveFile(projectId: string, path: string, content: string) {
    const t = this.tx(['files'], 'readwrite');
    t.objectStore('files').put({ projectId, path, content, updatedAt: Date.now() } satisfies ProjectFile);
    await done(t);
  }
  async deleteFile(projectId: string, path: string) {
    const t = this.tx(['files'], 'readwrite'); t.objectStore('files').delete([projectId, path]); await done(t);
  }
  async renameFile(projectId: string, from: string, to: string) {
    const t = this.tx(['files'], 'readwrite'); const s = t.objectStore('files');
    const f = (await req(s.get([projectId, from]))) as ProjectFile | undefined;
    if (f) { s.delete([projectId, from]); s.put({ ...f, path: to, updatedAt: Date.now() }); }
    await done(t);
  }
  async getMeta<T>(key: string) { return (await req(this.tx(['meta']).objectStore('meta').get(key))) as T | undefined; }
  async setMeta(key: string, value: unknown) {
    const t = this.tx(['meta'], 'readwrite'); t.objectStore('meta').put(value, key); await done(t);
  }
}

// ------------------------------------------------------------ memory fallback

class MemoryStore implements ProjectStore {
  readonly persistent = false;
  private projects = new Map<string, Project>();
  private files = new Map<string, ProjectFile>();
  private meta = new Map<string, unknown>();
  private k = (p: string, path: string) => p + '\u0000' + path;
  async listProjects() { return [...this.projects.values()].sort((a, b) => a.createdAt - b.createdAt); }
  async createProject(name: string) {
    const now = Date.now(); const p = { id: uid(), name, createdAt: now, updatedAt: now };
    this.projects.set(p.id, p); return p;
  }
  async renameProject(id: string, name: string) { const p = this.projects.get(id); if (p) p.name = name; }
  async deleteProject(id: string) {
    this.projects.delete(id);
    for (const [k, f] of this.files) if (f.projectId === id) this.files.delete(k);
  }
  async listFiles(pid: string) { return [...this.files.values()].filter((f) => f.projectId === pid).sort((a, b) => a.path.localeCompare(b.path)); }
  async getFile(pid: string, path: string) { return this.files.get(this.k(pid, path)); }
  async saveFile(projectId: string, path: string, content: string) {
    this.files.set(this.k(projectId, path), { projectId, path, content, updatedAt: Date.now() });
  }
  async deleteFile(pid: string, path: string) { this.files.delete(this.k(pid, path)); }
  async renameFile(pid: string, from: string, to: string) {
    const f = this.files.get(this.k(pid, from));
    if (f) { this.files.delete(this.k(pid, from)); this.files.set(this.k(pid, to), { ...f, path: to }); }
  }
  async getMeta<T>(key: string) { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }
}

export async function openProjectStore(): Promise<ProjectStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    return await IdbStore.open();
  } catch (e) {
    console.warn('IndexedDB unavailable, using in-memory storage', e);
    return new MemoryStore();
  }
}
