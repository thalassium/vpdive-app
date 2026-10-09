import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, EyeOff, FileText, Mail, MessageCircle, RefreshCw, Undo2, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Tab as TabItem, TabList, TabPanel } from '../Tabs';
import { useConfirm } from '../../hooks/useConfirm';
import { vpdive, isUnavailable, type RosterEntry } from '../../services/vpdive';
import { ymd, shortDay } from '../../lib/dates';
import { appApi, type IgnoredDocs } from '../../services/appApi';
import { messaging } from '../../services/messaging';
import { bulkReminderText, checkDocs, reminderText, seasonOfOuting, type DocIssue, type DocKind, type DocsStatus } from '../../lib/docsCheck';
import { MembershipTab, type MembershipStep } from './MembershipTab';
import { PendingDocumentsTab, RegistrationRequestsTab } from './PendingTabs';
import type { PendingValidation } from '../../services/vpdive';
import type { RegistrationRequest } from '../../services/appApi';
import { message } from '../../lib/errors';
import { docsStatusCache } from './memberCache';
import { Dialog, DialogHeader } from '../Dialog';

/**
 * Le parcours, dans l'ordre : 1 à traiter (sinon VPDive ignore la personne ou
 * le document), 2 diagnostic, 3 corrections rapides (puis relire les fiches),
 * 4 arbitrage. La relance des inscrits aux prochaines sorties est à part.
 */
type Tab = 'todo' | MembershipStep | 'relance';
const SUBTITLE: Record<Exclude<Tab, 'relance'>, string> = {
  todo: 'À valider avant les vérifications : tant qu’elles ne sont pas traitées, VPDive ignore ces personnes et ces documents.',
  diagnostic: 'Chaque membre vu par HelloAsso (paiements), la FFESSM (licence) et VPDive (fiche).',
  quickfix: 'Les corrections sans risque à pousser dans VPDive, puis relire les fiches.',
  arbitrage: 'Le cas par cas, à décider à la main.',
};
const STEPS: [MembershipStep | 'todo', string][] = [
  ['todo', 'À traiter'],
  ['diagnostic', 'Diagnostic'],
  ['quickfix', 'Corrections rapides'],
  ['arbitrage', 'Arbitrage'],
];

interface Me {
  uct: string;
  name: string;
  picture: string;
}

interface Props {
  me: Me;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

interface Outing {
  token: string;
  title: string;
  /** AAAA-MM-JJ */
  date: string;
  roster: RosterEntry[];
}

/** Une sortie pour laquelle le dossier du membre n'est pas en règle. */
interface Concern {
  outing: Outing;
  waitingList: boolean;
  issues: DocIssue[];
}

/** Un membre, toutes ses sorties concernées. */
interface Row {
  key: string;
  name: string;
  firstname: string;
  email: string;
  uct: string;
  picture: string;
  level: 'red' | 'yellow';
  /** Un problème par sorte, tel qu'il se pose pour la première sortie concernée. */
  issues: DocIssue[];
  concerns: Concern[];
}

type Filter = 'all' | DocKind | 'ignored';
type Phase = 'events' | 'rosters' | 'status' | 'stopped' | 'done' | 'error';

const DAYS_AHEAD = 60;
/** Erreurs d'affilée sur les fiches membres avant de s'arrêter ; VPDive indisponible (pare-feu, réseau) : tout de suite. */
const MAX_FAILURES = 3;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'caci', label: 'CACI' },
  { key: 'licence', label: 'Licence' },
  { key: 'adhesion', label: 'Adhésion' },
  { key: 'ignored', label: 'Ignorés' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const hasKind = (r: Row, kind: DocKind) => r.issues.some((i) => i.kind === kind && i.level !== 'muted');

/**
 * Documentation (admin) : chaque membre inscrit à une sortie des 60 prochains
 * jours dont le dossier VPDive n'est pas en règle à la date de la sortie
 * (règles dans lib/docsCheck.ts), avec relance par e-mail ou dans l'appli.
 *
 * VPDive a un pare-feu qui bloque les rafales : tout est lu l'un après l'autre
 * (la file du transport espace les appels), et les fiches membres sont gardées
 * 6 h dans la session.
 */
export function DocsPanel({ me, onClose, onSessionLost }: Props) {
  /**
   * À traiter d'abord : membres à valider, documents en attente (tant qu'ils ne
   * sont pas validés, les vérifications les voient manquants). Puis les
   * vérifications : Adhésions (HelloAsso × FFESSM × VPDive) et Relance.
   */
  /** L'onglet choisi par l'admin ; tant qu'il n'en a choisi aucun, celui de l'ouverture (plus bas). */
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  /** Compteurs des étapes 3 et 4, calculés par l'onglet des adhésions (une fois monté). */
  const [stepCounts, setStepCounts] = useState<{ fixes: number; cases: number } | null>(null);
  /** Écriture dans VPDive en cours (étape 3) : le panneau ne se ferme pas. */
  const membershipBusy = useRef(false);
  /** Rempli par l'onglet des adhésions : oublie la fiche d'un membre validé à l'étape 1. */
  const forgetMember = useRef<((uct: string) => void) | null>(null);
  const [requests, setRequests] = useState<RegistrationRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<PendingValidation[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const fetchRequests = useCallback(() => {
    appApi.registrationRequests().then(setRequests, (e) => onSessionLost(e) || setRequestsError(message(e)));
  }, [onSessionLost]);
  const fetchPendingDocs = useCallback(() => {
    vpdive.pendingValidations().then(setPendingDocs, (e) => onSessionLost(e) || setDocsError(message(e)));
  }, [onSessionLost]);
  /** « Réessayer » : la liste repasse en lecture, puis est relue. */
  const loadRequests = () => {
    setRequestsError(null);
    setRequests(null);
    fetchRequests();
  };
  const loadPendingDocs = () => {
    setDocsError(null);
    setPendingDocs(null);
    fetchPendingDocs();
  };
  // À l'ouverture, les listes sont déjà en lecture (null) : il n'y a qu'à les lire.
  useEffect(() => {
    fetchRequests();
    fetchPendingDocs();
  }, [fetchRequests, fetchPendingDocs]);
  // Tant que l'admin n'a pas choisi d'onglet : le premier qui a quelque chose à traiter, sinon les adhésions
  // (« À traiter » pendant la lecture des deux listes).
  const tab: Tab = chosenTab ?? (requests !== null && pendingDocs !== null && !requests.length && !pendingDocs.length ? 'diagnostic' : 'todo');
  const isStep = tab === 'diagnostic' || tab === 'quickfix' || tab === 'arbitrage';
  /**
   * L'onglet des adhésions lit beaucoup (annuaire, HelloAsso, exports, une fiche par membre) :
   * monté à la première visite d'une étape 2 à 4, puis gardé (données lues une fois).
   * Retenu pendant le rendu (état dérivé d'un rendu précédent), pas dans un effet.
   */
  const [stepsOpened, setStepsOpened] = useState(false);
  if (isStep && !stepsOpened) setStepsOpened(true);
  /** La relance ne lit VPDive qu'une fois son onglet ouvert. */
  const [relanceOpened, setRelanceOpened] = useState(false);
  const [outings, setOutings] = useState<Outing[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, DocsStatus>>({});
  const [phase, setPhase] = useState<Phase>('events');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [rosterErrors, setRosterErrors] = useState<string[]>([]);
  const [statusFailures, setStatusFailures] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  /** Membres ignorés, partagés entre admins (serveur de l'appli). null : pas encore lus. */
  const [ignored, setIgnored] = useState<IgnoredDocs | null>(null);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    appApi.docsIgnored().then(
      (list) => live && setIgnored(list),
      (e) => {
        if (!live || onSessionLost(e)) return;
        setIgnored({});
        setIgnoreError(`Liste des membres ignorés illisible : ${message(e)}`);
      },
    );
    return () => {
      live = false;
    };
  }, [onSessionLost]);
  const setIgnore = async (row: { uct: string; name: string }, ignore: boolean) => {
    if (!row.uct) return;
    const before = ignored ?? {};
    const optimistic = { ...before };
    if (ignore) optimistic[row.uct] = { name: row.name, by: me.name, at: new Date().toISOString() };
    else delete optimistic[row.uct];
    setIgnored(optimistic);
    setIgnoreError(null);
    if (ignore) setSelected((prev) => {
      const next = new Set(prev);
      next.delete(row.uct);
      return next;
    });
    try {
      setIgnored(await appApi.setDocsIgnored(row.uct, row.name, ignore));
    } catch (e) {
      if (onSessionLost(e)) return;
      setIgnored(before);
      setIgnoreError(message(e));
    }
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminder, setReminder] = useState<{ rows: Row[]; bulk: boolean } | null>(null);

  // Chaque chargement porte un numéro ; « Arrêter », un nouveau chargement ou la fermeture l'invalident.
  const run = useRef(0);
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  }, [onSessionLost]);

  const checkStatuses = useCallback(async (list: Outing[], id: number) => {
    const ucts = [...new Set(list.flatMap((o) => o.roster.filter((e) => !e.waitingList && e.uct).map((e) => e.uct!)))];
    const cached: Record<string, DocsStatus> = {};
    const todo: string[] = [];
    for (const u of ucts) {
      const c = docsStatusCache.read(u);
      if (c) cached[u] = c;
      else todo.push(u);
    }
    setStatuses((prev) => ({ ...prev, ...cached }));
    let done = ucts.length - todo.length;
    let failures = 0;
    let failed = 0;
    setStatusFailures(0);
    setPhase('status');
    setProgress({ done, total: ucts.length });
    for (const uct of todo) {
      if (run.current !== id) return;
      try {
        const status = await vpdive.memberStatus(uct, { priority: 'low' });
        if (run.current !== id) return;
        docsStatusCache.write(uct, status);
        setStatuses((prev) => ({ ...prev, [uct]: status }));
        failures = 0;
      } catch (e) {
        if (lost.current(e)) {
          run.current++;
          return;
        }
        if (run.current !== id) return;
        failed++;
        setStatusFailures(failed);
        if (++failures >= MAX_FAILURES || isUnavailable(e)) {
          setError(`VPDive ne répond plus aux lectures de fiches (${message(e)}). Vérification interrompue.`);
          setPhase('stopped');
          return;
        }
      }
      setProgress({ done: ++done, total: ucts.length });
    }
    setPhase('done');
  }, []);

  const load = useCallback(async () => {
    const id = ++run.current;
    setError(null);
    setRosterErrors([]);
    setOutings(null);
    setSelected(new Set());
    setPhase('events');
    try {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + DAYS_AHEAD);
      const events = (await vpdive.fetchEvents(ymd(start), ymd(end))).filter((e) => e.registeredCount > 0);
      if (run.current !== id) return;
      setPhase('rosters');
      setProgress({ done: 0, total: events.length });
      const list: Outing[] = [];
      const errors: string[] = [];
      for (const [i, ev] of events.entries()) {
        if (run.current !== id) return;
        const date = ev.start.slice(0, 10);
        try {
          const roster = await vpdive.fetchRoster(ev.token, { priority: 'low' });
          if (run.current !== id) return;
          list.push({ token: ev.token, title: ev.title, date, roster });
          setOutings([...list]);
        } catch (e) {
          if (lost.current(e)) {
            run.current++;
            return;
          }
          // VPDive ne répond plus (pare-feu, réseau) : inutile de lire les sorties suivantes.
          if (isUnavailable(e)) throw e;
          errors.push(`${ev.title} (${shortDay(date)}) : ${message(e)}`);
          setRosterErrors([...errors]);
        }
        setProgress({ done: i + 1, total: events.length });
      }
      setOutings([...list]);
      await checkStatuses(list, id);
    } catch (e) {
      if (lost.current(e) || run.current !== id) return;
      setError(message(e));
      setPhase('error');
    }
  }, [checkStatuses]);

  /** Première ouverture de la relance : elle lit VPDive (pas avant). */
  const openRelance = () => {
    if (relanceOpened) return;
    setRelanceOpened(true);
    void load();
  };
  // Fermeture du panneau : la lecture en cours s'arrête.
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  const stop = () => {
    run.current++;
    setPhase('stopped');
  };
  const resume = () => {
    setError(null);
    if (outings) checkStatuses(outings, ++run.current);
  };

  // Échap et le bouton Retour (la fenêtre <Dialog>, plus bas) ferment la relance si elle est ouverte (jamais
  // en plein envoi), sinon le panneau (jamais en pleine écriture dans VPDive).
  // useDialog relit ses fonctions à chaque appel : `reminder` y est toujours celui du dernier rendu.
  const reminderBusy = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  /** Identifiants des onglets et de leurs panneaux (les étapes 2 à 4 partagent un panneau). */
  const tabsId = useId();
  const tabId = (key: Tab) => `${tabsId}-tab-${key}`;
  const panelId = (key: Tab) => `${tabsId}-panel-${key === 'todo' || key === 'relance' ? key : 'steps'}`;
  /** Croix, clic à côté, Échap et Retour : pendant une écriture dans VPDive, on demande d'abord (le lot s'arrête après la fiche en cours). */
  const requestClose = async () => {
    if (
      membershipBusy.current &&
      !(await confirm({ title: 'Fermer quand même ?', message: 'Écriture dans VPDive en cours. Le lot s’arrêtera après la fiche en cours.', confirmLabel: 'Fermer', cancelLabel: 'Continuer' }))
    )
      return;
    onClose();
  };

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const o of [...(outings ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const e of o.roster) {
        const status = e.uct ? (statuses[e.uct] ?? null) : null;
        const res = checkDocs(e, o.date, status);
        if (res.level === 'ok') continue;
        const key = e.uct || `id:${e.id}`;
        let row = map.get(key);
        if (!row) {
          row = { key, name: e.name, firstname: e.firstname, email: e.email ?? '', uct: e.uct ?? '', picture: e.picture ?? '', level: 'yellow', issues: [], concerns: [] };
          map.set(key, row);
        }
        row.email ||= e.email ?? '';
        row.picture ||= e.picture ?? '';
        row.concerns.push({ outing: o, waitingList: e.waitingList, issues: res.issues });
        if (res.level === 'red') row.level = 'red';
      }
    }
    for (const row of map.values()) {
      const all = row.concerns.flatMap((c) => c.issues);
      for (const kind of ['caci', 'licence', 'adhesion'] as const) {
        const issue = all.find((i) => i.kind === kind && i.level !== 'muted') ?? all.find((i) => i.kind === kind);
        if (issue) row.issues.push(issue);
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1) ||
        a.concerns[0]!.outing.date.localeCompare(b.concerns[0]!.outing.date) ||
        a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    );
  }, [outings, statuses]);

  // Les membres ignorés sortent des compteurs, des listes et de la relance groupée.
  const active = useMemo(() => rows.filter((r) => !(r.uct && ignored?.[r.uct])), [rows, ignored]);
  const ignoredList = useMemo(
    () =>
      Object.entries(ignored ?? {})
        .map(([uct, v]) => ({ uct, ...v, row: rows.find((r) => r.uct === uct) ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [ignored, rows],
  );
  const counts = useMemo(
    () => ({ caci: active.filter((r) => hasKind(r, 'caci')).length, licence: active.filter((r) => hasKind(r, 'licence')).length, adhesion: active.filter((r) => hasKind(r, 'adhesion')).length }),
    [active],
  );
  const shown = useMemo(() => (filter === 'all' ? active : filter === 'ignored' ? [] : active.filter((r) => hasKind(r, filter))), [active, filter]);
  const picked = active.filter((r) => selected.has(r.key));
  const allShownPicked = shown.length > 0 && shown.every((r) => selected.has(r.key));

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShownPicked) next.delete(r.key);
        else next.add(r.key);
      }
      return next;
    });

  const loading = phase === 'events' || phase === 'rosters';
  const verifying = phase === 'status';

  return (
    <>
      <Dialog
        label="docs"
        onClose={() => (reminder !== null ? setReminder(null) : onClose())}
        canClose={() => {
          if (reminderBusy.current) return false;
          if (reminder !== null || !membershipBusy.current) return true;
          // Écriture dans VPDive en cours : on ne ferme pas tout de suite, on pose la question (requestClose ferme si accepté).
          void requestClose();
          return false;
        }}
        onBackdrop={() => void requestClose()}
        titleId="docs-title"
        className={`${tab === 'relance' ? 'sm:max-w-5xl' : 'sm:max-w-7xl'} h-dvh sm:h-[92vh]`}
      >
        <DialogHeader
          titleId="docs-title"
          kicker="Admin"
          icon={<FileText className="w-6 h-6 text-brand" />}
          title="Gestion des adhésions"
          onClose={() => void requestClose()}
          subtitle={
            <p className="mt-1 text-sm text-muted">
              {tab === 'relance' ? `Inscrits des ${DAYS_AHEAD} prochains jours dont le dossier VPDive n’est pas en règle à la date de la sortie.` : SUBTITLE[tab]}
            </p>
          }
        >
          {/* Onglets : les quatre étapes dans l'ordre (la première, prioritaire, en teinte d'alerte), puis la relance. */}
          {/* Activation au clavier par Entrée : ouvrir une étape lit beaucoup sur VPDive, les flèches ne font que s'y déplacer. */}
          <TabList
            label="Gestion des adhésions"
            activation="manual"
            className="mt-3 flex items-end gap-1 border-b border-line -mb-4 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {STEPS.map(([key, text], i) => {
              const count = key === 'todo' ? (requests && pendingDocs ? requests.length + pendingDocs.length : undefined) : key === 'quickfix' ? stepCounts?.fixes : key === 'arbitrage' ? stepCounts?.cases : undefined;
              const first = key === 'todo';
              const on = tab === key;
              return (
                <TabItem
                  key={key}
                  id={tabId(key)}
                  controls={panelId(key)}
                  selected={on}
                  onSelect={() => setChosenTab(key)}
                  className={`h-10 px-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-2 rounded-t-md transition-colors ${
                    first ? (on ? 'border-warn text-warn bg-warn-soft' : 'border-transparent text-warn bg-warn-soft/60 hover:bg-warn-soft') : on ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-brand'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`w-5 h-5 rounded-full text-xs font-bold inline-flex items-center justify-center ${first ? 'bg-surface text-warn border border-warn/40' : on ? 'bg-fill text-on-fill' : 'bg-raised text-muted'}`}
                  >
                    {i + 1}
                  </span>
                  {text}
                  {count !== undefined && count > 0 && (
                    <span className={`min-w-5 h-5 px-1.5 rounded-full text-xs tabular-nums inline-flex items-center justify-center border ${first ? 'border-warn/40 bg-surface' : 'border-line bg-surface text-ink'}`}>{count}</span>
                  )}
                </TabItem>
              );
            })}
            <span aria-hidden className="self-center w-px h-6 bg-line mx-2 shrink-0" />
            <TabItem
              id={tabId('relance')}
              controls={panelId('relance')}
              selected={tab === 'relance'}
              onSelect={() => {
                setChosenTab('relance');
                openRelance();
              }}
              className={`h-10 px-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${tab === 'relance' ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-brand'}`}
            >
              Relance
            </TabItem>
          </TabList>
          {tab === 'relance' && outings && (
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm text-ink flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-danger" /> {plural(counts.caci, 'CACI manquant', 'CACI manquants')}
                </span>
                <span aria-hidden className="text-muted">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-warn" /> {plural(counts.licence, 'licence FFESSM', 'licences FFESSM')}
                </span>
                <span aria-hidden className="text-muted">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-warn" /> {plural(counts.adhesion, 'adhésion', 'adhésions')}
                </span>
              </p>
              <div role="radiogroup" aria-label="Filtrer" className="inline-flex rounded-lg border border-field-border bg-surface p-1 sm:ml-auto">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="radio"
                    aria-checked={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={`h-11 sm:h-9 px-3 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                  >
                    {f.label}
                    {f.key === 'ignored' && ignoredList.length > 0 && <span className="ml-1 tabular-nums">{ignoredList.length}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogHeader>

        {tab === 'todo' && (
          <TabPanel id={panelId('todo')} labelledBy={tabId('todo')} className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-5 py-4 space-y-8">
            <section>
              <h3 className="text-lg font-semibold text-brand mb-2">
                Membres à valider {requests && requests.length > 0 && <span className="text-muted font-normal tabular-nums">· {requests.length}</span>}
              </h3>
              <RegistrationRequestsTab requests={requests} error={requestsError} onReload={loadRequests} onChange={setRequests} onSessionLost={onSessionLost} />
            </section>
            <section>
              <h3 className="text-lg font-semibold text-brand mb-2">
                Documents en attente {pendingDocs && pendingDocs.length > 0 && <span className="text-muted font-normal tabular-nums">· {pendingDocs.length}</span>}
              </h3>
              <PendingDocumentsTab
                items={pendingDocs}
                error={docsError}
                onReload={loadPendingDocs}
                onChange={setPendingDocs}
                onSessionLost={onSessionLost}
                onForget={(uct) => forgetMember.current?.(uct)}
              />
            </section>
          </TabPanel>
        )}
        {/* Étapes 2 à 4 : un seul onglet des adhésions, monté à la première visite puis gardé (données lues une fois, compteurs dans les onglets). */}
        {stepsOpened && (
          <TabPanel id={panelId('diagnostic')} labelledBy={tabId(isStep ? tab : 'diagnostic')} className={isStep ? 'flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-5 py-4' : 'hidden'}>
            <MembershipTab
              step={isStep ? (tab as MembershipStep) : 'diagnostic'}
              onCounts={setStepCounts}
              onSessionLost={onSessionLost}
              onWriting={(busy) => {
                membershipBusy.current = busy;
              }}
              forgetRef={forgetMember}
            />
          </TabPanel>
        )}
        {tab === 'relance' && (
        <TabPanel id={panelId('relance')} labelledBy={tabId('relance')} className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-4 py-3 space-y-3">
          {(loading || verifying || phase === 'stopped') && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted px-1" aria-live="polite">
              {phase === 'events' && <span>Lecture des sorties sur VPDive…</span>}
              {phase === 'rosters' && (
                <span>
                  Lecture des inscrits… {progress.done}/{progress.total}
                </span>
              )}
              {verifying && (
                <>
                  <span>
                    Vérification des adhésions… {progress.done}/{progress.total}
                  </span>
                  <button type="button" onClick={stop} className="btn btn-quiet sm:h-9 text-sm">
                    Arrêter
                  </button>
                </>
              )}
              {phase === 'stopped' && (
                <>
                  <span>
                    Vérification arrêtée : {progress.done}/{progress.total} fiches lues.
                  </span>
                  <button type="button" onClick={resume} className="btn btn-quiet sm:h-9 text-sm">
                    <RefreshCw className="w-4 h-4" /> Reprendre
                  </button>
                </>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-1 px-1 text-base text-danger">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{error}</span>
              <button type="button" onClick={phase === 'stopped' ? resume : load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}
          {rosterErrors.length > 0 && (
            <div role="alert" className="px-1 text-sm text-danger">
              <p className="flex flex-wrap items-center gap-x-3">
                <span className="font-semibold">Inscrits illisibles pour {plural(rosterErrors.length, 'sortie', 'sorties')} :</span>
                {!loading && (
                  <button type="button" onClick={load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
                    <RefreshCw className="w-4 h-4" /> Réessayer
                  </button>
                )}
              </p>
              <ul className="mt-1 space-y-0.5">
                {rosterErrors.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {ignoreError && (
            <p role="alert" className="px-1 text-sm text-danger">
              {ignoreError}
            </p>
          )}
          {statusFailures > 0 && phase !== 'stopped' && (
            <p className="px-1 text-sm text-muted">{plural(statusFailures, 'fiche membre illisible', 'fiches membres illisibles')} : adhésion non vérifiée.</p>
          )}

          {filter !== 'ignored' && outings && phase === 'done' && active.length === 0 && (
            <p className="py-10 text-center text-muted">
              {outings.length === 0 ? `Aucune sortie avec des inscrits dans les ${DAYS_AHEAD} prochains jours.` : 'Tous les inscrits sont en règle.'}
            </p>
          )}
          {filter !== 'ignored' && outings && active.length > 0 && shown.length === 0 && <p className="py-10 text-center text-muted">Personne n’est concerné par ce document.</p>}

          {filter === 'ignored' &&
            (ignoredList.length === 0 ? (
              <p className="py-10 text-center text-muted">Aucun membre ignoré.</p>
            ) : (
              <ul className="space-y-2">
                {ignoredList.map((i) => (
                  <li key={i.uct} className="card px-3 py-2.5 flex items-center gap-3">
                    <Avatar name={i.name} picture={i.row?.picture ?? ''} size="sm" initials={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink leading-snug break-words">{i.name}</span>
                      <span className="block text-sm text-muted">
                        Ignoré par {i.by} le {new Date(i.at).toLocaleDateString('fr-FR')}
                      </span>
                    </span>
                    <button type="button" onClick={() => void setIgnore({ uct: i.uct, name: i.name }, false)} className="btn btn-quiet sm:h-9 text-sm shrink-0">
                      <Undo2 className="w-4 h-4" /> Ne plus ignorer
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {shown.length > 0 && (
            <ul className="space-y-2">
              {shown.map((r) => (
                <MemberCard
                  key={r.key}
                  row={r}
                  checked={selected.has(r.key)}
                  onToggle={() => toggle(r.key)}
                  onRemind={() => setReminder({ rows: [r], bulk: false })}
                  onIgnore={r.uct ? () => void setIgnore(r, true) : undefined}
                />
              ))}
            </ul>
          )}
        </TabPanel>
        )}

        {tab === 'relance' && filter !== 'ignored' && active.length > 0 && (
          <div className="sticky bottom-0 shrink-0 bg-surface border-t border-line px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-base text-ink font-medium">{plural(picked.length, 'sélectionné', 'sélectionnés')}</span>
            <button type="button" onClick={toggleAll} className="btn btn-quiet sm:h-9 text-sm">
              {allShownPicked ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            <button type="button" disabled={picked.length === 0} onClick={() => setReminder({ rows: picked, bulk: true })} className="btn btn-primary ml-auto">
              Relancer la sélection
            </button>
          </div>
        )}

        {reminder && (
          <ReminderSheet
            key={reminder.rows.map((r) => r.key).join()}
            {...reminder}
            me={me}
            onClose={() => setReminder(null)}
            onBusy={(busy) => {
              reminderBusy.current = busy;
            }}
            onSessionLost={onSessionLost}
          />
        )}
      </Dialog>
      {confirmDialog}
    </>
  );
}

function IssueChip({ issue }: { issue: DocIssue }) {
  const tone = issue.level === 'red' ? 'bg-danger-soft text-danger font-semibold' : issue.level === 'yellow' ? 'bg-warn-soft text-warn font-semibold' : 'text-muted';
  return <span className={`rounded-md px-1.5 text-sm ${tone}`}>{issue.text}</span>;
}

function MemberCard({ row, checked, onToggle, onRemind, onIgnore }: { row: Row; checked: boolean; onToggle: () => void; onRemind: () => void; onIgnore?: () => void }) {
  const next = row.concerns[0];
  return (
    <li className={`card border-l-4 ${row.level === 'red' ? 'border-l-danger' : 'border-l-warn'} px-3 py-2.5 flex items-start gap-3`}>
      <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Sélectionner ${row.name}`} className="w-5 h-5 mt-0.5 accent-[var(--fill)] shrink-0" />
        <Avatar name={row.name} picture={row.picture} size="sm" initials={false} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink leading-snug break-words">{row.name}</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            {row.issues.map((i) => (
              <IssueChip key={i.kind} issue={i} />
            ))}
          </span>
          {next && <span className="mt-1 block text-sm text-muted">Prochaine sortie : {shortDay(next.outing.date)}</span>}
        </span>
      </label>
      <span className="flex flex-col sm:flex-row items-stretch gap-1.5 shrink-0">
        <button type="button" onClick={onRemind} className="btn btn-quiet sm:h-9 text-sm">
          Relancer
        </button>
        {onIgnore && (
          <button type="button" onClick={onIgnore} title="Ne plus afficher ce membre" className="btn btn-quiet sm:h-9 text-sm text-muted">
            <EyeOff className="w-4 h-4" /> Ignorer
          </button>
        )}
      </span>
    </li>
  );
}

function ReminderSheet({
  rows,
  bulk,
  me,
  onClose,
  onBusy,
  onSessionLost,
}: {
  rows: Row[];
  bulk: boolean;
  me: Me;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const first = rows[0]!;
  const next = first.concerns[0]!;
  const [text, setText] = useState(() =>
    bulk
      ? bulkReminderText({ year: seasonOfOuting(next.outing.date), from: me.name })
      : reminderText({
          firstName: first.firstname,
          date: shortDay(next.outing.date),
          title: next.outing.title,
          kinds: first.issues.filter((i) => i.level !== 'muted').map((i) => i.kind),
          year: seasonOfOuting(next.outing.date),
          from: me.name,
        }),
  );
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ sent: number; errors: string[] } | null>(null);

  const withEmail = rows.filter((r) => r.email);
  const noEmail = rows.filter((r) => !r.email);
  const subject = bulk ? 'Ton dossier VPDive pour les prochaines sorties' : `Ton dossier VPDive pour la sortie du ${shortDay(next.outing.date)}`;
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const mailHref = bulk
    ? `mailto:?bcc=${withEmail.map((r) => encodeURIComponent(r.email)).join(',')}&${query}`
    : `mailto:${encodeURIComponent(first.email)}?${query}`;

  const sendInApp = async () => {
    const errors: string[] = [];
    let sent = 0;
    setResult(null);
    setSending({ done: 0, total: rows.length });
    onBusy(true);
    // Envois l'un après l'autre : la file du transport les espace.
    for (const [i, r] of rows.entries()) {
      if (!r.uct) {
        errors.push(`${r.name} : pas de compte d’adhérent connu`);
      } else {
        try {
          await messaging.writeTo(r.uct, text);
          sent++;
        } catch (e) {
          if (onSessionLost(e)) return;
          errors.push(`${r.name} : ${message(e)}`);
        }
      }
      setSending({ done: i + 1, total: rows.length });
    }
    onBusy(false);
    setSending(null);
    setResult({ sent, errors });
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="reminder-title" className="panel w-full sm:max-w-xl max-h-full overflow-y-auto rounded-b-none sm:rounded-xl p-5 flex flex-col gap-3 animate-sheet sm:animate-pop">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="reminder-title" className="text-lg font-semibold text-brand">
              {bulk ? `Relancer ${plural(rows.length, 'membre', 'membres')}` : `Relancer ${first.name}`}
            </h3>
            {!bulk && (
              <p className="text-sm text-muted">
                {shortDay(next.outing.date)} · {next.outing.title}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Fermer la relance" className="icon-btn -mr-2 -mt-1" disabled={!!sending}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {bulk && (
          <p className="text-sm text-muted">
            {rows
              .slice(0, 8)
              .map((r) => r.name)
              .join(', ')}
            {rows.length > 8 && ` et ${rows.length - 8} autres`}
          </p>
        )}

        <div>
          <label htmlFor="reminder-text" className="label block mb-1.5">
            Message
          </label>
          <textarea id="reminder-text" rows={11} value={text} onChange={(e) => setText(e.target.value)} className="field w-full h-auto py-2.5 text-base leading-relaxed" />
        </div>

        {noEmail.length > 0 && (
          <p className="text-sm text-muted">
            Sans e-mail : <span className="text-ink">{noEmail.map((r) => r.name).join(', ')}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 justify-end">
          {withEmail.length > 0 ? (
            <a href={mailHref} className="btn btn-quiet">
              <Mail className="w-4 h-4" /> Envoyer par e-mail
            </a>
          ) : (
            <button type="button" disabled className="btn btn-quiet">
              <Mail className="w-4 h-4" /> Envoyer par e-mail
            </button>
          )}
          {/* Une fois tout envoyé, le bouton ne renvoie pas une deuxième fois. */}
          <button type="button" onClick={sendInApp} disabled={!!sending || !text.trim() || (!!result && result.errors.length === 0)} className="btn btn-primary">
            <MessageCircle className="w-4 h-4" /> {sending ? `Envoi… ${sending.done}/${sending.total}` : result && result.errors.length === 0 ? 'Envoyé' : 'Envoyer dans l’appli'}
          </button>
        </div>

        {result && (
          <div aria-live="polite" className="text-sm">
            <p className={result.sent > 0 ? 'text-ok font-semibold' : 'text-muted'}>{plural(result.sent, 'message envoyé', 'messages envoyés')}</p>
            {result.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-danger">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
