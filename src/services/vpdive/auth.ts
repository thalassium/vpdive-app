/**
 * Session VPDive : connexion, jeton gardé sur l'appareil (jamais le mot de passe),
 * déconnexion. Tous les appels passent par le transport créé ici, qui ajoute les
 * en-têtes de la session et la perd sur un 401.
 */
import { Transport, VpDiveError, SessionExpiredError, type CallOptions } from './transport';
import { obj, str, num, pictureUrl, type Json } from './parse';

const API_BASE = '/api/vpdive'; // Vite proxy → https://septentrion-env.vpdive.com/api
const SESSION_KEY = 'vpdive_session';
// Older AI Studio builds stored the password in clear text under this key.
const LEGACY_CREDENTIALS_KEY = 'vpdive_creds';

export interface Session {
  token: string;
  /** Expiry in ms since epoch, read from the JWT `exp` claim. */
  expiresAt: number;
  traceability: string;
  userId: number | null;
  email: string;
  firstName: string;
  lastName: string;
  clubName: string;
  /** Club admin on VPDive (permission `member_view`). Absent on sessions saved before this field existed. */
  isAdmin?: boolean;
  /** The member's own photo (absolute URL), '' for VPDive's default avatar. Absent on sessions saved before this field existed. */
  picture?: string;
}

function decodeJwtExp(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Permission check, same lookup as VPDive's own web app: `permissions` is
 * `{ user: {...}, club: {...}, user_club_traceability: {...} }` and a key may
 * sit at the top level or in any of those groups.
 */
function hasPermission(permissions: unknown, key: string): boolean {
  const p = obj(permissions);
  if (!p) return false;
  if (key in p) return p[key] === true;
  return Object.values(p).some((group) => obj(group)?.[key] === true);
}

/**
 * Club admin = may view member profiles. It is the permission VPDive itself
 * checks before opening the member directory and member profiles.
 */
const ADMIN_PERMISSION = 'member_view';

/** Session gardée sur l'appareil, relue au chargement (les anciennes versions gardaient le mot de passe : effacé). */
let session: Session | null = (() => {
  try {
    localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
    const raw = localStorage.getItem(SESSION_KEY);
    const stored = raw ? (JSON.parse(raw) as Session) : null;
    if (stored?.token && stored.traceability && stored.expiresAt > Date.now()) return stored;
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    return null;
  }
})();

/** Tous les appels passent par la file du transport (rythme, partage, cache, erreurs typées). */
export const http = new Transport({
  auth: () => {
    const s = getSession();
    return s ? { token: s.token, traceability: s.traceability } : null;
  },
  onUnauthorized: () => setSession(null),
});

export function getSession(): Session | null {
  if (session && session.expiresAt <= Date.now()) setSession(null);
  return session;
}

function setSession(next: Session | null) {
  // Autre session (connexion, déconnexion) : rien de ce qui a été lu ne lui revient.
  if (next?.token !== session?.token) http.clear();
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private browsing: the session simply lasts as long as the tab.
  }
}

/** Un appel dont la réponse doit être un objet JSON. */
export async function request(path: string, init: CallOptions = {}): Promise<Json> {
  const data = await http.call(path, init);
  const o = obj(data);
  if (o === null) throw new VpDiveError('Réponse VPDive inattendue.', 0);
  return o;
}

/** Same as request(), for the few endpoints that answer with a bare JSON array. */
export async function requestList(path: string, init: CallOptions = {}): Promise<unknown[]> {
  const data = await http.call(path, init);
  if (!Array.isArray(data)) throw new VpDiveError('Réponse VPDive inattendue.', 0);
  return data;
}

export async function login(email: string, password: string): Promise<Session> {
  let login: Json;
  try {
    login = await request('/login_check', { method: 'POST', body: { email, password }, auth: false });
  } catch (e) {
    if (e instanceof VpDiveError && e.status === 401) {
      throw new VpDiveError('E-mail ou mot de passe incorrect.', 401);
    }
    throw e;
  }

  const token = str(login.token);
  if (!token) {
    throw new VpDiveError(
      'VPDive n’a pas renvoyé de jeton de connexion. Si la double authentification est activée sur votre compte, elle n’est pas encore prise en charge.',
      0,
    );
  }

  // These two calls need the token but not yet the traceability header.
  const withToken = (path: string): Promise<Json> => request(path, { auth: false, headers: { Authorization: `Bearer ${token}` } });

  // Traceability (the club the member acts in) is mandatory: calendar calls
  // answer 403 without it, so a login without it is not a usable login.
  const trace = await withToken('/user/traceability');
  const traceability = str(trace.userClubTraceability);
  if (!traceability) {
    throw new VpDiveError('Votre compte VPDive n’est rattaché à aucun club actif.', 0);
  }
  const me = await withToken('/user/me');

  const session: Session = {
    token,
    expiresAt: decodeJwtExp(token) || Date.now() + 3_600_000,
    traceability,
    userId: num(me.id),
    email,
    firstName: str(me.first_name),
    lastName: str(me.last_name),
    clubName: str(obj(trace.club)?.name),
    isAdmin: hasPermission(trace.permissions, ADMIN_PERMISSION),
    picture: pictureUrl(str(me.profile_picture)),
  };
  setSession(session);
  return session;
}

/** The signed-in member's photo, read again from /user/me and kept in the session (sessions saved before `picture` existed). */
export async function refreshPicture(): Promise<string> {
  const me = await request('/user/me');
  const picture = pictureUrl(str(me.profile_picture));
  const s = getSession();
  if (s) setSession({ ...s, picture });
  return picture;
}

export function logout() {
  const s = session;
  setSession(null);
  if (s) {
    // Revoke the JWT server-side; nothing to do if it fails.
    fetch(`${API_BASE}/logout`, { headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
  }
}

/** Same headers as VPDive calls, for the app's own API (/api/app), which checks them with VPDive. */
export function authHeaders(): Record<string, string> {
  const s = getSession();
  if (!s) throw new SessionExpiredError();
  return { Authorization: `Bearer ${s.token}`, userClubTraceability: s.traceability };
}
