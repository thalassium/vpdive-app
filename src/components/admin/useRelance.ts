import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vpdive, isUnavailable } from '../../services/vpdive';
import { ymd, shortDay } from '../../lib/dates';
import { appApi, type IgnoredDocs } from '../../services/appApi';
import type { DocsStatus } from '../../lib/docsCheck';
import { message } from '../../lib/errors';
import { docsStatusCache } from './memberCache';
import { DAYS_AHEAD, hasKind, relanceRows, type Filter, type Me, type Outing, type Phase, type Row } from './relance';

/** Erreurs d'affilée sur les fiches membres avant de s'arrêter ; VPDive indisponible (pare-feu, réseau) : tout de suite. */
const MAX_FAILURES = 3;

/**
 * Relance (gestion des adhésions) : chaque membre inscrit à une sortie des 60
 * prochains jours dont le dossier VPDive n'est pas en règle à la date de la sortie.
 * Lit l'agenda, les inscrits de chaque sortie puis la fiche de chacun (gardée 6 h),
 * l'un après l'autre (la file du transport espace les appels). Rien n'est lu avant
 * la première ouverture de l'onglet (`open`).
 */
export function useRelance(me: Me, onSessionLost: (e: unknown) => boolean) {
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
  const open = () => {
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

  /** Envoi de relances en cours : la fenêtre ne se ferme pas. */
  const reminderBusy = useRef(false);

  const rows = useMemo(() => relanceRows(outings ?? [], statuses), [outings, statuses]);

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

  return {
    opened: relanceOpened,
    open,
    load,
    stop,
    resume,
    outings,
    phase,
    progress,
    error,
    rosterErrors,
    statusFailures,
    loading,
    verifying,
    filter,
    setFilter,
    ignoredList,
    ignoreError,
    setIgnore,
    counts,
    active,
    shown,
    picked,
    selected,
    allShownPicked,
    toggle,
    toggleAll,
    reminder,
    setReminder,
    /** Envoi de relances en cours (la fenêtre ne se ferme pas). */
    reminderSending: () => reminderBusy.current,
    setReminderSending: (busy: boolean) => {
      reminderBusy.current = busy;
    },
  };
}

export type Relance = ReturnType<typeof useRelance>;
