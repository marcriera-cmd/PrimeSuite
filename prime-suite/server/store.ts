// Capa de almacenamiento: Netlify Blobs en producción, ficheros JSON en local.
import { getStore } from '@netlify/blobs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
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
  async get<T>(key: string) {
    return ((await this.store.get(key, { type: 'json' })) ?? null) as T | null;
  }
  async set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }) {
    const r = await this.store.setJSON(key, value, opts?.onlyIfNew ? { onlyIfNew: true } : {});
    return r?.modified !== false;
  }
  async del(key: string) {
    await this.store.delete(key);
  }
  async keys(prefix: string) {
    const r = await this.store.list({ prefix });
    return r.blobs.map((b) => b.key);
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
  // En Netlify se usa Blobs; el servidor local (server/dev.ts) fija PRIME_STORE=file.
  if (process.env.PRIME_STORE === 'file') {
    kv = new FileKV(process.env.PRIME_DATA_DIR || path.resolve('.data'));
  } else {
    kv = new BlobKV();
  }
  return kv;
}

export function setStore(custom: KV) {
  kv = custom;
}
