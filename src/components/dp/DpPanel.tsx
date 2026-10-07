import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, ClipboardList, HandHelping, Lock, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { vpdive, ymd, DP_ROLE, type CalendarEvent, type RosterEntry, type Session } from '../../services/vpdiveApi';
import { appApi, AppApiError, type AppRole } from '../../services/appApi';
import { headerFromRoles, newOuting, nextDive, type Dive, type OutingDoc } from '../../lib/outing';
import { PalanqueesEditor } from './PalanqueesEditor';
import { SafetySheet } from './SafetySheet';
import { VolunteersPanel } from './VolunteersPanel';
import { ThemeToggle } from '../ThemeToggle';

interface Props {
  session: Session;
  role: AppRole;
  /**
   * « Voir en tant que » un membre : les sorties où lui est DP (jetons), à la
   * place de celles du compte connecté. Absent hors simulation.
   */
  dpEvents?: string[];
  /** Opened from an outing's sheet: go straight to it. */
  initialEvent?: CalendarEvent | null;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

/**
 * Menu DP : les sorties (celle du jour ou la prochaine en premier), puis pour
 * la sortie choisie ses plongées, leurs palanquées et la fiche de sécurité,
 * et les bénévoles de la journée.
 * Admins : toutes les sorties. DP : celles où VPDive l'inscrit « Directeur de plongée ».
 */
export function DpPanel({ session, role, dpEvents, initialEvent, onClose, onSessionLost }: Props) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(initialEvent ?? null);
  const closeRef = useRef<() => Promise<void>>(async () => {});

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 14);
      const to = new Date(today);
      to.setDate(to.getDate() + 60);
      let list = await vpdive.fetchEvents(ymd(from), ymd(to));
      if (role === 'member' && dpEvents) {
        list = list.filter((e) => dpEvents.includes(e.token));
      } else if (role === 'member') {
        // Pas admin : seulement les sorties où l'on est inscrit comme DP.
        const mine = list.filter((e) => e.registered);
        const rosters = await Promise.all(mine.map((e) => vpdive.fetchRoster(e.token).catch(() => [] as RosterEntry[])));
        list = mine.filter((_, i) => rosters[i]!.some((r) => r.id === String(session.userId) && r.roles.some((x) => DP_ROLE.test(x))));
      }
      setEvents(list);
    } catch (e) {
      if (onSessionLost(e)) return;
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, [role, dpEvents, session.userId, onSessionLost]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const close = useCallback(async () => {
    await closeRef.current();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  // Aujourd'hui et à venir d'abord (la plus proche en tête), puis les passées, la plus récente d'abord.
  const { upcoming, past } = useMemo(() => {
    const today = ymd(new Date());
    const all = events ?? [];
    return {
      upcoming: all.filter((e) => ymd(new Date(e.start)) >= today).sort((a, b) => a.start.localeCompare(b.start)),
      past: all.filter((e) => ymd(new Date(e.start)) < today).sort((a, b) => b.start.localeCompare(a.start)),
    };
  }, [events]);

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade print:static print:bg-white print:p-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dp-title"
        className="relative bg-surface w-full sm:max-w-6xl h-dvh sm:h-[94vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop print:h-auto print:shadow-none print:overflow-visible"
      >
        <div className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3 print:hidden">
          {selected && (
            <button onClick={() => closeRef.current().then(() => setSelected(null))} aria-label="Toutes les sorties" className="icon-btn lg:hidden -ml-2">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <ClipboardList className="w-6 h-6 text-brand shrink-0" />
          <h2 id="dp-title" className="text-xl font-semibold text-brand flex-1">
            Directeur de plongée
          </h2>
          <ThemeToggle />
          <button onClick={close} aria-label="Fermer" className="icon-btn -mr-2">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Sorties */}
          <aside className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 shrink-0 border-r border-line overflow-y-auto print:hidden`}>
            {!events && !listError && <p className="p-6 text-muted">Chargement des sorties…</p>}
            {listError && (
              <div role="alert" className="m-4 p-4 rounded-xl bg-danger-soft text-danger text-base">
                {listError}{' '}
                <button onClick={loadList} className="font-semibold underline">
                  Réessayer
                </button>
              </div>
            )}
            {events && events.length === 0 && (
              <p className="p-6 text-muted">
                {role === 'member' ? 'Vous n’êtes directeur de plongée d’aucune sortie dans les semaines qui viennent.' : 'Aucune sortie dans les semaines qui viennent.'}
              </p>
            )}
            {upcoming.length > 0 && <ListGroup label="Aujourd’hui et à venir" events={upcoming} selected={selected} onSelect={setSelected} />}
            {past.length > 0 && <ListGroup label="Passées" events={past} selected={selected} onSelect={setSelected} />}
          </aside>

          {/* Sortie choisie */}
          <main className={`${selected ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col overflow-y-auto overscroll-contain print:overflow-visible`}>
            {selected ? (
              <OutingWorkspace key={selected.token} event={selected} session={session} closeRef={closeRef} onSessionLost={onSessionLost} />
            ) : (
              <p className="m-auto p-8 text-muted">Choisissez une sortie.</p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

const JOURS = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
const MOIS_COURTS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
/** « Sam. 14 Oct » */
const shortDate = (d: Date) => `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`;

/** Sorties d'une section (à venir / passées), avec un séparateur par mois. */
function ListGroup({ label, events, selected, onSelect }: { label: string; events: CalendarEvent[]; selected: CalendarEvent | null; onSelect: (e: CalendarEvent) => void }) {
  const today = ymd(new Date());
  const months: { key: string; title: string; list: CalendarEvent[] }[] = [];
  for (const e of events) {
    const d = new Date(e.start);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (months.at(-1)?.key !== key) months.push({ key, title: `${MOIS[d.getMonth()]} ${d.getFullYear()}`, list: [] });
    months.at(-1)!.list.push(e);
  }
  return (
    <section className="py-2">
      <h3 className="px-4 pt-2 pb-1 label">{label}</h3>
      {months.map((m) => (
        <div key={m.key}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-1.5" role="separator">
            <span className="label">{m.title}</span>
            <span className="flex-1 h-px bg-line" />
          </div>
          <ul>
            {m.list.map((e) => {
              const d = new Date(e.start);
              const active = selected?.token === e.token;
              const isToday = ymd(d) === today;
              return (
                <li key={e.token}>
                  <button
                    onClick={() => onSelect(e)}
                    className={`w-full text-left pl-3 pr-4 py-2.5 flex items-center gap-3 border-l-4 transition-colors ${active ? 'bg-tint border-brand' : 'border-transparent hover:bg-raised'}`}
                  >
                    <span className="w-[5.75rem] shrink-0 whitespace-nowrap">
                      <span className="block text-sm font-bold tabular-nums text-brand">{shortDate(d)}</span>
                      <span className="block text-sm text-muted tabular-nums">
                        {isToday ? (
                          <span className="inline-block rounded-md bg-pink text-on-pink px-1.5 text-xs font-semibold">Aujourd’hui</span>
                        ) : e.allDay ? (
                          'Journée'
                        ) : (
                          d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                        )}
                      </span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-semibold text-ink truncate">{e.title}</span>
                      <span className="block text-sm text-muted">
                        {e.registeredCount} inscrit{e.registeredCount > 1 ? 's' : ''}
                        {isToday && !e.allDay && ` · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

function OutingWorkspace({
  event,
  session,
  closeRef,
  onSessionLost,
}: {
  event: CalendarEvent;
  session: Session;
  closeRef: React.RefObject<() => Promise<void>>;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [doc, setDoc] = useState<OutingDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diveId, setDiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<'palanquees' | 'fiche'>('palanquees');
  /** Une plongée de la sortie, ou l'écran des bénévoles (commun à toute la journée). */
  const [view, setView] = useState<'dive' | 'benevoles'>('dive');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<OutingDoc | null>(null);

  const docRef = useRef<OutingDoc | null>(null);
  const revRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const me = `${session.firstName} ${session.lastName}`.trim() || session.email;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [r, saved] = await Promise.all([vpdive.fetchRoster(event.token), appApi.getOuting(event.token)]);
      const d = saved ?? newOuting(event, r, session.clubName);
      revRef.current = saved?.rev ?? 0;
      docRef.current = d;
      setRoster(r);
      setDoc(d);
      setDiveId(d.dives[0]?.id ?? null);
      setView('dive');
      setTab(d.dives[0]?.validated ? 'fiche' : 'palanquees');
    } catch (e) {
      if (onSessionLost(e)) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [event, session.clubName, onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);

  /** Enregistre la dernière version, une sauvegarde à la fois. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    while (inFlight.current) await inFlight.current;
    const d = docRef.current;
    if (!d || saveStateRef.current === 'saved' || saveStateRef.current === 'conflict') return;
    setSave('saving');
    inFlight.current = (async () => {
      try {
        const saved = await appApi.saveOuting(event.token, d, revRef.current);
        revRef.current = saved.rev ?? revRef.current + 1;
        const meta = { rev: saved.rev, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy };
        const unchanged = docRef.current === d;
        docRef.current = { ...docRef.current!, ...meta };
        setDoc(docRef.current);
        setSave(unchanged ? 'saved' : 'pending');
      } catch (e) {
        if (onSessionLost(e)) return;
        if (e instanceof AppApiError && e.status === 409) {
          setConflict(((e.body as { doc?: OutingDoc } | null)?.doc ?? null) as OutingDoc | null);
          setSave('conflict');
        } else setSave('error');
      }
    })();
    await inFlight.current;
    inFlight.current = null;
    if (saveStateRef.current === 'pending') timer.current = setTimeout(() => void flush(), 800);
  }, [event.token, onSessionLost]);

  const saveStateRef = useRef<SaveState>('saved');
  const setSave = (s: SaveState) => {
    saveStateRef.current = s;
    setSaveState(s);
  };

  // En fermant ou en changeant de sortie, ce qui n'est pas encore parti est enregistré.
  useEffect(() => {
    closeRef.current = flush;
    return () => {
      void flush();
    };
  }, [flush, closeRef]);

  const update = (fn: (d: OutingDoc) => OutingDoc) => {
    const current = docRef.current;
    if (!current || saveStateRef.current === 'conflict') return;
    const next = fn(current);
    docRef.current = next;
    setDoc(next);
    setSave('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1000);
  };

  const updateDive = (fn: (d: Dive) => Dive) => update((d) => ({ ...d, dives: d.dives.map((x) => (x.id === diveId ? fn(x) : x)) }));

  if (loadError) {
    return (
      <div role="alert" className="m-5 p-4 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2.5">
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <div className="flex-1">
          <span className="font-semibold block">Sortie indisponible</span>
          {loadError}
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 font-semibold underline">
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      </div>
    );
  }
  if (!doc || !roster) return <p className="m-auto p-8 text-muted">Chargement de la sortie…</p>;

  const dive = doc.dives.find((d) => d.id === diveId) ?? doc.dives[0]!;

  return (
    <div className="px-5 sm:px-6 py-5 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-brand leading-snug">{event.title}</h3>
          <p className="text-sm text-muted first-letter:uppercase">
            {new Date(event.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            {event.location && ` · ${event.location}`} · {roster.length} inscrit{roster.length > 1 ? 's' : ''}
          </p>
        </div>
        <SaveBadge state={saveState} doc={doc} onRetry={() => void flush()} />
      </header>

      {saveState === 'conflict' && (
        <div role="alert" className="p-4 rounded-xl bg-warn-soft text-warn text-base flex flex-wrap items-center gap-3 print:hidden">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">
            {conflict?.updatedBy ?? 'Quelqu’un'} a enregistré cette sortie pendant que vous la modifiiez. Vos derniers changements ne sont pas enregistrés.
          </span>
          <button
            type="button"
            onClick={() => {
              if (!conflict) return void load();
              docRef.current = conflict;
              revRef.current = conflict.rev ?? 0;
              setDoc(conflict);
              setConflict(null);
              setSave('saved');
            }}
            className="btn btn-quiet h-9 text-sm border-warn/40 text-warn"
          >
            Charger sa version
          </button>
        </div>
      )}

      {/* Plongées */}
      <nav className="flex flex-wrap items-center gap-2 print:hidden" aria-label="Plongées">
        {doc.dives.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setDiveId(d.id);
              setView('dive');
              setTab(d.validated ? 'fiche' : 'palanquees');
            }}
            aria-pressed={view === 'dive' && d.id === dive.id}
            className={`btn btn-quiet h-9 text-sm ${view === 'dive' && d.id === dive.id ? 'bg-tint border-brand' : ''}`}
          >
            {d.validated && <Lock className="w-3.5 h-3.5" />}
            {d.label}
          </button>
        ))}
        <button
          onClick={() => {
            const added = nextDive(doc);
            update((d) => ({ ...d, dives: [...d.dives, added] }));
            setDiveId(added.id);
            setView('dive');
            setTab('palanquees');
          }}
          className="btn btn-quiet h-9 text-sm border-dashed"
        >
          <Plus className="w-4 h-4" /> Plongée
        </button>
        <span className="w-px h-6 bg-line mx-1" aria-hidden />
        <button
          onClick={() => setView('benevoles')}
          aria-pressed={view === 'benevoles'}
          className={`btn btn-quiet h-9 text-sm ${view === 'benevoles' ? 'bg-tint border-brand' : ''}`}
        >
          <HandHelping className="w-4 h-4" /> Bénévoles
        </button>
        {view === 'dive' && doc.dives.length > 1 && (
          <button
            onClick={() => {
              if (!window.confirm(`Supprimer « ${dive.label} » et sa fiche de sécurité ?`)) return;
              const rest = doc.dives.filter((d) => d.id !== dive.id);
              update((d) => ({ ...d, dives: rest }));
              setDiveId(rest[0]!.id);
            }}
            aria-label={`Supprimer ${dive.label}`}
            title={`Supprimer ${dive.label}`}
            className="icon-btn ml-auto w-9 h-9 hover:text-danger hover:bg-danger-soft"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </nav>

      {view === 'benevoles' ? (
        <VolunteersPanel
          roster={roster}
          volunteers={doc.volunteers ?? {}}
          onChange={(volunteers) => update((d) => ({ ...d, volunteers }))}
        />
      ) : (
        <>
        {/* Palanquées / Fiche */}
        <div className="flex border-b border-line print:hidden" role="tablist">
          <TabButton active={tab === 'palanquees'} onClick={() => setTab('palanquees')} icon={<Users className="w-4 h-4" />}>
            Palanquées
          </TabButton>
          <TabButton active={tab === 'fiche'} disabled={!dive.validated} onClick={() => setTab('fiche')} icon={dive.validated ? <ClipboardList className="w-4 h-4" /> : <Lock className="w-4 h-4" />}>
            Fiche de sécurité
          </TabButton>
        </div>

        {tab === 'palanquees' || !dive.validated || !dive.plan ? (
          <PalanqueesEditor
            title={event.title}
            roster={roster}
            doc={doc}
            dive={dive}
            onSettings={(settings) => update((d) => ({ ...d, settings }))}
            // Le rôle changé remplit son champ de l'en-tête de la fiche ; les deux autres gardent ce qui y est écrit (pilote extérieur…).
            onRoles={(roles, role) => update((d) => ({ ...d, roles, header: { ...d.header, ...headerFromRoles(roster, roles, role) } }))}
            onPlan={(plan) => updateDive((d) => ({ ...d, plan }))}
            onValidate={() => {
              updateDive((d) => ({ ...d, validated: { by: me, at: new Date().toISOString() } }));
              setTab('fiche');
            }}
            onReopen={() => updateDive((d) => ({ ...d, validated: null }))}
          />
        ) : (
          <SafetySheet
            title={event.title}
            doc={doc}
            dive={dive}
            onHeader={(header) => update((d) => ({ ...d, header }))}
            onSheet={(id, sheet) => updateDive((d) => ({ ...d, sheets: { ...d.sheets, [id]: sheet } }))}
            onGas={(id, gas) => updateDive((d) => ({ ...d, gas: { ...d.gas, [id]: gas } }))}
          />
        )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, disabled, onClick, icon, children }: { active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      title={disabled ? 'Validez d’abord les palanquées' : undefined}
      className={`inline-flex items-center gap-2 px-4 h-11 -mb-px border-b-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
        active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function SaveBadge({ state, doc, onRetry }: { state: SaveState; doc: OutingDoc; onRetry: () => void }) {
  if (state === 'error') {
    return (
      <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-sm font-semibold text-danger">
        <AlertTriangle className="w-4 h-4" /> Non enregistré · réessayer
      </button>
    );
  }
  if (state === 'pending' || state === 'saving') return <span className="text-sm text-muted">Enregistrement…</span>;
  if (state === 'conflict') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted" title={doc.updatedAt ? `Par ${doc.updatedBy}` : undefined}>
      <Check className="w-4 h-4 text-ok" />
      {doc.updatedAt
        ? `Enregistré · ${new Date(doc.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${doc.updatedBy ? ` par ${doc.updatedBy}` : ''}`
        : 'Rien d’enregistré pour l’instant'}
    </span>
  );
}
