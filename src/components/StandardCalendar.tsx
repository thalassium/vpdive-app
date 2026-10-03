import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Wind, Search, RefreshCw, AlertCircle, Check, MapPin } from 'lucide-react';
import { ymd, type CalendarEvent, type MeteoSlot } from '../services/vpdiveApi';

const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface Props {
  month: Date; // first day of the displayed month
  onMonthChange: (month: Date) => void;
  events: CalendarEvent[];
  meteoData: Record<string, MeteoSlot[]>;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenEvent: (ev: CalendarEvent) => void;
}

/** Visible grid for a month, Monday first: [first day shown, last day shown]. */
export function gridRange(month: Date): [Date, Date] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + ((7 - ((last.getDay() + 6) % 7) - 1) % 7));
  return [start, end];
}

const eventDay = (ev: CalendarEvent) => ymd(new Date(ev.start));
const timeOf = (ev: CalendarEvent) =>
  ev.allDay ? 'Journée' : new Date(ev.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Wind over the dive hours only (7h–19h): a gusty night says little about the outing. */
function daytimeWind(slots: MeteoSlot[] | undefined) {
  const day = slots?.filter((s) => s.hour >= 7 && s.hour <= 19) ?? [];
  if (!day.length) return null;
  const top = day.reduce((a, b) => (b.windSpeed_kt > a.windSpeed_kt ? b : a));
  return { max: top.windSpeed_kt, gusts: top.windGusts_kt, dir: top.windDir, strong: top.windSpeed_kt >= 20 };
}

// Phones open on the list: a 7-column grid of event titles is unreadable at 375 px.
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export function StandardCalendar({ month, onMonthChange, events, meteoData, isLoading, error, onRefresh, onOpenEvent }: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'list'>(() => (isPhone() ? 'list' : 'month'));
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = month.getFullYear();
  const m = month.getMonth();
  const todayStr = ymd(new Date());
  const inMonth = (d: string) => Number(d.slice(5, 7)) - 1 === m && Number(d.slice(0, 4)) === year;

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return events.filter(
      (ev) =>
        (!onlyMine || ev.registered) &&
        (!q ||
          ev.title.toLowerCase().includes(q) ||
          ev.location.toLowerCase().includes(q) ||
          (ev.activity?.name.toLowerCase().includes(q) ?? false)),
    );
  }, [events, searchQuery, onlyMine]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of filtered) (map[eventDay(ev)] ??= []).push(ev);
    return map;
  }, [filtered]);

  const days = useMemo(() => {
    const [start, end] = gridRange(month);
    const out: { date: string; day: number; inMonth: boolean; weekend: boolean }[] = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === m, weekend: d.getDay() === 0 || d.getDay() === 6 });
    }
    return out;
  }, [month, m]);

  // Day shown under the grid on phones: today if visible, else the month's first outing.
  useEffect(() => {
    const visible = (d: string) => Number(d.slice(5, 7)) - 1 === m && Number(d.slice(0, 4)) === year;
    setSelectedDay((cur) => {
      if (cur && visible(cur)) return cur;
      if (visible(todayStr)) return todayStr;
      return Object.keys(byDay).filter(visible).sort()[0] ?? null;
    });
  }, [m, year, byDay, todayStr]);

  const listDays = Object.keys(byDay).filter(inMonth).sort();
  const monthTotal = events.filter((e) => inMonth(eventDay(e))).length;
  const registeredCount = events.filter((e) => e.registered && inMonth(eventDay(e))).length;
  const shownCount = listDays.reduce((n, d) => n + (byDay[d]?.length ?? 0), 0);
  const selectedWind = selectedDay ? daytimeWind(meteoData[selectedDay]) : null;
  const firstLoad = isLoading && events.length === 0;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Month + navigation */}
      <div className="grid grid-cols-[1fr_auto] items-end gap-x-3 gap-y-2">
        <h1 className="col-span-2 sm:col-span-1 text-3xl sm:text-[2.75rem] font-semibold text-brand leading-none tracking-tight">
          {MOIS_FR[m]} <span className="font-normal text-muted/70">{year}</span>
        </h1>
        <p className="row-start-2 col-start-1 text-sm text-muted min-h-5 self-center sm:self-end">
          {!firstLoad && !error && (
            <>
              {plural(monthTotal, 'sortie')}
              {registeredCount > 0 && <span className="text-ok font-medium"> · {plural(registeredCount, 'inscription')}</span>}
            </>
          )}
        </p>
        <div className="row-start-2 col-start-2 sm:row-start-1 sm:row-span-2 flex items-center bg-surface border border-line rounded-full p-1 shadow-card">
          <IconButton label="Mois précédent" onClick={() => onMonthChange(new Date(year, m - 1, 1))}>
            <ChevronLeft className="w-5 h-5" />
          </IconButton>
          <button
            onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            className="px-2.5 sm:px-3 h-9 text-sm font-medium text-brand rounded-full hover:bg-raised transition-colors"
          >
            Aujourd’hui
          </button>
          <IconButton label="Mois suivant" onClick={() => onMonthChange(new Date(year, m + 1, 1))}>
            <ChevronRight className="w-5 h-5" />
          </IconButton>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative sm:w-80">
          <Search className="w-4 h-4 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher une sortie, un lieu…"
            aria-label="Rechercher"
            className="w-full bg-surface border border-line rounded-full pl-11 pr-4 h-11 text-base sm:text-sm text-ink placeholder-muted/70 focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="bg-raised border border-line p-1 rounded-full flex">
            {(['list', 'month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`px-4 h-9 text-sm font-medium rounded-full transition-all ${
                  viewMode === mode ? 'bg-surface dark:bg-tint text-brand shadow-card' : 'text-muted hover:text-ink'
                }`}
              >
                {mode === 'month' ? 'Mois' : 'Liste'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOnlyMine((v) => !v)}
            aria-pressed={onlyMine}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 h-11 text-sm font-medium rounded-full border transition-colors ${
              onlyMine ? 'bg-ok-soft border-green text-ok' : 'bg-surface border-line text-ink hover:border-brand/40'
            }`}
          >
            {onlyMine && <Check className="w-4 h-4" strokeWidth={2.5} />}
            Mes inscriptions
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Actualiser depuis VPDive"
            title="Actualiser depuis VPDive"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-surface border border-line text-muted hover:text-brand hover:border-brand/40 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 p-4 rounded-2xl bg-danger-soft text-danger text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div className="flex-1">
            <strong className="block font-semibold">L’agenda n’a pas pu être chargé depuis VPDive.</strong>
            <span>{error}</span>
          </div>
          <button onClick={onRefresh} className="font-semibold underline underline-offset-2">
            Réessayer
          </button>
        </div>
      )}

      {viewMode === 'month' ? (
        <>
          <div className="mt-6 bg-surface rounded-2xl border border-line overflow-hidden shadow-card">
            <div className="grid grid-cols-7 border-b border-line text-center text-xs font-semibold uppercase tracking-wider text-muted py-3">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
                <div key={d}>
                  <span className="sm:hidden">{d.slice(0, 1)}</span>
                  <span className="hidden sm:inline">{d}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const dayEvents = byDay[day.date] ?? [];
                const wind = daytimeWind(meteoData[day.date]);
                const isToday = day.date === todayStr;
                const isSelected = day.date === selectedDay;

                return (
                  <div
                    key={day.date}
                    className={`relative min-h-[60px] sm:min-h-[132px] p-1.5 sm:p-2 flex flex-col border-line ${i % 7 !== 6 ? 'border-r' : ''} ${
                      i < days.length - 7 ? 'border-b' : ''
                    } ${!day.inMonth ? 'bg-canvas/70' : day.weekend ? 'bg-raised/60' : ''} ${isSelected ? 'max-sm:bg-tint' : ''}`}
                  >
                    {/* Phones: the whole cell selects the day */}
                    <button
                      className="sm:hidden absolute inset-0"
                      onClick={() => setSelectedDay(day.date)}
                      aria-label={`${dayLabel(day.date)} : ${dayEvents.length} sortie${dayEvents.length > 1 ? 's' : ''}`}
                      aria-pressed={isSelected}
                    />

                    <div className="flex items-center justify-between max-sm:justify-center">
                      <span
                        className={`text-sm tabular-nums w-7 h-7 flex items-center justify-center rounded-full ${
                          isToday ? 'bg-pink text-on-pink font-bold' : day.inMonth ? 'text-ink font-medium' : 'text-muted/40'
                        }`}
                      >
                        {day.day}
                      </span>
                      {wind && day.inMonth && (
                        <span
                          title={`Vent max en journée : ${wind.max} nd (${wind.dir}), rafales ${wind.gusts} nd`}
                          className={`hidden sm:inline-flex items-center gap-1 text-xs tabular-nums ${wind.strong ? 'text-warn font-semibold' : 'text-muted/80'}`}
                        >
                          <Wind className="w-3.5 h-3.5" />
                          {wind.max} nd
                        </span>
                      )}
                    </div>

                    {/* Phones: dots */}
                    {dayEvents.length > 0 && (
                      <div className="sm:hidden mt-1.5 flex items-center justify-center gap-1">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <span
                            key={ev.token}
                            className={`w-2 h-2 rounded-full ${ev.registered ? 'ring-2 ring-green ring-offset-1 ring-offset-surface' : ''}`}
                            style={{ backgroundColor: ev.color }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Larger screens: chips */}
                    <div className="hidden sm:block mt-1.5 space-y-1 flex-1">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <EventChip key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                      ))}
                      {dayEvents.length > 3 && (
                        <button onClick={() => setViewMode('list')} className="text-xs text-brand underline underline-offset-2 block ml-auto">
                          +{dayEvents.length - 3} de plus
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Phones: outings of the selected day */}
          {selectedDay && (
            <section className="sm:hidden mt-6" aria-live="polite">
              <DayHeading date={selectedDay} wind={selectedWind} />
              {(byDay[selectedDay] ?? []).length ? (
                <div className="space-y-3">
                  {(byDay[selectedDay] ?? []).map((ev) => (
                    <EventCard key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                  ))}
                </div>
              ) : (
                <p className="text-muted font-serif italic px-1">Aucune sortie ce jour-là.</p>
              )}
            </section>
          )}
        </>
      ) : (
        <div className="mt-6 space-y-7">
          {firstLoad && <Skeletons />}
          {!isLoading && !error && shownCount === 0 && (
            <p className="py-14 text-center text-muted font-serif italic">Aucune sortie ce mois-ci pour ces critères.</p>
          )}
          {listDays.map((date) => (
            <section key={date}>
              <DayHeading date={date} wind={daytimeWind(meteoData[date])} today={date === todayStr} />
              <div className="space-y-3">
                {(byDay[date] ?? []).map((ev) => (
                  <EventCard key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-9 h-9 flex items-center justify-center rounded-full text-brand hover:bg-raised transition-colors"
    >
      {children}
    </button>
  );
}

function DayHeading({ date, wind, today }: { date: string; wind: ReturnType<typeof daytimeWind>; today?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3 px-1">
      <h2 className="text-base sm:text-lg font-semibold text-brand first-letter:uppercase flex items-center gap-2">
        {dayLabel(date)}
        {today && <span className="text-xs font-bold bg-pink text-on-pink px-2 py-0.5 rounded-full">Aujourd’hui</span>}
      </h2>
      {wind && (
        <span
          title={`Vent max en journée, rafales ${wind.gusts} nd`}
          className={`inline-flex items-center gap-1.5 text-sm tabular-nums px-2.5 py-1 rounded-full ${
            wind.strong ? 'bg-warn-soft text-warn font-semibold' : 'text-muted'
          }`}
        >
          <Wind className="w-4 h-4" /> {wind.max} nd {wind.dir}
        </span>
      )}
    </div>
  );
}

/** Loading placeholders shaped like the cards they stand in for. */
function Skeletons() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden>
      <div className="h-5 w-44 rounded-full bg-tint" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[104px] rounded-2xl bg-surface border border-line" />
      ))}
    </div>
  );
}

/** Availability wording + tone, shared by cards and chips. */
function availability(ev: CalendarEvent): { text: string; tone: 'ok' | 'warn' | 'muted' } | null {
  if (ev.availableSpots === null) return null;
  if (ev.availableSpots === 0) return { text: ev.hasWaitingList ? 'Complet · liste d’attente' : 'Complet', tone: 'warn' };
  return { text: `${plural(ev.availableSpots, 'place')} libre${ev.availableSpots > 1 ? 's' : ''}`, tone: ev.availableSpots <= 2 ? 'warn' : 'muted' };
}

/** List / day card: big tap target, everything readable at arm's length. */
function EventCard({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const a = availability(ev);
  const pct = ev.maxParticipants ? Math.min(100, Math.round((ev.registeredCount / ev.maxParticipants) * 100)) : null;
  return (
    <button
      onClick={onClick}
      data-event-card
      className={`group relative w-full text-left flex items-stretch gap-4 bg-surface rounded-2xl border pl-5 pr-4 py-4 shadow-card transition-all hover:shadow-lift hover:-translate-y-0.5 active:translate-y-0 animate-rise overflow-hidden ${
        ev.registered ? 'border-green/50' : 'border-line hover:border-brand/30'
      }`}
    >
      {/* Activity colour, as set by the club in VPDive */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: ev.color }} />

      <div className="w-14 shrink-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-semibold text-brand tabular-nums leading-none">{timeOf(ev)}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-base sm:text-[17px] font-semibold text-ink leading-snug">{ev.title}</p>

        {(ev.activity || ev.location) && (
          <p className="mt-1 text-sm text-muted flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            {ev.activity && <span className="capitalize">{ev.activity.name}</span>}
            {ev.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                {ev.location}
              </span>
            )}
          </p>
        )}

        {(ev.registered || (pct !== null && a)) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {ev.registered && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-ok bg-ok-soft px-2.5 py-0.5 rounded-full whitespace-nowrap">
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                Inscrit
              </span>
            )}
            {pct !== null && a && (
              <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                <span className="h-1.5 w-20 sm:w-32 shrink-0 rounded-full bg-tint overflow-hidden" aria-hidden>
                  <span className={`block h-full rounded-full ${a.tone === 'warn' ? 'bg-warn' : 'bg-green'}`} style={{ width: `${pct}%` }} />
                </span>
                <span className="text-sm text-muted tabular-nums">
                  {ev.registeredCount}/{ev.maxParticipants}
                </span>
                <span className={`text-sm ${a.tone === 'warn' ? 'text-warn font-semibold' : 'text-muted'}`}>{a.text}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <ChevronRight className="hidden sm:block w-5 h-5 text-muted/50 self-center shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
    </button>
  );
}

function EventChip({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const a = availability(ev);
  return (
    <button
      onClick={onClick}
      data-event-chip
      className={`relative w-full text-left pl-3 pr-2 py-1.5 rounded-lg overflow-hidden transition-colors block text-xs leading-tight ${
        ev.registered ? 'bg-ok-soft hover:brightness-95 dark:hover:brightness-125' : 'bg-raised hover:bg-tint'
      }`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: ev.color }} />
      <span className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-muted tabular-nums">{timeOf(ev)}</span>
        {ev.registered ? (
          <span className="text-[11px] font-semibold text-ok inline-flex items-center gap-0.5">
            <Check className="w-3 h-3" strokeWidth={3} /> Inscrit
          </span>
        ) : (
          a && (
            <span className={`text-[11px] ${a.tone === 'warn' ? 'text-warn font-semibold' : 'text-muted'}`}>
              {ev.availableSpots === 0 ? 'complet' : `${ev.availableSpots} pl.`}
            </span>
          )
        )}
      </span>
      <span className={`font-semibold line-clamp-2 ${ev.registered ? 'text-ok' : 'text-brand'}`}>{ev.title}</span>
    </button>
  );
}
