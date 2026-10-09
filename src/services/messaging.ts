import { pictureUrl, vpdive } from './vpdiveApi';
import {
  mergeConversations,
  nextStart,
  oldestShown,
  pageSize,
  parseConversations,
  parseThread,
  reachesCutoff,
  unreadCount,
  type ChatMember,
  type ChatSummary,
  type ChatThread,
} from '../lib/vpdiveChat';

export type { ChatMember, ChatMessage, ChatSummary, ChatThread } from '../lib/vpdiveChat';

/**
 * Messagerie de l'appli = celle de VPDive : mêmes conversations, mêmes messages,
 * de part et d'autre. Une nouvelle conversation n'existe chez VPDive qu'au premier
 * message : d'ici là, c'est un brouillon (« new:<jeton utilisateur> »).
 *
 * Une seule source pour la liste et la pastille : la liste relue par l'écran
 * Messagerie sert aussi à compter les non-lus tant qu'elle est récente, la
 * pastille ne relit donc pas VPDive pendant que l'écran est ouvert.
 */
type Me = { uct: string; name: string; picture: string };

const NEW = 'new:';
/** Pages lues au plus pour remonter jusqu'à la limite (garde-fou si VPDive pagine autrement que prévu). */
const MAX_PAGES = 10;
/** Âge au-delà duquel la liste ne suffit plus pour la pastille (l'écran la relit toutes les 20 s). */
const LIST_FRESH_MS = 45_000;

const drafts = new Map<string, ChatThread>();
let lastList: ChatSummary[] = [];
/** Moment de la dernière lecture de la liste ; 0 : jamais lue. */
let listAt = 0;
/** Session (jeton) pour laquelle la liste a été lue : un autre compte connecté ensuite ne la voit pas. */
let listSession = '';
const sessionToken = () => vpdive.getSession()?.token ?? '';
/** La liste connue, si elle appartient à la session en cours. */
const ownList = () => (listSession === sessionToken() ? lastList : []);
const meMember = (me: Me): ChatMember => ({ uct: me.uct, name: me.name, picture: me.picture });
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pages de la liste, depuis la plus récente, jusqu'à la première conversation
 * antérieure au 1er janvier de l'année précédente (les plus anciennes ne sont pas montrées).
 */
async function readPages(me: ChatMember, cutoff: string, maxPages: number): Promise<ChatSummary[][]> {
  const pages: ChatSummary[][] = [];
  const seen = new Set<string>();
  let start = 0;
  let received = 0;
  for (let i = 0; i < maxPages; i++) {
    const body = await vpdive.messageList(start);
    const page = parseConversations(body, me, pictureUrl);
    const fresh = page.filter((c) => !seen.has(c.id));
    // Page déjà vue (VPDive ignore la position demandée) : on s'arrête là.
    if (i > 0 && fresh.length === 0) break;
    page.forEach((c) => seen.add(c.id));
    pages.push(page);
    received += pageSize(body);
    if (reachesCutoff(page, cutoff)) break;
    const next = nextStart(body, received);
    if (next === null || next <= start) break;
    start = next;
  }
  return pages;
}

export const messaging = {
  /**
   * Conversations à deux. `quick` : la première page seulement, fusionnée avec la
   * liste déjà connue (relectures régulières) ; sinon toutes les pages jusqu'à la limite.
   */
  async chats(me: Me, opts: { quick?: boolean } = {}): Promise<ChatSummary[]> {
    const cutoff = oldestShown(new Date());
    const known = ownList();
    const quick = !!opts.quick && listAt > 0 && known.length > 0;
    const session = sessionToken();
    const pages = await readPages(meMember(me), cutoff, quick ? 1 : MAX_PAGES);
    lastList = mergeConversations(quick ? [...pages, known] : pages, cutoff);
    listAt = Date.now();
    listSession = session;
    return lastList;
  },

  async chat(id: string, me: Me): Promise<ChatThread> {
    const draft = drafts.get(id);
    if (draft) return draft;
    const thread = parseThread(await vpdive.messageThread(id), meMember(me), pictureUrl, ownList().find((c) => c.id === id) ?? null);
    // Le fil dit qui a écrit le dernier message, et l'ouvrir le marque lu.
    lastList = lastList.map((c) => (c.id === id ? { ...c, unread: false, last: thread.last ?? c.last } : c));
    return thread;
  },

  /** Brouillon de conversation avec une personne (jeton utilisateur VPDive) ; la conversation existante si elle est connue. */
  draft(person: ChatMember, me: Me): ChatSummary {
    const existing = ownList().find((c) => c.members.some((m) => m.uct === person.uct));
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

  /**
   * Envoie ; renvoie l'identifiant de la conversation (le vrai, si c'était un
   * brouillon). null : message envoyé, mais VPDive ne liste pas encore la
   * nouvelle conversation (relue une seconde fois après 1 s).
   */
  async send(id: string, text: string, me: Me): Promise<string | null> {
    if (!id.startsWith(NEW)) {
      await vpdive.messageReply(id, text);
      return id;
    }
    const userToken = id.slice(NEW.length);
    await vpdive.messageStart([userToken], text);
    drafts.delete(id);
    const find = (list: ChatSummary[]) => list.find((c) => c.members.some((m) => m.uct === userToken))?.id ?? null;
    // La nouvelle conversation est la plus récente : la première page suffit.
    const found = find(await messaging.chats(me, { quick: true }));
    if (found) return found;
    await wait(1000);
    return find(await messaging.chats(me, { quick: true }));
  },

  /** Conversations non lues (pastille de l'onglet) : d'après la liste si elle est récente, sinon demandé à VPDive. */
  async unread(): Promise<number> {
    if (listAt > 0 && Date.now() - listAt < LIST_FRESH_MS && listSession === sessionToken()) return lastList.filter((c) => c.unread).length;
    return unreadCount(await vpdive.messageNotifications());
  },

  /** Écrit à un membre repéré par son jeton d'adhésion (relances de la Documentation). */
  async writeTo(uct: string, text: string): Promise<void> {
    await vpdive.messageStart([await vpdive.userTokenOf(uct)], text);
  },
};
