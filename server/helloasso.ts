/**
 * Lecture des adhésions HelloAsso (API v5) pour la gestion des adhésions.
 *
 * Clé de l'association (Mon compte › Intégration et API) dans les variables
 * HELLOASSO_CLIENT_ID, HELLOASSO_CLIENT_SECRET et HELLOASSO_ORG_SLUG. Le secret
 * donne les droits d'admin du compte HelloAsso : il ne quitte jamais le serveur.
 * HelloAsso limite les demandes de jeton (50 par heure) : le jeton est gardé
 * dans le stockage partagé (le temps de sa validité) et renouvelé sous verrou,
 * pour que deux appels simultanés ne consomment pas le même refresh token.
 */
import { HttpError } from './auth.js';
import { log } from './log.js';
import { acquireLock, type Store } from './store.js';

const API = 'https://api.helloasso.com/v5';
const TOKEN_URL = 'https://api.helloasso.com/oauth2/token';
const TOKEN_KEY = 'app:helloasso-token';
const TOKEN_LOCK = `${TOKEN_KEY}:lock`;
/** Au-delà, on abandonne l'appel à HelloAsso. */
const TIMEOUT_MS = 8_000;

/*
 * Réponses de HelloAsso : seuls les champs lus, tous `unknown` (l'API peut en omettre ou en
 * changer le type) ; chacun est converti à la lecture (String(), Number()).
 */
interface HaTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}
interface HaPage<T> {
  data?: T[];
  pagination?: { continuationToken?: unknown };
}
interface HaPerson {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
}
/** Formulaire d'adhésion. */
interface HaForm {
  formSlug?: unknown;
  title?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}
/** Article d'un formulaire (une adhésion, une licence…), avec ses champs personnalisés. */
interface HaItem {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  amount?: unknown;
  state?: unknown;
  order?: { date?: unknown };
  user?: HaPerson;
  payer?: HaPerson;
  customFields?: { name?: unknown; answer?: unknown }[];
}
interface Token {
  access: string;
  refresh: string;
  /** ms depuis l'époque */
  expires: number;
}

/** Article d'adhésion, réduit à ce que l'écran compare (même forme que HaItem côté appli). */
export interface HaItemOut {
  id: number;
  formSeason: number;
  tier: string;
  type: string;
  amount: number;
  state: string;
  date: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  payerEmail: string;
  payerName: string;
}

export const helloassoConfigured = () => !!(process.env.HELLOASSO_CLIENT_ID && process.env.HELLOASSO_CLIENT_SECRET && process.env.HELLOASSO_ORG_SLUG);

/** Appel à HelloAsso avec délai maximal : délai dépassé → 504, réseau coupé → 502. */
async function haFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new HttpError(504, 'HelloAsso ne répond pas : réessayez dans un instant.');
    throw new HttpError(502, 'HelloAsso injoignable.');
  }
}

async function requestToken(params: Record<string, string>): Promise<{ token: Token; ttl: number }> {
  const res = await haFetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!res.ok) throw new HttpError(502, `HelloAsso : jeton refusé (HTTP ${res.status})`);
  const t = (await res.json()) as HaTokenResponse;
  const ttl = Number(t.expires_in) || 1700;
  return { token: { access: String(t.access_token), refresh: String(t.refresh_token ?? ''), expires: Date.now() + ttl * 1000 }, ttl };
}

const usable = (t: Token | null): boolean => !!t && t.expires > Date.now() + 60_000;

/** Jeton d'accès : celui du stockage s'il vaut encore, sinon renouvelé par un seul appel à la fois. */
export async function token(store: Store): Promise<string> {
  const saved = await store.get<Token>(TOKEN_KEY);
  if (saved && usable(saved)) return saved.access;
  // Verrou plus long que deux demandes de jeton (2 × 8 s) ; on attend un peu moins que la fonction Vercel.
  if (!(await acquireLock(store, TOKEN_LOCK, 9_000, 200, 20_000))) {
    const again = await store.get<Token>(TOKEN_KEY);
    if (again && usable(again)) return again.access;
    throw new HttpError(503, 'HelloAsso : renouvellement du jeton en cours, réessayez dans un instant.');
  }
  try {
    // Un autre appel a pu le renouveler pendant qu'on attendait le verrou.
    const current = await store.get<Token>(TOKEN_KEY);
    if (current && usable(current)) return current.access;
    let fresh: { token: Token; ttl: number } | null = null;
    if (current?.refresh) fresh = await requestToken({ grant_type: 'refresh_token', refresh_token: current.refresh }).catch(() => null);
    fresh ??= await requestToken({ grant_type: 'client_credentials', client_id: process.env.HELLOASSO_CLIENT_ID!, client_secret: process.env.HELLOASSO_CLIENT_SECRET! });
    // Gardé le temps de sa validité, pas plus.
    await store.set(TOKEN_KEY, fresh.token, { ex: fresh.ttl });
    log('info', { action: 'helloasso_token', message: 'Jeton HelloAsso renouvelé', via: current?.refresh ? 'refresh' : 'client_credentials' });
    return fresh.token.access;
  } finally {
    await store.unlock(TOKEN_LOCK).catch(() => {});
  }
}

/** Toutes les pages d'une liste HelloAsso : on suit le continuationToken jusqu'à une page vide. */
async function all<T>(path: string, access: string): Promise<T[]> {
  const out: T[] = [];
  let next = '';
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await haFetch(`${API}${path}${sep}pageSize=100${next ? `&continuationToken=${encodeURIComponent(next)}` : ''}`, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new HttpError(502, `HelloAsso : lecture refusée (HTTP ${res.status})`);
    const page = (await res.json()) as HaPage<T>;
    const data = Array.isArray(page.data) ? page.data : [];
    if (!data.length) break;
    out.push(...data);
    next = String(page.pagination?.continuationToken ?? '');
    if (!next) break;
  }
  return out;
}

const field = (it: HaItem, re: RegExp) => String((it.customFields ?? []).find((c) => re.test(String(c.name ?? '')))?.answer ?? '').trim();
const ymd = (s: string) => {
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

/**
 * Saison (année de fin) d'un formulaire d'adhésion : l'année de sa date de fin ;
 * sans date de fin, les deux années de son titre ou de son adresse
 * (« 2026-2027 », « 2026/27 ») ; sinon sa date d'ouverture (ouvert à partir
 * de juin : saison suivante). null si rien ne permet de la déduire.
 */
export function seasonOfForm(f: HaForm): number | null {
  const end = /^(\d{4})-\d{2}/.exec(String(f.endDate ?? ''));
  if (end) return Number(end[1]);
  for (const label of [f.title, f.formSlug]) {
    const span = /(20\d{2})\s*[-/–_ ]\s*(20\d{2}|\d{2})(?!\d)/.exec(String(label ?? ''));
    if (!span) continue;
    const first = Number(span[1]);
    const second = span[2]!.length === 2 ? Number(`${span[1]!.slice(0, 2)}${span[2]}`) : Number(span[2]);
    if (second === first + 1) return second;
  }
  const start = /^(\d{4})-(\d{2})/.exec(String(f.startDate ?? ''));
  if (start) return Number(start[1]) + (Number(start[2]) >= 6 ? 1 : 0);
  return null;
}

function itemOut(it: HaItem, formSeason: number): HaItemOut {
  return {
    id: Number(it.id),
    formSeason,
    tier: String(it.name ?? '').trim(),
    type: String(it.type ?? ''),
    amount: Number(it.amount ?? 0),
    state: String(it.state ?? ''),
    date: String(it.order?.date ?? ''),
    firstName: String(it.user?.firstName ?? '').trim(),
    lastName: String(it.user?.lastName ?? '').trim(),
    birthDate: ymd(field(it, /date de naissance/i)),
    email: field(it, /e-?mail/i),
    payerEmail: String(it.payer?.email ?? '').trim(),
    payerName: `${String(it.payer?.firstName ?? '')} ${String(it.payer?.lastName ?? '')}`.trim(),
  };
}

/**
 * Les articles des formulaires d'adhésion qui comptent pour la saison
 * `season` (année de fin) : ceux du formulaire de la saison, et ceux du
 * formulaire précédent payés en août (geste du club : ils valent aussi pour
 * la saison suivante). Tous les états sont rendus (payé, remboursé…) : l'écran trie.
 */
export async function membershipItems(store: Store, season: number): Promise<HaItemOut[]> {
  const slug = process.env.HELLOASSO_ORG_SLUG!;
  const access = await token(store);
  const forms = await all<HaForm>(`/organizations/${encodeURIComponent(slug)}/forms?formTypes=Membership`, access);
  const out: HaItemOut[] = [];
  for (const f of forms) {
    const formSeason = seasonOfForm(f);
    if (formSeason === null) {
      // Plus d'oubli silencieux : le formulaire est signalé dans les journaux.
      log('warn', { action: 'helloasso', message: 'Formulaire d’adhésion sans saison reconnaissable : ignoré', form: String(f.formSlug ?? '') });
      continue;
    }
    if (formSeason !== season && formSeason !== season - 1) continue;
    const items = await all<HaItem>(`/organizations/${encodeURIComponent(slug)}/forms/Membership/${encodeURIComponent(String(f.formSlug))}/items?withDetails=true`, access);
    for (const it of items) {
      const o = itemOut(it, formSeason);
      if (formSeason === season || o.date.slice(0, 7) === `${season - 1}-08`) out.push(o);
    }
  }
  return out;
}
