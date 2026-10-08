/**
 * Messagerie de l'appli, propre au club (VPDive n'expose pas la sienne par son
 * API : ses routes /messages/* répondent 404, relevé d'octobre 2026).
 *
 * Deux sortes de conversations entre membres du club, repérés par leur jeton
 * d'adhésion (uct, comme les rôles) :
 *   direct  deux personnes ; une seule conversation par paire
 *   group   plusieurs personnes, avec un titre
 *
 * Stockage (même base que les rôles et les palanquées) :
 *   club:<id>:chat:<conv>           la conversation et ses messages (les 500 derniers)
 *   club:<id>:chat-inbox:<uct>      les conversations d'une personne
 *   club:<id>:chat-read:<uct>       pour chaque conversation, la date de dernière lecture
 *   club:<id>:chat-direct:<a>|<b>   la conversation directe d'une paire
 *
 * Seuls les membres d'une conversation la lisent ou y écrivent.
 */
import { HttpError } from './auth.js';
import type { Store } from './store.js';

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

export interface Conversation {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  members: ChatMember[];
  messages: ChatMessage[];
  createdBy: string;
  updatedAt: string;
}

/** Ce que la liste des conversations montre : sans les messages, avec le dernier et l'état de lecture. */
export interface ConversationSummary {
  id: string;
  kind: Conversation['kind'];
  title: string;
  members: ChatMember[];
  last: ChatMessage | null;
  unread: boolean;
  updatedAt: string;
}

/** Qui appelle, tel que le serveur l'a vérifié auprès de VPDive. */
export interface ChatCaller {
  clubId: string;
  uct: string;
  name: string;
}

const MAX_MESSAGES = 500;
const MAX_TEXT = 2000;
const MAX_MEMBERS = 60;
const UCT = /^[\w-]{20,80}$/;

const convKey = (c: ChatCaller, id: string) => `club:${c.clubId}:chat:${id}`;
const inboxKey = (c: ChatCaller, uct: string) => `club:${c.clubId}:chat-inbox:${uct}`;
const readKey = (c: ChatCaller, uct: string) => `club:${c.clubId}:chat-read:${uct}`;
const directKey = (c: ChatCaller, a: string, b: string) => `club:${c.clubId}:chat-direct:${[a, b].sort().join('|')}`;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

/** Le titre vu par une personne : celui du groupe, ou le nom de l'autre dans une conversation à deux. */
export function titleFor(conv: Conversation, uct: string): string {
  if (conv.kind === 'group') return conv.title || conv.members.map((m) => m.name.split(' ')[0]).join(', ');
  return conv.members.find((m) => m.uct !== uct)?.name ?? conv.title;
}

/** Non lue : un message plus récent que la dernière lecture, écrit par quelqu'un d'autre. */
export function isUnread(conv: Conversation, uct: string, readAt: string | undefined): boolean {
  const last = conv.messages.at(-1);
  return !!last && last.from !== uct && (!readAt || last.at > readAt);
}

async function load(store: Store, caller: ChatCaller, id: string): Promise<Conversation> {
  if (!/^[a-z0-9]{6,40}$/.test(id)) throw new HttpError(400, 'Conversation inconnue.');
  const conv = await store.get<Conversation>(convKey(caller, id));
  if (!conv || !conv.members.some((m) => m.uct === caller.uct)) throw new HttpError(404, 'Conversation introuvable.');
  return conv;
}

async function markRead(store: Store, caller: ChatCaller, id: string, at: string) {
  const read = (await store.get<Record<string, string>>(readKey(caller, caller.uct))) ?? {};
  if (read[id] && read[id] >= at) return;
  read[id] = at;
  await store.set(readKey(caller, caller.uct), read);
}

/** Les conversations de l'appelant, les plus récentes d'abord. */
export async function listConversations(store: Store, caller: ChatCaller): Promise<ConversationSummary[]> {
  const ids = (await store.get<string[]>(inboxKey(caller, caller.uct))) ?? [];
  const read = (await store.get<Record<string, string>>(readKey(caller, caller.uct))) ?? {};
  const convs = (await Promise.all(ids.map((id) => store.get<Conversation>(convKey(caller, id))))).filter(
    (c): c is Conversation => !!c && c.members.some((m) => m.uct === caller.uct),
  );
  return convs
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      title: titleFor(c, caller.uct),
      members: c.members,
      last: c.messages.at(-1) ?? null,
      unread: isUnread(c, caller.uct, read[c.id]),
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Ouvre une conversation avec ces membres. Avec une seule autre personne,
 * c'est la conversation directe de la paire (créée au besoin) ; avec
 * plusieurs, un nouveau groupe.
 */
export async function startConversation(
  store: Store,
  caller: ChatCaller,
  body: { members?: unknown; title?: unknown; me?: unknown },
): Promise<ConversationSummary> {
  const raw = Array.isArray(body.members) ? body.members : [];
  const me = (body.me ?? {}) as Partial<ChatMember>;
  const self: ChatMember = { uct: caller.uct, name: caller.name || clean(me.name, 80) || 'Moi', picture: clean(me.picture, 300) };
  const others = new Map<string, ChatMember>();
  for (const m of raw as Partial<ChatMember>[]) {
    const uct = clean(m?.uct, 80);
    if (!UCT.test(uct) || uct === caller.uct) continue;
    others.set(uct, { uct, name: clean(m?.name, 80) || 'Membre du club', picture: clean(m?.picture, 300) });
  }
  if (others.size === 0) throw new HttpError(400, 'Choisissez au moins une personne.');
  if (others.size >= MAX_MEMBERS) throw new HttpError(400, `${MAX_MEMBERS} personnes au plus par conversation.`);
  const members = [self, ...others.values()];
  const now = new Date().toISOString();

  if (others.size === 1) {
    const other = [...others.values()][0]!;
    const pair = directKey(caller, caller.uct, other.uct);
    const existing = await store.get<string>(pair);
    if (existing) {
      const conv = await store.get<Conversation>(convKey(caller, existing));
      if (conv) return summary(conv, caller);
    }
    const conv: Conversation = { id: newId(), kind: 'direct', title: '', members, messages: [], createdBy: caller.uct, updatedAt: now };
    await store.set(convKey(caller, conv.id), conv);
    await store.set(pair, conv.id);
    await addToInboxes(store, caller, conv);
    return summary(conv, caller);
  }

  const conv: Conversation = { id: newId(), kind: 'group', title: clean(body.title, 80), members, messages: [], createdBy: caller.uct, updatedAt: now };
  await store.set(convKey(caller, conv.id), conv);
  await addToInboxes(store, caller, conv);
  return summary(conv, caller);
}

async function addToInboxes(store: Store, caller: ChatCaller, conv: Conversation) {
  for (const m of conv.members) {
    const ids = (await store.get<string[]>(inboxKey(caller, m.uct))) ?? [];
    if (!ids.includes(conv.id)) await store.set(inboxKey(caller, m.uct), [conv.id, ...ids]);
  }
}

function summary(conv: Conversation, caller: ChatCaller, read?: string): ConversationSummary {
  return {
    id: conv.id,
    kind: conv.kind,
    title: titleFor(conv, caller.uct),
    members: conv.members,
    last: conv.messages.at(-1) ?? null,
    unread: isUnread(conv, caller.uct, read),
    updatedAt: conv.updatedAt,
  };
}

/** Une conversation et ses messages ; l'ouvrir la marque comme lue. */
export async function readConversation(store: Store, caller: ChatCaller, id: string): Promise<ConversationSummary & { messages: ChatMessage[] }> {
  const conv = await load(store, caller, id);
  const last = conv.messages.at(-1);
  if (last) await markRead(store, caller, id, last.at);
  return { ...summary(conv, caller, last?.at), messages: conv.messages };
}

/** Ajoute un message ; l'auteur l'a lu, par définition. */
export async function sendMessage(store: Store, caller: ChatCaller, body: { id?: unknown; text?: unknown }): Promise<ChatMessage> {
  const conv = await load(store, caller, clean(body.id, 40));
  const text = clean(body.text, MAX_TEXT);
  if (!text) throw new HttpError(400, 'Message vide.');
  const message: ChatMessage = { id: newId(), from: caller.uct, text, at: new Date().toISOString() };
  // Le nom de l'auteur suit celui de VPDive.
  const members = conv.members.map((m) => (m.uct === caller.uct && caller.name ? { ...m, name: caller.name } : m));
  const next: Conversation = { ...conv, members, messages: [...conv.messages, message].slice(-MAX_MESSAGES), updatedAt: message.at };
  await store.set(convKey(caller, conv.id), next);
  await markRead(store, caller, conv.id, message.at);
  return message;
}
