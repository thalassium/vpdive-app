/**
 * Lecture des adhésions HelloAsso (API v5) pour la gestion des adhésions.
 *
 * Clé de l'association (Mon compte › Intégration et API) dans les variables
 * HELLOASSO_CLIENT_ID, HELLOASSO_CLIENT_SECRET et HELLOASSO_ORG_SLUG. Le secret
 * donne les droits d'admin du compte HelloAsso : il ne quitte jamais le serveur.
 * HelloAsso limite les demandes de jeton (50 par heure) : le jeton est gardé
 * dans le stockage partagé et renouvelé par son refresh token.
 */
import type { Store } from './store.js';

const API = 'https://api.helloasso.com/v5';
const TOKEN_URL = 'https://api.helloasso.com/oauth2/token';
const TOKEN_KEY = 'app:helloasso-token';

type Json = Record<string, any>;
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

async function requestToken(params: Record<string, string>): Promise<Token> {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!res.ok) throw new Error(`HelloAsso : jeton refusé (HTTP ${res.status})`);
  const t = (await res.json()) as Json;
  return { access: String(t.access_token), refresh: String(t.refresh_token ?? ''), expires: Date.now() + (Number(t.expires_in) || 1700) * 1000 };
}

async function token(store: Store): Promise<string> {
  const saved = await store.get<Token>(TOKEN_KEY);
  if (saved && saved.expires > Date.now() + 60_000) return saved.access;
  let fresh: Token | null = null;
  if (saved?.refresh) fresh = await requestToken({ grant_type: 'refresh_token', refresh_token: saved.refresh }).catch(() => null);
  fresh ??= await requestToken({ grant_type: 'client_credentials', client_id: process.env.HELLOASSO_CLIENT_ID!, client_secret: process.env.HELLOASSO_CLIENT_SECRET! });
  await store.set(TOKEN_KEY, fresh);
  return fresh.access;
}

/** Toutes les pages d'une liste HelloAsso : on avance jusqu'à une page vide. */
async function all(path: string, access: string): Promise<Json[]> {
  const out: Json[] = [];
  let next = '';
  for (let i = 0; i < 50; i++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${API}${path}${sep}pageSize=100${next ? `&continuationToken=${encodeURIComponent(next)}` : ''}`, {
      headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HelloAsso : lecture refusée (HTTP ${res.status})`);
    const page = (await res.json()) as Json;
    const data = Array.isArray(page.data) ? (page.data as Json[]) : [];
    if (!data.length) break;
    out.push(...data);
    next = String(page.pagination?.continuationToken ?? '');
    if (!next) break;
  }
  return out;
}

const field = (it: Json, re: RegExp) => String((it.customFields ?? []).find((c: Json) => re.test(String(c.name ?? '')))?.answer ?? '').trim();
const ymd = (s: string) => {
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

function itemOut(it: Json, formSeason: number): HaItemOut {
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
    payerName: `${it.payer?.firstName ?? ''} ${it.payer?.lastName ?? ''}`.trim(),
  };
}

/**
 * Les articles des formulaires d'adhésion qui comptent pour la saison
 * `season` (année de fin) : ceux du formulaire de la saison, et ceux du
 * formulaire précédent payés en août (geste du club : ils valent aussi pour
 * la saison suivante).
 */
export async function membershipItems(store: Store, season: number): Promise<HaItemOut[]> {
  const slug = process.env.HELLOASSO_ORG_SLUG!;
  const access = await token(store);
  const forms = await all(`/organizations/${encodeURIComponent(slug)}/forms?formTypes=Membership`, access);
  const seasonOfForm = (f: Json) => Number(String(f.endDate ?? '').slice(0, 4));
  const out: HaItemOut[] = [];
  for (const f of forms.filter((x) => seasonOfForm(x) === season || seasonOfForm(x) === season - 1)) {
    const formSeason = seasonOfForm(f);
    const items = await all(`/organizations/${encodeURIComponent(slug)}/forms/Membership/${encodeURIComponent(String(f.formSlug))}/items?withDetails=true`, access);
    for (const it of items) {
      const o = itemOut(it, formSeason);
      if (formSeason === season || o.date.slice(0, 7) === `${season - 1}-08`) out.push(o);
    }
  }
  return out;
}
