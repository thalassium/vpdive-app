/**
 * Messagerie VPDive (/api/messages_/…) lue dans le format de l'écran Messagerie.
 *
 * Formes relevées sur VPDive (octobre 2026) :
 *  - liste : { messages: { <mois>: { <jeton>: { <id message>: conversation } } }, more }
 *    où conversation = { token, id (socket de l'autre), content, timestamp, read,
 *    from_user, to_user, to_user_is_current_user, fullname, … } ;
 *  - fil : { token, user (l'autre), messages: { <date>: { <jeton>: message } }, can_respond }
 *    où message = { message_id, sender (vrai : envoyé par moi), message, timestamp, message_files }.
 *
 * Les personnes sont repérées par leur jeton utilisateur VPDive (`token`), pas par
 * le jeton d'adhésion ; « moi » garde l'identifiant que l'écran connaît (me.uct).
 */

export interface ChatMember {
  /** Jeton utilisateur VPDive de l'autre personne ; me.uct pour moi. */
  uct: string;
  name: string;
  picture: string;
}
export interface ChatMessage {
  id: string;
  from: string;
  text: string;
  at: string;
}
export interface ChatSummary {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  members: ChatMember[];
  last: ChatMessage | null;
  unread: boolean;
  updatedAt: string;
}
export type ChatThread = ChatSummary & { messages: ChatMessage[]; canRespond: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', euro: '€', deg: '°',
  agrave: 'à', acirc: 'â', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', ccedil: 'ç', oelig: 'œ',
  Agrave: 'À', Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Ccedil: 'Ç',
};

/** Texte d'un message VPDive : <br> → retour à la ligne, balises retirées, entités décodées. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}

const isoOf = (timestamp: unknown, fallback: unknown): string => {
  const t = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (Number.isFinite(t) && t > 0) return new Date(t * 1000).toISOString();
  const d = Date.parse(str(fallback));
  return Number.isNaN(d) ? '' : new Date(d).toISOString();
};

/** Une personne VPDive (from_user, to_user, user) ; pictureUrl rend l'adresse absolue. */
export function personOf(u: unknown, pictureUrl: (path: string) => string): ChatMember | null {
  const o = obj(u);
  if (!o) return null;
  const token = str(o.token);
  if (!token) return null;
  const name = `${str(o.first_name)} ${str(o.last_name)}`.trim() || str(o.username);
  return { uct: token, name, picture: pictureUrl(str(o.profile_picture)) };
}

/** Toutes les feuilles d'un objet imbriqué qui ressemblent à `test`. */
function leaves(root: unknown, test: (o: Json) => boolean, depth = 0, out: Json[] = []): Json[] {
  const o = obj(root);
  if (!o || depth > 6) return out;
  if (test(o)) {
    out.push(o);
    return out;
  }
  for (const v of Object.values(o)) leaves(v, test, depth + 1, out);
  return out;
}

/** Liste des conversations à deux, la plus récente d'abord. */
export function parseConversations(body: unknown, me: ChatMember, pictureUrl: (path: string) => string): ChatSummary[] {
  const items = leaves(obj(body)?.messages, (o) => !!o.from_user && !!o.to_user && typeof o.token === 'string');
  const byToken = new Map<string, ChatSummary>();
  for (const it of items) {
    const other = personOf(it.to_user_is_current_user === true ? it.from_user : it.to_user, pictureUrl);
    if (!other) continue;
    if (!other.name) other.name = str(it.fullname);
    const at = isoOf(it.timestamp, it.date);
    const summary: ChatSummary = {
      id: str(it.token),
      kind: 'direct',
      title: other.name || str(it.fullname),
      members: [other, me],
      // L'auteur du dernier message n'est pas dit clairement dans la liste : le fil le précise.
      last: { id: str(it.token), from: other.uct, text: htmlToText(str(it.content)), at },
      unread: it.read === false,
      updatedAt: at,
    };
    const prev = byToken.get(summary.id);
    if (!prev || prev.updatedAt < summary.updatedAt) byToken.set(summary.id, summary);
  }
  return [...byToken.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Fil d'une conversation, du plus ancien au plus récent. */
export function parseThread(body: unknown, me: ChatMember, pictureUrl: (path: string) => string, summary?: ChatSummary | null): ChatThread {
  const o = obj(body) ?? {};
  const other = personOf(o.user, pictureUrl) ?? summary?.members.find((m) => m.uct !== me.uct) ?? { uct: '', name: '', picture: '' };
  const messages = leaves(o.messages, (m) => 'message_id' in m || ('sender' in m && 'message' in m))
    .map((m): ChatMessage & { ts: number } => {
      const files = Array.isArray(m.message_files) ? m.message_files.length : 0;
      const text = htmlToText(str(m.message)) || (files ? `📎 ${files > 1 ? `${files} pièces jointes` : 'pièce jointe'}` : '');
      const at = isoOf(m.timestamp, m.date);
      return { id: str(m.message_id) || at, from: m.sender === true ? me.uct : other.uct, text, at, ts: Number(m.timestamp) || 0 };
    })
    .sort((a, b) => a.ts - b.ts)
    .map(({ ts: _ts, ...m }) => m);
  const last = messages[messages.length - 1] ?? summary?.last ?? null;
  return {
    id: str(o.token) || summary?.id || '',
    kind: 'direct',
    title: other.name || summary?.title || '',
    members: [other, me],
    last,
    unread: false,
    updatedAt: last?.at ?? summary?.updatedAt ?? '',
    messages,
    canRespond: o.can_respond !== false && o.is_close !== true,
  };
}

/** Nombre de conversations non lues : { res: { messages, groups } } de /messages_/notifications. */
export function unreadCount(body: unknown): number {
  const res = obj(obj(body)?.res);
  if (!res) return 0;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return n(res.messages) + n(res.groups);
}
