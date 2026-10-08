import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SEUILS } from '../lib/marine';
import { ChevronLeft, ChevronRight, Wind, RefreshCw, AlertCircle, Check } from 'lucide-react';
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
  // Vigilance au même seuil que l'écran Météo (SEUILS.jaune.vent).
  return { max: top.windSpeed_kt, gusts: top.windGusts_kt, dir: top.windDir, strong: top.windSpeed_kt >= SEUILS.jaune.vent };
}

/** Warning mark next to a strong wind; the reason stays in the tooltip. */
const WindWarning = () => (
  <span role="img" aria-label="Sortie menacée par le vent">
    ⚠️
  </span>
);

// Phones open on the list: a 7-column grid of event titles is unreadable at 375 px.
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

// The view the member chose stays put, visit after visit; only a first visit
// picks one from the screen size.
const VIEW_KEY = 'calendarView';
const readView = (): 'month' | 'list' => {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'month' || saved === 'list') return saved;
  } catch {
    // Private browsing: fall back to the screen size.
  }
  return isPhone() ? 'list' : 'month';
};

export function StandardCalendar({ month, onMonthChange, events, meteoData, isLoading, error, onRefresh, onOpenEvent }: Props) {
  const [viewMode, setViewModeState] = useState<'month' | 'list'>(readView);
  const setViewMode = (mode: 'month' | 'list') => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      // Private browsing: the choice lasts for this visit.
    }
  };
  /** Month cell showing all its outings instead of the first three. */
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  /** Téléphone, vue Calendrier : le jour tapé, dont les sorties s'affichent juste sous la grille. */
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const year = month.getFullYear();
  const m = month.getMonth();
  const todayStr = ymd(new Date());
  const inMonth = (d: string) => Number(d.slice(5, 7)) - 1 === m && Number(d.slice(0, 4)) === year;

  const filtered = useMemo(() => events.filter((ev) => !onlyMine || ev.registered), [events, onlyMine]);

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

  // Jour montré sous la grille sur téléphone : aujourd'hui s'il est dans le mois, sinon la première sortie du mois.
  useEffect(() => {
    const visible = (d: string) => Number(d.slice(5, 7)) - 1 === m && Number(d.slice(0, 4)) === year;
    setSelectedDay((cur) => {
      if (cur && visible(cur)) return cur;
      if (visible(todayStr)) return todayStr;
      return Object.keys(byDay).filter(visible).sort()[0] ?? null;
    });
  }, [m, year, byDay, todayStr]);

  // Current month: the list starts the day before (older outings are history); other months show in full.
  const isCurrentMonth = inMonth(todayStr);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const listFrom = isCurrentMonth ? ymd(yesterday) : '';
  const listDays = Object.keys(byDay)
    .filter((d) => inMonth(d) && d >= listFrom)
    .sort();
  const monthTotal = events.filter((e) => inMonth(eventDay(e))).length;
  const registeredCount = events.filter((e) => e.registered && inMonth(eventDay(e))).length;
  const shownCount = listDays.reduce((n, d) => n + (byDay[d]?.length ?? 0), 0);
  const firstLoad = isLoading && events.length === 0;
  const empty = <p className="py-14 text-center text-muted">{isCurrentMonth ? 'Plus aucune' : 'Aucune'} {onlyMine ? 'inscription' : 'sortie'} ce mois-ci.</p>;
  const agenda = (dates: string[]) => (
    <AgendaList dates={dates} byDay={byDay} meteoData={meteoData} todayStr={todayStr} onOpenEvent={onOpenEvent} />
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Month (the page title, fixed width so the arrows stay put) + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="self-start inline-flex items-center gap-1 rounded-lg border border-field-border bg-surface p-1">
          <IconButton label="Mois précédent" onClick={() => onMonthChange(new Date(year, m - 1, 1))}>
            <ChevronLeft className="w-5 h-5" />
          </IconButton>
          <h1 aria-live="polite" className="w-48 sm:w-56 text-center text-2xl font-semibold text-brand tracking-normal">
            {MOIS_FR[m]} <span className="font-normal text-muted">{year}</span>
          </h1>
          <IconButton label="Mois suivant" onClick={() => onMonthChange(new Date(year, m + 1, 1))}>
            <ChevronRight className="w-5 h-5" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="inline-flex rounded-lg border border-field-border bg-surface p-1">
            {(['list', 'month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-pressed={viewMode === mode}
                className={`h-9 px-3 min-[375px]:px-4 rounded-md text-sm font-medium transition-colors ${
                  viewMode === mode ? 'bg-tint text-brand' : 'text-muted hover:text-ink'
                }`}
              >
                {mode === 'month' ? 'Calendrier' : 'Liste'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOnlyMine((v) => !v)}
            aria-pressed={onlyMine}
            className={`btn btn-quiet h-11 min-w-0 px-3 min-[375px]:px-4 flex-1 sm:flex-none text-sm ${
              onlyMine ? 'bg-ok-soft border-ok text-ok hover:bg-ok-soft' : ''
            }`}
          >
            {onlyMine && <Check className="w-4 h-4 shrink-0" strokeWidth={2.5} />}
            <span className="truncate">Mes sorties</span>
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Actualiser depuis VPDive"
            title="Actualiser depuis VPDive"
            className="icon-btn h-11 w-11 border border-field-border bg-surface disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <p className="mt-2.5 px-1 text-sm text-muted min-h-5">
        {!firstLoad && !error && (
          <>
            {plural(monthTotal, 'sortie')}
            {registeredCount > 0 && <span className="text-ok font-medium"> · {plural(registeredCount, 'inscription')}</span>}
          </>
        )}
      </p>

      {error && (
        <div role="alert" className="mt-5 p-4 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-3">
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
          <div className="mt-6 card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line text-center label py-3">
              {['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => (
                <div key={d}>
                  <span className="sm:hidden">{d.slice(0, 1).toUpperCase()}</span>
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
                    {/* Téléphone : toute la case choisit le jour, ses sorties s'affichent sous la grille */}
                    <button
                      className="sm:hidden absolute inset-0"
                      onClick={() => setSelectedDay(day.date)}
                      aria-label={`${dayLabel(day.date)} : ${dayEvents.length} sortie${dayEvents.length > 1 ? 's' : ''}`}
                      aria-pressed={isSelected}
                    />

                    <div className="flex items-center justify-between max-sm:justify-center">
                      <span
                        className={`text-sm tabular-nums w-7 h-7 flex items-center justify-center rounded-full ${
                          isToday ? 'bg-pink text-on-pink font-bold' : day.inMonth ? 'text-ink font-medium' : 'text-muted'
                        }`}
                      >
                        {day.day}
                      </span>
                      {wind && day.inMonth && (
                        <span
                          title={`Vent max en journée : ${wind.max} nd (${wind.dir}), rafales ${wind.gusts} nd`}
                          className={`hidden sm:inline-flex items-center gap-1 text-xs tabular-nums ${wind.strong ? 'text-warn font-semibold' : 'text-muted'}`}
                        >
                          <Wind className="w-3.5 h-3.5" />
                          {wind.max} nd{wind.strong && <WindWarning />}
                        </span>
                      )}
                    </div>

                    {/* Téléphone : une puce par sortie, à la couleur de l'activité, cerclée de vert si inscrit */}
                    {dayEvents.length > 0 && (
                      <div aria-hidden className="sm:hidden mt-1.5 flex items-center justify-center gap-1">
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
                      {(expandedDay === day.date ? dayEvents : dayEvents.slice(0, 3)).map((ev) => (
                        <EventChip key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                      ))}
                      {dayEvents.length > 3 && (
                        <button
                          onClick={() => setExpandedDay(expandedDay === day.date ? null : day.date)}
                          className="text-xs text-brand underline underline-offset-2 block ml-auto"
                        >
                          {expandedDay === day.date ? 'Réduire' : `+${dayEvents.length - 3} de plus`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Téléphone : les sorties du jour choisi, juste sous la grille, en lignes compactes */}
          {selectedDay && (
            <section className="sm:hidden mt-5" aria-live="polite">
              <DayHeading date={selectedDay} wind={daytimeWind(meteoData[selectedDay])} today={selectedDay === todayStr} />
              {(byDay[selectedDay] ?? []).length ? (
                <div className="card divide-y divide-line overflow-hidden">
                  {(byDay[selectedDay] ?? []).map((ev) => (
                    <EventRow key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                  ))}
                </div>
              ) : (
                <p className="text-muted px-1">Aucune sortie ce jour-là.</p>
              )}
            </section>
          )}
        </>
      ) : (
        <div className="mt-6">
          {firstLoad ? <Skeletons /> : shownCount === 0 ? !isLoading && !error && empty : agenda(listDays)}
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
      className="icon-btn w-9 h-9 text-brand"
    >
      {children}
    </button>
  );
}

/**
 * L'agenda en lignes, comme les vues « planning » des agendas mobiles : une
 * colonne de date par jour, puis une ligne par sortie (heure, titre, un seul
 * état). Le lieu et le détail sont dans la fiche, à un tap.
 *
 * Deux poids de filet disent la hiérarchie sans titre : un filet plein entre
 * les jours, un filet atténué entre les sorties d'un même jour ; la gouttière
 * de date, légèrement teintée, tient le jour d'un seul bloc.
 */
export function AgendaList({
  dates,
  byDay,
  meteoData,
  todayStr,
  onOpenEvent,
}: {
  dates: string[];
  byDay: Record<string, CalendarEvent[]>;
  meteoData: Record<string, MeteoSlot[]>;
  todayStr: string;
  onOpenEvent: (ev: CalendarEvent) => void;
}) {
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {dates.map((date) => {
        const d = new Date(`${date}T12:00:00`);
        const wind = daytimeWind(meteoData[date]);
        const today = date === todayStr;
        return (
          <section
            key={date}
            aria-label={dayLabel(date)}
            className="grid grid-cols-[3.25rem_1fr] sm:grid-cols-[4rem_1fr]"
          >
            <div className="flex flex-col items-center gap-1 pt-2.5 pb-2 border-r border-line bg-raised/60">
              <span className="text-sm text-muted leading-none">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</span>
              <span
                className={`w-8 h-8 inline-flex items-center justify-center rounded-full text-xl font-semibold tabular-nums leading-none ${
                  today ? 'bg-pink text-on-pink' : 'text-brand'
                }`}
              >
                {d.getDate()}
              </span>
              {wind?.strong && (
                <span title={`Vent max en journée : ${wind.max} nd (${wind.dir}), rafales ${wind.gusts} nd`} className="text-sm font-semibold text-warn tabular-nums inline-flex items-center gap-0.5">
                  <WindWarning />
                  {wind.max}
                </span>
              )}
            </div>
            <div className="min-w-0 divide-y divide-line/60">
              {(byDay[date] ?? []).map((ev) => (
                <EventRow key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Le jour choisi dans la grille, au-dessus de ses sorties (téléphone). */
function DayHeading({ date, wind, today }: { date: string; wind: ReturnType<typeof daytimeWind>; today?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 px-1">
      <h2 className="text-lg font-semibold text-brand first-letter:uppercase flex items-center gap-2">
        {dayLabel(date)}
        {today && <span className="alpha bg-pink text-on-pink text-sm font-semibold pl-2 py-0.5">Aujourd’hui</span>}
      </h2>
      {wind && (
        <span
          title={`Vent max en journée, rafales ${wind.gusts} nd`}
          className={`inline-flex items-center gap-1.5 text-sm tabular-nums px-2.5 py-1 rounded-md ${wind.strong ? 'bg-warn-soft text-warn font-semibold' : 'text-muted'}`}
        >
          <Wind className="w-4 h-4" /> {wind.max} nd {wind.dir}
          {wind.strong && <WindWarning />}
        </span>
      )}
    </div>
  );
}

/** Pendant le premier chargement : des lignes à la forme de l'agenda. */
function Skeletons() {
  return (
    <div className="card divide-y divide-line overflow-hidden animate-pulse" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid grid-cols-[3.25rem_1fr] sm:grid-cols-[4rem_1fr] h-24">
          <div className="border-r border-line bg-raised/60" />
          <div className="p-3 space-y-3">
            <div className="h-4 w-3/4 rounded-md bg-tint" />
            <div className="h-4 w-1/2 rounded-md bg-tint" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** L'état qui décide, en une ligne : inscrit, en liste d'attente, complet, ou places restantes. */
function rowStatus(ev: CalendarEvent): { text: string; tone: 'ok' | 'warn' | 'muted' } | null {
  if (ev.onWaitingList) return { text: 'Liste d’attente', tone: 'warn' };
  if (ev.registered) return { text: 'Inscrit', tone: 'ok' };
  if (ev.availableSpots === null) return null;
  if (ev.availableSpots === 0) return { text: 'Complet', tone: 'warn' };
  return { text: `${ev.availableSpots} pl.`, tone: ev.availableSpots <= 2 ? 'warn' : 'muted' };
}

/** Une sortie, une ligne : heure, titre (deux lignes au plus), un état. Le tap ouvre la fiche. */
export function EventRow({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const status = rowStatus(ev);
  return (
    <button
      onClick={onClick}
      data-event-card
      title={[ev.title, ev.location].filter(Boolean).join(' — ')}
      className="w-full flex items-center gap-2.5 sm:gap-3 pl-2.5 pr-3 sm:pr-4 py-2.5 text-left hover:bg-raised focus-visible:bg-raised transition-colors"
    >
      {/* Couleur de l'activité, telle que le club la règle dans VPDive */}
      <span aria-hidden className="self-stretch w-[3px] shrink-0 rounded-full" style={{ backgroundColor: ev.color }} />
      <span className={`w-[3.25rem] shrink-0 tabular-nums font-semibold text-brand ${ev.allDay ? 'text-sm' : 'text-base'}`}>{timeOf(ev)}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-ink leading-snug line-clamp-2">{ev.title}</span>
        {ev.location && <span className="hidden lg:block text-sm text-muted truncate">{ev.location}</span>}
      </span>
      {status &&
        (status.tone === 'ok' ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-ok">
            <Check className="w-4 h-4" strokeWidth={3} />
            {/* Sur téléphone, la coche seule : la place va au titre. */}
            <span className="sr-only sm:not-sr-only">{status.text}</span>
          </span>
        ) : (
          <span className={`shrink-0 text-sm tabular-nums whitespace-nowrap ${status.tone === 'warn' ? 'text-warn font-semibold' : 'text-muted'}`}>{status.text}</span>
        ))}
    </button>
  );
}

/** Availability wording + tone, shared by cards and chips. */
function availability(ev: CalendarEvent): { text: string; tone: 'ok' | 'warn' | 'muted' } | null {
  if (ev.availableSpots === null) return null;
  if (ev.availableSpots === 0) return { text: ev.hasWaitingList ? 'Complet · liste d’attente' : 'Complet', tone: 'warn' };
  return { text: `${plural(ev.availableSpots, 'place')} libre${ev.availableSpots > 1 ? 's' : ''}`, tone: ev.availableSpots <= 2 ? 'warn' : 'muted' };
}

function EventChip({ ev, onClick }: { ev: CalendarEvent; onClick: () => void }) {
  const a = availability(ev);
  return (
    <button
      onClick={onClick}
      data-event-chip
      className={`relative w-full text-left pl-3 pr-2 py-1.5 rounded-lg overflow-hidden transition-colors block text-xs leading-snug ${
        ev.registered ? 'bg-ok-soft hover:brightness-95 dark:hover:brightness-125' : 'bg-raised hover:bg-tint'
      }`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: ev.color }} />
      <span className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-muted tabular-nums">{timeOf(ev)}</span>
        {ev.registered ? (
          <span className="font-semibold text-ok inline-flex items-center gap-0.5">
            <Check className="w-3 h-3" strokeWidth={3} /> Inscrit
          </span>
        ) : (
          a && (
            <span className={`${a.tone === 'warn' ? 'text-warn font-semibold' : 'text-muted'}`}>
              {ev.availableSpots === 0 ? 'complet' : `${ev.availableSpots} pl.`}
            </span>
          )
        )}
      </span>
      <span className={`lg:text-sm font-semibold line-clamp-2 ${ev.registered ? 'text-ok' : 'text-brand'}`}>{ev.title}</span>
    </button>
  );
}
