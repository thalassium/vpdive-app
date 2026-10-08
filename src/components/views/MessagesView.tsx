import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, Plus, SendHorizontal, Users, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Cromagnon } from '../Cromagnon';
import { messaging, type ChatMember, type ChatMessage, type ChatSummary, type ChatThread } from '../../services/messaging';
import { vpdive, type MemberMatch } from '../../services/vpdiveApi';
import { normalizeName, rankByName } from '../../lib/fuzzy';

const THREAD_POLL_MS = 15_000;
const LIST_POLL_MS = 30_000;

type Me = { uct: string; name: string; picture: string };

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// ── Dates ───────────────────────────────────────────────────────

function parseDate(s: string): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date courte de la liste : « 14:05 » aujourd'hui, « hier », sinon « 3 oct. ». */
function listDate(s: string): string {
  const d = parseDate(s);
  if (!d) return '';
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
function dayLabel(d: Date): string {
  const now = new Date();
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}

/** Un message du fil, envoyé ou encore dans la boîte d'envoi. */
type Shown = ChatMessage & { status?: 'sending' | 'failed'; error?: string };

/** Messages groupés par jour (heure locale), dans l'ordre du fil. */
function byDay(messages: Shown[]): { key: string; date: Date | null; messages: Shown[] }[] {
  const out: { key: string; date: Date | null; messages: Shown[] }[] = [];
  for (const m of messages) {
    const d = parseDate(m.at);
    const key = d ? dayKey(d) : '';
    const last = out[out.length - 1];
    if (last && last.key === key) last.messages.push(m);
    else out.push({ key, date: d, messages: [m] });
  }
  return out;
}

/** Clavier physique : Entrée envoie. Sur téléphone, Entrée va à la ligne. */
const hasFinePointer = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** L'autre personne d'une conversation à deux. */
const otherMember = (c: Pick<ChatSummary, 'members'>, me: Me): ChatMember | undefined => c.members.find((m) => m.uct !== me.uct) ?? c.members[0];

function ChatAvatar({ chat, me, size }: { chat: ChatSummary; me: Me; size: 'sm' | 'lg' }) {
  if (chat.kind === 'group') {
    return (
      <span aria-hidden className={`${size === 'lg' ? 'w-10 h-10' : 'w-7 h-7'} rounded-full shrink-0 bg-tint text-brand inline-flex items-center justify-center`}>
        <Users className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
      </span>
    );
  }
  const other = otherMember(chat, me);
  return <Avatar name={other?.name || chat.title} picture={other?.picture} size={size === 'lg' ? 'md' : 'sm'} />;
}

// ── Vue ─────────────────────────────────────────────────────────

export function MessagesView({ me, onSessionLost, onRead }: { me: Me; onSessionLost: (e: unknown) => boolean; onRead: () => void }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const [open, setOpen] = useState<ChatSummary | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadError, setThreadError] = useState('');
  const [threadLoading, setThreadLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [outbox, setOutbox] = useState<{ id: string; text: string; at: string; status: 'sending' | 'failed'; error?: string }[]>([]);

  // Les props et la conversation ouverte, lues depuis les minuteries sans les relancer.
  const lostRef = useRef(false);
  const onSessionLostRef = useRef(onSessionLost);
  const onReadRef = useRef(onRead);
  const meRef = useRef(me);
  const openIdRef = useRef<string | null>(null);
  const tempIdRef = useRef(0);
  useEffect(() => {
    onSessionLostRef.current = onSessionLost;
    onReadRef.current = onRead;
    meRef.current = me;
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
        const list = await messaging.chats(meRef.current);
        // La conversation ouverte reste lue.
        setChats(list.map((c) => (c.id === openIdRef.current ? { ...c, unread: false } : c)));
        setListError('');
      } catch (e) {
        if (lost(e)) return;
        if (!quiet) setListError(errorText(e, 'Les conversations n’ont pas pu être chargées.'));
      } finally {
        if (!quiet) setListLoading(false);
      }
    },
    [lost],
  );

  const loadThread = useCallback(
    async (id: string, quiet = false): Promise<boolean> => {
      if (lostRef.current) return false;
      if (!quiet) {
        setThreadLoading(true);
        setThreadError('');
      }
      try {
        const t = await messaging.chat(id, meRef.current);
        if (openIdRef.current !== id) return false;
        setThread(t);
        setThreadError('');
        return true;
      } catch (e) {
        if (lost(e) || openIdRef.current !== id) return false;
        if (!quiet) setThreadError(errorText(e, 'La conversation n’a pas pu être chargée.'));
        return false;
      } finally {
        if (!quiet && openIdRef.current === id) setThreadLoading(false);
      }
    },
    [lost],
  );

  // Liste : au montage, puis toutes les 20 s.
  useEffect(() => {
    void loadList();
    const id = window.setInterval(() => void loadList(true), LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadList]);

  // Fil ouvert : toutes les 10 s.
  const openId = open?.id ?? null;
  useEffect(() => {
    if (!openId) return;
    const id = window.setInterval(() => void loadThread(openId, true), THREAD_POLL_MS);
    return () => window.clearInterval(id);
  }, [openId, loadThread]);

  const openChat = async (c: ChatSummary) => {
    openIdRef.current = c.id;
    scrollKeyRef.current = '';
    setOpen(c);
    setThread(null);
    setOutbox([]);
    setDraft('');
    setChats((list) => list && list.map((x) => (x.id === c.id ? { ...x, unread: false } : x)));
    const ok = await loadThread(c.id);
    if (ok && openIdRef.current === c.id && !lostRef.current) onReadRef.current();
  };

  const closeChat = () => {
    openIdRef.current = null;
    setOpen(null);
    setThread(null);
    setThreadError('');
    setOutbox([]);
  };

  const onCreated = (c: ChatSummary) => {
    setComposing(false);
    void openChat(c);
    void loadList(true);
  };

  // Défile jusqu'au dernier message à l'ouverture et à chaque nouveau message.
  const messageCount = (thread?.messages.length ?? 0) + outbox.length;
  useLayoutEffect(() => {
    if (!thread) return;
    const key = `${openId}:${messageCount}`;
    if (scrollKeyRef.current === key) return;
    const first = !scrollKeyRef.current;
    scrollKeyRef.current = key;
    endRef.current?.scrollIntoView({ block: 'end', behavior: first ? 'auto' : 'smooth' });
  }, [thread, openId, messageCount]);

  // Zone de saisie qui grandit avec le texte (plafonnée par max-h-32).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
  }, [draft, thread]);

  /** Envoie (ou renvoie) un message de la boîte d'envoi. */
  const deliver = async (chatId: string, tempId: string, text: string) => {
    try {
      const realId = await messaging.send(chatId, text, meRef.current);
      if (openIdRef.current !== chatId) return;
      // Premier message d'une nouvelle conversation : VPDive vient de la créer.
      if (realId !== chatId) {
        openIdRef.current = realId;
        setOpen((o) => (o ? { ...o, id: realId } : o));
      }
      await loadThread(realId, true);
      setOutbox((o) => o.filter((x) => x.id !== tempId));
      void loadList(true);
      if (!lostRef.current) onReadRef.current();
    } catch (err) {
      if (lost(err) || openIdRef.current !== chatId) return;
      setOutbox((o) => o.map((x) => (x.id === tempId ? { ...x, status: 'failed', error: errorText(err, '') } : x)));
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!open || !thread || !text) return;
    const tempId = `local-${++tempIdRef.current}`;
    setOutbox((o) => [...o, { id: tempId, text, at: new Date().toISOString(), status: 'sending' }]);
    setDraft('');
    textareaRef.current?.focus();
    void deliver(open.id, tempId, text);
  };

  const retry = (tempId: string) => {
    const item = outbox.find((x) => x.id === tempId);
    if (!open || !item) return;
    setOutbox((o) => o.map((x) => (x.id === tempId ? { ...x, status: 'sending' } : x)));
    void deliver(open.id, tempId, item.text);
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || !hasFinePointer()) return;
    e.preventDefault();
    send();
  };

  const current = thread ?? open;
  const members = current?.members ?? [];
  const authorName = (uct: string) => members.find((m) => m.uct === uct)?.name || 'Membre';
  const shown: Shown[] = thread ? [...thread.messages, ...outbox.map((o) => ({ id: o.id, from: me.uct, text: o.text, at: o.at, status: o.status, error: o.error }))] : [];

  const failedFirst = chats === null && !listLoading && !!listError;
  const empty = chats !== null && chats.length === 0 && !open && !composing;

  const newButton = (label: string, className: string) => (
    <button type="button" onClick={() => setComposing(true)} className={`btn btn-primary ${className}`} aria-label="Nouvelle conversation">
      <Plus className="w-5 h-5" />
      {label}
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className={open || composing ? 'hidden md:block' : ''}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-brand">Messagerie</h1>
          {!composing && !failedFirst && !empty && newButton('Nouvelle', 'h-10')}
        </div>
        <div aria-hidden className="isobath bg-line mt-2 mb-4" />
      </div>

      {failedFirst ? (
        <div className="card p-4 sm:p-6 space-y-4">
          <div>
            <p className="text-base text-ink">La messagerie n'a pas pu être chargée.</p>
            <p className="mt-1 text-sm text-muted break-words">{listError}</p>
          </div>
          <button type="button" onClick={() => void loadList()} className="btn btn-quiet">
            Réessayer
          </button>
        </div>
      ) : empty ? (
        <div className="card px-6 py-10 text-center max-w-lg mx-auto">
          <Cromagnon className="w-40 mx-auto mb-5 text-field-border" />
          <p className="text-base text-ink">Aucune conversation pour l'instant.</p>
          <p className="mt-1 text-sm text-muted">Écrivez à un membre du club ou créez un groupe pour une sortie.</p>
          <div className="mt-6 flex justify-center">{newButton('Nouvelle conversation', '')}</div>
        </div>
      ) : (
        <div className="md:flex md:items-start">
          {/* Liste des conversations, ou le choix des personnes d'une nouvelle conversation */}
          <section
            aria-label={composing ? 'Nouvelle conversation' : 'Conversations'}
            className={`md:w-80 md:shrink-0 md:border-r border-line md:pr-4 ${open && !composing ? 'hidden md:block' : ''}`}
          >
            {composing ? (
              <NewChat me={me} lost={lost} onCancel={() => setComposing(false)} onCreated={onCreated} />
            ) : (
              <>
                {listError && chats && (
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-danger flex-1 min-w-0">{listError}</p>
                    <button type="button" onClick={() => void loadList()} className="btn btn-quiet">
                      Réessayer
                    </button>
                  </div>
                )}

                {chats === null ? (
                  <p className="text-sm text-muted py-2">Chargement des conversations…</p>
                ) : chats.length === 0 ? (
                  <p className="text-sm text-muted py-2">Aucune conversation pour l'instant.</p>
                ) : (
                  <ul className="card divide-y divide-line overflow-hidden">
                    {chats.map((c) => {
                      const active = openId === c.id;
                      const mine = c.last?.from === me.uct;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => void openChat(c)}
                            aria-current={active ? 'true' : undefined}
                            className={`flex items-center gap-3 px-3 py-3 text-left hover:bg-raised w-full ${active ? 'bg-tint' : ''}`}
                          >
                            <span className="w-10 shrink-0 flex justify-center">
                              <ChatAvatar chat={c} me={me} size="lg" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={`block truncate text-ink ${c.unread ? 'font-semibold' : 'font-medium'}`}>{c.title}</span>
                              <span className="block text-sm text-muted line-clamp-1 break-all">
                                {c.last ? `${mine ? 'Vous : ' : ''}${c.last.text}` : 'Aucun message'}
                              </span>
                            </span>
                            <span className="shrink-0 flex flex-col items-end gap-1.5 self-start pt-0.5">
                              <span className="text-sm text-muted whitespace-nowrap">{listDate(c.last?.at ?? c.updatedAt)}</span>
                              {c.unread && <span className="alpha w-3 h-2.5 bg-brand" aria-label="non lu" role="img" />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* Fil de la conversation */}
          <section aria-label="Conversation" className={`flex-1 min-w-0 md:pl-6 ${open && !composing ? '' : 'hidden md:block'}`}>
            {!open || !current ? (
              <p className="text-sm text-muted py-2">Choisissez une conversation.</p>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 pb-3 border-b border-line">
                  <button type="button" onClick={closeChat} className="icon-btn md:hidden -ml-2" aria-label="Retour aux conversations">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <ChatAvatar chat={current} me={me} size="sm" />
                  <span className="min-w-0 flex-1">
                    <h2 className="font-semibold text-ink truncate">{current.title}</h2>
                    {current.kind === 'group' && (
                      <p className="text-sm text-muted truncate">{current.members.map((m) => (m.uct === me.uct ? 'vous' : firstName(m.name))).join(', ')}</p>
                    )}
                  </span>
                </div>

                {threadError && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-danger flex-1 min-w-0">{threadError}</p>
                    <button type="button" onClick={() => void loadThread(open.id)} className="btn btn-quiet">
                      Réessayer
                    </button>
                  </div>
                )}

                <div className="py-4 space-y-4">
                  {!thread ? (
                    threadLoading && <p className="text-sm text-muted">Chargement de la conversation…</p>
                  ) : shown.length === 0 ? (
                    <p className="text-sm text-muted">Aucun message pour l’instant.</p>
                  ) : (
                    byDay(shown).map((g, gi) => (
                      <div key={`${g.key}-${gi}`} className="space-y-3">
                        {g.date && <p className="label text-center">{dayLabel(g.date)}</p>}
                        {g.messages.map((m, i) => {
                          const mine = m.from === me.uct;
                          const prev = g.messages[i - 1];
                          const showAuthor = current.kind === 'group' && !mine && (!prev || prev.from !== m.from);
                          return (
                            <Bubble key={m.id} message={m} mine={mine} author={showAuthor ? authorName(m.from) : ''} onRetry={() => retry(m.id)} />
                          );
                        })}
                      </div>
                    ))
                  )}
                  <div ref={endRef} className="scroll-mb-40 sm:scroll-mb-24" />
                </div>

                {thread && (
                  <form onSubmit={send} className="sticky bottom-20 sm:bottom-0 z-10 bg-surface border-t border-line -mx-4 px-4 sm:mx-0 sm:px-0 py-3">
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
                        placeholder="Votre message"
                        enterKeyHint="enter"
                        className="field w-full h-auto min-h-11 max-h-32 py-2.5 resize-none"
                      />
                      <button type="submit" disabled={!draft.trim()} className="btn btn-primary h-11 px-3 sm:px-4" aria-label="Envoyer">
                        <SendHorizontal className="w-5 h-5" />
                        <span className="hidden sm:inline">Envoyer</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Bubble({ message: m, mine, author, onRetry }: { message: Shown; mine: boolean; author: string; onRetry: () => void }) {
  const d = parseDate(m.at);
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {author && <span className="text-sm text-muted mb-1 px-1">{author}</span>}
      <div
        className={`max-w-[80%] px-3 py-2 text-base whitespace-pre-wrap break-words ${
          mine ? 'bg-fill text-white rounded-xl rounded-br-md' : 'bg-raised text-ink rounded-xl rounded-bl-md'
        } ${m.status ? 'opacity-60' : ''}`}
      >
        {m.text}
      </div>
      {m.status === 'failed' ? (
        <span className="text-sm text-danger mt-1 px-1 max-w-[80%] text-right">
          Non envoyé{m.error ? ` : ${m.error}` : ''} —{' '}
          <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 py-1">
            Réessayer
          </button>
        </span>
      ) : (
        <span className="text-sm text-muted mt-1 px-1">{m.status === 'sending' ? 'Envoi…' : d ? hhmm(d) : ''}</span>
      )}
    </div>
  );
}

// ── Nouvelle conversation ───────────────────────────────────────

/** Choisir une ou plusieurs personnes dans l'annuaire du club (même filtre que « Voir en tant que »). */
function NewChat({
  me,
  lost,
  onCancel,
  onCreated,
}: {
  me: Me;
  lost: (e: unknown) => boolean;
  onCancel: () => void;
  onCreated: (c: ChatSummary) => void;
}) {
  const [directory, setDirectory] = useState<MemberMatch[] | null>(null);
  const [dirError, setDirError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MemberMatch[]>([]);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    let cancelled = false;
    vpdive.fetchMemberDirectory('messages').then(
      (list) => {
        if (cancelled) return;
        setDirectory(list.filter((m) => m.name !== me.name));
        setDirError('');
      },
      (e) => {
        if (cancelled || lost(e)) return;
        setDirError(errorText(e, 'L’annuaire du club n’a pas pu être chargé.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, me.uct, lost]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!directory || q.length < 2) return [];
    const exact = directory.filter((m) => normalizeName(m.name).includes(normalizeName(q)));
    const close = rankByName(q, directory, (m) => m.name, 0.6)
      .map((r) => r.item)
      .filter((m) => !exact.includes(m));
    return [...exact, ...close].slice(0, 10);
  }, [directory, query]);

  const isSelected = (m: MemberMatch) => selected.some((s) => s.id === m.id);
  // Une personne à la fois : les groupes se créent dans VPDive.
  const toggle = (m: MemberMatch) => setSelected((s) => (s.some((x) => x.id === m.id) ? [] : [m]));

  const create = async () => {
    if (selected.length === 0 || creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const person = selected[0]!;
      onCreated(messaging.draft({ uct: person.id, name: person.name, picture: person.picture }, me));
    } catch (e) {
      if (lost(e)) return;
      setCreateError(errorText(e, 'La conversation n’a pas pu être créée.'));
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 pb-3 border-b border-line mb-3">
        <button type="button" onClick={onCancel} className="icon-btn -ml-2" aria-label="Retour aux conversations">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="font-semibold text-ink">Nouvelle conversation</h2>
      </div>

      {selected.length > 0 && (
        <ul aria-label="Personnes choisies" className="flex flex-wrap gap-2 mb-3">
          {selected.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => toggle(m)}
                aria-label={`Retirer ${m.name}`}
                className="inline-flex items-center gap-1.5 h-9 pl-2 pr-1.5 rounded-lg border border-field-border bg-tint text-brand text-sm font-medium"
              >
                {m.name}
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nom d’un membre"
        aria-label="Rechercher un membre"
        className="field w-full"
      />

      <div className="mt-3">
        {dirError ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-danger flex-1 min-w-0">{dirError}</p>
            <button
              type="button"
              onClick={() => {
                setDirError('');
                setAttempt((n) => n + 1);
              }}
              className="btn btn-quiet"
            >
              Réessayer
            </button>
          </div>
        ) : !directory ? (
          <p className="text-sm text-muted">Chargement de l’annuaire…</p>
        ) : query.trim().length < 2 ? (
          <p className="text-sm text-muted">Tapez au moins deux lettres du nom.</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-muted">Aucun membre ne correspond.</p>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {results.map((m) => {
              const on = isSelected(m);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(m)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-raised ${on ? 'bg-tint' : ''}`}
                  >
                    <Avatar name={m.name} picture={m.picture} size="sm" />
                    <span className="flex-1 min-w-0 truncate text-ink">{m.name}</span>
                    <span
                      aria-hidden
                      className={`w-5 h-5 shrink-0 rounded-md border inline-flex items-center justify-center ${
                        on ? 'bg-fill border-transparent text-white' : 'border-field-border'
                      }`}
                    >
                      {on && <Check className="w-4 h-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <div className="sticky bottom-20 sm:bottom-0 z-10 bg-surface border-t border-line -mx-4 px-4 sm:mx-0 sm:px-0 py-3 mt-4 space-y-3">
          {selected.length > 1 && (
            <div>
              <label htmlFor="group-title" className="label block mb-1.5">
                Nom du groupe (facultatif)
              </label>
              <input id="group-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full" />
            </div>
          )}
          {createError && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-danger flex-1 min-w-0">{createError}</p>
              <button type="button" onClick={() => void create()} className="btn btn-quiet">
                Réessayer
              </button>
            </div>
          )}
          <button type="button" onClick={() => void create()} disabled={creating} aria-busy={creating} className="btn btn-primary w-full">
            {selected.length === 1 ? `Écrire à ${firstName(selected[0]?.name ?? '')}` : 'Créer le groupe'}
          </button>
        </div>
      )}
    </div>
  );
}
