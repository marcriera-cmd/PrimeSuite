// Capa de almacenamiento: Netlify Blobs (nube), SQLite (autoalojado) o ficheros JSON (local).
import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

// Almacenamiento en SQLite (un único fichero) para instalaciones autoalojadas.
// Usa el módulo nativo de Node (node:sqlite), sin dependencias externas. Se carga de forma
// perezosa: solo se requiere cuando PRIME_STORE=sqlite, así no afecta al despliegue en Netlify.
class SqliteKV implements KV {
  private db: any;
  private esc(s: string) { return s.replace(/[\\%_]/g, '\\$&'); }
  constructor(file: string) {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }
  async get<T>(key: string) {
    const row = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(key) as { v: string } | undefined;
    return row ? (JSON.parse(row.v) as T) : null;
  }
  async set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }) {
    const v = JSON.stringify(value);
    if (opts?.onlyIfNew) {
      const r = this.db.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)').run(key, v);
      return r.changes > 0;
    }
    this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(key, v);
    return true;
  }
  async del(key: string) {
    this.db.prepare('DELETE FROM kv WHERE k = ?').run(key);
  }
  async keys(prefix: string) {
    const rows = this.db.prepare("SELECT k FROM kv WHERE k LIKE ? ESCAPE '\\' ORDER BY k").all(this.esc(prefix) + '%') as { k: string }[];
    return rows.map((r) => r.k);
  }
}

function makeBlobStore() {
  // Si se proporciona un token explícito (variable de entorno), se usa SIEMPRE:
  // evita el token que Netlify inyecta automáticamente y que puede caducar
  // ("Failed to decode token: Token expired").
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'prime-suite', consistency: 'strong', siteID, token });
  }
  // Respaldo: configuración automática del runtime de Netlify Functions.
  return getStore({ name: 'prime-suite', consistency: 'strong' });
}

class BlobKV implements KV {
  private store = makeBlobStore();
  // Si el token automático de Netlify caduca, se descarta el almacén en caché para que
  // la siguiente petición (otra instancia) lo reconstruya con contexto fresco o el token propio.
  private guard<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: any) => {
      if (/token expired|expired|invalid/i.test(String(e?.message))) kv = null;
      throw e;
    });
  }
  async get<T>(key: string) {
    return this.guard(this.store.get(key, { type: 'json' }).then((v) => (v ?? null) as T | null));
  }
  async set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }) {
    return this.guard(this.store.setJSON(key, value, opts?.onlyIfNew ? { onlyIfNew: true } : {}).then((r) => r?.modified !== false));
  }
  async del(key: string) {
    await this.guard(this.store.delete(key));
  }
  async keys(prefix: string) {
    return this.guard(this.store.list({ prefix }).then((r) => r.blobs.map((b) => b.key)));
  }
}

class FileKV implements KV {
  constructor(private dir: string) {}
  private file(key: string) {
    return path.join(this.dir, encodeURIComponent(key) + '.json');
  }
  async get<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(key), 'utf8')) as T;
    } catch {
      return null;
    }
  }
  async set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }) {
    await fs.mkdir(this.dir, { recursive: true });
    if (opts?.onlyIfNew) {
      try {
        await fs.writeFile(this.file(key), JSON.stringify(value), { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    }
    await fs.writeFile(this.file(key), JSON.stringify(value));
    return true;
  }
  async del(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
  async keys(prefix: string) {
    try {
      const files = await fs.readdir(this.dir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => decodeURIComponent(f.slice(0, -5)))
        .filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  }
}

let kv: KV | null = null;
export function store(): KV {
  if (kv) return kv;
  // Selector de motor: 'sqlite' (autoalojado), 'file' (desarrollo local) o Blobs (Netlify, por defecto).
  if (process.env.PRIME_STORE === 'sqlite') {
    kv = new SqliteKV(process.env.PRIME_SQLITE_PATH || path.resolve('.data/prime-suite.db'));
  } else if (process.env.PRIME_STORE === 'file') {
    kv = new FileKV(process.env.PRIME_DATA_DIR || path.resolve('.data'));
  } else {
    kv = new BlobKV();
  }
  return kv;
}

export function setStore(custom: KV) {
  kv = custom;
}
