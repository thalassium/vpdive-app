/**
 * Qui appelle ? Le navigateur envoie le jeton VPDive de la personne connectée
 * (les mêmes en-têtes que pour VPDive). Le serveur ne croit rien sur parole :
 * il demande à VPDive qui est derrière ce jeton et ce qu'il a le droit de faire.
 */

const VPDIVE_API = process.env.VPDIVE_API_BASE ?? 'https://septentrion-env.vpdive.com/api';

/** Au-delà, on abandonne l'appel à VPDive (la fonction Vercel a 30 s en tout). */
export const VPDIVE_TIMEOUT_MS = 8_000;

export interface Caller {
  id: number;
  /**
   * Jeton d'adhésion au club (UserClubTraceability). C'est aussi l'`id` que
   * renvoie la recherche de membres : les rôles de l'appli y sont rattachés,
   * ce qui permet de nommer admin un membre qui ne s'est jamais connecté.
   */
  uct: string;
  email: string;
  name: string;
  clubId: string;
  /** Admin dans VPDive : permission `member_view` (cf. src/services/vpdiveApi.ts). */
  vpdiveAdmin: boolean;
  /** En-têtes à réutiliser pour interroger VPDive au nom de l'appelant. */
  headers: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const VPDIVE_TIMEOUT_MESSAGE = 'VPDive ne répond pas : réessayez dans un instant.';
export const VPDIVE_FIREWALL_MESSAGE = 'Le pare-feu de VPDive bloque temporairement les appels de l’appli : réessayez dans quelques minutes.';

/** Appel à VPDive avec délai maximal : délai dépassé → 504, réseau coupé → 502. */
export async function vpdiveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(VPDIVE_TIMEOUT_MS) });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') throw new HttpError(504, VPDIVE_TIMEOUT_MESSAGE);
    throw new HttpError(502, 'VPDive injoignable.');
  }
}

/**
 * Réponse du pare-feu de VPDive plutôt que de l'appli : 429, ou une page HTML
 * (403 ou autre) là où l'on attend du JSON. Un 403 en JSON est une vraie
 * réponse de l'API (droits insuffisants) et n'en est pas un.
 */
export function isFirewallBlock(res: Response, expectJson = true): boolean {
  if (res.status === 429) return true;
  const html = /text\/html/i.test(res.headers.get('content-type') ?? '');
  return html && (expectJson || res.status === 403);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

export async function vpdiveGet(path: string, headers: Record<string, string>): Promise<Json> {
  const res = await vpdiveFetch(`${VPDIVE_API}${path}`, { headers: { Accept: 'application/json', ...headers } });
  if (isFirewallBlock(res)) throw new HttpError(429, VPDIVE_FIREWALL_MESSAGE);
  const body = obj(await res.json().catch(() => null));
  const code = typeof body?.code === 'number' ? body.code : null;
  if (res.status === 401 || code === 401) throw new HttpError(401, 'Session VPDive expirée.');
  if (!res.ok || !body || (code !== null && code >= 400)) throw new HttpError(502, `Réponse VPDive inattendue sur ${path}.`);
  return body;
}

function hasPermission(permissions: unknown, key: string): boolean {
  const p = obj(permissions);
  if (!p) return false;
  if (key in p) return p[key] === true;
  return Object.values(p).some((group) => obj(group)?.[key] === true);
}

// Un même jeton n'est vérifié auprès de VPDive qu'une fois toutes les 5 minutes.
const cache = new Map<string, { caller: Caller; until: number }>();

export async function identify(request: Request): Promise<Caller> {
  const auth = request.headers.get('authorization') ?? '';
  if (!/^Bearer \S+$/.test(auth)) throw new HttpError(401, 'Connexion VPDive requise.');
  const hit = cache.get(auth);
  if (hit && hit.until > Date.now()) return hit.caller;

  const [me, trace] = await Promise.all([vpdiveGet('/user/me', { Authorization: auth }), vpdiveGet('/user/traceability', { Authorization: auth })]);
  const traceability = typeof trace.userClubTraceability === 'string' ? trace.userClubTraceability : '';
  const id = typeof me.id === 'number' ? me.id : Number(me.id);
  if (!Number.isFinite(id) || !traceability) throw new HttpError(403, 'Compte VPDive sans club actif.');

  const caller: Caller = {
    id,
    uct: traceability,
    email: String(me.email ?? '').toLowerCase(),
    name: `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim(),
    clubId: String(obj(trace.club)?.id ?? obj(trace.club)?.name ?? 'club'),
    vpdiveAdmin: hasPermission(trace.permissions, 'member_view'),
    headers: { Authorization: auth, userClubTraceability: traceability },
  };
  if (cache.size > 500) cache.clear();
  cache.set(auth, { caller, until: Date.now() + 5 * 60_000 });
  return caller;
}

/** Déconnexion : on oublie ce jeton, le prochain appel qui le présente sera revérifié auprès de VPDive. */
export function forget(authHeader: string): void {
  cache.delete(authHeader);
}

/** L'appelant est-il inscrit comme « Directeur de plongée » sur cette sortie dans VPDive ? */
export async function isDpOf(caller: Caller, eventToken: string): Promise<boolean> {
  if (!/^[\w-]{10,80}$/.test(eventToken)) return false;
  const res = await vpdiveGet(`/calendar/${eventToken}/event`, caller.headers);
  const me = obj(obj(obj(res.data)?.user_registered)?.[String(caller.id)]);
  const roles = Array.isArray(me?.roles) ? me.roles : [];
  return roles.some((r) => /directeur de plong/i.test(String(obj(r)?.role ?? '')));
}
