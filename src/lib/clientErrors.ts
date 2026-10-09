/**
 * Erreurs du navigateur : rechargement automatique après une mise en ligne, et
 * remontée au serveur (POST /api/app?action=client_error) pour qu'on les voie.
 *
 * Après une mise en ligne, les fichiers de l'ancienne version (assets/*.js, gardés
 * en cache « immutable » par vercel.json) n'existent plus : un écran chargé à la
 * demande (React.lazy) échoue alors. On recharge la page une fois pour prendre la
 * nouvelle version ; si ça recommence juste après, on n'insiste pas, l'écran
 * d'erreur propose de recharger à la main.
 */
import { appApi } from '../services/appApi';

/** Import dynamique (écran chargé à la demande) qui a échoué : fichier disparu ou réseau coupé. */
export function isChunkLoadError(e: unknown): boolean {
  const message = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError|Failed to fetch dynamically/i.test(message);
}

const RELOAD_KEY = 'gabian:auto-reload';
/** Un seul rechargement automatique par incident : pas de second avant ce délai. */
const RELOAD_GUARD_MS = 5 * 60_000;

/**
 * Recharge la page pour prendre la nouvelle version, sauf si on vient déjà de le faire
 * (garde dans sessionStorage) ou si l'appareil est hors ligne (la page ne reviendrait pas).
 * true : rechargement lancé.
 */
export function reloadOnce(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Stockage interdit : sans garde possible, on ne recharge pas tout seul (risque de boucle).
    return false;
  }
  window.location.reload();
  return true;
}

/** Préchargements d'écrans en tâche de fond en cours (App.tsx) : un échec n'y recharge pas la page. */
let backgroundLoads = 0;
export async function inBackground<T>(load: () => Promise<T>): Promise<T> {
  backgroundLoads++;
  try {
    return await load();
  } finally {
    backgroundLoads--;
  }
}

const MAX_REPORTS = 5;
const REPORTS_KEY = 'gabian:error-reports';
const sent = new Set<string>();

/**
 * Remonte une erreur au serveur, sans jamais lever d'erreur ni rien attendre. Dédoublonnée
 * (même message au même endroit : une fois) et limitée à quelques envois par session d'onglet.
 */
export function reportError(error: unknown, where: string): void {
  try {
    const e = error instanceof Error ? error : null;
    const message = (e ? `${e.name}: ${e.message}` : String(error)).slice(0, 500);
    const key = `${where}|${message}`;
    if (sent.has(key)) return;
    let count = 0;
    try {
      count = Number(sessionStorage.getItem(REPORTS_KEY) ?? 0);
      if (count >= MAX_REPORTS) return;
      sessionStorage.setItem(REPORTS_KEY, String(count + 1));
    } catch {
      if (sent.size >= MAX_REPORTS) return;
    }
    sent.add(key);
    void appApi.reportClientError({ message, stack: e?.stack?.slice(0, 4000), url: location.href.slice(0, 500), where: where.slice(0, 100) });
  } catch {
    // Remonter une erreur ne doit jamais en provoquer une autre.
  }
}

/** Bruit sans intérêt : session expirée (gérée par l'appli), boucles de ResizeObserver, scripts d'extensions. */
function ignored(error: unknown, filename?: string): boolean {
  if (error instanceof Error && error.name === 'SessionExpiredError') return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/ResizeObserver loop/.test(message)) return true;
  if (filename && !filename.startsWith(location.origin)) return true;
  return false;
}

let installed = false;
/**
 * À appeler une fois au démarrage (main.tsx) : erreurs non rattrapées et promesses rejetées
 * sans traitement remontées au serveur ; échec de préchargement Vite (vite:preloadError) ou
 * d'import dynamique : rechargement unique pour prendre la nouvelle version.
 */
export function installErrorHandlers(): void {
  if (installed) return;
  installed = true;

  // Vite précharge les fichiers d'un écran avant de l'importer : leur absence veut dire
  // nouvelle version en ligne. Pendant un préchargement de fond, on ne recharge pas la page
  // sous les doigts du membre : l'écran, s'il est ouvert, échouera et rechargera à ce moment-là.
  window.addEventListener('vite:preloadError', (event) => {
    if (backgroundLoads > 0) return;
    if (reloadOnce()) event.preventDefault();
  });

  window.addEventListener('error', (event) => {
    if (ignored(event.error ?? event.message, event.filename)) return;
    reportError(event.error ?? event.message, 'window.onerror');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    // Import dynamique raté hors écran (bouton PDF…) : déjà traité par vite:preloadError ci-dessus,
    // que Vite émet aussi quand le fichier importé lui-même manque.
    if (ignored(reason) || (isChunkLoadError(reason) && backgroundLoads > 0)) return;
    reportError(reason, 'unhandledrejection');
  });
}
