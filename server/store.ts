/**
 * Stockage partagé de l'appli : rôles et fiches de plongée.
 *
 * En production, Upstash Redis, branché au projet Vercel par le Marketplace
 * (variables KV_REST_API_URL / KV_REST_API_TOKEN, ou UPSTASH_REDIS_REST_*).
 * En local (`npm run dev`), un fichier JSON dans .data/, ignoré par git, pour
 * développer sans toucher à la base de production. Les tests utilisent la
 * même mécanique, en mémoire (memoryStore).
 */
import { Redis } from '@upstash/redis';

export interface SetOptions {
  /** Durée de conservation en secondes (EX de Redis) ; sans elle, la clé est gardée indéfiniment. */
  ex?: number;
}

/** Une clé telle que la sauvegarde l'exporte : une valeur, ou une liste (la plus récente en tête). */
export type StoreEntry = { type: 'value'; value: unknown; ttl?: number } | { type: 'list'; items: unknown[]; ttl?: number };

export interface Store {
  get<T>(key: string): Promise<T | null>;
  /** Écrit la valeur ; sans `ex`, une éventuelle expiration précédente est levée (comme SET dans Redis). */
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  del(key: string): Promise<void>;
  /** Supprime les clés qui correspondent au motif (« * » = n'importe quoi) ; renvoie leur nombre. */
  deleteMatching(pattern: string): Promise<number>;
  /** Les clés qui correspondent au motif (SCAN dans Redis). */
  keys(pattern: string): Promise<string[]>;
  /** Ajoute en tête de liste (LPUSH) et ne garde que les `max` plus récents (LTRIM). */
  listPush<T>(key: string, value: T, options: { max: number; ex?: number }): Promise<void>;
  /** Éléments `start` à `stop` inclus (0 = le plus récent, -1 = le plus ancien), comme LRANGE. */
  listRange<T>(key: string, start: number, stop: number): Promise<T[]>;
  /** Ne garde que les éléments `start` à `stop` inclus, comme LTRIM. */
  listTrim(key: string, start: number, stop: number): Promise<void>;
  /** Toutes les clés du motif avec leur contenu et leur durée de vie restante (sauvegarde). */
  exportEntries(pattern: string): Promise<Record<string, StoreEntry>>;
  /** Réécrit une clé exportée (restauration) : son contenu remplace l'existant. */
  importEntry(key: string, entry: StoreEntry): Promise<void>;
  /** Pose un verrou s'il est libre (il expire de lui-même après `ttlMs`) ; false si quelqu'un le tient déjà. */
  lock(key: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
}

/** Motif à étoiles (« club:*:chat* ») → expression régulière ancrée. */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

const LOCK_TTL_MS = 3_000;
const LOCK_WAIT_MS = 1_500;
const LOCK_RETRY_MS = 100;

/** Essaie de prendre le verrou pendant `waitMs` au plus (un essai toutes les `retryMs`) ; il expire après `ttlMs`. */
export async function acquireLock(store: Store, key: string, waitMs = LOCK_WAIT_MS, retryMs = LOCK_RETRY_MS, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (await store.lock(key, ttlMs)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, retryMs));
  }
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

/** Par paquets : une requête Upstash garde une taille raisonnable. */
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

function redisStore(): Store | null {
  const creds = redisCredentials();
  if (!creds) return null;
  const { url, token } = creds;
  const redis = new Redis({ url, token });
  const keys = async (pattern: string) => {
    const out: string[] = [];
    let cursor: string | number = 0;
    do {
      const [next, found]: [string | number, string[]] = await redis.scan(cursor, { match: pattern, count: 500 });
      out.push(...found);
      cursor = next;
    } while (String(cursor) !== '0');
    return [...new Set(out)];
  };
  return {
    get: (key) => redis.get(key),
    set: async (key, value, options) => {
      if (options?.ex) await redis.set(key, value, { ex: Math.max(1, Math.round(options.ex)) });
      else await redis.set(key, value);
    },
    del: async (key) => {
      await redis.del(key);
    },
    deleteMatching: async (pattern) => {
      let deleted = 0;
      for (const part of chunks(await keys(pattern), 500)) deleted += await redis.del(...part);
      return deleted;
    },
    keys,
    listPush: async (key, value, { max, ex }) => {
      const p = redis.pipeline();
      p.lpush(key, value);
      p.ltrim(key, 0, max - 1);
      if (ex) p.expire(key, Math.max(1, Math.round(ex)));
      await p.exec();
    },
    listRange: (key, start, stop) => redis.lrange(key, start, stop),
    listTrim: async (key, start, stop) => {
      await redis.ltrim(key, start, stop);
    },
    exportEntries: async (pattern) => {
      const out: Record<string, StoreEntry> = {};
      for (const part of chunks(await keys(pattern), 25)) {
        const meta = redis.pipeline();
        for (const k of part) meta.type(k).ttl(k);
        const types = (await meta.exec()) as (string | number)[];
        const read = redis.pipeline();
        const kept: { key: string; type: 'value' | 'list'; ttl?: number }[] = [];
        part.forEach((k, i) => {
          const type = types[2 * i];
          const ttl = Number(types[2 * i + 1]);
          if (type !== 'string' && type !== 'list') return; // clé disparue entre-temps, ou d'un type que l'appli n'écrit pas
          kept.push({ key: k, type: type === 'list' ? 'list' : 'value', ...(ttl > 0 ? { ttl } : {}) });
          if (type === 'list') read.lrange(k, 0, -1);
          else read.get(k);
        });
        if (!kept.length) continue;
        const values = (await read.exec()) as unknown[];
        kept.forEach((k, i) => {
          const { key, type, ...rest } = k;
          out[key] = type === 'list' ? { type, items: (values[i] as unknown[]) ?? [], ...rest } : { type, value: values[i] ?? null, ...rest };
        });
      }
      return out;
    },
    importEntry: async (key, entry) => {
      const p = redis.pipeline();
      p.del(key);
      if (entry.type === 'value') {
        if (entry.ttl) p.set(key, entry.value, { ex: entry.ttl });
        else p.set(key, entry.value);
      } else if (entry.items.length) {
        p.rpush(key, ...entry.items);
        if (entry.ttl) p.expire(key, entry.ttl);
      }
      await p.exec();
    },
    // SET NX PX : posé seulement si la clé n'existe pas, avec expiration.
    lock: async (key, ttlMs) => (await redis.set(key, 1, { nx: true, px: ttlMs })) === 'OK',
    unlock: async (key) => {
      await redis.del(key);
    },
  };
}

/** Contenu du stockage local : valeurs, listes (la plus récente en tête) et dates d'expiration (ms). */
export interface StoreState {
  values: Record<string, unknown>;
  lists: Record<string, unknown[]>;
  expires: Record<string, number>;
}

/** Indices façon Redis (négatifs : depuis la fin, `stop` inclus) → bornes de slice. */
const bounds = (len: number, start: number, stop: number): [number, number] => {
  const s = Math.max(0, start < 0 ? len + start : start);
  const e = Math.min(len - 1, stop < 0 ? len + stop : stop);
  return [s, e + 1];
};

/**
 * Le même comportement que Redis au-dessus d'un état chargé puis enregistré
 * (fichier ou mémoire). Verrous en mémoire : un seul processus en développement.
 */
function stateStore(load: () => Promise<StoreState>, save: (state: StoreState) => Promise<void>): Store {
  const locks = new Map<string, number>();
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  /** État courant, sans les clés expirées. */
  const current = async () => {
    const s = await load();
    const now = Date.now();
    for (const [k, until] of Object.entries(s.expires)) {
      if (until > now) continue;
      delete s.values[k];
      delete s.lists[k];
      delete s.expires[k];
    }
    return s;
  };
  const remove = (s: StoreState, key: string) => {
    const had = key in s.values || key in s.lists;
    delete s.values[key];
    delete s.lists[key];
    delete s.expires[key];
    return had;
  };
  const keysOf = (s: StoreState, pattern: string) => {
    const re = globToRegExp(pattern);
    return [...Object.keys(s.values), ...Object.keys(s.lists)].filter((k) => re.test(k));
  };
  const expireIn = (s: StoreState, key: string, ex?: number) => {
    if (ex) s.expires[key] = Date.now() + ex * 1000;
    else delete s.expires[key];
  };
  return {
    get: async <T,>(key: string) => (clone((await current()).values[key]) as T) ?? null,
    set: async (key, value, options) => {
      const s = await current();
      remove(s, key);
      s.values[key] = clone(value);
      expireIn(s, key, options?.ex);
      await save(s);
    },
    del: async (key) => {
      const s = await current();
      if (remove(s, key)) await save(s);
    },
    deleteMatching: async (pattern) => {
      const s = await current();
      const keys = keysOf(s, pattern);
      if (!keys.length) return 0;
      for (const k of keys) remove(s, k);
      await save(s);
      return keys.length;
    },
    keys: async (pattern) => keysOf(await current(), pattern),
    listPush: async (key, value, { max, ex }) => {
      const s = await current();
      delete s.values[key];
      s.lists[key] = [clone(value), ...(s.lists[key] ?? [])].slice(0, max);
      if (ex) expireIn(s, key, ex);
      await save(s);
    },
    listRange: async <T,>(key: string, start: number, stop: number) => {
      const list = (await current()).lists[key] ?? [];
      return clone(list.slice(...bounds(list.length, start, stop))) as T[];
    },
    listTrim: async (key, start, stop) => {
      const s = await current();
      const list = s.lists[key];
      if (!list) return;
      const kept = list.slice(...bounds(list.length, start, stop));
      if (kept.length) s.lists[key] = kept;
      else remove(s, key);
      await save(s);
    },
    exportEntries: async (pattern) => {
      const s = await current();
      const now = Date.now();
      return Object.fromEntries(
        keysOf(s, pattern).map((k): [string, StoreEntry] => {
          const ttl = s.expires[k] ? { ttl: Math.ceil((s.expires[k]! - now) / 1000) } : {};
          return [k, k in s.lists ? { type: 'list', items: clone(s.lists[k]!), ...ttl } : { type: 'value', value: clone(s.values[k]), ...ttl }];
        }),
      );
    },
    importEntry: async (key, entry) => {
      const s = await current();
      remove(s, key);
      if (entry.type === 'value') s.values[key] = clone(entry.value);
      else if (entry.items.length) s.lists[key] = clone(entry.items);
      if (key in s.values || key in s.lists) expireIn(s, key, entry.ttl);
      await save(s);
    },
    lock: async (key, ttlMs) => {
      const until = locks.get(key);
      if (until !== undefined && until > Date.now()) return false;
      locks.set(key, Date.now() + ttlMs);
      return true;
    },
    unlock: async (key) => {
      locks.delete(key);
    },
  };
}

/** Stockage en mémoire (tests, scripts) : `state` donne accès au contenu brut. */
export function memoryStore(initial: Record<string, unknown> = {}): Store & { state: StoreState } {
  const state: StoreState = { values: structuredClone(initial), lists: {}, expires: {} };
  return Object.assign(
    stateStore(
      async () => state,
      async () => {},
    ),
    { state },
  );
}

// Dans le fichier local, les valeurs restent à plat (comme avant) ; listes et expirations à part.
const LISTS = '__lists__';
const EXPIRES = '__expires__';

/** Stockage local dans un fichier JSON. */
export function fileStore(file = '.data/app-store.json'): Store {
  return stateStore(
    async () => {
      const { readFile } = await import('node:fs/promises');
      let all: Record<string, unknown> = {};
      try {
        all = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        // Fichier absent ou illisible : stockage vide.
      }
      const { [LISTS]: lists, [EXPIRES]: expires, ...values } = all;
      return { values, lists: (lists as StoreState['lists']) ?? {}, expires: (expires as StoreState['expires']) ?? {} };
    },
    async (s) => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ ...s.values, [LISTS]: s.lists, [EXPIRES]: s.expires }, null, 2));
    },
  );
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const redis = redisStore();
  if (redis) return (store = redis);
  // Sur Vercel sans base configurée, mieux vaut une erreur claire qu'un fichier qui s'efface.
  if (process.env.VERCEL) throw new Error('Stockage non configuré : connectez une base Upstash Redis au projet Vercel (Storage → Create Database).');
  return (store = fileStore());
}
