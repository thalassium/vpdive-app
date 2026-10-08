import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vpdive, ymd, type CalendarEvent } from '../../services/vpdiveApi';
import { AgendaList } from '../StandardCalendar';

type Filter = 'all' | 'practice' | 'theory' | 'stages';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'practice', label: 'Pratique' },
  { key: 'theory', label: 'Théorie' },
  { key: 'stages', label: 'Stages et examens' },
];

/** Nom d'activité en minuscules, sans accents (« Cours théorique » → « cours theorique »). */
const activityKey = (ev: CalendarEvent) =>
  (ev.activity?.name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Noms traduits par vpdiveApi (« Cours pratique », « Stage pratique », « Examen »…), clés anglaises aussi au cas où.
const IS_COURSE = /cours|stage|exam|formation|course|internship|training|theor|pratique/;
const IS_STAGE = /stage|internship|exam/;

function matches(filter: Filter, key: string) {
  switch (filter) {
    case 'theory':
      return /theor/.test(key);
    case 'practice':
      return /pratique|practical/.test(key) && !/stage|internship/.test(key);
    case 'stages':
      return IS_STAGE.test(key);
    default:
      return true;
  }
}

const eventDay = (ev: CalendarEvent) => ymd(new Date(ev.start));
const monthLabel = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

/** Sorties groupées par jour, pour AgendaList (colonne de date, puis une ligne par cours). */
function groupByDay(events: CalendarEvent[]) {
  const byDay: Record<string, CalendarEvent[]> = {};
  for (const ev of events) (byDay[eventDay(ev)] ??= []).push(ev);
  return { dates: Object.keys(byDay).sort(), byDay };
}

export function CoursesView({ onOpenEvent, onSessionLost }: { onOpenEvent: (ev: CalendarEvent) => void; onSessionLost: (e: unknown) => boolean }) {
  const [courses, setCourses] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setCourses(null);
    setError(null);
    try {
      const to = new Date();
      to.setDate(to.getDate() + 120);
      const events = await vpdive.fetchEvents(ymd(new Date()), ymd(to));
      if (id !== request.current) return;
      setCourses(events.filter((ev) => IS_COURSE.test(activityKey(ev))));
    } catch (e) {
      if (id !== request.current || onSessionLost(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onSessionLost]);

  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);

  const shown = useMemo(() => (courses ?? []).filter((ev) => matches(filter, activityKey(ev))), [courses, filter]);
  const mine = shown.filter((ev) => ev.registered);
  const months = useMemo(() => {
    const out: [string, CalendarEvent[]][] = [];
    for (const ev of shown) {
      if (ev.registered) continue;
      const month = eventDay(ev).slice(0, 7);
      const last = out[out.length - 1];
      if (last && last[0] === month) last[1].push(ev);
      else out.push([month, [ev]]);
    }
    return out;
  }, [shown]);
  const todayStr = ymd(new Date());

  const agenda = (events: CalendarEvent[]) => {
    const { dates, byDay } = groupByDay(events);
    return <AgendaList dates={dates} byDay={byDay} meteoData={{}} todayStr={todayStr} onOpenEvent={onOpenEvent} />;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl font-semibold text-brand">Cours</h1>
      <div aria-hidden className="isobath bg-line mt-2 mb-5" />

      <div className="max-w-full overflow-x-auto">
        <div role="group" aria-label="Type de cours" className="inline-flex rounded-lg border border-field-border bg-surface p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`h-9 px-3 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                filter === f.key ? 'bg-tint text-brand' : 'text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3">
            <p className="text-danger flex-1 min-w-0">{error}</p>
            <button type="button" onClick={load} className="btn btn-quiet">
              Réessayer
            </button>
          </div>
        ) : courses === null ? (
          <div aria-hidden className="card divide-y divide-line overflow-hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse bg-raised" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="text-muted">Aucun cours programmé dans les quatre prochains mois.</p>
        ) : (
          <div className="space-y-8">
            {mine.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-brand mb-2">Mes cours</h2>
                {agenda(mine)}
              </section>
            )}
            {months.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-brand mb-2">À venir</h2>
                <div className="space-y-4">
                  {months.map(([month, events]) => (
                    <div key={month}>
                      <h3 className="label mb-1.5 px-1">{monthLabel(month)}</h3>
                      {agenda(events)}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
