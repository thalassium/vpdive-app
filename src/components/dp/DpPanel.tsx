import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronRight, ClipboardList, HandHelping, Lock, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { vpdive, ymd, DP_ROLE, SessionExpiredError, type CalendarEvent, type MemberMatch, type RosterEntry, type Session } from '../../services/vpdiveApi';
import { appApi, AppApiError, type AppRole, type OutingLock } from '../../services/appApi';
import {
  addedMemberId,
  adoptRegistrations,
  defaultRoles,
  headerFromRoles,
  newOuting,
  nextDive,
  normalizeOuting,
  parseDepth,
  pruneOrphans,
  sameContent,
  setGuideNote,
  syncWithRoster,
  toggleDiving,
  withGuests,
  type AddedMember,
  type Dive,
  type DiveRole,
  type OutingDoc,
} from '../../lib/outing';
import { setDepth } from '../../lib/palanqueeEdit';
import { PalanqueesEditor } from './PalanqueesEditor';
import { SafetySheet } from './SafetySheet';
import { VolunteersPanel } from './VolunteersPanel';
import { useConfirm } from '../../hooks/useConfirm';
import { Tab, TabList, TabPanel } from '../Tabs';
import { useDialog } from '../../hooks/useDialog';
import { GabianLoader } from '../Gabian';

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
  /** Enregistre ce qui reste et dit si tout est bien enregistré. */
  const closeRef = useRef<() => Promise<boolean>>(async () => true);

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
        // Pas admin : seulement les sorties où l'on est inscrit comme DP, listes lues une à une avec une pause (le pare-feu VPDive bloque les rafales).
        const mine = list.filter((e) => e.registered);
        const dp: CalendarEvent[] = [];
        for (const e of mine) {
          const roster = await vpdive.fetchRoster(e.token).catch(() => [] as RosterEntry[]);
          if (roster.some((r) => r.id === String(session.userId) && r.roles.some((x) => DP_ROLE.test(x)))) dp.push(e);
          await new Promise((r) => setTimeout(r, 400));
        }
        list = dp;
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

  /**
   * Quitter la sortie ouverte (fermer, revenir à la liste, en choisir une autre) :
   * ce qui reste part d'abord ; si l'enregistrement échoue, on demande. La
   * saisie non enregistrée reste en brouillon sur l'appareil.
   */
  const { confirm, confirmDialog } = useConfirm();
  const leave = useCallback(
    async (then: () => void) => {
      const saved = await closeRef.current();
      if (
        !saved &&
        !(await confirm({
          title: 'Quitter quand même ?',
          message: 'Des modifications ne sont pas enregistrées. Elles restent en brouillon sur cet appareil.',
          confirmLabel: 'Quitter',
          cancelLabel: 'Rester',
        }))
      )
        return;
      then();
    },
    [confirm],
  );
  const close = useCallback(() => leave(onClose), [leave, onClose]);
  const select = useCallback(
    (e: CalendarEvent) => {
      if (e.token === selected?.token) return;
      void leave(() => setSelected(e));
    },
    [leave, selected],
  );

  // Échap, bouton Retour, focus et verrou de défilement : hooks/useDialog.
  const { ref: dialogRef } = useDialog({ onClose: () => void close(), label: 'dp' });

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dp-title"
        className="relative bg-surface w-full sm:max-w-6xl h-dvh sm:h-[94vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop print:h-auto print:shadow-none print:overflow-visible"
      >
        <div className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3 print:hidden">
          {selected && (
            <button onClick={() => void leave(() => setSelected(null))} aria-label="Toutes les sorties" className="icon-btn lg:hidden -ml-2">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <ClipboardList className="w-6 h-6 text-brand shrink-0" />
          <h2 id="dp-title" className="text-xl font-semibold text-brand flex-1 min-w-0">
            {/* Sur téléphone, le libellé du menu : le titre complet passerait sur deux lignes. */}
            <span className="sm:hidden">DP</span>
            <span className="hidden sm:inline">Directeur de plongée</span>
          </h2>
          <button onClick={() => void close()} aria-label="Fermer" className="icon-btn -mr-2">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Sorties */}
          <aside className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-80 shrink-0 border-r border-line overflow-y-auto print:hidden`}>
            {!events && !listError && <GabianLoader label="Chargement des sorties…" />}
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
            {upcoming.length > 0 && <ListGroup label="Aujourd’hui et à venir" events={upcoming} selected={selected} onSelect={select} />}
            {past.length > 0 && <ListGroup label="Passées" events={past} selected={selected} onSelect={select} />}
          </aside>

          {/* Sortie choisie */}
          <main className={`${selected ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col overflow-y-auto overscroll-contain bg-canvas print:bg-white print:overflow-visible`}>
            {selected ? (
              <OutingWorkspace key={selected.token} event={selected} session={session} isAdmin={role !== 'member'} closeRef={closeRef} onSessionLost={onSessionLost} />

            ) : (
              <p className="m-auto p-8 text-muted">Choisissez une sortie.</p>
            )}
          </main>
        </div>
      </div>
      {confirmDialog}
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
      <h3 className="sticky top-0 z-10 bg-surface px-4 pt-2 pb-1 label">{label}</h3>
      {months.map((m) => (
        <div key={m.key}>
          <div className="flex items-center gap-2 px-4 pt-3 pb-1.5">
            <h4 className="label">{m.title}</h4>
            <span aria-hidden className="flex-1 h-px bg-line" />
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
                          <span className="alpha inline-block bg-pink text-on-pink pl-1.5 text-xs font-semibold">Aujourd’hui</span>
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

/**
 * Brouillon d'une fiche, gardé sur l'appareil tant qu'il n'est pas enregistré :
 * une session expirée ou un serveur injoignable ne fait plus perdre la saisie.
 */
interface Draft {
  doc: OutingDoc;
  /** Révision sur laquelle la saisie s'appuie : si la fiche a changé depuis, l'enregistrer fait un conflit. */
  baseRev: number;
  at: string;
  by: string;
}
const DRAFT_PREFIX = 'outing-draft:v1:';
function readDraft(token: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + token);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(token: string, draft: Draft) {
  try {
    localStorage.setItem(DRAFT_PREFIX + token, JSON.stringify(draft));
  } catch {
    // Stockage plein ou interdit : rien de plus à faire, l'enregistrement reste la vraie sauvegarde.
  }
}
function clearDraft(token: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + token);
  } catch {
    // Rien à faire.
  }
}

/** Cet onglet, pour le bail d'édition : le même après un rechargement de la page (sessionStorage). */
function editorClient(): string {
  const fresh = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  try {
    const id = sessionStorage.getItem('outing-client') ?? fresh();
    sessionStorage.setItem('outing-client', id);
    return id;
  } catch {
    return fresh();
  }
}

/** Le bail est renouvelé toutes les 30 s (il dure 2 min) ; sans la main, la fiche est relue toutes les 20 s. */
const RENEW_MS = 30_000;
const POLL_MS = 20_000;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
type LeaseResult = 'ok' | 'taken' | 'failed';

function OutingWorkspace({
  event,
  session,
  isAdmin,
  closeRef,
  onSessionLost,
}: {
  event: CalendarEvent;
  session: Session;
  /** Admin : peut inscrire quelqu'un de la liste d'attente et désinscrire (routes d'admin de VPDive). */
  isAdmin: boolean;
  closeRef: React.RefObject<() => Promise<boolean>>;
  onSessionLost: (e: unknown) => boolean;
}) {
  const token = event.token;
  const [roster, setRosterState] = useState<RosterEntry[] | null>(null);
  const [doc, setDoc] = useState<OutingDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [diveId, setDiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<'palanquees' | 'fiche'>('palanquees');
  /** Une plongée de la sortie, ou l'écran des bénévoles (commun à toute la journée). */
  const [view, setView] = useState<'dive' | 'benevoles'>('dive');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<OutingDoc | null>(null);
  /** Retirés des palanquées au chargement : désinscrits, ou passés en liste d'attente ; à dire au DP. */
  const [departed, setDeparted] = useState<{ gone: string[]; waitlisted: string[] }>({ gone: [], waitlisted: [] });
  /** Qui modifie la fiche (bail d'édition) ; `mine` : cet onglet. */
  const [lock, setLockState] = useState<OutingLock | null>(null);
  /** Saisie non enregistrée trouvée sur l'appareil, proposée à la reprise. */
  const [draftOffer, setDraftOffer] = useState<Draft | null>(null);
  /** Message passager : action ignorée, main perdue… */
  const [notice, setNotice] = useState<string | null>(null);
  const [client] = useState(editorClient);
  const { confirm, confirmDialog } = useConfirm();
  const tabsId = useId();

  const docRef = useRef<OutingDoc | null>(null);
  /** La dernière version du serveur, rapprochée de la liste : ce qu'on retrouve si une saisie est refusée. */
  const baseDocRef = useRef<OutingDoc | null>(null);
  const rosterRef = useRef<RosterEntry[] | null>(null);
  const lockRef = useRef<OutingLock | null>(null);
  const revRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const acquiring = useRef<Promise<LeaseResult> | null>(null);
  const saveStateRef = useRef<SaveState>('saved');
  const me = `${session.firstName} ${session.lastName}`.trim() || session.email;

  const setSave = (s: SaveState) => {
    saveStateRef.current = s;
    setSaveState(s);
  };
  /** La liste tenue à jour aussitôt : une modification qui suit (désinscrire, inscrire) la lit déjà. */
  const setRoster = (r: RosterEntry[]) => {
    rosterRef.current = r;
    setRosterState(r);
  };
  const setLock = (l: OutingLock | null) => {
    lockRef.current = l;
    setLockState(l);
  };
  const showDoc = (d: OutingDoc) => {
    docRef.current = d;
    setDoc(d);
  };

  /** Version enregistrée (ou fiche neuve) rapprochée des inscrits du jour : les désinscrits en sortent, un membre ajouté qui s'est inscrit devient l'inscrit VPDive. */
  const derive = useCallback(
    (saved: OutingDoc | null, r: RosterEntry[]) => {
      const base = saved ? adoptRegistrations(normalizeOuting(saved, event), r) : null;
      const sync = base ? syncWithRoster(base, withGuests(r, base)) : null;
      return { doc: sync?.doc ?? newOuting(event, r, session.clubName), gone: sync?.departed ?? [], waitlisted: sync?.waitlisted ?? [] };
    },
    [event, session.clubName],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [r, res] = await Promise.all([vpdive.fetchRoster(token), appApi.getOuting(token, client)]);
      const v = derive(res.doc, r);
      // Ouvrir une fiche ne l'enregistre pas : la synchronisation ne part qu'avec le premier geste de celui qui tient la main.
      revRef.current = res.doc?.rev ?? 0;
      baseDocRef.current = v.doc;
      showDoc(v.doc);
      setRoster(r);
      setLock(res.lock);
      setSave('saved');
      setDeparted({ gone: v.gone, waitlisted: v.waitlisted });
      setDiveId(v.doc.dives[0]?.id ?? null);
      setView('dive');
      setTab(v.doc.dives[0]?.validated ? 'fiche' : 'palanquees');
      const draft = readDraft(token);
      if (draft && draft.by === me) {
        // Déjà enregistrée telle quelle (la page s'est fermée juste après) : rien à proposer.
        if (res.doc && sameContent(draft.doc, res.doc)) clearDraft(token);
        else setDraftOffer(draft);
      }
    } catch (e) {
      if (onSessionLost(e)) return;
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [token, client, derive, me, onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);

  /** Relit la fiche enregistrée et qui la tient ; la remplace à l'écran si rien n'est en attente ici. */
  const refresh = useCallback(async () => {
    try {
      const res = await appApi.getOuting(token, client);
      setLock(res.lock);
      const r = rosterRef.current;
      if (!r || saveStateRef.current !== 'saved' || inFlight.current || (res.doc?.rev ?? 0) === revRef.current) return;
      const v = derive(res.doc, r);
      revRef.current = res.doc?.rev ?? 0;
      baseDocRef.current = v.doc;
      showDoc(v.doc);
    } catch (e) {
      // Réseau : on relira au prochain tour.
      onSessionLost(e);
    }
  }, [token, client, derive, onSessionLost]);

  /** Revient à la version du serveur (saisie refusée) ; ce qui n'était pas enregistré reste en brouillon si `keepDraft`. */
  const backToServer = (message: string, keepDraft: boolean) => {
    clearTimeout(timer.current);
    if (!keepDraft) clearDraft(token);
    else setDraftOffer(readDraft(token));
    if (baseDocRef.current) showDoc(baseDocRef.current);
    setSave('saved');
    setNotice(message);
    void refresh();
  };

  /** Prend la main si on ne l'a pas : 'taken' si un autre la tient, 'failed' si le serveur n'a pas répondu. */
  const ensureLease = useCallback(
    (force = false): Promise<LeaseResult> => {
      if (lockRef.current?.mine && !force) return Promise.resolve('ok');
      if (acquiring.current) return acquiring.current;
      acquiring.current = (async (): Promise<LeaseResult> => {
        try {
          const res = await appApi.outingLock(token, 'acquire', client, { force });
          setLock(res.lock);
          return 'ok';
        } catch (e) {
          if (onSessionLost(e)) return 'failed';
          if (e instanceof AppApiError && e.status === 423) {
            setLock(((e.body as { lock?: OutingLock } | null)?.lock ?? null) as OutingLock | null);
            return 'taken';
          }
          return 'failed';
        } finally {
          acquiring.current = null;
        }
      })();
      return acquiring.current;
    },
    [token, client, onSessionLost],
  );

  const takenBy = () => lockRef.current?.name ?? 'Quelqu’un';

  /** Enregistre la dernière version, une sauvegarde à la fois, après avoir pris la main. */
  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    while (inFlight.current) await inFlight.current;
    if (!docRef.current || saveStateRef.current === 'saved' || saveStateRef.current === 'conflict') return;
    // Tout se passe dans inFlight (posé sans attendre) : deux appels ne peuvent pas enregistrer en même temps.
    inFlight.current = (async () => {
      const lease = await ensureLease();
      if (lease === 'taken') {
        return backToServer(`Modification non enregistrée : ${takenBy()} a commencé à modifier cette fiche juste avant vous.`, false);
      }
      if (lease === 'failed') return setSave('error');
      const d = docRef.current!;
      setSave('saving');
      try {
        const saved = await appApi.saveOuting(token, d, revRef.current, client);
        revRef.current = saved.rev ?? revRef.current + 1;
        const unchanged = docRef.current === d;
        // La version du serveur fait foi : c'est lui qui pose qui a validé, désinscrit, commenté, et quand.
        baseDocRef.current = saved;
        if (unchanged) {
          showDoc(saved);
          clearDraft(token);
        } else showDoc({ ...docRef.current!, rev: saved.rev, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy });
        setSave(unchanged ? 'saved' : 'pending');
      } catch (e) {
        if (onSessionLost(e)) return setSave('error');
        const body = e instanceof AppApiError ? (e.body as { doc?: OutingDoc; lock?: OutingLock; retry?: boolean } | null) : null;
        if (e instanceof AppApiError && e.status === 409) {
          setConflict(body?.doc ?? null);
          setSave('conflict');
        } else if (e instanceof AppApiError && e.status === 423) {
          setLock(body?.lock ?? null);
          backToServer(`${takenBy()} a pris la main : vos dernières modifications ne sont pas enregistrées. Elles restent en brouillon sur cet appareil.`, true);
        } else {
          setSave('error');
          // Un autre enregistrement de la sortie était en cours : on réessaie de soi-même.
          if (body?.retry) timer.current = setTimeout(() => void flushRef.current(), 1500);
        }
      }
    })();
    await inFlight.current;
    inFlight.current = null;
    if (saveStateRef.current === 'pending') timer.current = setTimeout(() => void flushRef.current(), 800);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // En fermant ou en changeant de sortie : ce qui n'est pas encore parti est enregistré, puis la main est rendue.
  useEffect(() => {
    closeRef.current = async () => {
      await flushRef.current();
      return saveStateRef.current === 'saved';
    };
  }, [closeRef]);
  useEffect(() => {
    const release = (keepalive: boolean) => {
      if (!lockRef.current?.mine) return;
      lockRef.current = null;
      void appApi.outingLock(token, 'release', client, { keepalive }).catch(() => undefined);
    };
    const onHide = () => release(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      void flushRef.current().finally(() => release(false));
    };
  }, [token, client]);

  // Tenir la main : renouvelée toutes les 30 s tant que l'onglet est visible ; en le quittant, ce qui reste part.
  const mine = !!lock?.mine;
  useEffect(() => {
    if (!mine) return;
    const renew = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await appApi.outingLock(token, 'renew', client);
        setLock(res.lock);
        // Quelqu'un a enregistré pendant que l'onglet était caché : on recharge sa version.
        if ((res.rev ?? 0) !== revRef.current && saveStateRef.current === 'saved') void refresh();
      } catch (e) {
        if (onSessionLost(e)) return;
        if (e instanceof AppApiError && e.status === 423) {
          setLock(((e.body as { lock?: OutingLock } | null)?.lock ?? null) as OutingLock | null);
          if (saveStateRef.current === 'saved') {
            setNotice(`${takenBy()} a pris la main pendant votre absence.`);
            void refresh();
          } else backToServer(`${takenBy()} a pris la main : vos dernières modifications ne sont pas enregistrées. Elles restent en brouillon sur cet appareil.`, true);
        }
      }
    };
    const id = setInterval(() => void renew(), RENEW_MS);
    const onVisibility = () => (document.visibilityState === 'visible' ? void renew() : void flushRef.current());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mine, token, client, refresh, onSessionLost]);

  // Sans la main : la fiche est relue régulièrement (et au retour sur l'onglet), pour voir les changements de celui qui la tient.
  const loaded = !!doc;
  useEffect(() => {
    if (mine || !loaded) return;
    const tick = () => document.visibilityState === 'visible' && void refresh();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [mine, loaded, refresh]);

  // Fermer l'onglet avec des modifications en attente : le navigateur demande confirmation.
  useEffect(() => {
    if (saveState === 'saved') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  /** Un autre tient la main : la fiche est en lecture seule. */
  const other = lock && !lock.mine ? lock : null;

  const update = (fn: (d: OutingDoc) => OutingDoc) => {
    const current = docRef.current;
    if (!current) return;
    if (lockRef.current && !lockRef.current.mine) return setNotice(`Modification ignorée : ${lockRef.current.name} modifie cette fiche.`);
    if (saveStateRef.current === 'conflict') return setNotice('Modification ignorée : choisissez d’abord quelle version garder (bandeau en haut).');
    // Contrôle continu : un plongeur décoché de « Qui plonge ? » quitte aussitôt les palanquées.
    const changed = fn(current);
    const r = rosterRef.current;
    const next = r ? syncWithRoster(changed, withGuests(r, changed)).doc : changed;
    showDoc(next);
    // Écrit à chaque geste : une saisie proposée en reprise et pas reprise est alors remplacée.
    writeDraft(token, { doc: next, baseRev: revRef.current, at: new Date().toISOString(), by: me });
    if (draftOffer) setDraftOffer(null);
    setSave('pending');
    clearTimeout(timer.current);
    // Premier geste sans la main : on la demande tout de suite, pour dire au plus vite si quelqu'un l'a prise.
    timer.current = setTimeout(() => void flushRef.current(), lockRef.current?.mine ? 1000 : 0);
  };

  /** Une plongée modifiée ; ses fiches et commentaires sans palanquée (palanquées refaites) s'en vont. */
  const updateDive = (fn: (d: Dive) => Dive) => update((d) => ({ ...d, dives: d.dives.map((x) => (x.id === diveId ? pruneOrphans(fn(x)) : x)) }));

  /** Inscrits VPDive, membres ajoutés et plongeurs hors VPDive : tout l'écran les traite pareil. */
  const guests = doc?.guests;
  const members = doc?.members;
  const people = useMemo(() => (roster ? withGuests(roster, { guests, members }) : null), [roster, guests, members]);

  /** L'identifiant d'inscription que VPDive attend pour ses routes d'admin. */
  const socketOf = (id: string, name: string) => {
    const socket = rosterRef.current?.find((r) => r.id === id)?.socket;
    if (!socket) throw new Error(`Inscription de ${name} introuvable sur VPDive : rechargez la sortie.`);
    return socket;
  };

  /** Avant d'écrire dans VPDive au nom de la fiche : il faut tenir la main. */
  const mustHoldLease = async () => {
    const lease = await ensureLease();
    if (lease === 'taken') throw new Error(`${takenBy()} modifie cette fiche : action annulée.`);
    if (lease === 'failed') throw new Error('Serveur de l’appli injoignable : réessayez.');
  };

  /**
   * Désinscrit quelqu'un de la sortie sur VPDive, puis relit la liste pour s'en
   * assurer. Il reste affiché barré (`unregistered`) tant qu'il ne s'est pas réinscrit.
   */
  const unregister = async (person: { id: string; name: string; instructor: boolean }) => {
    await mustHoldLease();
    await vpdive.deleteRegistration(token, socketOf(person.id, person.name));
    const fresh = await vpdive.fetchRoster(token);
    if (fresh.some((r) => r.id === person.id)) throw new Error(`VPDive n’a pas désinscrit ${person.name}.`);
    setRoster(fresh);
    // Plus décoché : s'il se réinscrit, il revient comme tout nouvel inscrit.
    update((d) => ({
      ...d,
      settings: toggleDiving(d.settings, person.id, true),
      unregistered: [...(d.unregistered ?? []).filter((u) => u.id !== person.id), { ...person, by: me, at: new Date().toISOString() }],
    }));
  };

  /** Liste d'attente → inscrit sur VPDive (même au-delà de la jauge), puis coché « plonge ». */
  const promote = async (person: { id: string; name: string }) => {
    await mustHoldLease();
    await vpdive.switchWaitingList(token, socketOf(person.id, person.name));
    const fresh = await vpdive.fetchRoster(token);
    const now = fresh.find((r) => r.id === person.id);
    if (!now || now.waitingList) throw new Error(`VPDive n’a pas inscrit ${person.name}.`);
    setRoster(fresh);
    update((d) => ({ ...d, settings: toggleDiving(d.settings, person.id, true) }));
  };

  /**
   * Ajoute un membre VPDive qui ne s'est pas inscrit (DP, pilote, sécu désignés),
   * avec les rôles choisis. Ses niveaux viennent de sa fiche ; il ne plonge pas
   * tant qu'on ne le coche pas. Rien n'est inscrit sur VPDive.
   */
  const addMember = async (m: MemberMatch, chosen: DiveRole[]) => {
    await mustHoldLease();
    const existing = people?.find((r) => r.uct === m.id);
    let id = existing?.id ?? addedMemberId(m.id);
    let added: AddedMember | null = null;
    if (!existing) {
      const profile = await vpdive.memberProfile(m.id).catch((e) => {
        if (e instanceof SessionExpiredError) throw e;
        return null;
      });
      added = { id, uct: m.id, name: m.name, picture: m.picture, levels: profile?.labels ?? [], display: profile ? [...profile.teaching, ...profile.levels] : [] };
    }
    id = added?.id ?? id;
    update((d) => {
      const r = rosterRef.current ?? [];
      const list = added ? withGuests(r, { ...d, members: [...(d.members ?? []), added] }) : withGuests(r, d);
      let roles = d.roles ?? defaultRoles(r);
      const header = { ...d.header };
      for (const role of chosen) {
        if (!(roles[role] ?? []).includes(id)) roles = { ...roles, [role]: [...(roles[role] ?? []), id] };
        Object.assign(header, headerFromRoles(list, roles, role));
      }
      return {
        ...d,
        roles,
        header,
        ...(added ? { members: [...(d.members ?? []), added], settings: toggleDiving(d.settings, id, false) } : {}),
      };
    });
  };

  /** Reprendre la saisie trouvée sur l'appareil : il faut la main ; si la fiche a changé depuis, l'enregistrement fera un conflit à trancher. */
  const resumeDraft = async (draft: Draft) => {
    const lease = await ensureLease();
    if (lease !== 'ok') return setNotice(lease === 'taken' ? `Impossible de reprendre la saisie : ${takenBy()} modifie cette fiche.` : 'Serveur de l’appli injoignable : réessayez.');
    const r = rosterRef.current;
    const d = r ? syncWithRoster(draft.doc, withGuests(r, draft.doc)).doc : draft.doc;
    revRef.current = draft.baseRev;
    setDraftOffer(null);
    showDoc(d);
    setSave('pending');
    void flushRef.current();
  };

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
  if (!doc || !roster || !people) return <GabianLoader label="Chargement de la sortie…" className="m-auto" />;

  const dive = doc.dives.find((d) => d.id === diveId) ?? doc.dives[0]!;
  const readOnly = !!other;
  /** L'onglet affiché : la fiche seulement une fois les palanquées validées. */
  const shown = tab === 'palanquees' || !dive.validated || !dive.plan ? 'palanquees' : 'fiche';
  const tabId = (t: 'palanquees' | 'fiche') => `${tabsId}-tab-${t}`;
  const panelId = (t: 'palanquees' | 'fiche') => `${tabsId}-panel-${t}`;

  return (
    <div className="px-5 sm:px-6 py-5 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-brand leading-snug">{event.title}</h3>
          <p className="text-sm text-muted first-letter:uppercase">
            {new Date(event.start).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            {event.location && ` · ${event.location}`} · {roster.length} inscrit{roster.length > 1 ? 's' : ''}
            {people.length > roster.length && ` · ${people.length - roster.length} hors VPDive`}
          </p>
        </div>
        <SaveBadge state={saveState} doc={doc} onRetry={() => void flush()} />
      </header>

      {other && (
        <div role="status" className="p-4 rounded-xl bg-tint text-brand text-base flex flex-wrap items-center gap-3 print:hidden">
          <Lock className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">
            <strong className="font-semibold">
              En cours de modification par {other.uct === session.traceability ? 'vous, sur un autre appareil ou un autre onglet,' : other.name} depuis {hhmm(other.since)}.
            </strong>{' '}
            Lecture seule : la fiche se met à jour toute seule et redevient modifiable dès qu’elle est libre.
          </span>
          {other.uct === session.traceability && (
            <button
              type="button"
              onClick={() =>
                void ensureLease(true).then((r) => {
                  if (r === 'ok') void refresh();
                  else setNotice('Impossible de prendre la main : réessayez.');
                })
              }
              className="btn btn-quiet h-9 text-sm"
            >
              Prendre la main ici
            </button>
          )}
        </div>
      )}

      {notice && (
        <div role="status" className="p-4 rounded-xl bg-warn-soft text-warn text-base flex flex-wrap items-center gap-3 print:hidden">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fermer" className="icon-btn w-9 h-9">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {draftOffer && (
        <div role="alert" className="p-4 rounded-xl bg-warn-soft text-warn text-base flex flex-wrap items-center gap-3 print:hidden">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">
            Une saisie non enregistrée du {dateTime(draftOffer.at)} existe sur cet appareil : la reprendre, ou l’abandonner (modifier la fiche l’abandonne aussi).
          </span>
          <button type="button" onClick={() => void resumeDraft(draftOffer)} disabled={readOnly} className="btn btn-quiet h-9 text-sm border-warn/40 text-warn">
            La reprendre
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft(token);
              setDraftOffer(null);
            }}
            className="btn btn-quiet h-9 text-sm"
          >
            L’abandonner
          </button>
        </div>
      )}

      {saveState === 'conflict' && (
        <div role="alert" className="p-4 rounded-xl bg-warn-soft text-warn text-base flex flex-wrap items-center gap-3 print:hidden">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">
            {conflict?.updatedBy ?? 'Quelqu’un'} a enregistré cette sortie
            {conflict?.updatedAt ? ` le ${dateTime(conflict.updatedAt)}` : ''} pendant que vous la modifiiez. Vos derniers changements ne sont pas enregistrés : gardez sa version ou la vôtre.
          </span>
          <button
            type="button"
            onClick={() => {
              setConflict(null);
              clearDraft(token);
              if (!conflict) {
                setSave('saved');
                return void load();
              }
              const r = rosterRef.current;
              const v = r ? derive(conflict, r).doc : conflict;
              revRef.current = conflict.rev ?? 0;
              baseDocRef.current = v;
              showDoc(v);
              setSave('saved');
            }}
            className="btn btn-quiet h-9 text-sm border-warn/40 text-warn"
          >
            Charger sa version
          </button>
          <button
            type="button"
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Écraser la version de ${conflict?.updatedBy ?? 'l’autre personne'} ?`,
                  message: 'Votre version la remplace : ses changements seront perdus.',
                  confirmLabel: 'Écraser',
                  danger: true,
                }))
              )
                return;
              // Ma version, enregistrée par-dessus la sienne : on part de sa révision.
              revRef.current = conflict?.rev ?? revRef.current;
              setConflict(null);
              setSave('pending');
              void flush();
            }}
            className="btn btn-quiet h-9 text-sm"
          >
            Écraser avec ma version
          </button>
        </div>
      )}

      {(departed.gone.length > 0 || departed.waitlisted.length > 0) && (
        <div role="alert" className="p-4 rounded-xl bg-warn-soft text-warn text-base flex flex-wrap items-center gap-3 print:hidden">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 min-w-0">
            {departed.gone.length > 0 && `${departed.gone.length > 1 ? 'Désinscrits' : 'Désinscrit'} depuis la composition : ${departed.gone.join(', ')}. `}
            {departed.waitlisted.length > 0 && `${departed.waitlisted.length > 1 ? 'Passés' : 'Passé'} en liste d’attente : ${departed.waitlisted.join(', ')}. `}
            {departed.gone.length + departed.waitlisted.length > 1 ? 'Retirés' : 'Retiré'} des palanquées, à revoir.
          </span>
          <button type="button" onClick={() => setDeparted({ gone: [], waitlisted: [] })} aria-label="Fermer" className="icon-btn w-9 h-9">
            <X className="w-4 h-4" />
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
        {!readOnly && (
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
        )}
        <span className="w-px h-6 bg-line mx-1" aria-hidden />
        <button
          onClick={() => setView('benevoles')}
          aria-pressed={view === 'benevoles'}
          className={`btn btn-quiet h-9 text-sm ${view === 'benevoles' ? 'bg-tint border-brand' : ''}`}
        >
          <HandHelping className="w-4 h-4" /> Bénévoles
        </button>
        {view === 'dive' && doc.dives.length > 1 && !readOnly && (
          <button
            onClick={async () => {
              if (!(await confirm({ title: `Supprimer « ${dive.label} » ?`, message: 'Sa fiche de sécurité sera supprimée aussi.', confirmLabel: 'Supprimer', danger: true }))) return;
              // Relue après la question : la fiche a pu changer pendant qu'elle était ouverte.
              const rest = (docRef.current ?? doc).dives.filter((d) => d.id !== dive.id);
              if (!rest.length) return;
              update((d) => ({ ...d, dives: d.dives.filter((x) => x.id !== dive.id) }));
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
        <fieldset disabled={readOnly} className="min-w-0">
          <VolunteersPanel roster={people} volunteers={doc.volunteers ?? {}} onChange={(volunteers) => update((d) => ({ ...d, volunteers }))} />
        </fieldset>
      ) : (
        <>
        {/* Palanquées / Fiche */}
        <TabList label={dive.label} className="flex border-b border-line print:hidden">
          <TabButton id={tabId('palanquees')} controls={panelId('palanquees')} active={shown === 'palanquees'} onClick={() => setTab('palanquees')} icon={<Users className="w-4 h-4" />}>
            Palanquées
          </TabButton>
          <TabButton
            id={tabId('fiche')}
            controls={panelId('fiche')}
            active={shown === 'fiche'}
            disabled={!dive.validated}
            onClick={() => setTab('fiche')}
            icon={dive.validated ? <ClipboardList className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          >
            Fiche de sécurité
          </TabButton>
        </TabList>

        <TabPanel id={panelId(shown)} labelledBy={tabId(shown)}>
        {shown === 'palanquees' ? (
          <PalanqueesEditor
            title={event.title}
            roster={people}
            doc={doc}
            dive={dive}
            readOnly={readOnly}
            onSettings={(settings) => update((d) => ({ ...d, settings }))}
            // Le rôle changé remplit son champ de l'en-tête de la fiche ; les deux autres gardent ce qui y est écrit (pilote extérieur…).
            onRoles={(roles, role) => update((d) => ({ ...d, roles, header: { ...d.header, ...headerFromRoles(people, roles, role) } }))}
            onPlan={(plan) => updateDive((d) => ({ ...d, plan }))}
            onValidate={() => {
              // Qui et quand : posés par le serveur à l'enregistrement.
              updateDive((d) => ({ ...d, validated: { by: me, at: new Date().toISOString() } }));
              setTab('fiche');
            }}
            onReopen={() => updateDive((d) => ({ ...d, validated: null }))}
            onNote={(palanqueeId, text) => updateDive((d) => setGuideNote(d, palanqueeId, text, me))}
            onGuests={(list) => update((d) => ({ ...d, guests: list }))}
            onMembers={(list) => update((d) => ({ ...d, members: list }))}
            onUnregister={isAdmin ? unregister : undefined}
            onPromote={isAdmin ? promote : undefined}
            onAddMember={addMember}
          />
        ) : (
          <SafetySheet
            title={event.title}
            doc={doc}
            dive={dive}
            readOnly={readOnly}
            onHeader={(header) => update((d) => ({ ...d, header }))}
            // La profondeur prévue est aussi celle de la palanquée : elle est contrôlée contre sa prérogative.
            onSheet={(id, sheet) =>
              updateDive((d) => ({
                ...d,
                sheets: { ...d.sheets, [id]: sheet },
                plan: d.plan && sheet.planned.depth !== (d.sheets[id]?.planned.depth ?? '') ? setDepth(d.plan, id, parseDepth(sheet.planned.depth)) : d.plan,
              }))
            }
            onGas={(id, gas) => updateDive((d) => ({ ...d, gas: { ...d.gas, [id]: gas } }))}
          />
        )}
        </TabPanel>
        </>
      )}
      {confirmDialog}
    </div>
  );
}

function TabButton({
  id,
  controls,
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Tab
      id={id}
      controls={controls}
      selected={active}
      disabled={disabled}
      onSelect={onClick}
      title={disabled ? 'Validez d’abord les palanquées' : undefined}
      className={`inline-flex items-center gap-2 px-4 h-11 -mb-px border-b-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
        active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </Tab>
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
