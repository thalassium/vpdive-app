/**
 * Demandes d'inscription au club : elles ne vivent que dans l'ancienne
 * interface de VPDive (/f/user/index/3, « Demandes d'inscription »), sans
 * équivalent dans l'API. On ouvre donc, avec le jeton de l'admin qui demande,
 * une session de cette interface (/api/jwt-to-connect-token, comme le fait
 * VPDive pour ses propres pages historiques), puis on lit le tableau qu'elle
 * affiche et on suit les mêmes liens que ses boutons :
 *   /f/user/accept/{jeton}/1   accepter : nouveau membre du club
 *   /f/user/accept/{jeton}/0   accepter comme invité (pas de messagerie, invisible des autres membres)
 *   /f/user/refuse/{jeton}     refuser l'accès au site
 * VPDive vérifie lui-même les droits de l'admin (member_edit / club_assoc).
 */
import { HttpError, type Caller } from './auth.js';

const ORIGIN = (process.env.VPDIVE_API_BASE ?? 'https://septentrion-env.vpdive.com/api').replace(/\/api\/?$/, '');
const UA = 'Mozilla/5.0 (vpdive-app)';

export interface RegistrationRequest {
  /** Jeton de la demande (celui des liens accepter / refuser). */
  token: string;
  name: string;
  /** Coordonnées telles que VPDive les affiche (e-mail, téléphone), en texte. */
  contact: string;
  picture: string;
  /** « Le membre est en attente de votre réponse »… */
  status: string;
}
export type Decision = 'member' | 'guest' | 'refuse';

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#0?39;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s*·\s*(·\s*)+/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*·\s*|\s*·\s*$/g, '')
    .trim();

/** Ouvre une session de l'interface historique au nom de l'appelant ; renvoie ses cookies. */
async function legacySession(caller: Caller): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${ORIGIN}/api/jwt-to-connect-token`, {
      method: 'POST',
      headers: { ...caller.headers, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ target_url: '/f/user/index/3' }),
    });
  } catch {
    throw new HttpError(502, 'VPDive injoignable.');
  }
  if (res.status === 401) throw new HttpError(401, 'Session VPDive expirée.');
  const body = (await res.json().catch(() => null)) as { connect_url?: string; data?: { connect_url?: string } } | null;
  let next = body?.connect_url ?? body?.data?.connect_url ?? '';
  if (!next) throw new HttpError(502, 'VPDive n’a pas ouvert de session pour les demandes d’inscription.');
  const cookies = new Map<string, string>();
  for (let i = 0; i < 6 && next; i++) {
    const r = await fetch(next.startsWith('http') ? next : `${ORIGIN}${next}`, { headers: { 'User-Agent': UA, Cookie: cookieHeader(cookies) }, redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      if (eq > 0) cookies.set(pair!.slice(0, eq).trim(), pair!.slice(eq + 1).trim());
    }
    next = r.status >= 300 && r.status < 400 ? (r.headers.get('location') ?? '') : '';
  }
  if (!cookies.size) throw new HttpError(502, 'VPDive n’a pas ouvert de session pour les demandes d’inscription.');
  return cookieHeader(cookies);
}
const cookieHeader = (cookies: Map<string, string>) => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

/** Lit le tableau des demandes d'inscription (statut 3 de la liste des membres). */
async function readRequests(cookie: string): Promise<RegistrationRequest[]> {
  const q = new URLSearchParams({ draw: '1', start: '0', length: '200', enabled: '3', name: '' });
  const r = await fetch(`${ORIGIN}/f/user/datatable?${q}`, {
    headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    redirect: 'manual',
  });
  if (r.status !== 200) throw new HttpError(403, 'VPDive refuse la liste des demandes d’inscription (droits « member_edit » requis).');
  const json = (await r.json().catch(() => null)) as { data?: Record<string, unknown>[] } | null;
  if (!json || !Array.isArray(json.data)) throw new HttpError(502, 'Liste des demandes d’inscription illisible.');
  return json.data
    .map((row) => {
      const actions = String(row.actions ?? '');
      const token = /\/f\/user\/accept\/([\w-]{20,80})\//.exec(actions)?.[1] ?? '';
      const src = /src="([^"]+)"/.exec(String(row.picture ?? ''))?.[1] ?? '';
      return {
        token,
        name: text(String(row.name ?? '')),
        contact: text(String(row.infos ?? '')),
        picture: !src || src.includes('/files/images/') ? '' : src.startsWith('http') ? src : `${ORIGIN}${src}`,
        status: /title="([^"]*)"/.exec(String(row.status ?? ''))?.[1]?.replace(/&#0?39;/g, '’') ?? '',
      };
    })
    .filter((x) => x.token);
}

export async function registrationRequests(caller: Caller): Promise<RegistrationRequest[]> {
  return readRequests(await legacySession(caller));
}

/** Accepte (membre ou invité) ou refuse une demande, puis relit la liste pour s'en assurer. */
export async function decideRegistration(caller: Caller, token: string, decision: Decision): Promise<RegistrationRequest[]> {
  if (!/^[\w-]{20,80}$/.test(token)) throw new HttpError(400, 'Demande inconnue.');
  const cookie = await legacySession(caller);
  const before = await readRequests(cookie);
  if (!before.some((x) => x.token === token)) throw new HttpError(409, 'Cette demande n’est plus en attente : rechargez la liste.');
  const path = decision === 'refuse' ? `/f/user/refuse/${token}` : `/f/user/accept/${token}/${decision === 'member' ? 1 : 0}`;
  const r = await fetch(`${ORIGIN}${path}`, { headers: { 'User-Agent': UA, Cookie: cookie }, redirect: 'manual' });
  if (r.status >= 400) throw new HttpError(502, `VPDive a refusé l’opération (HTTP ${r.status}).`);
  const after = await readRequests(cookie);
  if (after.some((x) => x.token === token)) throw new HttpError(502, 'VPDive n’a pas pris en compte la décision : la demande est toujours en attente.');
  return after;
}
