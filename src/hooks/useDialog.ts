import { useEffect, useRef, useState, type RefObject } from 'react';

interface Options {
  /** Demande de fermeture : Échap, bouton Retour du téléphone ou du navigateur. */
  onClose: () => void;
  /** false : fermeture refusée pour l'instant (envoi en cours…), le dialogue reste. */
  canClose?: () => boolean;
  /** Nom court gardé dans l'entrée d'historique, pour s'y retrouver au débogage. */
  label?: string;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Éléments atteignables au clavier dans `root`, dans l'ordre du document (ni désactivés, ni cachés). */
const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);

let seq = 0;
/** Dialogues ouverts, du plus ancien au plus récent : seul le dernier réagit au clavier. */
const opened: string[] = [];
/** Identifiants créés depuis le chargement de la page : une entrée d'historique qui en porte un est à nous. */
const known = new Set<string>();

// Verrou de défilement partagé : la page ne défile plus tant qu'au moins un dialogue est ouvert.
let locks = 0;
let overflowBefore = '';
function lockScroll() {
  if (locks++ === 0) {
    overflowBefore = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}
function unlockScroll() {
  if (--locks === 0) document.body.style.overflow = overflowBefore;
}

/**
 * Ce qu'un dialogue modal doit faire, et que chaque panneau recopiait :
 * - Échap ferme (écouté en phase de capture, avant les raccourcis de la page), sauf
 *   quand le focus est dans un portail (menu déroulant), qui gère Échap lui-même ;
 * - la page derrière ne défile plus, jusqu'à la fermeture du dernier dialogue ouvert ;
 * - le focus entre dans le dialogue (`[data-autofocus]`, sinon le dialogue lui-même ;
 *   un `autoFocus` déjà posé est respecté), y tourne en boucle avec Tab,
 *   et revient à l'élément d'origine à la fermeture ;
 * - le bouton Retour (Android, navigateur) ferme le dialogue au lieu de quitter l'écran :
 *   une entrée d'historique est posée à l'ouverture, retirée à la fermeture.
 *
 * `ref` va sur l'élément `role="dialog"`. Les fonctions passées sont relues à chaque
 * appel : inutile de les mémoriser.
 */
export function useDialog({ onClose, canClose, label }: Options): { ref: RefObject<HTMLDivElement | null> } {
  const ref = useRef<HTMLDivElement>(null);
  const [id] = useState(() => `${++seq}-${Math.random().toString(36).slice(2, 8)}`);
  // Lu au rendu : au moment des effets, un autoFocus du dialogue aurait déjà pris le focus.
  const [opener] = useState(() => document.activeElement);
  const latest = useRef({ onClose, canClose, label });
  useEffect(() => {
    latest.current = { onClose, canClose, label };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    known.add(id);
    opened.push(id);
    lockScroll();

    // Sans élément désigné, le focus va au dialogue lui-même : lu comme tel par les lecteurs
    // d'écran, sans anneau de focus sur un bouton quelconque à l'ouverture.
    if (!el.contains(document.activeElement)) {
      const target = el.querySelector<HTMLElement>('[data-autofocus]');
      if (target) target.focus({ preventScroll: true });
      else {
        if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus({ preventScroll: true });
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (opened[opened.length - 1] !== id) return;
      const active = document.activeElement;
      if (e.key === 'Escape') {
        if (active && active !== document.body && !el.contains(active)) return;
        if (latest.current.canClose?.() === false) return;
        latest.current.onClose();
      } else if (e.key === 'Tab') {
        if (!active || !el.contains(active)) return;
        const items = focusables(el);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey ? active === first : active === last) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);

    const entry = () => history.pushState({ dialog: id, label: latest.current.label }, '');
    let mounted = true;
    let closedByPop = false;
    const onPop = () => {
      const current: unknown = history.state?.dialog;
      if (typeof current === 'string' && known.has(current)) {
        // Notre entrée de nouveau courante (un dialogue ouvert par-dessus vient de fermer), ou
        // l'entrée périmée d'un dialogue fermé (« Suivant ») : rien à faire. Seule l'entrée
        // d'un dialogue encore ouvert sous nous veut dire que la nôtre a été quittée.
        const under = opened.indexOf(current);
        if (under === -1 || under >= opened.indexOf(id)) return;
      }
      if (latest.current.canClose?.() === false) return entry();
      closedByPop = true;
      latest.current.onClose();
      // Toujours ouvert juste après (il a fermé une sous-fenêtre à la place) : on repose l'entrée.
      setTimeout(() => {
        if (!mounted) return;
        closedByPop = false;
        entry();
      }, 0);
    };
    // Déjà posée (React remonte le dialogue en développement) : pas de seconde entrée.
    if (history.state?.dialog !== id) entry();
    window.addEventListener('popstate', onPop);

    return () => {
      mounted = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('popstate', onPop);
      const i = opened.indexOf(id);
      if (i !== -1) opened.splice(i, 1);
      unlockScroll();
      // Fermé par un bouton : on retire l'entrée d'historique (le popstate qui en résulte ne nous trouve plus).
      // Un peu plus tard, et seulement si le dialogue n'a pas été remonté entre-temps : en
      // développement, React démonte puis remonte aussitôt chaque composant ; un retour
      // immédiat arrivait après le remontage et refermait la fenêtre à peine ouverte.
      if (!closedByPop)
        setTimeout(() => {
          if (!opened.includes(id) && history.state?.dialog === id) history.back();
        }, 0);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [id, opener]);

  return { ref };
}
