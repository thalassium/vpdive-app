import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, FileDown, Loader2, RefreshCw, X } from 'lucide-react';
import { vpdive, type CalendarEvent, type RosterEntry } from '../../services/vpdiveApi';
import { appApi } from '../../services/appApi';
import { computeStats, dateFr, isDiveActivity, monthSeries, monthShort, presetRange, type StatEvent, type StatPerson, type StatStaff, type Stats } from '../../lib/stats';
import { Avatar } from '../Avatar';
import { ThemeToggle } from '../ThemeToggle';
import { useDialog } from '../../hooks/useDialog';

/**
 * Statistiques de la saison (super-admin) : sorties, plongeurs, niveaux,
 * âges, encadrement, sur une période (par défaut depuis le 1er janvier).
 * VPDive ne donne pas ses statistiques aux clubs : on relit l'agenda puis la
 * liste des inscrits de chaque sortie, une à une et espacées (pare-feu). Une
 * sortie terminée ne change plus : sa liste est gardée sur l'appareil.
 */

type Preset = 'year' | '12m' | 'last-year' | 'custom';

const GAP_MS = 400;
// v2 : la liste garde aussi l'équipe non inscrite (pilote, DP désignés dans VPDive).
const CACHE_PREFIX = 'stats-roster:v2:';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nf = new Intl.NumberFormat('fr-FR');
const n = (x: number) => nf.format(x);
const plural = (x: number, one: string, many: string) => `${n(x)} ${x > 1 ? many : one}`;

function toPerson(r: RosterEntry): StatPerson {
  return { id: r.id, name: r.name, ...(r.picture ? { picture: r.picture } : {}), age: r.age, levels: r.levels, training: r.training, roles: r.roles, waitingList: r.waitingList };
}
const finished = (e: CalendarEvent) => Date.parse(e.end || e.start) < Date.now() - 24 * 3600_000;
type Cached = { rows: StatPerson[]; staff: StatStaff[] };
function readCache(token: string): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + token);
    return raw ? (JSON.parse(raw) as Cached) : null;
  } catch {
    return null;
  }
}
function writeCache(token: string, value: Cached) {
  try {
    localStorage.setItem(CACHE_PREFIX + token, JSON.stringify(value));
  } catch {
    // Stockage plein ou interdit : la liste sera relue la prochaine fois.
  }
}

export function StatsPanel({ onClose, onSessionLost }: { onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const { ref: dialogRef } = useDialog({ onClose, label: 'stats' });
  const lastYear = new Date().getFullYear() - 1;
  const [preset, setPreset] = useState<Preset>('year');
  const [custom, setCustom] = useState(() => presetRange('year', new Date()));
  const range = preset === 'custom' ? custom : presetRange(preset, new Date());

  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [rosters, setRosters] = useState<Record<string, StatPerson[]>>({});
  const [staff, setStaff] = useState<Record<string, StatStaff[]>>({});
  /** DP choisis dans l'appli (Rôles de la sortie), par sortie : ils priment sur VPDive. */
  const [dpFromApp, setDpFromApp] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopped, setStopped] = useState(false);
  const run = useRef(0);

  /** Listes des inscrits, une à une ; les sorties terminées déjà lues viennent du cache de l'appareil. */
  const readRosters = useCallback(
    async (list: CalendarEvent[], id: number) => {
      const todo = list.filter((e) => isDiveActivity(e.activity?.name ?? e.type?.name ?? '') && e.registeredCount > 0);
      let done = 0;
      let fetched = false;
      setStopped(false);
      setProgress({ done, total: todo.length });
      for (const e of todo) {
        if (id !== run.current) return;
        const cached = finished(e) ? readCache(e.token) : null;
        if (cached) {
          setRosters((r) => ({ ...r, [e.token]: cached.rows }));
          setStaff((r) => ({ ...r, [e.token]: cached.staff }));
        } else {
          if (fetched) await wait(GAP_MS);
          if (id !== run.current) return;
          try {
            const read = await vpdive.fetchRosterAndStaff(e.token);
            const rows = read.roster.map(toPerson);
            const crew: StatStaff[] = read.staff.map((x) => ({ id: x.id, name: x.name, ...(x.picture ? { picture: x.picture } : {}), roles: x.roles }));
            fetched = true;
            if (finished(e)) writeCache(e.token, { rows, staff: crew });
            setRosters((r) => ({ ...r, [e.token]: rows }));
            setStaff((r) => ({ ...r, [e.token]: crew }));
          } catch (err) {
            if (onSessionLost(err)) return;
            setError(`Lecture interrompue : ${message(err)}`);
            setStopped(true);
            return;
          }
        }
        setProgress({ done: ++done, total: todo.length });
      }
      if (id === run.current) setProgress(null);
    },
    [onSessionLost],
  );

  const load = useCallback(async () => {
    const id = ++run.current;
    setError(null);
    setEvents(null);
    setRosters({});
    setStaff({});
    setDpFromApp({});
    setProgress(null);
    try {
      const to = range.to < presetRange('year', new Date()).to ? range.to : presetRange('year', new Date()).to;
      const list = (await vpdive.fetchEvents(range.from, to)).filter((e) => Date.parse(e.start) <= Date.now());
      if (id !== run.current) return;
      setEvents(list);
      // Un seul appel au serveur de l'appli pour toutes les sorties ; sans réponse, VPDive seul.
      appApi
        .outingRoles(list.map((e) => e.token))
        .then((roles) => id === run.current && setDpFromApp(Object.fromEntries(Object.entries(roles).map(([k, r]) => [k, r?.dp]))))
        .catch((e) => onSessionLost(e));
      await readRosters(list, id);
    } catch (e) {
      if (id !== run.current || onSessionLost(e)) return;
      setError(message(e));
    }
  }, [range.from, range.to, readRosters, onSessionLost]);

  useEffect(() => {
    if (range.from && range.to && range.from <= range.to) void load();
    return () => {
      run.current++;
    };
  }, [load, range.from, range.to]);

  const stop = () => {
    run.current++;
    setStopped(true);
  };
  const resume = () => {
    if (!events) return void load();
    const id = ++run.current;
    setError(null);
    void readRosters(events, id);
  };

  const stats = useMemo<Stats | null>(() => {
    if (!events) return null;
    const statEvents: StatEvent[] = events.map((e) => ({
      token: e.token,
      start: e.start,
      activity: e.activity?.name ?? e.type?.name ?? 'Sortie',
      registered: e.registeredCount,
      max: e.maxParticipants,
    }));
    return computeStats(statEvents, rosters, dpFromApp, staff);
  }, [events, rosters, dpFromApp, staff]);

  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'error'>('idle');
  /** Le générateur de PDF n'est chargé qu'au premier clic ; une lecture en cours donne des chiffres partiels, dits dans le PDF. */
  const downloadPdf = async () => {
    if (!stats) return;
    setPdfState('busy');
    try {
      const { downloadStatsPdf } = await import('../../lib/statsPdf');
      const partial = stopped || progress ? (progress ? `Chiffres partiels : ${n(progress.done)} listes d’inscrits lues sur ${n(progress.total)}.` : 'Chiffres partiels.') : null;
      downloadStatsPdf(stats, { from: range.from, to: range.to, partial });
      setPdfState('idle');
    } catch {
      setPdfState('error');
    }
  };

  const presets: { id: Preset; label: string }[] = [
    { id: 'year', label: 'Depuis janvier' },
    { id: '12m', label: '12 derniers mois' },
    { id: 'last-year', label: String(lastYear) },
    { id: 'custom', label: 'Dates' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        className="relative bg-surface w-full sm:max-w-5xl h-dvh sm:h-[92vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        <header className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-brand shrink-0" />
          <h2 id="stats-title" className="text-xl font-semibold text-brand flex-1">
            Statistiques
          </h2>
          {pdfState === 'error' && <span className="hidden sm:inline text-sm text-danger">PDF indisponible, réessayez</span>}
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={!stats || stats.outings === 0 || pdfState === 'busy'}
            title={pdfState === 'error' ? 'PDF indisponible, réessayez' : 'Télécharger les statistiques en PDF'}
            className="btn btn-quiet h-9 text-sm"
          >
            {pdfState === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF
          </button>
          <ThemeToggle />
          <button onClick={onClose} aria-label="Fermer" className="icon-btn -mr-2">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-canvas">
          <div className="px-4 sm:px-6 py-5 space-y-5">
            {/* Période */}
            <div className="flex flex-wrap items-center gap-3">
              <div role="radiogroup" aria-label="Période" className="inline-flex flex-wrap rounded-lg border border-field-border bg-surface p-1">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={preset === p.id}
                    onClick={() => {
                      if (p.id === 'custom') setCustom(range);
                      setPreset(p.id);
                    }}
                    className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${preset === p.id ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {preset === 'custom' && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <label className="inline-flex items-center gap-2">
                    du
                    <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="field h-9 py-0" />
                  </label>
                  <label className="inline-flex items-center gap-2">
                    au
                    <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="field h-9 py-0" />
                  </label>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="flex flex-wrap items-center gap-3 text-danger">
                <span className="flex-1 min-w-0">{error}</span>
                <button type="button" onClick={stopped ? resume : () => void load()} className="btn btn-quiet h-9 text-sm">
                  <RefreshCw className="w-4 h-4" /> Réessayer
                </button>
              </div>
            )}

            {!stats ? (
              !error && <p className="py-16 text-center text-muted">Lecture de l’agenda…</p>
            ) : stats.outings === 0 ? (
              <p className="py-16 text-center text-muted">Aucune sortie sur cette période.</p>
            ) : (
              <>
                <Hero stats={stats} from={range.from} to={range.to} />

                {(progress || stopped) && !error && (
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted" aria-live="polite">
                    {progress && !stopped ? (
                      <>
                        <span className="tabular-nums">
                          Lecture des inscrits… {progress.done}/{progress.total}
                        </span>
                        <span aria-hidden className="h-1 w-32 rounded-full bg-line overflow-hidden">
                          <span className="block h-full bg-fill transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                        </span>
                        <button type="button" onClick={stop} className="btn btn-quiet h-8 text-sm">
                          Arrêter
                        </button>
                      </>
                    ) : (
                      <>
                        <span>Lecture arrêtée : chiffres partiels.</span>
                        <button type="button" onClick={resume} className="btn btn-quiet h-8 text-sm">
                          <RefreshCw className="w-4 h-4" /> Reprendre
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
                  <LevelsSection stats={stats} />
                  <div className="space-y-5">
                    <SeasonSection stats={stats} from={range.from} to={range.to} />
                    <AgesSection stats={stats} />
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  <Ranking title="Directeurs de plongée" rows={stats.directors} unit="sortie" note={`DP connu pour ${plural(stats.dpKnown.known, 'sortie', 'sorties')} sur ${n(stats.dpKnown.of)}.`} />
                  <Ranking title="Encadrants" rows={stats.instructors} unit="sortie" />
                  <Ranking title="Les plus assidus" rows={stats.regulars} unit="sortie" className="md:col-span-2 lg:col-span-1" />
                </div>

                <div className="grid gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <ActivitiesSection stats={stats} />
                  <WeekdaysSection stats={stats} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mb-4">
        <h3 className="text-lg font-semibold text-brand">{title}</h3>
        {aside && <span className="text-sm text-muted tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** La saison en une phrase : les chiffres dans le texte, pas dans des cartes. */
function Hero({ stats, from, to }: { stats: Stats; from: string; to: string }) {
  const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-brand tabular-nums">{children}</strong>;
  const others = stats.outings - stats.diveOutings;
  return (
    <div className="max-w-3xl">
      <p className="text-2xl leading-snug text-ink">
        Du {dateFr(from)} au {dateFr(to)}, <B>{plural(stats.diveOutings, 'sortie', 'sorties')}</B> de plongée, <B>{plural(stats.places, 'place', 'places')}</B> réservées et{' '}
        <B>{plural(stats.divers, 'plongeur', 'plongeurs')}</B> différents.
      </p>
      <p className="mt-2 text-base text-muted">
        {others > 0 && `${plural(others, 'autre événement', 'autres événements')} (réunions, cours théoriques…). `}
        {stats.fill !== null && `Remplissage moyen ${Math.round(stats.fill * 100)} %. `}
        {stats.waiting > 0 && `${plural(stats.waiting, 'inscription', 'inscriptions')} en liste d’attente.`}
      </p>
    </div>
  );
}

/** Teintes des niveaux, de la surface vers le fond (sans profondeur affichée). */
const LEVEL_TINTS = ['var(--sea-6)', 'var(--sea-12)', 'var(--sea-20)', 'var(--sea-40)', 'var(--sea-60)'];
const levelTint = (i: number, count: number) => LEVEL_TINTS[Math.min(LEVEL_TINTS.length - 1, Math.floor((i / Math.max(1, count - 1)) * (LEVEL_TINTS.length - 1)))]!;

/**
 * Les plongeurs de la période, répartis sans reste : la barre du haut retombe
 * sur le total de la phrase d'en-tête. Puis les niveaux de plongeur, et
 * l'encadrement du E4 au GP.
 */
function LevelsSection({ stats }: { stats: Stats }) {
  const g = stats.groups;
  const total = Math.max(1, g.divers + g.staff + g.otherSchool + g.none);
  const parts = [
    { label: 'plongeurs', count: g.divers, color: 'var(--sea-20)' },
    { label: 'encadrants', count: g.staff, color: 'var(--fill)' },
    { label: 'brevet d’une autre école', count: g.otherSchool, color: 'var(--chart)' },
    { label: 'sans niveau dans VPDive', count: g.none, color: 'var(--line)' },
  ].filter((x) => x.count > 0);
  const max = Math.max(1, ...stats.levels.map((l) => l.count));
  const staffMax = Math.max(1, ...stats.staff.map((x) => x.count));
  return (
    <Section title="Niveaux" aside={plural(stats.divers, 'plongeur', 'plongeurs')}>
      <div className="flex h-3 rounded-full overflow-hidden" role="img" aria-label={parts.map((x) => `${x.count} ${x.label}`).join(', ')}>
        {parts.map((x) => (
          <span key={x.label} style={{ width: `${(x.count / total) * 100}%`, background: x.color }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((x) => (
          <li key={x.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: x.color }} />
            <span className="font-semibold tabular-nums text-ink">{n(x.count)}</span>
            <span className="text-muted">{x.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        <div>
          <h4 className="text-sm font-semibold text-ink mb-2">Plongeurs</h4>
          <ul className="space-y-2">
            {stats.levels.map((l, i) => (
              <li key={l.label} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-semibold text-brand truncate">{l.label}</span>
                <span className="flex-1 min-w-0 h-6 flex items-center gap-2">
                  <span className="h-full rounded-md transition-[width] duration-500" style={{ width: `max(calc(${(l.count / max) * 100}% - 2.5rem), 0.75rem)`, background: levelTint(i, stats.levels.length) }} aria-hidden />
                  <span className="text-sm font-semibold tabular-nums text-ink">{n(l.count)}</span>
                </span>
              </li>
            ))}
          </ul>
          {stats.otherSchools.length > 0 && (
            <p className="mt-3 text-sm text-muted">Autres écoles : {stats.otherSchools.map((x) => `${x.label} ${n(x.count)}`).join(', ')}.</p>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-ink mb-2">Encadrement</h4>
          <ul className="space-y-2">
            {stats.staff.map((x) => (
              <li key={x.level} className="flex items-center gap-2">
                <span className="w-7 text-sm font-semibold tabular-nums text-brand">{x.level}</span>
                <span className="flex-1 h-2 rounded-full bg-line overflow-hidden" aria-hidden>
                  <span className="block h-full bg-fill rounded-full" style={{ width: `${(x.count / staffMax) * 100}%` }} />
                </span>
                <span className="w-7 text-right text-sm tabular-nums text-ink">{n(x.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {stats.training.length > 0 && (
        <p className="mt-4 text-base text-ink">
          En formation : {stats.training.map((t, i) => `${i ? ', ' : ''}${n(t.count)} vers le ${t.label}`).join('')}.
        </p>
      )}
    </Section>
  );
}

/** Sorties de plongée par mois ; le mois le plus chargé en rose. */
function SeasonSection({ stats, from, to }: { stats: Stats; from: string; to: string }) {
  const months = monthSeries(stats.months, from, to);
  const max = Math.max(1, ...months.map((m) => m.outings));
  const tops = months.filter((m) => m.outings === max);
  const peak = tops.length === 1 ? tops[0] : null;
  return (
    <Section title="Saison" aside="sorties par mois">
      <div className="flex items-end gap-1.5 h-40" role="img" aria-label={months.map((m) => `${monthShort(m.key)} : ${m.outings} sorties, ${m.places} places`).join(' ; ')}>
        {months.map((m) => (
          <div key={m.key} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" title={`${m.outings} sorties, ${m.places} places`}>
            <span className="text-sm font-semibold tabular-nums text-ink">{m.outings || ''}</span>
            <span className={`w-full max-w-10 rounded-t-md ${m === peak ? 'bg-pink' : 'bg-fill'}`} style={{ height: `${(m.outings / max) * 100}%`, minHeight: m.outings ? 4 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5 border-t border-line pt-1.5">
        {months.map((m) => (
          <span key={m.key} className="flex-1 min-w-0 text-center text-xs text-muted truncate">
            {monthShort(m.key)}
          </span>
        ))}
      </div>
    </Section>
  );
}

function AgesSection({ stats }: { stats: Stats }) {
  const { bins, median, minors, known } = stats.ages;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const medianBin = median === null ? -1 : bins.findIndex((b, i) => median >= b.from && median < (bins[i + 1]?.from ?? Infinity));
  return (
    <Section title="Âges" aside={median !== null ? `âge médian ${median} ans` : undefined}>
      {known === 0 ? (
        <p className="text-muted">Âges pas encore lus.</p>
      ) : (
        <>
          <div className="flex items-end gap-2 h-28">
            {bins.map((b, i) => (
              <div key={b.label} className="flex-1 h-full flex flex-col justify-end items-center gap-1">
                <span className="text-sm font-semibold tabular-nums text-ink">{b.count || ''}</span>
                <span className={`w-full rounded-t-md ${i === medianBin ? 'bg-fill' : 'bg-chart'}`} style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 4 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-1.5 border-t border-line pt-1.5">
            {bins.map((b) => (
              <span key={b.label} className="flex-1 text-center text-xs text-muted tabular-nums">
                {b.label}
              </span>
            ))}
          </div>
          {minors > 0 && <p className="mt-3 text-sm text-muted">{plural(minors, 'mineur', 'mineurs')} sur {n(known)}</p>}
        </>
      )}
    </Section>
  );
}

function Ranking({ title, rows, unit, note, className = '' }: { title: string; rows: Stats['regulars']; unit: string; note?: string; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Section title={title} aside="nombre de sorties" className={className}>
      {rows.length === 0 ? (
        <p className="text-muted">Personne pour l’instant.</p>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5">
              <Avatar name={r.name} picture={r.picture} size="sm" initials={false} />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-ink">{r.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted" title={plural(r.count, unit, `${unit}s`)}>
                    {n(r.count)}
                  </span>
                </span>
                <span className="mt-1 block h-1 rounded-full bg-line overflow-hidden" aria-hidden>
                  <span className="block h-full bg-fill rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {note && <p className="mt-3 text-sm text-muted">{note}</p>}
    </Section>
  );
}

const ACTIVITY_COLORS = ['var(--fill)', 'var(--sea-20)', 'var(--sea-6)', 'var(--chart)', 'var(--bubble)', 'var(--swell)', 'var(--line)'];

function ActivitiesSection({ stats }: { stats: Stats }) {
  const total = Math.max(1, stats.outings);
  return (
    <Section title="Événements" aside={`${n(stats.outings)} au total`}>
      <div className="flex h-4 rounded-full overflow-hidden" role="img" aria-label={stats.activities.map((a) => `${a.label} ${a.count}`).join(', ')}>
        {stats.activities.map((a, i) => (
          <span key={a.label} style={{ width: `${(a.count / total) * 100}%`, background: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length] }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {stats.activities.map((a, i) => (
          <li key={a.label} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length] }} />
            <span className="flex-1 min-w-0 truncate text-ink">{a.label}</span>
            <span className="tabular-nums text-muted">{n(a.count)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

function WeekdaysSection({ stats }: { stats: Stats }) {
  const max = Math.max(1, ...stats.weekdays);
  return (
    <Section title="Jours de plongée">
      <div className="flex items-end gap-1.5 h-24">
        {stats.weekdays.map((c, i) => (
          <div key={i} className="flex-1 h-full flex flex-col justify-end items-center gap-1">
            <span className="text-sm font-semibold tabular-nums text-ink">{c || ''}</span>
            <span className="w-full rounded-t-md bg-fill" style={{ height: `${(c / max) * 100}%`, minHeight: c ? 4 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5 border-t border-line pt-1.5">
        {WEEKDAYS.map((d) => (
          <span key={d} className="flex-1 text-center text-xs text-muted">
            {d}
          </span>
        ))}
      </div>
    </Section>
  );
}

