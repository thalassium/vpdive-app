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

/** Messagerie de l'appli (server/chat.ts). Les membres sont repérés par leur jeton d'adhésion (uct). */
export interface ChatMember {
  uct: string;
  name: string;
  picture: string;
}
export interface ChatMessage {
  id: string;
  /** uct de l'auteur */
  from: string;
  text: string;
  at: string;
}
export interface ChatSummary {
  id: string;
  kind: 'direct' | 'group';
  /** Nom de l'autre personne (à deux) ou titre du groupe. */
  title: string;
  members: ChatMember[];
  last: ChatMessage | null;
  unread: boolean;
  updatedAt: string;
}
export type ChatThread = ChatSummary & { messages: ChatMessage[] };

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
  setRole: (uct: string, change: { admin?: boolean; superAdmin?: boolean }) =>
    call<{ roles: RoleEntry[] }>('action=role', { method: 'POST', body: { uct, ...change } }).then((r) => r.roles),
  getOuting: (event: string) => call<{ doc: OutingDoc | null }>(`action=outing&event=${encodeURIComponent(event)}`).then((r) => r.doc),
  /** Suivi des documents : membres ignorés (uct → nom, qui, quand), partagés entre admins. */
  docsIgnored: () => call<{ ignored: IgnoredDocs }>('action=docs_ignored').then((r) => r.ignored),
  setDocsIgnored: (uct: string, name: string, ignore: boolean) =>
    call<{ ignored: IgnoredDocs }>('action=docs_ignored', { method: 'POST', body: { uct, name, ignore } }).then((r) => r.ignored),
  chats: () => call<{ conversations: ChatSummary[] }>('action=chats').then((r) => r.conversations),
  chat: (id: string) => call<ChatThread>(`action=chat&id=${encodeURIComponent(id)}`),
  /** Une personne : la conversation à deux (retrouvée si elle existe). Plusieurs : un nouveau groupe. */
  chatNew: (members: ChatMember[], me: Pick<ChatMember, 'name' | 'picture'>, title?: string) =>
    call<ChatSummary>('action=chat_new', { method: 'POST', body: { members, me, title } }),
  chatSend: (id: string, text: string) => call<{ message: ChatMessage }>('action=chat_send', { method: 'POST', body: { id, text } }).then((r) => r.message),
  /** Refused with status 409 (body.doc = the newer version) when someone saved in between. */
  saveOuting: (event: string, doc: OutingDoc, baseRev: number) =>
    call<{ doc: OutingDoc }>(`action=outing&event=${encodeURIComponent(event)}`, { method: 'POST', body: { doc, baseRev } }).then((r) => r.doc),
};
