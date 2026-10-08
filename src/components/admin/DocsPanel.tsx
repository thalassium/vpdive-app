import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Mail, MessageCircle, RefreshCw, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { ThemeToggle } from '../ThemeToggle';
import { vpdive, ymd, type RosterEntry } from '../../services/vpdiveApi';
import { appApi } from '../../services/appApi';
import { bulkReminderText, checkDocs, reminderText, type DocIssue, type DocKind, type DocsStatus } from '../../lib/docsCheck';

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

type Filter = 'all' | DocKind;
type Phase = 'events' | 'rosters' | 'status' | 'stopped' | 'done' | 'error';

const DAYS_AHEAD = 60;
const ROSTER_GAP_MS = 400;
const STATUS_GAP_MS = 500;
const SEND_GAP_MS = 400;
const CACHE_TTL_MS = 6 * 3600_000;
/** Erreurs d'affilée sur les fiches membres avant de s'arrêter (pare-feu de VPDive). */
const MAX_FAILURES = 3;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** « sam. 11 oct. » */
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

const cacheKey = (uct: string) => `docs-status:${uct}`;
function readCache(uct: string): DocsStatus | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(uct));
    if (!raw) return null;
    const { at, status } = JSON.parse(raw) as { at: number; status: DocsStatus };
    return Date.now() - at < CACHE_TTL_MS && status && Array.isArray(status.seasons) && Array.isArray(status.licences) ? status : null;
  } catch {
    return null;
  }
}
function writeCache(uct: string, status: DocsStatus) {
  try {
    sessionStorage.setItem(cacheKey(uct), JSON.stringify({ at: Date.now(), status }));
  } catch {
    // Navigation privée ou stockage plein : on relira la fiche la prochaine fois.
  }
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'caci', label: 'CACI' },
  { key: 'licence', label: 'Licence' },
  { key: 'adhesion', label: 'Adhésion' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const hasKind = (r: Row, kind: DocKind) => r.issues.some((i) => i.kind === kind && i.level !== 'muted');

/**
 * Documentation (admin) : chaque membre inscrit à une sortie des 60 prochains
 * jours dont le dossier VPDive n'est pas en règle à la date de la sortie
 * (règles dans lib/docsCheck.ts), avec relance par e-mail ou dans l'appli.
 *
 * VPDive a un pare-feu qui bloque les rafales : tout est lu l'un après l'autre,
 * avec une pause, et les fiches membres sont gardées 6 h dans la session.
 */
export function DocsPanel({ me, onClose, onSessionLost }: Props) {
  const [outings, setOutings] = useState<Outing[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, DocsStatus>>({});
  const [phase, setPhase] = useState<Phase>('events');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [rosterErrors, setRosterErrors] = useState<string[]>([]);
  const [statusFailures, setStatusFailures] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
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
      const c = readCache(u);
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
    for (const [i, uct] of todo.entries()) {
      if (i > 0) await wait(STATUS_GAP_MS);
      if (run.current !== id) return;
      try {
        const status = await vpdive.memberStatus(uct);
        if (run.current !== id) return;
        writeCache(uct, status);
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
        if (++failures >= MAX_FAILURES) {
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
        if (i > 0) await wait(ROSTER_GAP_MS);
        if (run.current !== id) return;
        const date = ev.start.slice(0, 10);
        try {
          const roster = await vpdive.fetchRoster(ev.token);
          if (run.current !== id) return;
          list.push({ token: ev.token, title: ev.title, date, roster });
          setOutings([...list]);
        } catch (e) {
          if (lost.current(e)) {
            run.current++;
            return;
          }
          errors.push(`${ev.title} (${dayLabel(date)}) : ${message(e)}`);
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

  useEffect(() => {
    load();
    return () => {
      run.current++;
    };
  }, [load]);

  const stop = () => {
    run.current++;
    setPhase('stopped');
  };
  const resume = () => {
    setError(null);
    if (outings) checkStatuses(outings, ++run.current);
  };

  // Escape ferme la relance si elle est ouverte, sinon le panneau.
  const reminderOpen = useRef(false);
  reminderOpen.current = reminder !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (reminderOpen.current) setReminder(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

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

  const counts = useMemo(
    () => ({ caci: rows.filter((r) => hasKind(r, 'caci')).length, licence: rows.filter((r) => hasKind(r, 'licence')).length, adhesion: rows.filter((r) => hasKind(r, 'adhesion')).length }),
    [rows],
  );
  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => hasKind(r, filter))), [rows, filter]);
  const picked = rows.filter((r) => selected.has(r.key));
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
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="docs-title" className="relative bg-surface w-full sm:max-w-5xl h-dvh sm:h-[92vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop">
        <header className="relative border-t-[3px] border-pink border-b border-line px-5 sm:px-6 pt-4 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="label block mb-0.5">Admin</span>
              <h2 id="docs-title" className="text-xl font-semibold text-brand leading-snug flex items-center gap-2">
                <FileText className="w-6 h-6 text-brand" /> Documentation
              </h2>
              <p className="mt-1 text-sm text-muted">Inscrits des {DAYS_AHEAD} prochains jours dont le dossier VPDive n’est pas en règle à la date de la sortie.</p>
            </div>
            <div className="flex items-center gap-1 -mr-2 -mt-1 shrink-0">
              <ThemeToggle />
              <button onClick={onClose} aria-label="Fermer" className="icon-btn">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          {outings && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
                    className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-4 py-3 space-y-3">
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
                  <button type="button" onClick={stop} className="btn btn-quiet h-9 text-sm">
                    Arrêter
                  </button>
                </>
              )}
              {phase === 'stopped' && (
                <>
                  <span>
                    Vérification arrêtée : {progress.done}/{progress.total} fiches lues.
                  </span>
                  <button type="button" onClick={resume} className="btn btn-quiet h-9 text-sm">
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
              <button type="button" onClick={phase === 'stopped' ? resume : load} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}
          {rosterErrors.length > 0 && (
            <div role="alert" className="px-1 text-sm text-danger">
              <p className="flex flex-wrap items-center gap-x-3">
                <span className="font-semibold">Inscrits illisibles pour {plural(rosterErrors.length, 'sortie', 'sorties')} :</span>
                {!loading && (
                  <button type="button" onClick={load} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
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
          {statusFailures > 0 && phase !== 'stopped' && (
            <p className="px-1 text-sm text-muted">{plural(statusFailures, 'fiche membre illisible', 'fiches membres illisibles')} : adhésion non vérifiée.</p>
          )}

          {outings && phase === 'done' && rows.length === 0 && (
            <p className="py-10 text-center text-muted">
              {outings.length === 0 ? `Aucune sortie avec des inscrits dans les ${DAYS_AHEAD} prochains jours.` : 'Tous les inscrits sont en règle.'}
            </p>
          )}
          {outings && rows.length > 0 && shown.length === 0 && <p className="py-10 text-center text-muted">Personne n’est concerné par ce document.</p>}

          {shown.length > 0 && (
            <ul className="space-y-2">
              {shown.map((r) => (
                <MemberCard key={r.key} row={r} checked={selected.has(r.key)} onToggle={() => toggle(r.key)} onRemind={() => setReminder({ rows: [r], bulk: false })} />
              ))}
            </ul>
          )}
        </div>

        {rows.length > 0 && (
          <div className="sticky bottom-0 shrink-0 bg-surface border-t border-line px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-base text-ink font-medium">{plural(picked.length, 'sélectionné', 'sélectionnés')}</span>
            <button type="button" onClick={toggleAll} className="btn btn-quiet h-9 text-sm">
              {allShownPicked ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
            <button type="button" disabled={picked.length === 0} onClick={() => setReminder({ rows: picked, bulk: true })} className="btn btn-primary ml-auto">
              Relancer la sélection
            </button>
          </div>
        )}

        {reminder && <ReminderSheet key={reminder.rows.map((r) => r.key).join()} {...reminder} me={me} onClose={() => setReminder(null)} onSessionLost={onSessionLost} />}
      </div>
    </div>
  );
}

function IssueChip({ issue }: { issue: DocIssue }) {
  const tone = issue.level === 'red' ? 'bg-danger-soft text-danger font-semibold' : issue.level === 'yellow' ? 'bg-warn-soft text-warn font-semibold' : 'text-muted';
  return <span className={`rounded-md px-1.5 text-sm ${tone}`}>{issue.text}</span>;
}

function MemberCard({ row, checked, onToggle, onRemind }: { row: Row; checked: boolean; onToggle: () => void; onRemind: () => void }) {
  const [next, ...others] = row.concerns;
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
          {next && (
            <span className="mt-1 block text-sm text-muted">
              {dayLabel(next.outing.date)} · {next.outing.title}
              {next.waitingList && ' (liste d’attente)'}
              {others.length > 0 && (
                <span title={others.map((c) => `${dayLabel(c.outing.date)} · ${c.outing.title}`).join('\n')}>
                  {' '}
                  + {plural(others.length, 'autre sortie', 'autres sorties')} ({others.map((c) => dayLabel(c.outing.date)).join(', ')})
                </span>
              )}
            </span>
          )}
        </span>
      </label>
      <button type="button" onClick={onRemind} className="btn btn-quiet h-9 text-sm shrink-0">
        Relancer
      </button>
    </li>
  );
}

/** Relance : texte modifiable, envoyé par e-mail (mailto:) ou dans la messagerie de l'appli. */
function ReminderSheet({ rows, bulk, me, onClose, onSessionLost }: { rows: Row[]; bulk: boolean; me: Me; onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const first = rows[0]!;
  const next = first.concerns[0]!;
  const [text, setText] = useState(() =>
    bulk
      ? bulkReminderText({ year: next.outing.date.slice(0, 4), from: me.name })
      : reminderText({
          firstName: first.firstname,
          date: dayLabel(next.outing.date),
          title: next.outing.title,
          kinds: first.issues.filter((i) => i.level !== 'muted').map((i) => i.kind),
          year: next.outing.date.slice(0, 4),
          from: me.name,
        }),
  );
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ sent: number; errors: string[] } | null>(null);

  const withEmail = rows.filter((r) => r.email);
  const noEmail = rows.filter((r) => !r.email);
  const subject = bulk ? 'Ton dossier VPDive pour les prochaines sorties' : `Ton dossier VPDive pour la sortie du ${dayLabel(next.outing.date)}`;
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const mailHref = bulk
    ? `mailto:?bcc=${withEmail.map((r) => encodeURIComponent(r.email)).join(',')}&${query}`
    : `mailto:${encodeURIComponent(first.email)}?${query}`;

  const sendInApp = async () => {
    const errors: string[] = [];
    let sent = 0;
    setResult(null);
    setSending({ done: 0, total: rows.length });
    for (const [i, r] of rows.entries()) {
      if (i > 0) await wait(SEND_GAP_MS);
      if (!r.uct) {
        errors.push(`${r.name} : pas de compte d’adhérent connu`);
      } else {
        try {
          const conv = await appApi.chatNew([{ uct: r.uct, name: r.name, picture: r.picture }], { name: me.name, picture: me.picture });
          await appApi.chatSend(conv.id, text);
          sent++;
        } catch (e) {
          if (onSessionLost(e)) return;
          errors.push(`${r.name} : ${message(e)}`);
        }
      }
      setSending({ done: i + 1, total: rows.length });
    }
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
                {dayLabel(next.outing.date)} · {next.outing.title}
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
            Sans e-mail : <span className="text-ink">{noEmail.map((r) => r.name).join(', ')}</span>
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
          <button type="button" onClick={sendInApp} disabled={!!sending || !text.trim()} className="btn btn-primary">
            <MessageCircle className="w-4 h-4" /> {sending ? `Envoi… ${sending.done}/${sending.total}` : 'Envoyer dans l’appli'}
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
