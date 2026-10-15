/**
 * Nouvelle version en ligne : l'appli se recharge d'elle-même quand le membre y
 * revient (téléphone sorti de veille, onglet retrouvé), au lieu de garder
 * l'ancienne jusqu'à ce qu'un écran manque (voir clientErrors.ts).
 *
 * La version, c'est le fichier principal que cite index.html
 * (« /assets/index-C4dqyIHi.js », son nom change à chaque construction) : on
 * relit index.html sans cache et on compare avec celui de la page ouverte.
 */
import { reloadOnce } from './clientErrors';

/** Le fichier principal cité par une page index.html, null s'il n'y en a pas. */
export function entryScript(html: string): string | null {
  return /<script[^>]*\btype="module"[^>]*\bsrc="([^"]*\/assets\/index-[^"]+\.js)"/.exec(html)?.[1] ?? null;
}

/** Pas plus d'une vérification par période : un aller-retour d'onglet ne relit pas index.html. */
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Le membre est en train de faire quelque chose qu'un rechargement perdrait :
 * une fenêtre ouverte (inscription, palanquées…) ou un champ en cours de saisie.
 */
function busy(): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

let installed = false;
/** À appeler une fois au démarrage (main.tsx), en production seulement. */
export function watchNewVersion(): void {
  if (installed) return;
  installed = true;
  const current = entryScript(document.documentElement.outerHTML);
  if (!current) return;

  let lastCheck = Date.now();
  let checking = false;
  /** Nouvelle version repérée pendant que le membre était occupé : rechargement au prochain retour. */
  let pending = false;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || checking) return;
    if (pending) {
      if (!busy()) reloadOnce();
      return;
    }
    if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    checking = true;
    fetch('/', { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : null))
      .then((html) => {
        const online = html ? entryScript(html) : null;
        if (!online || online === current) return;
        if (busy()) pending = true;
        else reloadOnce();
      })
      // Hors ligne ou serveur injoignable : on réessaiera au prochain retour.
      .catch(() => {})
      .finally(() => {
        checking = false;
      });
  });
}
