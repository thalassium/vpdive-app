/**
 * Stockage partagé de l'appli : rôles et fiches de plongée.
 *
 * En production, Upstash Redis, branché au projet Vercel par le Marketplace
 * (variables KV_REST_API_URL / KV_REST_API_TOKEN, ou UPSTASH_REDIS_REST_*).
 * En local (`npm run dev`), un fichier JSON dans .data/, ignoré par git, pour
 * développer sans toucher à la base de production.
 */
import { Redis } from '@upstash/redis';

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  /** Supprime les clés qui correspondent au motif (« * » = n'importe quoi) ; renvoie leur nombre. */
  deleteMatching(pattern: string): Promise<number>;
}

/** Motif à étoiles (« club:*:chat* ») → expression régulière ancrée. */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/**
 * Identifiants Upstash. Le Marketplace Vercel les nomme KV_REST_API_URL /
 * KV_REST_API_TOKEN, ou avec le préfixe choisi à la connexion de la base
 * (MONPREFIXE_KV_REST_API_URL…) ; Upstash seul les nomme UPSTASH_REDIS_REST_*.
 */
function redisCredentials(): { url: string; token: string } | null {
  const env = process.env;
  for (const [key, url] of Object.entries(env)) {
    const m = /^(.*?)(KV_REST_API|UPSTASH_REDIS_REST|REDIS_REST_API|REDIS_REST)_URL$/.exec(key);
    if (!m || !url?.startsWith('https://')) continue;
    const token = env[`${m[1]}${m[2]}_TOKEN`];
    if (token) return { url, token };
  }
  return null;
}

function redisStore(): Store | null {
  const creds = redisCredentials();
  if (!creds) return null;
  const { url, token } = creds;
  const redis = new Redis({ url, token });
  return {
    get: (key) => redis.get(key),
    set: async (key, value) => {
      await redis.set(key, value);
    },
    deleteMatching: async (pattern) => {
      let cursor: string | number = 0;
      let deleted = 0;
      do {
        const [next, keys]: [string | number, string[]] = await redis.scan(cursor, { match: pattern, count: 500 });
        if (keys.length) deleted += await redis.del(...keys);
        cursor = next;
      } while (String(cursor) !== '0');
      return deleted;
    },
  };
}

function fileStore(): Store {
  const file = '.data/app-store.json';
  const read = async (): Promise<Record<string, unknown>> => {
    const { readFile } = await import('node:fs/promises');
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return {};
    }
  };
  return {
    get: async <T,>(key: string) => ((await read())[key] as T) ?? null,
    set: async (key, value) => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const all = await read();
      all[key] = value;
      await mkdir('.data', { recursive: true });
      await writeFile(file, JSON.stringify(all, null, 2));
    },
    deleteMatching: async (pattern) => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const all = await read();
      const re = globToRegExp(pattern);
      const keys = Object.keys(all).filter((k) => re.test(k));
      if (!keys.length) return 0;
      for (const k of keys) delete all[k];
      await mkdir('.data', { recursive: true });
      await writeFile(file, JSON.stringify(all, null, 2));
      return keys.length;
    },
  };
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const redis = redisStore();
  if (redis) return (store = redis);
  // Sur Vercel sans base configurée, mieux vaut une erreur claire qu'un fichier qui s'efface.
  if (process.env.VERCEL) throw new Error('Stockage non configuré : connectez une base Upstash Redis au projet Vercel (Storage → Create Database).');
  return (store = fileStore());
}
