import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, RefreshCw, Wind, X } from 'lucide-react';
import { vpdive, ymd, type CalendarEvent } from '../../services/vpdiveApi';
import { SPOTS, forecastAt, type Spot } from '../../services/marineWeather';
import { SEUILS, beaufort, compass, level, metres, worstIn, type Level, type Slot } from '../../lib/marine';
import { ThemeToggle } from '../ThemeToggle';

const WeatherMap = lazy(() => import('./WeatherMap'));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const p2 = (n: number) => String(n).padStart(2, '0');
const HOURS = ['06', '09', '12', '15', '18', '21'] as const;
const PICKED_ID = 'carte';

/** Date locale → « 2026-10-11T09:00 ». */
const localKey = (d: Date) => `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** Date VPDive (locale, ou ISO avec fuseau) → « 2026-10-11T09:00 » local. */
function toLocal(s: string): string {
  if (!s) return '';
  if (/(Z|[+-]\d\d:?\d\d)$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : localKey(d);
  }
  return s.replace(' ', 'T').slice(0, 16);
}

/** « 2026-10-11T09:00 » ou « 2026-10-11 » → Date locale. */
function fromLocal(k: string): Date {
  const [d = '', t = '00:00'] = k.split('T');
  const [y = 1970, m = 1, day = 1] = d.split('-').map(Number);
  const [h = 0, mi = 0] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h || 0, mi || 0);
}

const fr = (n: number) => String(n).replace('.', ',');
const LEGEND =
  `Jaune : vent ≥ ${fr(SEUILS.jaune.vent)} nd, rafales ≥ ${fr(SEUILS.jaune.rafales)} nd ou vagues ≥ ${fr(SEUILS.jaune.vagues)} m` +
  ` · Rouge : ${fr(SEUILS.rouge.vent)} nd, ${fr(SEUILS.rouge.rafales)} nd, ${fr(SEUILS.rouge.vagues)} m`;

const DOT: Record<Level, string> = { ok: 'bg-ok', jaune: 'bg-warn', rouge: 'bg-danger' };
const LEVEL_NAME: Record<Level, string> = { ok: 'Favorable', jaune: 'Vigilance', rouge: 'Défavorable' };

function Dot({ lvl }: { lvl: Level | null }) {
  return (
    <span
      role="img"
      aria-label={lvl ? LEVEL_NAME[lvl] : 'Inconnu'}
      title={lvl ? LEVEL_NAME[lvl] : undefined}
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${lvl ? DOT[lvl] : 'bg-line'}`}
    />
  );
}

/** Teinte d'une valeur selon ses seuils jaune et rouge. */
function tone(v: number | null, jaune: number, rouge: number): string {
  if (v === null) return '';
  if (v >= rouge) return 'bg-danger-soft text-danger';
  if (v >= jaune) return 'bg-warn-soft text-warn';
  return '';
}
const windTone = (s: Slot) => tone(s.wind, SEUILS.jaune.vent, SEUILS.rouge.vent);
const gustTone = (s: Slot) => tone(s.gusts, SEUILS.jaune.rafales, SEUILS.rouge.rafales);
const waveTone = (s: Slot) => tone(s.waves, SEUILS.jaune.vagues, SEUILS.rouge.vagues);

function Arrow({ deg }: { deg: number }) {
  return <ArrowUp aria-hidden className="w-4 h-4 shrink-0" style={{ transform: `rotate(${deg + 180}deg)` }} />;
}

const swellText = (s: Slot) =>
  s.swell === null
    ? '–'
    : [metres(s.swell), s.swellPeriod !== null ? `${Math.round(s.swellPeriod)} s` : null, s.swellDir !== null ? compass(s.swellDir) : null]
        .filter(Boolean)
        .join(' · ');

function Failure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card p-4 flex flex-wrap items-center gap-3">
      <p className="flex-1 min-w-0 text-danger">{text}</p>
      <button type="button" onClick={onRetry} className="btn btn-quiet">
        <RefreshCw className="w-4 h-4" /> Réessayer
      </button>
    </div>
  );
}

/** Créneaux d'une sortie : la journée de plongée pour une sortie « journée ». */
function outingWindow(e: CalendarEvent): [string, string] {
  const start = toLocal(e.start);
  const day = start.slice(0, 10);
  if (e.allDay || start.length < 16) return [`${day}T06:00`, `${day}T21:00`];
  return [start, toLocal(e.end)];
}

/**
 * Météo (admin) : vent, rafales et mer sur 7 jours au point choisi, niveau de
 * chaque sortie VPDive de la semaine, carte des vagues Ifremer.
 */
export function WeatherPanel({ onClose, onSessionLost }: { onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [spotId, setSpotId] = useState<string>(SPOTS[0].id);
  const [picked, setPicked] = useState<Spot | null>(null);
  const spot: Spot = (spotId === PICKED_ID ? picked : null) ?? SPOTS.find((s) => s.id === spotId) ?? SPOTS[0];

  const days = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      out.push(ymd(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }, []);
  const [day, setDay] = useState(days[0]!);

  // Prévision au point choisi.
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSlots(null);
    setForecastError(null);
    forecastAt(spot.lat, spot.lon).then(
      (s) => live && setSlots(s),
      (e) => live && setForecastError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [spot.lat, spot.lon, attempt]);

  // Sorties de la semaine : un seul appel, indépendant de la prévision.
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const sessionLost = useRef(onSessionLost);
  useEffect(() => {
    sessionLost.current = onSessionLost;
  });
  const loadEvents = useCallback(async () => {
    setEventsError(null);
    setEvents(null);
    try {
      const list = await vpdive.fetchEvents(days[0]!, days[days.length - 1]!);
      setEvents(list);
    } catch (e) {
      if (sessionLost.current(e)) return;
      setEventsError(message(e));
    }
  }, [days]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const outings = useMemo(() => {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    return (events ?? [])
      .map((e) => ({ event: e, window: outingWindow(e) }))
      .filter(({ window: [a] }) => a.slice(0, 10) >= first && a.slice(0, 10) <= last)
      .sort((a, b) => a.window[0].localeCompare(b.window[0]));
  }, [events, days]);

  const dayLevel = useMemo(() => {
    const out = new Map<string, Level>();
    if (slots)
      days.forEach((d) => {
        const w = worstIn(slots, `${d}T06:00`, `${d}T21:00`);
        if (w) out.set(d, level(w));
      });
    return out;
  }, [slots, days]);

  const daySlots = useMemo(
    () =>
      HOURS.map((h) => slots?.find((s) => s.time === `${day}T${h}:00`)).filter((s): s is Slot => s !== undefined),
    [slots, day],
  );
  const water = useMemo(() => {
    const all = slots?.filter((s) => s.time.startsWith(day)) ?? [];
    const w = all.find((s) => s.time.endsWith('T12:00') && s.water !== null) ?? all.find((s) => s.water !== null);
    return w?.water ?? null;
  }, [slots, day]);

  const forecastRef = useRef<HTMLElement>(null);
  const showDay = (d: string) => {
    if (!days.includes(d)) return;
    setDay(d);
    forecastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onPick = useCallback((lat: number, lon: number) => {
    const known = SPOTS.find((s) => Math.abs(s.lat - lat) < 1e-6 && Math.abs(s.lon - lon) < 1e-6);
    if (known) {
      setSpotId(known.id);
      return;
    }
    setPicked({ id: PICKED_ID, name: 'Point sur la carte', lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });
    setSpotId(PICKED_ID);
  }, []);

  const spotChoices: Spot[] = picked ? [...SPOTS, picked] : [...SPOTS];

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-title"
        className="relative bg-surface w-full sm:max-w-5xl h-dvh sm:h-[92vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        <header className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3">
          <Wind className="w-6 h-6 text-brand shrink-0" />
          <h2 id="weather-title" className="text-xl font-semibold text-brand flex-1">
            Météo
          </h2>
          <ThemeToggle />
          <button onClick={onClose} aria-label="Fermer" className="icon-btn -mr-2">
            <X className="w-6 h-6" />
          </button>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-canvas">
          <div className="p-4 sm:p-5 space-y-5">
            {/* Lieu */}
            <section aria-label="Lieu">
              <div className="flex flex-wrap gap-1 rounded-lg border border-field-border bg-surface p-1 w-fit max-w-full">
                {spotChoices.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSpotId(s.id)}
                    aria-pressed={spot.id === s.id}
                    className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${
                      spot.id === s.id ? 'bg-tint text-brand' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </section>

            {/* Prochaines sorties */}
            <section className="card p-4 sm:p-5">
              <h3 className="text-lg font-semibold text-brand mb-2">Prochaines sorties</h3>
              {eventsError ? (
                <Failure text={eventsError} onRetry={loadEvents} />
              ) : !events ? (
                <p className="py-2 text-muted">Chargement des sorties…</p>
              ) : outings.length === 0 ? (
                <p className="py-2 text-muted">Aucune sortie d’ici une semaine.</p>
              ) : (
                <ul className="divide-y divide-line -mx-2">
                  {outings.map(({ event: e, window: [a, b] }) => {
                    const w = slots ? worstIn(slots, a, b) : null;
                    const when = fromLocal(a);
                    const date = when.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <li key={e.token}>
                        <button
                          type="button"
                          onClick={() => showDay(a.slice(0, 10))}
                          aria-current={day === a.slice(0, 10) || undefined}
                          className="w-full text-left px-2 py-2 rounded-lg flex items-center gap-3 hover:bg-raised transition-colors"
                        >
                          <Dot lvl={w ? level(w) : null} />
                          <span className="flex-1 min-w-0 sm:flex sm:items-baseline sm:gap-3">
                            <span className="block sm:inline truncate sm:max-w-[45%] sm:shrink-0">
                              <span className="font-semibold text-brand tabular-nums whitespace-nowrap">
                                {date}
                                {!e.allDay && ` ${p2(when.getHours())}:${p2(when.getMinutes())}`}
                              </span>{' '}
                              <span className="text-ink">{e.title}</span>
                            </span>
                            <span className="block sm:inline text-sm text-muted tabular-nums sm:ml-auto sm:text-right">
                              {!slots ? (
                                forecastError ? 'prévision indisponible' : '…'
                              ) : w ? (
                                <>
                                  {w.wind} nd {compass(w.windDir)} · raf. {w.gusts} · F{beaufort(w.wind)}
                                  {w.waves !== null && <> · vagues {metres(w.waves)}</>}
                                </>
                              ) : (
                                'prévision indisponible'
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Prévision */}
            <section ref={forecastRef} className="card p-4 sm:p-5 scroll-mt-4 space-y-3">
              <h3 className="text-lg font-semibold text-brand">Prévision · {spot.name}</h3>
              <div role="tablist" aria-label="Jour" className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
                {days.map((d, i) => {
                  const date = fromLocal(d);
                  const label = i === 0 ? 'auj.' : `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${date.getDate()}`;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="tab"
                      aria-selected={day === d}
                      onClick={() => setDay(d)}
                      className={`h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap inline-flex items-center gap-2 border transition-colors ${
                        day === d ? 'bg-tint text-brand border-brand' : 'border-transparent text-muted hover:text-ink hover:bg-raised'
                      }`}
                    >
                      <Dot lvl={dayLevel.get(d) ?? null} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {forecastError ? (
                <Failure text={forecastError} onRetry={() => setAttempt((n) => n + 1)} />
              ) : !slots ? (
                <p className="py-6 text-center text-muted">Chargement de la prévision…</p>
              ) : daySlots.length === 0 ? (
                <p className="py-6 text-center text-muted">Prévision indisponible pour ce jour.</p>
              ) : (
                <>
                  {water !== null && <p className="text-base text-ink">Eau {Math.round(water)}&nbsp;°C</p>}

                  {/* Téléphone : une ligne double par créneau */}
                  <ul className="sm:hidden divide-y divide-line">
                    {daySlots.map((s) => (
                      <li key={s.time} className="py-2 flex items-start gap-3">
                        <span className="w-10 shrink-0 font-semibold text-brand tabular-nums">{s.time.slice(11, 13)} h</span>
                        <span className="flex-1 min-w-0 space-y-1 tabular-nums">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 rounded px-1 ${windTone(s) || 'text-ink'}`}>
                              <Arrow deg={s.windDir} /> {s.wind} nd {compass(s.windDir)}
                            </span>
                            <span className="text-sm text-muted">F{beaufort(s.wind)}</span>
                            <span className={`rounded px-1 ${gustTone(s) || 'text-ink'}`}>raf. {s.gusts}</span>
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                            <span className={`rounded px-1 ${waveTone(s)}`}>vagues {metres(s.waves)}</span>
                            <span>houle {swellText(s)}</span>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Tablette et ordinateur : tableau */}
                  <table className="hidden sm:table w-full text-base tabular-nums border-collapse">
                    <thead>
                      <tr className="text-left">
                        <th className="label py-1.5 pr-3 font-semibold">Heure</th>
                        <th className="label py-1.5 px-2 font-semibold">Vent</th>
                        <th className="label py-1.5 px-2 font-semibold">Rafales</th>
                        <th className="label py-1.5 px-2 font-semibold">Vagues</th>
                        <th className="label py-1.5 px-2 font-semibold">Houle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line border-t border-line">
                      {daySlots.map((s) => (
                        <tr key={s.time}>
                          <td className="py-2 pr-3 font-semibold text-brand">{s.time.slice(11, 13)} h</td>
                          <td className={`py-2 px-2 ${windTone(s) || 'text-ink'}`}>
                            <span className="inline-flex items-center gap-1.5">
                              <Arrow deg={s.windDir} />
                              {s.wind} nd {compass(s.windDir)}
                              <span className="text-sm opacity-75">F{beaufort(s.wind)}</span>
                            </span>
                          </td>
                          <td className={`py-2 px-2 ${gustTone(s) || 'text-ink'}`}>{s.gusts} nd</td>
                          <td className={`py-2 px-2 ${waveTone(s) || 'text-ink'}`}>{metres(s.waves)}</td>
                          <td className="py-2 px-2 text-ink">{swellText(s)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <p className="text-sm text-muted">{LEGEND}</p>
            </section>

            {/* Carte */}
            <section className="card p-4 sm:p-5">
              <h3 className="text-lg font-semibold text-brand mb-3">Carte</h3>
              <Suspense fallback={<div className="h-80 sm:h-[28rem] rounded-xl bg-raised animate-pulse" />}>
                <WeatherMap spot={spot} onPick={onPick} spots={SPOTS} />
              </Suspense>
            </section>

            <p className="text-sm text-muted">
              Sources : Météo-France (AROME) et Open-Meteo pour le vent, Open-Meteo Marine pour la mer, Ifremer (WW3 Provence 200 m) pour la carte.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
