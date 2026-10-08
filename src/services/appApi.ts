/**
 * Client of the app's own API (/api/app, server/handler.ts): roles in the app,
 * and the dives and safety sheets of each outing. Every call carries the VPDive
 * session; the server checks it with VPDive before answering.
 */
import { vpdive, SessionExpiredError } from './vpdiveApi';
import type { OutingDoc } from '../lib/outing';
import type { FfessmRow, HaItem, LinkChoice } from '../lib/membership';

/** Dernier export FFESSM déposé, partagé entre admins. */
export interface FfessmImport {
  rows: FfessmRow[];
  period: string;
  by: string;
  at: string;
}

export type AppRole = 'superadmin' | 'admin' | 'member';

export interface Me {
  id: number;
  /** Jeton d'adhésion au club : l'`id` de la personne dans la liste des membres. */
  uct: string;
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  role: AppRole;
}

/** Un membre qui a un rôle dans l'appli (les autres sont de simples membres). */
export interface RoleEntry {
  /** Jeton d'adhésion au club, = MemberMatch.id. */
  uct: string;
  role: AppRole;
  vpdiveAdmin: boolean;
  /** Super-admin par réglage Vercel (SUPER_ADMIN_EMAILS) : ne se change pas dans l'appli. */
  lockedSuperAdmin: boolean;
  /** Admin VPDive à qui le rôle admin de l'appli a été retiré. */
  revoked: boolean;
}


export type IgnoredDocs = Record<string, { name: string; by: string; at: string }>;

export class AppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

async function call<T>(query: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/app?${query}`, {
      method: init.method ?? 'GET',
      headers: { ...vpdive.authHeaders(), Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new AppApiError('Serveur de l’appli injoignable. Vérifiez votre connexion.', 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401) throw new SessionExpiredError();
  if (!res.ok || !body) throw new AppApiError(body?.error ?? `Erreur du serveur de l’appli (HTTP ${res.status}).`, res.status, body);
  return body;
}

export const appApi = {
  me: () => call<Me>('action=me'),
  roles: () => call<{ roles: RoleEntry[] }>('action=roles').then((r) => r.roles),
  /** Rôles, et dernière connexion à l'appli de chaque membre (uct → date ISO). */
  rolesAndSeen: () => call<{ roles: RoleEntry[]; seen?: Record<string, string> }>('action=roles').then((r) => ({ roles: r.roles, seen: r.seen ?? {} })),
  setRole: (uct: string, change: { admin?: boolean; superAdmin?: boolean }) =>
    call<{ roles: RoleEntry[] }>('action=role', { method: 'POST', body: { uct, ...change } }).then((r) => r.roles),
  getOuting: (event: string) => call<{ doc: OutingDoc | null }>(`action=outing&event=${encodeURIComponent(event)}`).then((r) => r.doc),
  /** Rôles enregistrés dans l'appli (DP, pilote, sécurité) pour plusieurs sorties ; null : pas de fiche. */
  outingRoles: (events: string[]) =>
    call<{ roles: Record<string, Record<string, string[]> | null> }>(`action=outing_roles&events=${events.map(encodeURIComponent).join(',')}`, { method: 'GET' }).then((r) => r.roles),
  /** Suivi des documents : membres ignorés (uct → nom, qui, quand), partagés entre admins. */
  /** Gestion des adhésions : articles HelloAsso de la saison (année de fin). */
  helloasso: (season: number) => call<{ items: HaItem[] }>(`action=helloasso&season=${season}`).then((r) => r.items),
  ffessmImport: () => call<{ import: FfessmImport | null }>('action=ffessm').then((r) => r.import),
  saveFfessmImport: (rows: FfessmRow[], period: string) => call<{ import: FfessmImport }>('action=ffessm', { method: 'POST', body: { rows, period } }).then((r) => r.import),
  memberLinks: () => call<{ links: Record<string, LinkChoice> }>('action=member_links').then((r) => r.links),
  setMemberLink: (key: string, uct: string | null) => call<{ links: Record<string, LinkChoice> }>('action=member_links', { method: 'POST', body: { key, uct } }).then((r) => r.links),
  docsIgnored: () => call<{ ignored: IgnoredDocs }>('action=docs_ignored').then((r) => r.ignored),
  setDocsIgnored: (uct: string, name: string, ignore: boolean) =>
    call<{ ignored: IgnoredDocs }>('action=docs_ignored', { method: 'POST', body: { uct, name, ignore } }).then((r) => r.ignored),
  /** Refused with status 409 (body.doc = the newer version) when someone saved in between. */
  saveOuting: (event: string, doc: OutingDoc, baseRev: number) =>
    call<{ doc: OutingDoc }>(`action=outing&event=${encodeURIComponent(event)}`, { method: 'POST', body: { doc, baseRev } }).then((r) => r.doc),
  /**
   * Logout: the server drops its cached copy of this session. Call it before
   * vpdive.logout() (the headers are still needed). Never rejects: fire-and-forget safe.
   */
  logout: (): Promise<void> =>
    call<{ ok: boolean }>('action=logout', { method: 'POST' }).then(
      () => undefined,
      () => undefined,
    ),
};
