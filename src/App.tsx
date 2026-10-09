import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ExternalLink, ClipboardList, Eye, CalendarDays, FileWarning, GraduationCap, MessageCircle, Package, RefreshCw, Settings, UserRound, Users, Wind, BarChart3 } from 'lucide-react';
import { Logo } from './components/Brand';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './components/LoginPage';
import { StandardCalendar } from './components/StandardCalendar';
import { EventBookingModal } from './components/EventBookingModal';
import { SeaBackdrop } from './components/SeaBackdrop';
import { CaptainHat, HeaderMenu } from './components/HeaderMenu';
import { AccountMenu } from './components/AccountMenu';
import { ROLE_LABEL } from './lib/roleLabels';
import { Avatar } from './components/Avatar';
import { Cromagnon } from './components/Cromagnon';
import { GabianLoader } from './components/Gabian';
import { ErrorBoundary, PanelError } from './components/ErrorBoundary';
import { ReconnectDialog } from './components/ReconnectDialog';
import { CoursesView } from './components/views/CoursesView';
import { vpdive, type CalendarEvent, type Session } from './services/vpdive';
import { DP_SCAN_FAILED } from './services/dpEvents';
import type { AppRole } from './services/appApi';
import { inBackground } from './lib/clientErrors';
import { useSessionState } from './hooks/useSessionState';
import { useMe } from './hooks/useMe';
import { useDpEvents } from './hooks/useDpEvents';
import { useViewAs } from './hooks/useViewAs';
import { useUnread } from './hooks/useUnread';
import { useTab, TABS, type Tab } from './hooks/useTab';
import { useAgenda } from './hooks/useAgenda';

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

type Screen = keyof typeof screens;

/** Les écrans qu'un rôle peut ouvrir : seuls ceux-là sont préchargés (un membre ne télécharge pas l'administration). */
function screensFor(role: AppRole, isDp: boolean): Screen[] {
  const list: Screen[] = ['messages', 'profile'];
  if (role !== 'member' || isDp) list.push('dp', 'weather');
  if (role !== 'member') list.push('material', 'docs', 'members');
  if (role === 'superadmin') list.push('stats');
  return list;
}

/** Écrans déjà téléchargés (ou en cours) depuis l'ouverture de la page. */
const preloaded = new Set<Screen>();

/**
 * Télécharge ces écrans quand la page est au repos (les menus et onglets s'ouvrent alors sans
 * cadre de chargement). Un échec ici est sans conséquence (lib/clientErrors : pas de
 * rechargement de la page en tâche de fond) : l'écran réessaiera à son ouverture.
 */
function preloadScreens(list: Screen[]): () => void {
  const todo = list.filter((s) => !preloaded.has(s));
  if (!todo.length) return () => {};
  const run = () =>
    todo.forEach((s) => {
      preloaded.add(s);
      void inBackground<unknown>(screens[s]).catch(() => preloaded.delete(s));
    });
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 2000);
  return () => clearTimeout(id);
}

export default function App() {
  const { session, setSession, lost, onSessionLost, logout, reconnected } = useSessionState();

  // Premier lancement, ou après « Se déconnecter » : la page de connexion entière.
  if (!session) return <LoginPage onLoginSuccess={setSession} />;

  return (
    <>
      {/* Clé = membre : un autre compte remonte tout de zéro, rien (rôle, menu DP, pastille, « voir en tant que ») ne survit au changement. */}
      <SignedIn key={String(session.userId ?? session.email)} session={session} onLogout={logout} onSessionLost={onSessionLost} />
      {lost && <ReconnectDialog notice={lost} email={session.email} onReconnected={reconnected} onLogout={() => void logout()} />}
    </>
  );
}

/** Tout ce qui dépend d'une session connectée : état, appels VPDive et écran principal. */
function SignedIn({ session, onLogout, onSessionLost: handleSessionLost }: { session: Session; onLogout: () => void; onSessionLost: (e: unknown) => boolean }) {
  const { month, setMonth, events, isLoading, error, loadEvents } = useAgenda(handleSessionLost);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [panel, setPanel] = useState<'dp' | 'weather' | 'material' | 'members' | 'docs' | 'stats' | null>(null);
  const [dpEvent, setDpEvent] = useState<CalendarEvent | null>(null);
  const { me, meError, fetchMe, retryMe } = useMe(handleSessionLost);
  /** Photo relue sur VPDive pour les sessions enregistrées avant que la session la garde. */
  const [fetchedPicture, setFetchedPicture] = useState<string | undefined>(undefined);
  // La photo relue (à l’ouverture du profil) passe avant celle gardée dans la session.
  const picture = fetchedPicture ?? session.picture;
  const { tab, goTo } = useTab();
  const { unread, refreshUnread } = useUnread(handleSessionLost);
  const {
    viewAs,
    start: startViewAs,
    stop: stopViewAs,
    retry: retryViewAs,
  } = useViewAs(handleSessionLost, () => {
    setActiveEvent(null);
    setPanel(null);
  });
  // Rôle dans l'appli, décidé par le serveur (server/handler.ts) : super-admin,
  // admin (admin VPDive dont le rôle n'a pas été retiré) ou membre.
  const realRole = me?.role ?? 'member';
  const role = viewAs?.role ?? realRole;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const dp = useDpEvents(session, me?.role === 'member', handleSessionLost);
  /** Sorties où le membre connecté est DP (jetons) ; null tant qu'on ne les connaît pas (ou pas membre simple). */
  const dpEvents = dp.dpEvents;
  const isDp = dp.isDp;
  const canDp = isAdmin || (viewAs ? (viewAs.dpEvents?.length ?? 0) > 0 : isDp);
  /** Recherche des sorties DP incomplète (simple membre, ou membre vu « en tant que ») : à réessayer. */
  const dpUnchecked = viewAs ? viewAs.role === 'member' && viewAs.failed : dp.failed;
  /** « Réessayer » la recherche des sorties DP : la sienne, ou celle du membre vu « en tant que ». */
  const retryDp = () => (viewAs ? retryViewAs() : dp.retry());

  // Les autres écrans arrivent en tâche de fond, une fois l'agenda affiché : ceux que le rôle
  // permet d'ouvrir (l'administration et le menu DP seulement pour qui y a accès).
  useEffect(() => preloadScreens(screensFor(realRole, isDp)), [realRole, isDp]);

  // Photo du compte : les sessions enregistrées avant ce champ la relisent une fois sur VPDive.
  const sessionPicture = session.picture;
  useEffect(() => {
    if (sessionPicture !== undefined) return;
    vpdive.refreshPicture().then(setFetchedPicture, (e) => handleSessionLost(e) || console.warn('Photo non lue :', e));
  }, [sessionPicture, handleSessionLost]);

  // Après une reconnexion (fenêtre ReconnectDialog), ce qui avait échoué faute de session est relu.
  const tokenSeen = useRef(session.token);
  useEffect(() => {
    if (tokenSeen.current === session.token) return;
    tokenSeen.current = session.token;
    void loadEvents();
    fetchMe();
  }, [session.token, loadEvents, fetchMe]);

  const displayName = `${session.firstName} ${session.lastName}`.trim() || session.email;
  const connected = !error && !isLoading;
  const vpdiveStatus = error ? 'VPDive injoignable' : connected ? 'VPDive connecté' : 'Synchronisation avec VPDive…';
  const closePanel = () => {
    setPanel(null);
    setDpEvent(null);
  };
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

            {/* Ordinateur et tablette : les onglets dans l'en-tête, sauf Profil, déjà au menu du compte à droite.
                L'écran courant est la pilule rose (tab-pill, d'après aria-current). */}
            <nav aria-label="Navigation" className="hidden sm:flex items-center gap-1">
              {TABS.filter((t) => t.id !== 'profil').map((t) => (
                <button key={t.id} type="button" onClick={() => goTo(t.id)} aria-current={tab === t.id ? 'page' : undefined} className="tab-pill px-3">
                  <TabIcon tab={t.id} picture={picture} name={displayName} />
                  <span className="hidden md:inline">{t.label}</span>
                  {t.id === 'messages' && unread > 0 && <UnreadBadge count={unread} onAccent={tab === t.id} />}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-1 sm:gap-2 min-w-0">
              {/* État de VPDive : la couleur pour l'œil, le texte (caché) pour les lecteurs d'écran. */}
              <span title={vpdiveStatus} className="hidden lg:inline-flex items-center mr-1">
                <span aria-hidden className={`w-2 h-2 rounded-full ${error ? 'bg-danger' : connected ? 'bg-ok' : 'bg-line'}`} />
                <span className="sr-only">{vpdiveStatus}</span>
              </span>

              {(canDp || dpUnchecked) && (
                <HeaderMenu
                  icon={<CaptainHat className="w-5 h-5" />}
                  label="Gestion de sortie"
                  active={panel === 'dp' || panel === 'weather' || panel === 'material'}
                  items={[
                    // Une liste d'inscrits illisible : on ne sait pas si le membre est DP, on le dit ici.
                    ...(dpUnchecked ? [{ icon: <RefreshCw className="w-4 h-4" />, label: `${DP_SCAN_FAILED}, réessayer`, onClick: retryDp }] : []),
                    ...(canDp
                      ? [
                          { icon: <ClipboardList className="w-4 h-4" />, label: 'DP', hint: 'Palanquées et fiches de sécurité', onClick: () => setPanel('dp') },
                          { icon: <Wind className="w-4 h-4" />, label: 'Météo', hint: 'Vent, rafales, vagues, houle', onClick: () => setPanel('weather') },
                        ]
                      : []),
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
                  active={panel === 'members' || panel === 'docs' || panel === 'stats'}
                  items={[
                    { icon: <Users className="w-4 h-4" />, label: 'Gestion des membres', hint: realRole === 'superadmin' ? 'Rôles et doublons' : 'Doublons', onClick: () => setPanel('members') },
                    { icon: <FileWarning className="w-4 h-4" />, label: 'Gestion des adhésions', hint: 'HelloAsso, FFESSM, VPDive, relances', onClick: () => setPanel('docs') },
                    ...(realRole === 'superadmin'
                      ? [{ icon: <BarChart3 className="w-4 h-4" />, label: 'Statistiques', hint: 'Sorties, plongeurs, niveaux, âges', onClick: () => setPanel('stats') }]
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
                    : viewAs.failed
                      ? ` · ${DP_SCAN_FAILED.charAt(0).toLowerCase()}${DP_SCAN_FAILED.slice(1)} (menu Gestion de sortie pour réessayer)`
                      : viewAs.dpEvents.length
                      ? ` · DP de ${viewAs.dpEvents.length} sortie${viewAs.dpEvents.length > 1 ? 's' : ''}`
                      : ' · DP d’aucune sortie à venir')}
                . Les inscriptions affichées restent les vôtres.
              </span>
              <button type="button" onClick={stopViewAs} className="btn sm:h-8 px-3 text-sm bg-surface border border-warn/40 text-warn hover:bg-raised">
                Revenir à mon compte
              </button>
            </div>
          </div>
        )}
      </header>

      <main className={`flex-1 pb-[calc(5rem_+_env(safe-area-inset-bottom))] sm:pb-0 ${printPanel}`}>
        {/* Un onglet en panne n'emporte pas l'appli : message à sa place, en-tête et onglets utilisables. */}
        <ErrorBoundary key={tab} where={`onglet ${tab}`}>
          <Suspense fallback={<GabianLoader className="py-16" />}>
            {tab === 'agenda' && (
              <StandardCalendar
                month={month}
                onMonthChange={setMonth}
                events={events}
                isLoading={isLoading}
                error={error}
                onRefresh={() => void loadEvents(true)}
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
                  <button type="button" onClick={retryMe} className="btn btn-quiet">
                    Réessayer
                  </button>
                </div>
              ) : (
                <GabianLoader className="py-16" />
              ))}
            {tab === 'profil' && <ProfileView session={session} me={me} picture={picture} onPicture={setFetchedPicture} onLogout={onLogout} onSessionLost={handleSessionLost} />}
          </Suspense>
        </ErrorBoundary>
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
            className={`relative flex flex-col items-center justify-center gap-0.5 h-16 text-xs ${tab === t.id ? 'text-brand font-bold' : 'text-muted font-medium'}`}
          >
            {/* L'écran courant : l'icône dans une pilule rose (le rose en fond, jamais en texte). */}
            <span className={`relative inline-flex items-center justify-center w-14 h-8 rounded-full transition-colors ${tab === t.id ? 'bg-accent text-on-accent' : ''}`}>
              <TabIcon tab={t.id} picture={picture} name={displayName} large />
              {t.id === 'messages' && unread > 0 && <UnreadBadge count={unread} floating onAccent={tab === t.id} />}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {activeEvent && !panel && (
        <ErrorBoundary key={activeEvent.token} where="fiche de sortie" fallback={(e) => <PanelError error={e} onClose={() => setActiveEvent(null)} />}>
          <EventBookingModal
            event={activeEvent}
            onClose={() => setActiveEvent(null)}
            onChanged={() => void loadEvents()}
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
        </ErrorBoundary>
      )}

      {/* Un panneau en panne (ou introuvable après une mise en ligne) : message dans une fenêtre qu'on peut fermer. */}
      <ErrorBoundary key={panel ?? 'aucun'} where={`panneau ${panel ?? ''}`} fallback={(e) => <PanelError error={e} onClose={closePanel} />}>
        <Suspense fallback={<PanelFallback />}>
          {panel === 'dp' && canDp && (
            <DpPanel
              session={session}
              role={role}
              // Membre : ses sorties DP déjà trouvées ici, le menu DP ne relit pas les listes d'inscrits.
              dpEvents={viewAs && viewAs.role === 'member' ? (viewAs.dpEvents ?? []) : role === 'member' ? (dpEvents ?? []) : undefined}
              initialEvent={dpEvent}
              onClose={closePanel}
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
      </ErrorBoundary>

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

/** Compteur de non-lus : rose, ou marine sur la pilule rose de l'onglet courant (sinon il s'y fondrait). */
function UnreadBadge({ count, floating, onAccent }: { count: number; floating?: boolean; onAccent?: boolean }) {
  return (
    <span
      role="img"
      aria-label={`${count} non lu${count > 1 ? 's' : ''}`}
      className={`min-w-5 h-5 px-1 rounded-full ${onAccent ? 'bg-on-accent text-white' : 'bg-pink text-on-pink'} text-xs font-bold tabular-nums inline-flex items-center justify-center ${floating ? 'absolute -top-0.5 right-1' : ''}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
