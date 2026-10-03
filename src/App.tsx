import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, ExternalLink } from 'lucide-react';
import { Logo } from './components/Brand';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './components/LoginPage';
import { StandardCalendar, gridRange } from './components/StandardCalendar';
import { EventBookingModal } from './components/EventBookingModal';
import { vpdive, ymd, SessionExpiredError, type CalendarEvent, type MeteoSlot, type Session } from './services/vpdiveApi';

const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

export default function App() {
  const [session, setSession] = useState<Session | null>(() => vpdive.getSession());
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  const [month, setMonth] = useState<Date>(thisMonth);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meteo, setMeteo] = useState<Record<string, MeteoSlot[]>>({});
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const loadId = useRef(0);

  const handleSessionLost = useCallback((e: unknown) => {
    if (e instanceof SessionExpiredError) {
      setActiveEvent(null);
      setSession(null);
      setLoginNotice(e.message);
      return true;
    }
    return false;
  }, []);

  const loadEvents = useCallback(async () => {
    if (!session) return;
    const id = ++loadId.current; // ignore answers for a month the member already left
    const [start, end] = gridRange(month);
    setIsLoading(true);
    setError(null);
    try {
      const list = await vpdive.fetchEvents(ymd(start), ymd(end));
      if (id === loadId.current) setEvents(list);
    } catch (e) {
      if (id !== loadId.current || handleSessionLost(e)) return;
      setEvents([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === loadId.current) setIsLoading(false);
    }
  }, [session, month, handleSessionLost]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Weather is a bonus: if Open-Meteo is down the agenda still works, just without wind badges.
  useEffect(() => {
    if (!session) return;
    vpdive.fetchMeteo().then(setMeteo, (e) => console.warn('Météo indisponible :', e));
  }, [session]);

  const handleLogout = () => {
    vpdive.logout();
    setSession(null);
    setEvents([]);
    setLoginNotice(null);
  };

  if (!session) {
    return (
      <LoginPage
        notice={loginNotice}
        onLoginSuccess={(s) => {
          setLoginNotice(null);
          setMonth(thisMonth());
          setSession(s);
        }}
      />
    );
  }

  const displayName = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const initials = (`${session.firstName[0] ?? ''}${session.lastName[0] ?? ''}` || session.email[0] || '?').toUpperCase();
  const connected = !error && !isLoading;

  return (
    <div className="min-h-dvh bg-canvas text-ink flex flex-col font-sans">
      <header className="sticky top-0 z-30 bg-surface/85 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-[4.5rem] gap-3">
            <a href="https://www.septentrion-env.com/" target="_blank" rel="noreferrer" className="shrink-0" title="septentrion-env.com">
              <Logo className="h-12 sm:h-14" />
            </a>

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <span className="hidden md:inline-flex items-center gap-2 text-sm text-muted mr-2">
                <span className={`w-2 h-2 rounded-full ${error ? 'bg-danger' : connected ? 'bg-green' : 'bg-line'}`} />
                {error ? 'VPDive injoignable' : connected ? 'VPDive connecté' : 'Synchronisation…'}
              </span>

              <ThemeToggle />

              <span className="flex items-center gap-2 pl-1 min-w-0" title={displayName}>
                <span className="w-9 h-9 shrink-0 rounded-full bg-tint text-brand text-sm font-semibold flex items-center justify-center">
                  {initials}
                </span>
                <span className="hidden sm:block text-sm font-medium text-ink truncate max-w-40">{displayName}</span>
              </span>

              <button
                onClick={handleLogout}
                aria-label="Se déconnecter"
                title="Se déconnecter"
                className="w-10 h-10 flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger-soft transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <StandardCalendar
          month={month}
          onMonthChange={setMonth}
          events={events}
          meteoData={meteo}
          isLoading={isLoading}
          error={error}
          onRefresh={loadEvents}
          onOpenEvent={setActiveEvent}
        />
      </main>

      {activeEvent && (
        <EventBookingModal
          key={activeEvent.token}
          event={activeEvent}
          onClose={() => setActiveEvent(null)}
          onChanged={loadEvents}
          onSessionLost={handleSessionLost}
        />
      )}

      <footer className="bg-band text-white/75 px-4 py-8 mt-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
          <Logo tone="white" className="h-12 opacity-90" />
          <div className="text-center sm:text-right space-y-1">
            <p>Port de la Pointe Rouge, 13008 Marseille</p>
            <a href="https://www.septentrion-env.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-pink hover:underline">
              septentrion-env.com <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
