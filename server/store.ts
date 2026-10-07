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
