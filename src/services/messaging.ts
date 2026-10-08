import { pictureUrl, vpdive } from './vpdiveApi';
import { parseConversations, parseThread, unreadCount, type ChatMember, type ChatSummary, type ChatThread } from '../lib/vpdiveChat';

export type { ChatMember, ChatMessage, ChatSummary, ChatThread } from '../lib/vpdiveChat';

/**
 * Messagerie de l'appli = celle de VPDive : mêmes conversations, mêmes messages,
 * de part et d'autre. Une nouvelle conversation n'existe chez VPDive qu'au premier
 * message : d'ici là, c'est un brouillon (« new:<jeton utilisateur> »).
 */
type Me = { uct: string; name: string; picture: string };

const NEW = 'new:';
const drafts = new Map<string, ChatThread>();
let lastList: ChatSummary[] = [];
const meMember = (me: Me): ChatMember => ({ uct: me.uct, name: me.name, picture: me.picture });

export const messaging = {
  async chats(me: Me): Promise<ChatSummary[]> {
    lastList = parseConversations(await vpdive.messageList(), meMember(me), pictureUrl);
    return lastList;
  },

  async chat(id: string, me: Me): Promise<ChatThread> {
    const draft = drafts.get(id);
    if (draft) return draft;
    return parseThread(await vpdive.messageThread(id), meMember(me), pictureUrl, lastList.find((c) => c.id === id) ?? null);
  },

  /** Brouillon de conversation avec une personne (jeton utilisateur VPDive) ; la conversation existante si elle est connue. */
  draft(person: ChatMember, me: Me): ChatSummary {
    const existing = lastList.find((c) => c.members.some((m) => m.uct === person.uct));
    if (existing) return existing;
    const thread: ChatThread = {
      id: `${NEW}${person.uct}`,
      kind: 'direct',
      title: person.name,
      members: [person, meMember(me)],
      last: null,
      unread: false,
      updatedAt: new Date().toISOString(),
      messages: [],
      canRespond: true,
    };
    drafts.set(thread.id, thread);
    return thread;
  },

  /** Envoie ; renvoie l'identifiant de la conversation (nouveau si c'était un brouillon). */
  async send(id: string, text: string, me: Me): Promise<string> {
    if (!id.startsWith(NEW)) {
      await vpdive.messageReply(id, text);
      return id;
    }
    const userToken = id.slice(NEW.length);
    await vpdive.messageStart([userToken], text);
    drafts.delete(id);
    const list = await messaging.chats(me);
    return list.find((c) => c.members.some((m) => m.uct === userToken))?.id ?? id;
  },

  /** Conversations non lues (pastille de l'onglet). */
  async unread(): Promise<number> {
    return unreadCount(await vpdive.messageNotifications());
  },

  /** Écrit à un membre repéré par son jeton d'adhésion (relances de la Documentation). */
  async writeTo(uct: string, text: string): Promise<void> {
    await vpdive.messageStart([await vpdive.userTokenOf(uct)], text);
  },
};
