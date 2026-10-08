import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, ClipboardList, Eye, CalendarDays, FileWarning, GraduationCap, MessageCircle, Package, Settings, UserRound, Users, Wind, BarChart3 } from 'lucide-react';
import { Logo } from './components/Brand';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './components/LoginPage';
import { StandardCalendar, gridRange } from './components/StandardCalendar';
import { EventBookingModal } from './components/EventBookingModal';
import { SeaBackdrop } from './components/SeaBackdrop';
import { CaptainHat, HeaderMenu } from './components/HeaderMenu';
import { AccountMenu, ROLE_LABEL, type ViewAsPick } from './components/AccountMenu';
import { sameName } from './lib/fuzzy';
import { Avatar } from './components/Avatar';
import { Cromagnon } from './components/Cromagnon';
import { GabianLoader } from './components/Gabian';
import { CoursesView } from './components/views/CoursesView';
import { messaging } from './services/messaging';
import { vpdive, ymd, SessionExpiredError, DP_ROLE, type CalendarEvent, type MeteoSlot, type Session } from './services/vpdiveApi';
import { appApi, type Me } from './services/appApi';

// Hors du paquet principal : l'agenda et la fiche de réservation s'affichent tout de suite, le reste
// est téléchargé en tâche de fond peu après la connexion (preloadScreens), pour s'ouvrir sans attente.
const screens = {
  dp: () => import('./components/dp/DpPanel'),
  material: () => import('./components/admin/MaterialPanel'),
  docs: () => import('./components/admin/DocsPanel'),
  stats: () => import('./components/admin/StatsPanel'),
  weather: () => import('./components/admin/WeatherPanel'),
  members: () => import('./components/MembersPanel'),
  messages: () => import('./components/views/MessagesView'),
  profile: () => import('./components/views/ProfileView'),
};
const DpPanel = lazy(() => screens.dp().then((m) => ({ default: m.DpPanel })));
const MaterialPanel = lazy(() => screens.material().then((m) => ({ default: m.MaterialPanel })));
const DocsPanel = lazy(() => screens.docs().then((m) => ({ default: m.DocsPanel })));
const StatsPanel = lazy(() => screens.stats().then((m) => ({ default: m.StatsPanel })));
const WeatherPanel = lazy(() => screens.weather().then((m) => ({ default: m.WeatherPanel })));
const MembersPanel = lazy(() => screens.members().then((m) => ({ default: m.MembersPanel })));
const MessagesView = lazy(() => screens.messages().then((m) => ({ default: m.MessagesView })));
const ProfileView = lazy(() => screens.profile().then((m) => ({ default: m.ProfileView })));

/** Télécharge les écrans quand la page est au repos (les menus et onglets s'ouvrent alors sans cadre de chargement). */
function preloadScreens(): () => void {
  const run = () => Object.values(screens).forEach((load) => void load().catch(() => {}));
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 2000);
  return () => clearTimeout(id);
}

const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

/** Les quatre onglets ; l'onglet actif est dans l'adresse (#cours…) pour que le retour du téléphone marche. */
type Tab = 'agenda' | 'cours' | 'messages' | 'profil';
const TABS: { id: Tab; label: string }[] = [
  { id: 'agenda', label: 'Calendrier' },
  { id: 'cours', label: 'Cours' },
  { id: 'messages', label: 'Messagerie' },
  { id: 'profil', label: 'Profil' },
];
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'agenda';
};

/** Caches de session de l'appli (documents, adhésions, libellés, météo, sorties DP) : effacés à la déconnexion, le téléphone peut être partagé. */
const SESSION_CACHE_PREFIXES = ['docs-status:', 'member-record:', 'club-member-v2:', 'my-labels:', 'meteo:', 'dp-events:'];
function clearSessionCaches() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && SESSION_CACHE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
    // Listes d'inscrits gardées pour les statistiques (sur l'appareil, d'une session à l'autre).
    const kept: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('stats-roster:')) kept.push(k);
    }
    kept.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Stockage interdit (navigation privée) : rien à effacer.
  }
}

/** Le pare-feu VPDive coupe les rafales : une pause entre deux lectures de liste d'inscrits. */
const pause = () => new Promise<void>((r) => setTimeout(r, 400));

/** Sorties où le membre est DP, gardées une heure dans l'onglet pour ne pas relire toutes les listes d'inscrits à chaque visite. */
const DP_CACHE_TTL = 60 * 60 * 1000;
const dpCacheKey = (s: Session) => `dp-events:${s.userId ?? ''}`;
const readDpCache = (key: string): string[] | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; tokens: string[] };
    return Date.now() - v.at < DP_CACHE_TTL && Array.isArray(v.tokens) ? v.tokens : null;
  } catch {
    return null;
  }
};
const writeDpCache = (key: string, tokens: string[]) => {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), tokens }));
  } catch {
    // Stockage plein ou interdit : on relira à la prochaine visite.
  }
};

/**
 * « Voir en tant que » (super-admin) : les droits d'un autre membre, simulés
 * dans le navigateur. Son rôle dans l'appli, et les sorties où il est DP
 * (null tant qu'on les cherche, avec l'avancement de la recherche). Le serveur, lui, voit toujours le compte connecté.
 */
type ViewAs = ViewAsPick & { dpEvents: string[] | null; progress: { done: number; total: number } | null };

export default function App() {
  const [session, setSession] = useState<Session | null>(() => vpdive.getSession());
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  const handleSessionLost = useCallback((e: unknown) => {
    if (e instanceof SessionExpiredError) {
      setSession(null);
      setLoginNotice(e.message);
      return true;
    }
    return false;
  }, []);

  const handleLogout = useCallback(async () => {
    // D'abord le serveur de l'appli (il lui faut encore la session VPDive), puis VPDive, puis le local.
    await appApi.logout();
    vpdive.logout();
    clearSessionCaches();
    setLoginNotice(null);
    setSession(null);
  }, []);

  if (!session) {
    return (
      <LoginPage
        notice={loginNotice}
        onLoginSuccess={(s) => {
          setLoginNotice(null);
          setSession(s);
        }}
      />
    );
  }

  // Clé = jeton : une autre session remonte tout de zéro, rien (rôle, menu DP, pastille, « voir en tant que ») ne survit à la déconnexion.
  return <SignedIn key={session.token} session={session} onLogout={handleLogout} onSessionLost={handleSessionLost} />;
}

/** Tout ce qui dépend d'une session connectée : état, appels VPDive et écran principal. */
function SignedIn({ session, onLogout, onSessionLost: handleSessionLost }: { session: Session; onLogout: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [month, setMonth] = useState<Date>(thisMonth);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meteo, setMeteo] = useState<Record<string, MeteoSlot[]>>({});
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [panel, setPanel] = useState<'dp' | 'weather' | 'material' | 'members' | 'docs' | 'stats' | null>(null);
  const [dpEvent, setDpEvent] = useState<CalendarEvent | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  /** Sorties où le membre connecté est DP (jetons) ; null tant qu'on ne les connaît pas. */
  const [dpEvents, setDpEvents] = useState<string[] | null>(null);
  const [picture, setPicture] = useState<string | undefined>(session.picture);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [unread, setUnread] = useState(0);
  const [viewAs, setViewAs] = useState<ViewAs | null>(null);
  const viewAsId = useRef(0);
  const loadId = useRef(0);
  // Rôle dans l'appli, décidé par le serveur (server/handler.ts) : super-admin,
  // admin (admin VPDive dont le rôle n'a pas été retiré) ou membre.
  const realRole = me?.role ?? 'member';
  const role = viewAs?.role ?? realRole;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isDp = (dpEvents?.length ?? 0) > 0;
  const canDp = isAdmin || (viewAs ? (viewAs.dpEvents?.length ?? 0) > 0 : isDp);

  const loadEvents = useCallback(async () => {
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
  }, [month, handleSessionLost]);

  // Les autres écrans arrivent en tâche de fond, une fois l'agenda affiché.
  useEffect(() => preloadScreens(), []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Rôle relu à chaque visite (la session VPDive dure 30 jours, les rôles peuvent changer entre-temps).
  const loadMe = useCallback(() => {
    setMeError(null);
    appApi.me().then(setMe, (e) => {
      if (handleSessionLost(e)) return;
      console.warn('Rôle dans l’appli non lu :', e);
      // Autre erreur qu'une session perdue : la messagerie propose de réessayer au lieu de charger sans fin.
      setMeError(e instanceof Error ? e.message : String(e));
    });
  }, [handleSessionLost]);
  useEffect(() => {
    loadMe();
  }, [loadMe]);

  // Un membre qui n'est pas admin a le menu DP s'il est directeur de plongée
  // d'une sortie où il est inscrit (même fenêtre que le menu DP : 14 jours en arrière, 60 en avant).
  useEffect(() => {
    if (!me || me.role !== 'member') return;
    const key = dpCacheKey(session);
    const cached = readDpCache(key);
    if (cached) {
      setDpEvents(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const today = new Date();
      const from = new Date(today);
      from.setDate(from.getDate() - 14);
      const to = new Date(today);
      to.setDate(to.getDate() + 60);
      const mine = (await vpdive.fetchEvents(ymd(from), ymd(to))).filter((e) => e.registered);
      const tokens: string[] = [];
      // Toutes ses sorties comme DP (le menu DP en a besoin), listes lues une à une avec une pause.
      for (const e of mine) {
        if (cancelled) return;
        const roster = await vpdive.fetchRoster(e.token).catch(() => []);
        if (roster.some((r) => r.id === String(session.userId) && r.roles.some((x) => DP_ROLE.test(x)))) tokens.push(e.token);
        await pause();
      }
      if (cancelled) return;
      writeDpCache(key, tokens);
      setDpEvents(tokens);
    })().catch((e) => handleSessionLost(e) || console.warn('Rôle DP non vérifié :', e));
    return () => {
      cancelled = true;
    };
  }, [me, session, handleSessionLost]);

  // Photo du compte : les sessions enregistrées avant ce champ la relisent une fois sur VPDive.
  useEffect(() => {
    if (session.picture !== undefined) {
      setPicture(session.picture);
      return;
    }
    vpdive.refreshPicture().then(setPicture, (e) => handleSessionLost(e) || console.warn('Photo non lue :', e));
  }, [session, handleSessionLost]);

  /** Voir le site avec les droits d'un membre : son rôle, puis les sorties où VPDive l'inscrit DP (même fenêtre que le menu DP). */
  const startViewAs = useCallback(
    async (pick: ViewAsPick) => {
      const id = ++viewAsId.current;
      setActiveEvent(null);
      setPanel(null);
      // Admin simulé : le menu DP lui est acquis, inutile de lire une seule liste d'inscrits.
      if (pick.role !== 'member') return setViewAs({ ...pick, dpEvents: [], progress: null });
      setViewAs({ ...pick, dpEvents: null, progress: null });
      const update = (patch: Partial<ViewAs>) => {
        if (id === viewAsId.current) setViewAs((v) => (v && v.uct === pick.uct ? { ...v, ...patch } : v));
      };
      try {
        const today = new Date();
        const from = new Date(today);
        from.setDate(from.getDate() - 14);
        const to = new Date(today);
        to.setDate(to.getDate() + 60);
        // Seulement les sorties qui ont des inscrits, une liste à la fois avec une pause : le pare-feu VPDive bloque les rafales.
        const list = (await vpdive.fetchEvents(ymd(from), ymd(to))).filter((e) => e.registeredCount > 0);
        const dpEvents: string[] = [];
        for (let i = 0; i < list.length; i++) {
          if (id !== viewAsId.current) return;
          update({ progress: { done: i + 1, total: list.length } });
          const roster = await vpdive.fetchRoster(list[i]!.token).catch(() => []);
          if (roster.some((r) => sameName(r.name, pick.name) && r.roles.some((x) => DP_ROLE.test(x)))) dpEvents.push(list[i]!.token);
          await pause();
        }
        update({ dpEvents, progress: null });
      } catch (e) {
        if (handleSessionLost(e)) return;
        update({ dpEvents: [], progress: null });
      }
    },
    [handleSessionLost],
  );
  const stopViewAs = () => {
    viewAsId.current++;
    setViewAs(null);
    setActiveEvent(null);
    setPanel(null);
  };

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const goTo = (t: Tab) => {
    if (t === tab) return window.scrollTo({ top: 0 });
    window.location.hash = t === 'agenda' ? '' : t;
    window.scrollTo({ top: 0 });
  };

  // Pastille de la messagerie (celle de VPDive) : conversations non lues, relues toutes les minutes.
  const refreshUnread = useCallback(() => {
    if (!vpdive.getSession()) return;
    // Session perdue pendant la relecture : retour à la connexion, pas une pastille à zéro en silence.
    messaging.unread().then(setUnread, (e) => {
      if (!handleSessionLost(e)) setUnread(0);
    });
  }, [handleSessionLost]);
  useEffect(() => {
    // Onglet caché : pas de relecture (pare-feu VPDive) ; relue dès le retour au premier plan.
    const tick = () => {
      if (!document.hidden) refreshUnread();
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshUnread]);

  // Weather is a bonus: if Open-Meteo is down the agenda still works, just without wind badges.
  useEffect(() => {
    vpdive.fetchMeteo().then(setMeteo, (e) => console.warn('Météo indisponible :', e));
  }, []);

  const displayName = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const connected = !error && !isLoading;
  // Imprimer depuis le menu DP n'imprime que la fiche, pas l'agenda derrière.
  const printPanel = panel ? 'print:hidden' : '';

  return (
    <div className="min-h-dvh text-ink flex flex-col font-sans">
      <SeaBackdrop />
      <header className={`sticky top-0 z-30 bg-surface border-b border-line ${printPanel}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-[4.5rem] gap-3">
            <a href="https://www.septentrion-env.com/" target="_blank" rel="noreferrer" className="shrink-0" title="septentrion-env.com">
              <Logo className="h-12 sm:h-14" />
            </a>

            {/* Ordinateur et tablette : les onglets dans l'en-tête, sauf Profil, déjà au menu du compte à droite */}
            <nav aria-label="Navigation" className="hidden sm:flex items-stretch self-stretch gap-1">
              {TABS.filter((t) => t.id !== 'profil').map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => goTo(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={`relative inline-flex items-center gap-2 px-3 text-sm font-semibold transition-colors ${tab === t.id ? 'text-brand' : 'text-muted hover:text-ink'}`}
                >
                  <TabIcon tab={t.id} picture={picture} name={displayName} />
                  <span className="hidden md:inline">{t.label}</span>
                  {t.id === 'messages' && unread > 0 && <UnreadBadge count={unread} />}
                  {tab === t.id && <span aria-hidden className="alpha absolute left-3 bottom-0 w-6 h-1.5 bg-brand" />}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              <span
                title={error ? 'VPDive injoignable' : connected ? 'VPDive connecté' : 'Synchronisation…'}
                className={`hidden lg:block w-2 h-2 mr-1 rounded-full ${error ? 'bg-danger' : connected ? 'bg-green' : 'bg-line'}`}
              />

              {canDp && (
                <HeaderMenu
                  icon={<CaptainHat className="w-5 h-5" />}
                  label="Gestion sortie"
                  items={[
                    { icon: <ClipboardList className="w-4 h-4" />, label: 'DP', hint: 'Palanquées et fiches de sécurité', onClick: () => setPanel('dp') },
                    { icon: <Wind className="w-4 h-4" />, label: 'Météo', hint: 'Vent, rafales, vagues, houle', onClick: () => setPanel('weather') },
                    ...(isAdmin
                      ? [{ icon: <Package className="w-4 h-4" />, label: 'Matériel', hint: 'Gilets, combinaisons, bouteilles', onClick: () => setPanel('material') }]
                      : []),
                  ]}
                />
              )}
              {isAdmin && (
                <HeaderMenu
                  icon={<Settings className="w-5 h-5" />}
                  label="Admin"
                  items={[
                    { icon: <Users className="w-4 h-4" />, label: 'Gestion des membres', hint: realRole === 'superadmin' ? 'Rôles et doublons' : 'Doublons', onClick: () => setPanel('members') },
                    { icon: <FileWarning className="w-4 h-4" />, label: 'Gestion des adhésions', hint: 'HelloAsso, FFESSM, VPDive, relances', onClick: () => setPanel('docs') },
                    ...(realRole === 'superadmin'
                      ? [{ icon: <BarChart3 className="w-4 h-4" />, label: 'Stats', hint: 'Sorties, plongeurs, niveaux, âges', onClick: () => setPanel('stats') }]
                      : []),
                  ]}
                />
              )}
              <ThemeToggle />

              <AccountMenu
                name={displayName}
                email={session.email}
                picture={picture}
                role={realRole}
                onProfile={() => goTo('profil')}
                onViewAs={startViewAs}
                onLogout={onLogout}
                onSessionLost={handleSessionLost}
              />
            </div>
          </div>
        </div>
        {viewAs && (
          <div className="border-t border-warn/30 bg-warn-soft text-warn">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <Eye className="w-4 h-4 shrink-0" />
              <span className="flex-1 min-w-0">
                Vous voyez le site comme <strong className="font-semibold">{viewAs.name}</strong> · {ROLE_LABEL[viewAs.role]}
                {viewAs.role === 'member' &&
                  (viewAs.dpEvents === null
                    ? ` · recherche de ses sorties comme DP…${viewAs.progress ? ` ${viewAs.progress.done}/${viewAs.progress.total}` : ''}`
                    : viewAs.dpEvents.length
                      ? ` · DP de ${viewAs.dpEvents.length} sortie${viewAs.dpEvents.length > 1 ? 's' : ''}`
                      : ' · DP d’aucune sortie à venir')}
                . Les inscriptions affichées restent les vôtres.
              </span>
              <button type="button" onClick={stopViewAs} className="btn h-8 px-3 text-sm bg-surface border border-warn/40 text-warn hover:bg-raised">
                Revenir à mon compte
              </button>
            </div>
          </div>
        )}
      </header>

      <main className={`flex-1 pb-20 sm:pb-0 ${printPanel}`}>
        <Suspense fallback={<GabianLoader className="py-16" />}>
          {tab === 'agenda' && (
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
          )}
          {tab === 'cours' && <CoursesView onOpenEvent={setActiveEvent} onSessionLost={handleSessionLost} />}
          {tab === 'messages' &&
            (me ? (
              <MessagesView me={{ uct: me.uct, name: displayName, picture: picture ?? '' }} onSessionLost={handleSessionLost} onRead={refreshUnread} />
            ) : meError ? (
              <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-danger">{meError}</span>
                <button type="button" onClick={loadMe} className="btn btn-quiet">
                  Réessayer
                </button>
              </div>
            ) : (
              <GabianLoader className="py-16" />
            ))}
          {tab === 'profil' && <ProfileView session={session} me={me} picture={picture} onLogout={onLogout} onSessionLost={handleSessionLost} />}
        </Suspense>
      </main>

      {/* Téléphone : la barre d'onglets en bas, à portée de pouce */}
      <nav
        aria-label="Navigation"
        className={`sm:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line grid grid-cols-4 pb-[env(safe-area-inset-bottom)] ${printPanel}`}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => goTo(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 h-16 text-xs font-medium ${tab === t.id ? 'text-brand font-semibold' : 'text-muted'}`}
          >
            {tab === t.id && <span aria-hidden className="alpha absolute top-0 left-1/2 -translate-x-1/2 w-7 h-1.5 bg-brand" />}
            <span className="relative">
              <TabIcon tab={t.id} picture={picture} name={displayName} large />
              {t.id === 'messages' && unread > 0 && <UnreadBadge count={unread} floating />}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

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

      <Suspense fallback={<PanelFallback />}>
        {panel === 'dp' && canDp && (
          <DpPanel
            session={session}
            role={role}
            // Membre : ses sorties DP déjà trouvées ici, le menu DP ne relit pas les listes d'inscrits.
            dpEvents={viewAs && viewAs.role === 'member' ? (viewAs.dpEvents ?? []) : role === 'member' ? (dpEvents ?? []) : undefined}
            initialEvent={dpEvent}
            onClose={() => {
              setPanel(null);
              setDpEvent(null);
            }}
            onSessionLost={handleSessionLost}
          />
        )}
        {panel === 'members' && isAdmin && me && <MembersPanel me={{ ...me, role }} onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />}
        {panel === 'weather' && canDp && <WeatherPanel onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />}
        {panel === 'material' && isAdmin && <MaterialPanel onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />}
        {panel === 'stats' && realRole === 'superadmin' && <StatsPanel onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />}
        {panel === 'docs' && isAdmin && me && (
          <DocsPanel me={{ uct: me.uct, name: displayName, picture: picture ?? '' }} onClose={() => setPanel(null)} onSessionLost={handleSessionLost} />
        )}
      </Suspense>

      <footer className={`relative bg-band text-on-band px-4 pt-8 pb-28 sm:pb-8 mt-16 ${printPanel}`}>
        {/* Le bandeau marine sort de l'eau par une vague, au lieu d'une coupure droite */}
        <svg aria-hidden className="absolute bottom-full inset-x-0 w-full h-6 text-band" viewBox="0 0 1440 24" preserveAspectRatio="none">
          <path fill="currentColor" d="M0 14 C 180 2 360 2 540 12 S 900 24 1080 12 S 1320 4 1440 10 V24 H0 Z" />
        </svg>
        {/*
          Le Cromagnon dans le creux de la vague : le point le plus bas de la courbe (x = 810 sur 1440, soit 56 %)
          n'est qu'à 4 px au-dessus du bandeau, la coque repose sur la surface au lieu de disparaître dedans.
        */}
        <Cromagnon className="absolute bottom-full left-[calc(56%-5rem)] sm:left-[calc(56%-6.5rem)] -mb-0.5 w-40 sm:w-52 text-brand pointer-events-none" />
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

/** Le temps qu'un panneau arrive : le même voile que lui, pour que l'ouverture ne saute pas. */
function PanelFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div className="bg-surface rounded-xl px-8">
        <GabianLoader className="py-6" />
      </div>
    </div>
  );
}

function TabIcon({ tab, picture, name, large }: { tab: Tab; picture?: string; name: string; large?: boolean }) {
  const cls = large ? 'w-6 h-6' : 'w-5 h-5';
  if (tab === 'agenda') return <CalendarDays className={cls} />;
  if (tab === 'cours') return <GraduationCap className={cls} />;
  if (tab === 'messages') return <MessageCircle className={cls} />;
  // Profil : la photo du membre quand VPDive en a une.
  return picture ? <Avatar name={name} picture={picture} size="sm" className={large ? 'w-6 h-6' : 'w-5 h-5'} /> : <UserRound className={cls} />;
}

function UnreadBadge({ count, floating }: { count: number; floating?: boolean }) {
  return (
    <span
      aria-label={`${count} non lu${count > 1 ? 's' : ''}`}
      className={`min-w-5 h-5 px-1 rounded-full bg-pink text-on-pink text-xs font-bold tabular-nums inline-flex items-center justify-center ${floating ? 'absolute -top-1.5 -right-3' : ''}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
