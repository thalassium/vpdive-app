import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Wind, X } from 'lucide-react';
import { vpdive, ymd, type CalendarEvent } from '../../services/vpdiveApi';
import { SPOTS, forecastAt, type Spot } from '../../services/marineWeather';
import { SEUILS, beaufort, compass, level, metres, windColor, worstIn, type Level, type Slot } from '../../lib/marine';
import { useDialog } from '../../hooks/useDialog';
import { GabianLoader } from '../Gabian';

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

/** Couleur du vent mêlée au fond (plus discrète en thème sombre, voir --wind-mix). */
const mix = (c: string, part = 'var(--wind-mix)') => `color-mix(in srgb, ${c} ${part}, transparent)`;

/** Vitesse en pastille de la couleur du vent : « 14 ». */
function WindPill({ kn, className = '' }: { kn: number; className?: string }) {
  return (
    <span className={`inline-block rounded-md px-1.5 font-semibold tabular-nums text-ink ${className}`} style={{ background: mix(windColor(kn), '75%') }}>
      {kn}
    </span>
  );
}

/** Flèche pleine : pointe vers où va le vent (la direction donnée est celle d'où il vient). */
function WindArrow({ deg }: { deg: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="w-7 h-7 shrink-0 text-ink" style={{ transform: `rotate(${deg + 180}deg)` }}>
      <path d="M12 2 19.5 21 12 16.5 4.5 21Z" fill="currentColor" />
    </svg>
  );
}

const waveTone = (m: number | null) => (m === null ? 'text-ink' : m >= SEUILS.rouge.vagues ? 'text-danger' : m >= SEUILS.jaune.vagues ? 'text-warn' : 'text-ink');

/** Part d'une vitesse sur l'échelle de la barre (40 nd = pleine largeur). */
const bar = (kn: number) => `${Math.min(kn / 40, 1) * 100}%`;

/**
 * Un créneau, à la manière des sites de vent : le fond prend la couleur du
 * vent, la flèche montre où il va, la barre du bas sa force puis les rafales.
 */
function SlotRow({ s, active, onSelect }: { s: Slot; active: boolean; onSelect: () => void }) {
  const c = windColor(s.wind);
  // « houle 0,9 m du SO » puis « période 5 s » : le temps entre deux crêtes.
  const swell = s.swell === null ? '' : `houle ${metres(s.swell)}` + (s.swellDir !== null ? ` du ${compass(s.swellDir)}` : '');
  const period = s.swell !== null && s.swellPeriod !== null ? `période ${Math.round(s.swellPeriod)} s` : '';
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`${Number(s.time.slice(11, 13))} h : vent ${s.wind} nœuds de ${compass(s.windDir)}, rafales ${s.gusts}, vagues ${metres(s.waves)}`}
        className={`relative w-full text-left grid grid-cols-[3.25rem_minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2 sm:gap-3 pl-2 pr-3 pt-2.5 pb-3.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
          active ? 'shadow-[inset_4px_0_0_var(--color-brand)]' : ''
        }`}
        style={{ background: `linear-gradient(90deg, ${mix(c)} 0%, ${mix(c)} 30%, transparent 78%)` }}
      >
        <span className={`justify-self-start rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums ${active ? 'bg-brand text-surface' : 'bg-surface text-ink'}`}>
          {s.time.slice(11, 13)}h
        </span>

        <span className="flex items-center gap-2 min-w-0">
          <WindArrow deg={s.windDir} />
          <span className="min-w-0">
            <span className="block text-2xl font-semibold leading-none tabular-nums text-ink">
              {s.wind}
              <span className="text-base font-medium"> nd</span>
            </span>
            <span className="block mt-1 text-sm max-sm:leading-snug text-ink/80 tabular-nums">
              {compass(s.windDir)} · raf. {s.gusts} · F{beaufort(s.wind)}
            </span>
          </span>
        </span>

        <span className="min-w-0">
          <span className={`block text-xl font-semibold leading-none tabular-nums ${waveTone(s.waves)}`}>{metres(s.waves)}</span>
          {swell && <span className="block mt-1 text-sm leading-snug text-muted tabular-nums">{swell}</span>}
          {period && <span className="block text-sm leading-snug text-muted tabular-nums">{period}</span>}
        </span>

        {/* Force du vent puis rafales, sur une échelle de 0 à 40 nd */}
        <span aria-hidden className="absolute left-0 bottom-0 h-1 w-full flex">
          <span style={{ width: bar(s.wind), background: c }} />
          <span style={{ width: `calc(${bar(s.gusts)} - ${bar(s.wind)})`, background: windColor(s.gusts), opacity: 0.6 }} />
        </span>
      </button>
    </li>
  );
}

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
 * Météo (admin et DP) : vent, rafales et mer sur 7 jours au point choisi,
 * niveau de chaque sortie VPDive de la semaine, carte du vent.
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
  // Créneau affiché sur la carte : le prochain d'aujourd'hui, 9 h les autres jours.
  const nextHour = (): string => HOURS.find((h) => Number(h) + 2 >= new Date().getHours()) ?? '21';
  const [hour, setHour] = useState<string>(nextHour);
  const pickDay = (d: string) => {
    setDay(d);
    setHour(d === days[0] ? nextHour() : '09');
  };

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

  const { ref: dialogRef } = useDialog({ onClose, label: 'weather' });

  const outings = useMemo(() => {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    return (events ?? [])
      .map((e) => ({ event: e, window: outingWindow(e) }))
      .filter(({ window: [a] }) => a.slice(0, 10) >= first && a.slice(0, 10) <= last)
      .sort((a, b) => a.window[0].localeCompare(b.window[0]));
  }, [events, days]);

  /** Vent le plus fort de chaque jour, de 6 h à 21 h. */
  const dayPeak = useMemo(() => {
    const out = new Map<string, Slot>();
    if (slots)
      days.forEach((d) => {
        const w = worstIn(slots, `${d}T06:00`, `${d}T21:00`);
        if (w) out.set(d, w);
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
    pickDay(d);
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
        ref={dialogRef}
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
                    className={`h-11 sm:h-9 px-3 rounded-md text-sm font-medium transition-colors ${
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
                            <span className="line-clamp-2 sm:inline sm:truncate sm:max-w-[45%] sm:shrink-0">
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
                                <span className="inline-flex items-center gap-1.5">
                                  <WindPill kn={w.wind} />
                                  <span>
                                    nd {compass(w.windDir)} · raf. {w.gusts}
                                    {w.waves !== null && <> · vagues {metres(w.waves)}</>}
                                  </span>
                                </span>
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

            {/* Prévision : jours, créneaux colorés, carte du vent à l'heure choisie */}
            <section ref={forecastRef} className="scroll-mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-semibold text-brand">{spot.name}</h3>
                {water !== null && <span className="text-base text-ink tabular-nums">Eau {Math.round(water)}&nbsp;°C</span>}
              </div>

              {/* Boutons à bascule plutôt qu'onglets : le jour choisi règle à la fois les créneaux et la carte. */}
              <div role="group" aria-label="Jour" className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
                {days.map((d, i) => {
                  const date = fromLocal(d);
                  const peak = dayPeak.get(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={day === d}
                      onClick={() => pickDay(d)}
                      title={peak ? `Jusqu'à ${peak.wind} nd, rafales ${peak.gusts} nd` : undefined}
                      className={`shrink-0 w-[4.75rem] rounded-lg border py-1.5 text-center transition-colors ${
                        day === d ? 'bg-surface border-brand shadow-lift' : 'bg-surface/60 border-line hover:bg-surface'
                      }`}
                    >
                      <span className={`block text-sm ${day === d ? 'font-semibold text-brand' : 'text-muted'}`}>
                        {i === 0 ? 'auj.' : `${date.toLocaleDateString('fr-FR', { weekday: 'short' })} ${date.getDate()}`}
                      </span>
                      <span className="block mt-1 h-6">{peak && <WindPill kn={peak.wind} className="text-base" />}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
                <div className="card overflow-hidden">
                  {forecastError ? (
                    <div className="p-4">
                      <Failure text={forecastError} onRetry={() => setAttempt((n) => n + 1)} />
                    </div>
                  ) : !slots ? (
                    <GabianLoader label="Chargement de la prévision…" />
                  ) : daySlots.length === 0 ? (
                    <p className="py-10 text-center text-muted">Prévision indisponible pour ce jour.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      <li
                        aria-hidden
                        className="grid grid-cols-[3.25rem_minmax(0,1.2fr)_minmax(0,1fr)] gap-2 sm:gap-3 pl-2 pr-3 py-1.5 text-sm font-semibold text-muted bg-surface"
                      >
                        <span />
                        <span>Vent</span>
                        <span>Vagues</span>
                      </li>
                      {daySlots.map((sl) => (
                        <SlotRow key={sl.time} s={sl} active={sl.time.slice(11, 13) === hour} onSelect={() => setHour(sl.time.slice(11, 13))} />
                      ))}
                    </ul>
                  )}
                </div>

                <div className="lg:sticky lg:top-0 space-y-1.5">
                  <Suspense fallback={<div className="h-80 sm:h-[30rem] rounded-xl bg-raised animate-pulse" />}>
                    <WeatherMap spot={spot} onPick={onPick} spots={SPOTS} time={`${day}T${hour}:00`} />
                  </Suspense>
                  <p className="text-sm text-muted">
                    Vent à {Number(hour)} h, {fromLocal(day).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                </div>
              </div>
            </section>

            <p className="text-sm text-muted">
              Sources : Météo-France (AROME) et Open-Meteo pour le vent, Open-Meteo Marine pour la mer.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
