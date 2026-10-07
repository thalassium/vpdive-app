import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, ExternalLink, Users, ClipboardList } from 'lucide-react';
import { Logo } from './components/Brand';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './components/LoginPage';
import { StandardCalendar, gridRange } from './components/StandardCalendar';
import { EventBookingModal } from './components/EventBookingModal';
import { SeaBackdrop } from './components/SeaBackdrop';
import { MembersPanel } from './components/MembersPanel';
import { DpPanel } from './components/dp/DpPanel';
import { vpdive, ymd, SessionExpiredError, DP_ROLE, type CalendarEvent, type MeteoSlot, type Session } from './services/vpdiveApi';
import { appApi, type Me } from './services/appApi';

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
  const [panel, setPanel] = useState<'dp' | 'members' | null>(null);
  const [dpEvent, setDpEvent] = useState<CalendarEvent | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [isDp, setIsDp] = useState(false);
  const loadId = useRef(0);
  // Rôle dans l'appli, décidé par le serveur (server/handler.ts) : super-admin,
  // admin (admin VPDive dont le rôle n'a pas été retiré) ou membre.
  const role = me?.role ?? 'member';
  const isAdmin = role === 'admin' || role === 'superadmin';
  const canDp = isAdmin || isDp;

  const handleSessionLost = useCallback((e: unknown) => {
    if (e instanceof SessionExpiredError) {
      setActiveEvent(null);
      setPanel(null);
      setMe(null);
      setIsDp(false);
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

  // Rôle relu à chaque visite (la session VPDive dure 30 jours, les rôles peuvent changer entre-temps).
  const sessionToken = session?.token;
  useEffect(() => {
    if (!sessionToken) return;
    appApi.me().then(setMe, (e) => handleSessionLost(e) || console.warn('Rôle dans l’appli non lu :', e));
  }, [sessionToken, handleSessionLost]);

  // Un membre qui n'est pas admin a le menu DP s'il est directeur de plongée
  // d'une sortie à venir où il est inscrit.
  useEffect(() => {
    if (!me || me.role !== 'member' || !session) return;
    let cancelled = false;
    (async () => {
      const today = new Date();
      const to = new Date(today);
      to.setDate(to.getDate() + 60);
      const mine = (await vpdive.fetchEvents(ymd(today), ymd(to))).filter((e) => e.registered);
      for (const e of mine) {
        const roster = await vpdive.fetchRoster(e.token).catch(() => []);
        if (roster.some((r) => r.id === String(session.userId) && r.roles.some((x) => DP_ROLE.test(x)))) {
          if (!cancelled) setIsDp(true);
          return;
        }
      }
    })().catch((e) => console.warn('Rôle DP non vérifié :', e));
    return () => {
      cancelled = true;
    };
  }, [me, session]);

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
  // Imprimer depuis le menu DP n'imprime que la fiche, pas l'agenda derrière.
  const printPanel = panel ? 'print:hidden' : '';

  return (
    <div className="min-h-dvh text-ink flex flex-col font-sans">
      <SeaBackdrop />
      <header className={`sticky top-0 z-30 bg-surface/85 backdrop-blur-md border-b border-line ${printPanel}`}>
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

              {canDp && (
                <NavButton label="DP" title="Directeur de plongée : palanquées et fiches de sécurité" onClick={() => setPanel('dp')}>
                  <ClipboardList className="w-4 h-4" />
                </NavButton>
              )}
              {isAdmin && (
                <NavButton label="Membres" title="Membres du club" onClick={() => setPanel('members')}>
                  <Users className="w-4 h-4" />
                </NavButton>
              )}

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

      <main className={`flex-1 ${printPanel}`}>
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

      {activeEvent && !panel && (
        <EventBookingModal
          key={activeEvent.token}
          event={activeEvent}
          onClose={() => setActiveEvent(null)}
          onChanged={loadEvents}
          onSessionLost={handleSessionLost}
          onOpenPalanquees={
            canDp
              ? () => {
                  setDpEvent(activeEvent);
                  setActiveEvent(null);
                  setPanel('dp');
                }
              : undefined
          }
        />
      )}

      {panel === 'dp' && canDp && (
        <DpPanel
          session={session}
          role={role}
          initialEvent={dpEvent}
          onClose={() => {
            setPanel(null);
            setDpEvent(null);
          }}
          onSessionLost={handleSessionLost}
        />
      )}
      {panel === 'members' && isAdmin && me && <MembersPanel me={me} onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />}

      <footer className={`relative bg-band text-white/85 px-4 py-8 mt-16 ${printPanel}`}>
        {/* Le bandeau marine sort de l'eau par une vague, au lieu d'une coupure droite */}
        <svg aria-hidden className="absolute bottom-full inset-x-0 w-full h-6 text-band" viewBox="0 0 1440 24" preserveAspectRatio="none">
          <path fill="currentColor" d="M0 14 C 180 2 360 2 540 12 S 900 24 1080 12 S 1320 4 1440 10 V24 H0 Z" />
        </svg>
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

function NavButton({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full text-sm font-semibold text-brand hover:bg-raised transition-colors"
    >
      {children}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
