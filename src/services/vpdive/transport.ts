/**
 * Transport VPDive : le seul chemin vers l'API (/api/vpdive).
 *
 * Le pare-feu (WAF) devant VPDive coupe les rafales venues d'une même adresse :
 * c'est donc ici, pour tous les écrans à la fois, que se règle le rythme.
 *   - Une file d'attente : un appel à la fois, et une pause (GAP_MS, réglable par
 *     appel) entre la fin d'un appel et le début du suivant. Un écran peut passer
 *     devant (`priority: 'high'`) ou laisser passer les autres (`'low'`, lectures en lot).
 *   - Les lectures identiques en cours sont partagées (deux écrans qui lisent la même
 *     fiche, le double rendu de StrictMode en développement).
 *   - Un cache court des lectures, d'une durée choisie méthode par méthode (`ttl`),
 *     en mémoire et, au besoin, dans l'onglet (`persist`). Les écritures ne sont jamais
 *     partagées ni gardées, et oublient les lectures qu'elles touchent (`invalidates`).
 *   - Des erreurs typées (isRateLimited, isNetwork, isSessionLost, isUnavailable) ; un
 *     refus du pare-feu (403 ou 429 sans JSON) est retenté deux fois au plus, de plus en
 *     plus espacé, en tenant la file : les autres appels attendent avec lui.
 */

const API_BASE = '/api/vpdive'; // Vite proxy → https://septentrion-env.vpdive.com/api

/** Pause entre deux appels à VPDive. */
export const GAP_MS = 400;
/** Nouvelles tentatives après un refus du pare-feu, et la première attente (doublée ensuite). */
const RETRIES = 2;
const BACKOFF_MS = 2000;
/** Lectures gardées en mémoire au plus (les plus anciennes partent d'abord). */
const MAX_ENTRIES = 300;
/** Préfixe des lectures gardées dans l'onglet (effacées à la déconnexion, App.tsx). */
export const PERSIST_PREFIX = 'vpdive-cache:';

// ── Erreurs ──────────────────────────────────────────────────────

/**
 * rate-limit : refus du pare-feu (403, 429 sans JSON) ; server : 5xx sans JSON ;
 * network : VPDive injoignable ; session : session expirée ; api : réponse de VPDive.
 */
export type ErrorKind = 'rate-limit' | 'server' | 'network' | 'session' | 'api';

export class VpDiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: ErrorKind = 'api',
  ) {
    super(message);
    this.name = 'VpDiveError';
  }
}

export class SessionExpiredError extends VpDiveError {
  constructor() {
    super('Votre session VPDive a expiré. Merci de vous reconnecter.', 401, 'session');
    this.name = 'SessionExpiredError';
  }
}

/** Réponse non JSON du pare-feu devant VPDive (403, 429, 5xx). */
export const FIREWALL_MESSAGE = 'VPDive refuse temporairement la demande (pare-feu). Réessayez dans une minute.';
const NETWORK_MESSAGE = 'Impossible de joindre VPDive. Vérifiez votre connexion internet.';

/** Le pare-feu refuse (trop de requêtes rapprochées), même après les nouvelles tentatives. */
export const isRateLimited = (e: unknown): boolean => e instanceof VpDiveError && e.kind === 'rate-limit';
/** VPDive injoignable (réseau, appareil hors ligne). */
export const isNetwork = (e: unknown): boolean => e instanceof VpDiveError && e.kind === 'network';
/** Session VPDive expirée ou révoquée : il faut se reconnecter. */
export const isSessionLost = (e: unknown): e is SessionExpiredError => e instanceof SessionExpiredError;
/** VPDive ne répond plus pour l'instant (pare-feu, panne, réseau) : inutile d'enchaîner d'autres lectures. */
export const isUnavailable = (e: unknown): boolean => e instanceof VpDiveError && (e.kind === 'rate-limit' || e.kind === 'server' || e.kind === 'network');
/** Appel retiré de la file avant son départ (signal annulé). */
export const isAborted = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

// ── Options ──────────────────────────────────────────────────────

export type Priority = 'high' | 'normal' | 'low';
const RANK: Record<Priority, number> = { high: 2, normal: 1, low: 0 };

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Avec la session (par défaut) ; false pour la connexion. */
  auth?: boolean;
  /** En-têtes en plus (la connexion passe son jeton avant d'avoir une session). */
  headers?: Record<string, string>;
  /**
   * Lecture (partagée, gardée) ou écriture (jamais) ; par défaut, un GET lit et un POST
   * écrit. `true` pour un POST qui ne fait que lire (recherche, tarifs), `false` pour un
   * GET qui change quelque chose (désinscription).
   */
  read?: boolean;
  /** Durée de vie de la lecture en cache (ms) ; 0 ou absent : pas de cache, seulement le partage en cours. */
  ttl?: number;
  /** Lecture gardée aussi dans l'onglet (sessionStorage) : réponses petites et stables seulement. */
  persist?: boolean;
  /** Relecture demandée : le cache est ignoré (la réponse le remplace). */
  fresh?: boolean;
  /** Écriture : préfixes des chemins dont les lectures en cache sont oubliées (même si elle échoue). */
  invalidates?: string[];
  priority?: Priority;
  /** Pause avant cet appel depuis la fin du précédent (GAP_MS par défaut). */
  gap?: number;
  /** Annule l'appel tant qu'il attend dans la file (une recherche dépassée par la frappe). */
  signal?: AbortSignal;
}

/** Ce que les écrans peuvent régler sur un appel : son rang dans la file et la pause avant lui. */
export type CallPace = Pick<CallOptions, 'priority' | 'gap' | 'signal'>;
/** Ce que les écrans peuvent régler sur une lecture : en plus, l'ignorer en cache (« Relire »). */
export type ReadOptions = CallPace & Pick<CallOptions, 'fresh'>;

export interface Auth {
  token: string;
  traceability: string;
}

interface Deps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  storage: () => Storage | null;
}

interface Job {
  priority: number;
  seq: number;
  gap: number;
  signal: AbortSignal | undefined;
  start: () => Promise<void>;
  abort: () => void;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const browserStorage = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

export class Transport {
  private readonly deps: Deps;
  private queue: Job[] = [];
  private busy = false;
  private lastEnd = Number.NEGATIVE_INFINITY;
  private seq = 0;
  /** Lectures gardées, par clé (compte, méthode, chemin, corps). */
  private cache = new Map<string, { path: string; at: number; data: unknown }>();
  /** Lectures en cours, par clé : un second demandeur attend la même réponse. */
  private inflight = new Map<string, { path: string; promise: Promise<unknown>; job: Job }>();
  /** Augmente à chaque oubli : une lecture partie avant ne remplit pas le cache. */
  private generation = 0;

  constructor(
    private readonly hooks: { auth: () => Auth | null; onUnauthorized: () => void },
    deps: Partial<Deps> = {},
  ) {
    this.deps = {
      fetch: (input, init) => fetch(input, init),
      sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      storage: browserStorage,
      ...deps,
    };
  }

  /** Un appel à VPDive, à son tour dans la file. Résout avec le JSON de la réponse. */
  call(path: string, o: CallOptions = {}): Promise<unknown> {
    const method = o.method ?? 'GET';
    if (!(o.read ?? method === 'GET')) {
      // Écriture : jamais partagée ni gardée ; les lectures qu'elle touche sont oubliées, réussie ou non.
      const forget = () => this.invalidate(o.invalidates ?? []);
      return this.enqueue(() => this.send(path, o), o).then(
        (data) => {
          forget();
          return data;
        },
        (e: unknown) => {
          forget();
          throw e;
        },
      );
    }

    const auth = o.auth ?? true;
    const session = auth ? this.hooks.auth() : null;
    if (auth && !session) return Promise.reject(new SessionExpiredError());
    const who = session?.token ?? o.headers?.Authorization ?? '';
    const key = `${who}|${method}|${path}|${o.body === undefined ? '' : JSON.stringify(o.body)}`;
    const ttl = o.ttl ?? 0;

    if (!o.fresh && ttl > 0) {
      const hit = this.cached(key, ttl, o.persist ? session?.traceability : undefined);
      if (hit !== undefined) return Promise.resolve(hit);
    }
    const pending = this.inflight.get(key);
    if (pending) {
      // Partagée : elle part pour tous (plus d'annulation par le premier), au rang le plus pressé.
      pending.job.signal = undefined;
      pending.job.priority = Math.max(pending.job.priority, RANK[o.priority ?? 'normal']);
      return pending.promise;
    }

    const gen = this.generation;
    let job!: Job;
    const promise = this.enqueue(() => this.send(path, o), o, (j) => (job = j)).then(
      (data) => {
        if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
        if (ttl > 0 && gen === this.generation) this.store(key, path, data, o.persist ? session?.traceability : undefined);
        return data;
      },
      (e: unknown) => {
        if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
        throw e;
      },
    );
    this.inflight.set(key, { path, promise, job });
    return promise;
  }

  /** Oublie les lectures gardées (et en cours) dont le chemin commence par l'un de ces préfixes. */
  invalidate(prefixes: string[]) {
    if (!prefixes.length) return;
    this.generation++;
    const hit = (path: string) => prefixes.some((p) => path.startsWith(p));
    for (const [k, v] of this.cache) if (hit(v.path)) this.cache.delete(k);
    for (const [k, v] of this.inflight) if (hit(v.path)) this.inflight.delete(k);
    this.forgetPersisted((path) => hit(path));
  }

  /** Oublie tout (connexion, déconnexion, autre compte). */
  clear() {
    this.generation++;
    this.cache.clear();
    this.inflight.clear();
    this.forgetPersisted(() => true);
  }

  // ── File d'attente ─────────────────────────────────────────────

  private enqueue<T>(run: () => Promise<T>, o: CallOptions, created?: (job: Job) => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        priority: RANK[o.priority ?? 'normal'],
        seq: this.seq++,
        gap: o.gap ?? GAP_MS,
        signal: o.signal,
        start: () => run().then(resolve, reject),
        abort: () => reject(new DOMException('Appel VPDive annulé.', 'AbortError')),
      };
      created?.(job);
      this.queue.push(job);
      void this.pump();
    });
  }

  private next(): Job | undefined {
    let best = -1;
    this.queue.forEach((j, i) => {
      const b = this.queue[best];
      if (!b || j.priority > b.priority || (j.priority === b.priority && j.seq < b.seq)) best = i;
    });
    return best < 0 ? undefined : this.queue.splice(best, 1)[0];
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.next(); job; job = this.next()) {
        if (job.signal?.aborted) {
          job.abort();
          continue;
        }
        const delay = this.lastEnd + job.gap - this.deps.now();
        if (delay > 0) await this.deps.sleep(delay);
        if (job.signal?.aborted) {
          job.abort();
          continue;
        }
        await job.start();
        this.lastEnd = this.deps.now();
      }
    } finally {
      this.busy = false;
    }
  }

  // ── Cache ──────────────────────────────────────────────────────

  private cached(key: string, ttl: number, owner: string | undefined): unknown {
    const now = this.deps.now();
    const m = this.cache.get(key);
    if (m && now - m.at < ttl) return m.data;
    if (owner === undefined) return undefined;
    try {
      const raw = this.deps.storage()?.getItem(PERSIST_PREFIX + key.slice(key.indexOf('|') + 1));
      const v = obj(raw ? JSON.parse(raw) : null);
      const at = num(v?.at);
      if (!v || at === null || str(v.owner) !== owner || now - at >= ttl || !('data' in v)) return undefined;
      this.cache.set(key, { path: str(v.path), at, data: v.data });
      return v.data;
    } catch {
      return undefined;
    }
  }

  private store(key: string, path: string, data: unknown, owner: string | undefined) {
    const at = this.deps.now();
    this.cache.delete(key);
    this.cache.set(key, { path, at, data });
    if (this.cache.size > MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    if (owner === undefined) return;
    try {
      // La clé dans l'onglet ne porte pas le jeton : `owner` (le club du compte) dit à qui elle est.
      this.deps.storage()?.setItem(PERSIST_PREFIX + key.slice(key.indexOf('|') + 1), JSON.stringify({ at, owner, path, data }));
    } catch {
      // Stockage plein ou interdit : la mémoire suffit.
    }
  }

  private forgetPersisted(match: (path: string) => boolean) {
    try {
      const storage = this.deps.storage();
      if (!storage) return;
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (!k?.startsWith(PERSIST_PREFIX)) continue;
        // Clé : préfixe, méthode|chemin|corps.
        const path = k.slice(PERSIST_PREFIX.length).split('|')[1] ?? '';
        if (match(path)) keys.push(k);
      }
      keys.forEach((k) => storage.removeItem(k));
    } catch {
      // Stockage interdit : rien à oublier.
    }
  }

  // ── Envoi ──────────────────────────────────────────────────────

  /** Un envoi, retenté sur un refus du pare-feu : 2 s, puis 4 s. */
  private async send(path: string, o: CallOptions): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(path, o);
      } catch (e) {
        if (!isRateLimited(e) || attempt >= RETRIES) throw e;
        await this.deps.sleep(BACKOFF_MS * 2 ** attempt);
      }
    }
  }

  private async once(path: string, o: CallOptions): Promise<unknown> {
    const { method = 'GET', body, auth = true } = o;
    // Les libellés VPDive (activité, type de sortie…) arrivent en anglais par défaut : on demande le français.
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'fr-FR,fr;q=0.9', ...o.headers };

    if (auth) {
      const s = this.hooks.auth();
      if (!s) throw new SessionExpiredError();
      headers.Authorization = `Bearer ${s.token}`;
      headers.userClubTraceability = s.traceability;
    }

    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body; // the browser sets the multipart boundary itself
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.deps.fetch(`${API_BASE}${path}`, { method, headers, body: payload });
    } catch {
      throw new VpDiveError(NETWORK_MESSAGE, 0, 'network');
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (HTML error page from a proxy, etc.)
    }
    const r = obj(data);

    // VPDive sometimes reports errors with HTTP 200 and the real status in the
    // body — e.g. a wrong password is `200 {"error":"Invalid credentials","code":401}`,
    // although codehelp/docapi.txt documents a 401. Trust the body's code.
    const bodyCode = num(r?.code);
    const status = res.ok && bodyCode !== null && bodyCode >= 400 ? bodyCode : res.status;

    if (status === 401 && auth) {
      this.hooks.onUnauthorized();
      throw new SessionExpiredError();
    }

    // Page HTML (ou vide) au lieu du JSON de VPDive, en 403, 429 ou 5xx : c'est le pare-feu
    // devant VPDive qui refuse (trop de requêtes rapprochées), pas VPDive qui répond. À la
    // connexion, ce n'est surtout pas un mauvais mot de passe.
    if (data === null && (status === 403 || status === 429)) throw new VpDiveError(FIREWALL_MESSAGE, status, 'rate-limit');
    if (data === null && status >= 500) throw new VpDiveError(FIREWALL_MESSAGE, status, 'server');

    if (status >= 400 || r?.success === false) {
      const base = str(r?.message) || str(r?.error) || `Erreur VPDive (HTTP ${status})`;
      // 400 responses list what is missing in `errors` (codehelp/docapi.txt).
      // Les formulaires de fiche répondent `errors: [{field, message}]`.
      const details = Array.isArray(r?.errors)
        ? r.errors
            .map((x) => (typeof x === 'string' ? x : obj(x) ? [str(obj(x)!.field), str(obj(x)!.message)].filter(Boolean).join(' : ') : ''))
            .filter(Boolean)
        : [];
      throw new VpDiveError(details.length ? `${base} : ${details.join(', ')}` : base, status);
    }
    if (data === null) {
      throw new VpDiveError(`Réponse VPDive inattendue (HTTP ${res.status}).`, res.status);
    }
    return data;
  }
}
