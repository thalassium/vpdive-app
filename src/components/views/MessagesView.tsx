import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Paperclip, SendHorizontal } from 'lucide-react';
import { Avatar } from '../Avatar';
import { vpdive, ymd, type ChatMessage, type Conversation, type Thread } from '../../services/vpdiveApi';

const VPDIVE_URL = 'https://septentrion-env.vpdive.com/';
const THREAD_POLL_MS = 15_000;
const LIST_POLL_MS = 30_000;

type Filter = 'all' | 'discussion' | 'group';
const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: 'all', label: 'Tout', empty: 'Aucune conversation.' },
  { id: 'discussion', label: 'Discussions', empty: 'Aucune discussion.' },
  { id: 'group', label: 'Groupes', empty: 'Aucun groupe.' },
];

const keyOf = (c: Pick<Conversation, 'kind' | 'token'>) => `${c.kind}:${c.token}`;

// ── Dates ───────────────────────────────────────────────────────

/** Lit « AAAA-MM-JJ[ HH:MM[:SS]] » en heure locale (Safari refuse l'espace), sinon laisse faire Date. */
function parseDate(s: string): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Date courte de la liste : « 14:05 » aujourd'hui, « hier », sinon « 3 oct. ». */
function listDate(s: string): string {
  const d = parseDate(s);
  if (!d) return s.trim();
  const now = new Date();
  if (sameDay(d, now)) return hhmm(d);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'hier';
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/** Intitulé d'un jour dans le fil : « samedi 11 octobre ». */
function dayLabel(day: string): string {
  const d = parseDate(day);
  if (!d) return day;
  const now = new Date();
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

function messageTime(m: ChatMessage): string {
  if (m.time) return m.time;
  const d = /\d{2}:\d{2}/.test(m.date) ? parseDate(m.date) : null;
  return d ? hhmm(d) : '';
}

/** Messages groupés par jour, dans l'ordre du fil. */
function byDay(messages: ChatMessage[]): { day: string; messages: ChatMessage[] }[] {
  const out: { day: string; messages: ChatMessage[] }[] = [];
  for (const m of messages) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : m.date.trim();
    const last = out[out.length - 1];
    if (last && last.day === day) last.messages.push(m);
    else out.push({ day, messages: [m] });
  }
  return out;
}

/** Message envoyé d'ici, avant que VPDive le renvoie dans le fil. */
function pending_(id: number, text: string): ChatMessage {
  const now = new Date();
  return { token: `local-${id}`, mine: true, text, date: `${ymd(now)} ${hhmm(now)}`, time: hhmm(now), author: '', files: [] };
}

/** Clavier physique : Entrée envoie. Sur téléphone, Entrée va à la ligne. */
const hasFinePointer = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ── Vue ─────────────────────────────────────────────────────────

export function MessagesView({ onSessionLost, onRead }: { onSessionLost: (e: unknown) => boolean; onRead: () => void }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const [open, setOpen] = useState<Conversation | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadError, setThreadError] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ id: number; text: string; time: string }[]>([]);
  const [sendError, setSendError] = useState('');

  // Les props et la conversation ouverte, lues depuis les minuteries sans les relancer.
  const lostRef = useRef(false);
  const onSessionLostRef = useRef(onSessionLost);
  const onReadRef = useRef(onRead);
  const openKeyRef = useRef<string | null>(null);
  useEffect(() => {
    onSessionLostRef.current = onSessionLost;
    onReadRef.current = onRead;
  });

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollKeyRef = useRef('');

  /** Vrai si l'erreur a mis fin à la session (l'app reprend la main). */
  const lost = useCallback((e: unknown) => {
    if (lostRef.current) return true;
    if (onSessionLostRef.current(e)) {
      lostRef.current = true;
      return true;
    }
    return false;
  }, []);

  const loadList = useCallback(
    async (quiet = false) => {
      if (lostRef.current) return;
      if (!quiet) {
        setListLoading(true);
        setListError('');
      }
      try {
        const list = await vpdive.fetchConversations();
        // La conversation ouverte reste lue, même si VPDive n'a pas encore suivi.
        setConversations(list.map((c) => (keyOf(c) === openKeyRef.current ? { ...c, read: true } : c)));
        setListError('');
      } catch (e) {
        if (lost(e)) return;
        if (!quiet) setListError(e instanceof Error && e.message ? e.message : 'Les conversations n’ont pas pu être chargées.');
      } finally {
        if (!quiet) setListLoading(false);
      }
    },
    [lost],
  );

  const loadThread = useCallback(
    async (c: Conversation, quiet = false): Promise<boolean> => {
      if (lostRef.current) return false;
      const key = keyOf(c);
      if (!quiet) {
        setThreadLoading(true);
        setThreadError('');
      }
      try {
        const t = await vpdive.fetchThread(c);
        if (openKeyRef.current !== key) return false;
        setThread(t);
        setThreadError('');
        return true;
      } catch (e) {
        if (lost(e) || openKeyRef.current !== key) return false;
        if (!quiet) setThreadError(e instanceof Error && e.message ? e.message : 'La conversation n’a pas pu être chargée.');
        return false;
      } finally {
        if (!quiet && openKeyRef.current === key) setThreadLoading(false);
      }
    },
    [lost],
  );

  // Liste : au montage, puis toutes les 30 s.
  useEffect(() => {
    void loadList();
    const id = window.setInterval(() => void loadList(true), LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadList]);

  // Fil ouvert : toutes les 15 s.
  const openKey = open ? keyOf(open) : null;
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => void loadThread(open, true), THREAD_POLL_MS);
    return () => window.clearInterval(id);
  }, [open, loadThread]);

  const openConversation = async (c: Conversation) => {
    const key = keyOf(c);
    openKeyRef.current = key;
    scrollKeyRef.current = '';
    setOpen(c);
    setThread(null);
    setPending([]);
    setDraft('');
    setSendError('');
    setConversations((list) => list && list.map((x) => (keyOf(x) === key ? { ...x, read: true } : x)));
    await loadThread(c);
    if (openKeyRef.current === key && !lostRef.current) onReadRef.current();
  };

  const closeConversation = () => {
    openKeyRef.current = null;
    setOpen(null);
    setThread(null);
    setThreadError('');
    setPending([]);
    setSendError('');
  };

  // Défile jusqu'au dernier message à l'ouverture et à chaque nouveau message.
  const messageCount = (thread?.messages.length ?? 0) + pending.length;
  useLayoutEffect(() => {
    if (!thread) return;
    const key = `${openKey}:${messageCount}`;
    if (scrollKeyRef.current === key) return;
    const first = !scrollKeyRef.current;
    scrollKeyRef.current = key;
    endRef.current?.scrollIntoView({ block: 'end', behavior: first ? 'auto' : 'smooth' });
  }, [thread, openKey, messageCount]);

  // Zone de saisie qui grandit avec le texte (plafonnée par max-h-32).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
  }, [draft]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const c = open;
    const text = draft.trim();
    if (!c || !text || sending) return;
    const key = keyOf(c);
    const id = Date.now();
    setSending(true);
    setSendError('');
    setPending((p) => [...p, { id, text, time: hhmm(new Date()) }]);
    setDraft('');
    try {
      await vpdive.sendMessage(c, text);
      const refreshed = await loadThread(c, true);
      if (openKeyRef.current === key) {
        const sent = pending_(id, text);
        // Fil pas relu : le message envoyé reste affiché jusqu'au prochain relevé.
        if (!refreshed) setThread((t) => t && { ...t, messages: [...t.messages, sent] });
        setPending((p) => p.filter((x) => x.id !== id));
      }
      void loadList(true);
    } catch (err) {
      if (lost(err) || openKeyRef.current !== key) return;
      setPending((p) => p.filter((x) => x.id !== id));
      setDraft((d) => d || text);
      setSendError(err instanceof Error && err.message ? err.message : 'Le message n’a pas pu être envoyé.');
    } finally {
      setSending(false);
    }
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || !hasFinePointer()) return;
    e.preventDefault();
    void send();
  };

  const visible = (conversations ?? []).filter((c) => filter === 'all' || c.kind === filter);
  const failedFirst = conversations === null && !listLoading && !!listError;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className={open ? 'hidden md:block' : ''}>
        <h1 className="text-xl font-semibold text-brand">Messagerie</h1>
        <div aria-hidden className="isobath bg-line mt-2 mb-4" />
      </div>

      {failedFirst ? (
        <div className="card p-4 sm:p-6 space-y-4">
          <p className="text-base text-ink">La messagerie VPDive n'a pas pu être chargée.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void loadList()} className="btn btn-quiet">
              Réessayer
            </button>
            <a href={VPDIVE_URL} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand underline underline-offset-2">
              Ouvrir la messagerie sur VPDive
            </a>
          </div>
        </div>
      ) : (
        <div className="md:flex md:items-start">
          {/* Liste des conversations */}
          <section aria-label="Conversations" className={`md:w-80 md:shrink-0 md:border-r border-line md:pr-4 ${open ? 'hidden md:block' : ''}`}>
            <div role="group" aria-label="Filtrer" className="inline-flex rounded-lg border border-field-border bg-surface p-1 mb-3">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${filter === f.id ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {listError && conversations && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <p className="text-sm text-danger flex-1 min-w-0">{listError}</p>
                <button type="button" onClick={() => void loadList()} className="btn btn-quiet">
                  Réessayer
                </button>
              </div>
            )}

            {conversations === null ? (
              <p className="text-sm text-muted py-2">Chargement des conversations…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted py-2">{FILTERS.find((f) => f.id === filter)?.empty}</p>
            ) : (
              <ul className="card divide-y divide-line overflow-hidden">
                {visible.map((c) => {
                  const active = openKey === keyOf(c);
                  return (
                    <li key={keyOf(c)}>
                      <button
                        type="button"
                        onClick={() => void openConversation(c)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex items-center gap-3 px-3 py-3 text-left hover:bg-raised w-full ${active ? 'bg-tint' : ''}`}
                      >
                        <Avatar name={c.name} picture={c.picture} size="md" />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`truncate text-ink ${c.read ? 'font-medium' : 'font-semibold'}`}>{c.name}</span>
                            {c.kind === 'group' && <span className="label shrink-0">Groupe</span>}
                          </span>
                          {c.last && <span className="block text-sm text-muted line-clamp-1">{c.last}</span>}
                        </span>
                        <span className="shrink-0 flex flex-col items-end gap-1.5 self-start pt-0.5">
                          {c.date && <span className="text-sm text-muted whitespace-nowrap">{listDate(c.date)}</span>}
                          {!c.read && <span className="alpha w-3 h-2.5 bg-brand" aria-label="non lu" role="img" />}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Fil de la conversation */}
          <section aria-label="Conversation" className={`flex-1 min-w-0 md:pl-6 ${open ? '' : 'hidden md:block'}`}>
            {!open ? (
              <p className="text-sm text-muted py-2">Choisissez une conversation.</p>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 pb-3 border-b border-line">
                  <button type="button" onClick={closeConversation} className="icon-btn md:hidden -ml-2" aria-label="Retour aux conversations">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <Avatar name={thread?.name || open.name} picture={thread ? thread.picture : open.picture} size="sm" />
                  <h2 className="font-semibold text-ink truncate min-w-0 flex-1">{thread?.name || open.name}</h2>
                  {open.kind === 'group' && <span className="label shrink-0">Groupe</span>}
                </div>

                {threadError && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-danger flex-1 min-w-0">{threadError}</p>
                    <button type="button" onClick={() => void loadThread(open)} className="btn btn-quiet">
                      Réessayer
                    </button>
                  </div>
                )}

                <div className="py-4 space-y-4">
                  {!thread ? (
                    threadLoading && <p className="text-sm text-muted">Chargement de la conversation…</p>
                  ) : thread.messages.length === 0 && pending.length === 0 ? (
                    <p className="text-sm text-muted">Aucun message pour l’instant.</p>
                  ) : (
                    byDay(thread.messages).map((g, gi) => (
                      <div key={`${g.day}-${gi}`} className="space-y-3">
                        {g.day && (
                          <p className="label text-center">{dayLabel(g.day)}</p>
                        )}
                        {g.messages.map((m, i) => {
                          const prev = g.messages[i - 1];
                          const showAuthor = open.kind === 'group' && !m.mine && !!m.author && (!prev || prev.mine || prev.author !== m.author);
                          return <Bubble key={m.token || `${gi}-${i}`} message={m} author={showAuthor ? m.author : ''} />;
                        })}
                      </div>
                    ))
                  )}
                  {thread &&
                    pending.map((p) => (
                      <Bubble
                        key={`pending-${p.id}`}
                        pending
                        message={{ ...pending_(p.id, p.text), time: p.time }}
                        author=""
                      />
                    ))}
                  <div ref={endRef} className="scroll-mb-40 sm:scroll-mb-24" />
                </div>

                {thread &&
                  (thread.canRespond ? (
                    <form onSubmit={(e) => void send(e)} className="sticky bottom-20 sm:bottom-0 z-10 bg-surface border-t border-line -mx-4 px-4 sm:mx-0 sm:px-0 py-3">
                      {sendError && <p className="text-sm text-danger mb-2">{sendError}</p>}
                      <div className="flex items-end gap-2">
                        <label htmlFor="message-draft" className="sr-only">
                          Votre message
                        </label>
                        <textarea
                          id="message-draft"
                          ref={textareaRef}
                          rows={1}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={onComposerKey}
                          readOnly={sending}
                          aria-busy={sending}
                          placeholder="Votre message"
                          enterKeyHint="enter"
                          className="field w-full h-auto min-h-11 max-h-32 py-2.5 resize-none"
                        />
                        <button type="submit" disabled={sending || !draft.trim()} className="btn btn-primary h-11 px-3 sm:px-4" aria-label="Envoyer">
                          <SendHorizontal className="w-5 h-5" />
                          <span className="hidden sm:inline">Envoyer</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-sm text-muted border-t border-line pt-3">Cette conversation n’accepte plus de réponse.</p>
                  ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Bubble({ message: m, author, pending = false }: { message: ChatMessage; author: string; pending?: boolean }) {
  const time = messageTime(m);
  return (
    <div className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
      {author && <span className="text-sm text-muted mb-1 px-1">{author}</span>}
      <div
        className={`max-w-[80%] px-3 py-2 text-base whitespace-pre-wrap break-words ${
          m.mine ? 'bg-fill text-white rounded-xl rounded-br-md' : 'bg-raised text-ink rounded-xl rounded-bl-md'
        } ${pending ? 'opacity-60' : ''}`}
      >
        {m.text && <p>{m.text}</p>}
        {m.files.length > 0 && (
          <div className={`flex flex-col gap-2 ${m.text ? 'mt-2' : ''}`}>
            {m.files.map((f, i) =>
              f.image ? (
                <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noreferrer" className="block">
                  <img src={f.url} alt="Image jointe" loading="lazy" className="max-h-48 rounded-lg" />
                </a>
              ) : (
                <a
                  key={`${f.url}-${i}`}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 underline underline-offset-2 ${m.mine ? 'text-white' : 'text-brand'}`}
                >
                  <Paperclip className="w-4 h-4 shrink-0" />
                  Pièce jointe
                </a>
              ),
            )}
          </div>
        )}
      </div>
      {(time || pending) && <span className="text-sm text-muted mt-1 px-1">{pending ? 'Envoi…' : time}</span>}
    </div>
  );
}
