import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BarChart3, FileDown, RefreshCw } from 'lucide-react';
import { vpdive, type CalendarEvent, type RosterEntry } from '../../services/vpdive';
import { appApi } from '../../services/appApi';
import { computeStats, dateFr, isDiveActivity, monthSeries, monthShort, presetRange, seasonPresetLabel, type PresetId, type StatEvent, type StatPerson, type StatStaff, type Stats } from '../../lib/stats';
import { Avatar } from '../Avatar';
import { Spinner } from '../Spinner';
import { GabianLoader } from '../Gabian';
import { message } from '../../lib/errors';
import { WEEKDAYS } from '../../lib/dates';
import { isRecord, sessionCache } from '../../lib/cache';
import { Dialog, DialogHeader } from '../Dialog';
import { SectionTitle } from '../SectionTitle';
import { MemberSheetButton } from '../member/MemberLink';

/**
 * Statistiques de la saison (super-admin) : sorties, plongeurs, niveaux,
 * âges, encadrement, sur une période (par défaut la saison en cours, depuis
 * le 1er septembre). Une personne inscrite sous plusieurs comptes VPDive
 * (même nom) compte une fois.
 * VPDive ne donne pas ses statistiques aux clubs : on relit l'agenda puis la
 * liste des inscrits de chaque sortie, une à une (la file du transport les espace). Une
 * sortie terminée ne change plus : sa liste est gardée sur l'appareil.
 */

type Preset = PresetId | 'custom';

// v2 : la liste garde aussi l'équipe non inscrite (pilote, DP désignés dans VPDive).
// v3 : chaque inscrit garde son jeton d'adhésion (uct), pour ouvrir sa fiche depuis les classements.
const CACHE_PREFIX = 'stats-roster:v3:';
const nf = new Intl.NumberFormat('fr-FR');
const n = (x: number) => nf.format(x);
const plural = (x: number, one: string, many: string) => `${n(x)} ${x > 1 ? many : one}`;

function toPerson(r: RosterEntry): StatPerson {
  return { id: r.id, name: r.name, ...(r.picture ? { picture: r.picture } : {}), ...(r.uct ? { uct: r.uct } : {}), age: r.age, levels: r.levels, training: r.training, roles: r.roles, waitingList: r.waitingList };
}
const finished = (e: CalendarEvent) => Date.parse(e.end || e.start) < Date.now() - 24 * 3600_000;
type Cached = { rows: StatPerson[]; staff: StatStaff[] };
/** Liste d'une sortie terminée, gardée sur l'appareil (elle ne change plus), sans limite de durée. */
const rosterCache = sessionCache(CACHE_PREFIX, Infinity, (v): v is Cached => isRecord(v) && Array.isArray(v.rows) && Array.isArray(v.staff), {
  field: '',
  storage: () => localStorage,
});

export function StatsPanel({ onClose, onSessionLost }: { onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const lastYear = new Date().getFullYear() - 1;
  const [preset, setPreset] = useState<Preset>('season');
  const [custom, setCustom] = useState(() => presetRange('season', new Date()));
  const range = preset === 'custom' ? custom : presetRange(preset, new Date());

  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [rosters, setRosters] = useState<Record<string, StatPerson[]>>({});
  const [staff, setStaff] = useState<Record<string, StatStaff[]>>({});
  /** DP choisis dans l'appli (Rôles de la sortie), par sortie : ils priment sur VPDive. */
  const [dpFromApp, setDpFromApp] = useState<Record<string, string[] | undefined>>({});
  /** Membres ajoutés dans l'appli sans inscription qui tiennent un rôle (DP désigné…), par sortie. */
  const [appMembers, setAppMembers] = useState<Record<string, StatStaff[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stopped, setStopped] = useState(false);
  const run = useRef(0);

  /** Listes des inscrits, une à une ; les sorties terminées déjà lues viennent du cache de l'appareil. */
  const readRosters = useCallback(
    async (list: CalendarEvent[], id: number) => {
      const todo = list.filter((e) => isDiveActivity(e.activity?.name ?? e.type?.name ?? '') && e.registeredCount > 0);
      let done = 0;
      setStopped(false);
      setProgress({ done, total: todo.length });
      for (const e of todo) {
        if (id !== run.current) return;
        const cached = finished(e) ? rosterCache.read(e.token) : null;
        if (cached) {
          setRosters((r) => ({ ...r, [e.token]: cached.rows }));
          setStaff((r) => ({ ...r, [e.token]: cached.staff }));
        } else {
          try {
            const read = await vpdive.fetchRosterAndStaff(e.token, { priority: 'low' });
            if (id !== run.current) return;
            const rows = read.roster.map(toPerson);
            const crew: StatStaff[] = read.staff.map((x) => ({ id: x.id, name: x.name, ...(x.picture ? { picture: x.picture } : {}), roles: x.roles }));
            if (finished(e)) rosterCache.write(e.token, { rows, staff: crew });
            setRosters((r) => ({ ...r, [e.token]: rows }));
            setStaff((r) => ({ ...r, [e.token]: crew }));
          } catch (err) {
            if (onSessionLost(err) || id !== run.current) return;
            setError(`Lecture interrompue : ${message(err)}`);
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

  /** Tout repart de zéro : nouvelle période, ou « Réessayer ». */
  const resetStats = () => {
    setError(null);
    setEvents(null);
    setRosters({});
    setStaff({});
    setDpFromApp({});
    setAppMembers({});
    setProgress(null);
  };
  // Une période valable (du ≤ au) se lit ; une autre période valable remet tout à zéro dès ce rendu,
  // d'après la période du rendu précédent (pas dans l'effet qui lit).
  const validRange = !!(range.from && range.to && range.from <= range.to);
  const rangeKey = `${range.from}|${range.to}`;
  const [readRange, setReadRange] = useState(rangeKey);
  if (validRange && readRange !== rangeKey) {
    setReadRange(rangeKey);
    resetStats();
  }

  /** Lit l'agenda de la période, puis les inscrits : tout est posé par les rappels de la promesse. */
  const fetchStats = useCallback(() => {
    const id = ++run.current;
    const to = range.to < presetRange('year', new Date()).to ? range.to : presetRange('year', new Date()).to;
    return vpdive
      .fetchEvents(range.from, to)
      .then((all) => {
        const list = all.filter((e) => Date.parse(e.start) <= Date.now());
        if (id !== run.current) return;
        setEvents(list);
        // Un seul appel au serveur de l'appli pour toutes les sorties ; sans réponse, VPDive seul.
        appApi
          .outingRoles(list.map((e) => e.token))
          .then(({ roles, members }) => {
            if (id !== run.current) return;
            setDpFromApp(Object.fromEntries(Object.entries(roles).map(([k, r]) => [k, r?.dp])));
            // Membre ajouté dans l'appli : son identifiant est « uct:<jeton d'adhésion> » (lib/outing.ts).
            setAppMembers(Object.fromEntries(Object.entries(members).map(([k, list]) => [k, list.map((m) => ({ ...m, ...(m.id.startsWith('uct:') ? { uct: m.id.slice(4) } : {}), roles: [] }))])));
          })
          .catch((e) => onSessionLost(e));
        return readRosters(list, id);
      })
      .catch((e: unknown) => {
        if (id !== run.current || onSessionLost(e)) return;
        setError(message(e));
      });
  }, [range.from, range.to, readRosters, onSessionLost]);
  /** « Réessayer » (agenda illisible) : tout repart de zéro et se relit. */
  const load = () => {
    resetStats();
    void fetchStats();
  };

  /** Invalide la lecture en cours : elle s'arrête à sa prochaine étape. */
  const cancelRun = useCallback(() => {
    run.current++;
  }, []);
  // Autre période (ou fermeture) : la lecture de l'ancienne s'arrête.
  useEffect(() => {
    if (validRange) void fetchStats();
    return cancelRun;
  }, [fetchStats, cancelRun, validRange]);

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
    // L'équipe hors inscrits : celle que VPDive désigne, plus les membres ajoutés dans l'appli (DP désigné sans inscription).
    const crew = Object.fromEntries(events.map((e) => [e.token, [...(staff[e.token] ?? []), ...(appMembers[e.token] ?? [])]]));
    return computeStats(statEvents, rosters, dpFromApp, crew);
  }, [events, rosters, dpFromApp, staff, appMembers]);

  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'error'>('idle');
  /** Le générateur de PDF n'est chargé qu'au premier clic ; une lecture en cours donne des chiffres partiels, dits dans le PDF. */
  const downloadPdf = async () => {
    if (!stats) return;
    setPdfState('busy');
    try {
      const { downloadStatsPdf } = await import('../../lib/statsPdf');
      const partial = stopped || progress ? (progress ? `Chiffres partiels : ${n(progress.done)} listes d’inscrits lues sur ${n(progress.total)}.` : 'Chiffres partiels.') : null;
      downloadStatsPdf(stats, { from: range.from, to: range.to, partial });
      setPdfState('idle');
    } catch {
      setPdfState('error');
    }
  };

  const presets: { id: Preset; label: string }[] = [
    { id: 'season', label: seasonPresetLabel('season', new Date()) },
    { id: 'last-season', label: seasonPresetLabel('last-season', new Date()) },
    { id: 'year', label: 'Depuis janvier' },
    { id: '12m', label: '12 derniers mois' },
    { id: 'last-year', label: String(lastYear) },
    { id: 'custom', label: 'Dates' },
  ];

  return (
    <Dialog label="stats" onClose={onClose} titleId="stats-title" className="sm:max-w-5xl h-dvh sm:h-[92vh]">
      <DialogHeader
        titleId="stats-title"
        icon={<BarChart3 className="w-6 h-6 text-brand shrink-0" />}
        title="Statistiques"
        onClose={onClose}
        actions={
          <>
            {pdfState === 'error' && <span className="hidden sm:inline text-sm text-danger">PDF indisponible, réessayez</span>}
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={!stats || stats.outings === 0 || pdfState === 'busy'}
              aria-busy={pdfState === 'busy'}
              title={pdfState === 'error' ? 'PDF indisponible, réessayez' : 'Télécharger les statistiques en PDF'}
              className="btn btn-quiet sm:h-9 text-sm"
            >
              {pdfState === 'busy' ? <Spinner /> : <FileDown className="w-4 h-4" />} PDF
            </button>
          </>
        }
      />

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
                  className="tab-pill px-3 rounded-md"
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <label className="inline-flex items-center gap-2">
                  du
                  <input
                    type="date"
                    aria-label="Date de début"
                    value={custom.from}
                    max={custom.to}
                    onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
                    className="field sm:h-9 py-0"
                  />
                </label>
                <label className="inline-flex items-center gap-2">
                  au
                  <input
                    type="date"
                    aria-label="Date de fin"
                    value={custom.to}
                    min={custom.from}
                    onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                    className="field sm:h-9 py-0"
                  />
                </label>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-danger">
              <span className="flex-1 min-w-0">{error}</span>
              <button type="button" onClick={stopped ? resume : () => void load()} className="btn btn-quiet sm:h-9 text-sm">
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}

          {!stats ? (
            !error && <GabianLoader label="Lecture de l’agenda…" className="py-16" />
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
                      <button type="button" onClick={stop} className="btn btn-quiet sm:h-8 text-sm">
                        Arrêter
                      </button>
                    </>
                  ) : (
                    <>
                      <span>Lecture arrêtée : chiffres partiels.</span>
                      <button type="button" onClick={resume} className="btn btn-quiet sm:h-8 text-sm">
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
    </Dialog>
  );
}

function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // Titre de carte en bandeau rose (coins droits, la carte les arrondit), le contenu dessous.
    <section className={`card overflow-hidden ${className}`}>
      <SectionTitle flush hint={aside && <span className="tabular-nums">{aside}</span>}>
        {title}
      </SectionTitle>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Un chiffre mis en avant dans la phrase d'en-tête. */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-brand tabular-nums">{children}</strong>;
}

/** La saison en une phrase : les chiffres dans le texte, pas dans des cartes. */
function Hero({ stats, from, to }: { stats: Stats; from: string; to: string }) {
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
      {stats.merged.length > 0 && (
        <p className="mt-1 text-sm text-muted">
          Comptes fusionnés (même personne, plusieurs comptes VPDive) : {stats.merged.map((m) => `${m.name} (${m.accounts} comptes)`).join(', ')}.
        </p>
      )}

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
            <p className="mt-3 text-sm text-muted">Autres écoles : {stats.otherSchools.map((x) => `${x.label} ${n(x.count)}`).join(', ')}.</p>
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
          En formation : {stats.training.map((t, i) => `${i ? ', ' : ''}${n(t.count)} vers le ${t.label}`).join('')}.
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
      <div className="flex items-end gap-1.5 h-40" role="img" aria-label={months.map((m) => `${monthShort(m.key)} : ${m.outings} sorties, ${m.places} places`).join(' ; ')}>
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
            {/* Sur téléphone, douze mois ne tiennent qu'en initiales (J F M A…). */}
            <span className="sm:hidden">{monthShort(m.key).charAt(0).toUpperCase()}</span>
            <span className="hidden sm:inline">{monthShort(m.key)}</span>
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
              <Avatar name={r.name} picture={r.picture} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 inline-flex items-center gap-1">
                    <span className="truncate text-ink">{r.name}</span>
                    <MemberSheetButton member={r.uct ? { uct: r.uct, name: r.name, picture: r.picture } : null} size="sm" className="-my-1.5" />
                  </span>
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

