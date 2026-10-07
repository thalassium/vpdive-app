/**
 * Qui appelle ? Le navigateur envoie le jeton VPDive de la personne connectée
 * (les mêmes en-têtes que pour VPDive). Le serveur ne croit rien sur parole :
 * il demande à VPDive qui est derrière ce jeton et ce qu'il a le droit de faire.
 */

const VPDIVE_API = process.env.VPDIVE_API_BASE ?? 'https://septentrion-env.vpdive.com/api';

export interface Caller {
  id: number;
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

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

export async function vpdiveGet(path: string, headers: Record<string, string>): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(`${VPDIVE_API}${path}`, { headers: { Accept: 'application/json', ...headers } });
  } catch {
    throw new HttpError(502, 'VPDive injoignable.');
  }
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

/** L'appelant est-il inscrit comme « Directeur de plongée » sur cette sortie dans VPDive ? */
export async function isDpOf(caller: Caller, eventToken: string): Promise<boolean> {
  if (!/^[\w-]{10,80}$/.test(eventToken)) return false;
  const res = await vpdiveGet(`/calendar/${eventToken}/event`, caller.headers);
  const me = obj(obj(obj(res.data)?.user_registered)?.[String(caller.id)]);
  const roles = Array.isArray(me?.roles) ? me.roles : [];
  return roles.some((r) => /directeur de plong/i.test(String(obj(r)?.role ?? '')));
}
