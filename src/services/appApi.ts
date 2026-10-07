/**
 * Client of the app's own API (/api/app, server/handler.ts): roles in the app,
 * and the dives and safety sheets of each outing. Every call carries the VPDive
 * session; the server checks it with VPDive before answering.
 */
import { vpdive, SessionExpiredError } from './vpdiveApi';
import type { OutingDoc } from '../lib/outing';

export type AppRole = 'superadmin' | 'admin' | 'member';

export interface Me {
  id: number;
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  role: AppRole;
}

export interface AppUser {
  id: number;
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  lastSeen: string;
  role: AppRole;
  /** Super-admin by Vercel setting (SUPER_ADMIN_EMAILS): cannot be changed in the app. */
  lockedSuperAdmin: boolean;
  revoked: boolean;
}

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
  users: () => call<{ users: AppUser[] }>('action=users').then((r) => r.users),
  setRole: (userId: number, change: { admin?: boolean; superAdmin?: boolean }) =>
    call<{ ok: true }>('action=role', { method: 'POST', body: { userId, ...change } }),
  getOuting: (event: string) => call<{ doc: OutingDoc | null }>(`action=outing&event=${encodeURIComponent(event)}`).then((r) => r.doc),
  /** Refused with status 409 (body.doc = the newer version) when someone saved in between. */
  saveOuting: (event: string, doc: OutingDoc, baseRev: number) =>
    call<{ doc: OutingDoc }>(`action=outing&event=${encodeURIComponent(event)}`, { method: 'POST', body: { doc, baseRev } }).then((r) => r.doc),
};
