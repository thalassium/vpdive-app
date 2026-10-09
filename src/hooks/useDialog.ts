import { useEffect, useRef, useState, type RefObject } from 'react';

interface Options {
  /** Demande de fermeture : Échap, bouton Retour du téléphone ou du navigateur. */
  onClose: () => void;
  /** false : fermeture refusée pour l'instant (envoi en cours…), le dialogue reste. */
  canClose?: () => boolean;
  /** Nom court gardé dans l'entrée d'historique, pour s'y retrouver au débogage. */
  label?: string;
  /**
   * Où remettre le focus à la fermeture, quand ce n'est pas l'élément qui l'avait à
   * l'ouverture (par défaut) : un dialogue ouvert depuis un menu qui s'est refermé
   * aussitôt rend le focus au bouton du menu, pas au <body>. Lu à la fermeture.
   */
  returnTo?: HTMLElement | null | (() => HTMLElement | null);
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Éléments atteignables au clavier dans `root`, dans l'ordre du document (ni désactivés, ni cachés). */
const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);

/**
 * Attribut des éléments affichés hors du dialogue (portail sur <body>) mais qui en font
 * partie, comme la liste d'un menu déroulant (components/Menu.tsx) : le focus peut y aller
 * sans sortir du dialogue, et ils gèrent eux-mêmes Échap et Tab.
 */
export const DIALOG_PORTAL_ATTR = 'data-dialog-portal';
const inPortal = (el: Element | null) => !!el?.closest(`[${DIALOG_PORTAL_ATTR}]`);

let seq = 0;
/** Dialogues ouverts, du plus ancien au plus récent : seul le dernier réagit au clavier. */
const opened: string[] = [];
/** Identifiants créés depuis le chargement de la page : une entrée d'historique qui en porte un est à nous. */
const known = new Set<string>();
/** Rang des entrées d'historique posées par les dialogues : plus grand = posée plus tard, donc au-dessus. */
let depth = 0;

interface DialogState {
  dialog: string;
  depth: number;
  label?: string;
}
const dialogState = (s: unknown): DialogState | null =>
  s && typeof s === 'object' && typeof (s as DialogState).dialog === 'string' ? (s as DialogState) : null;

// Verrou de défilement partagé : la page ne défile plus tant qu'au moins un dialogue est ouvert.
// <html data-dialog-open> le signale à la feuille de style (les bulles du fond s'arrêtent).
let locks = 0;
let overflowBefore = '';
function lockScroll() {
  if (locks++ === 0) {
    overflowBefore = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.setAttribute('data-dialog-open', '');
  }
}
function unlockScroll() {
  if (--locks === 0) {
    document.body.style.overflow = overflowBefore;
    document.documentElement.removeAttribute('data-dialog-open');
  }
}

// Une entrée d'historique d'un dialogue déjà fermé (fermé par « Suivant », ou laissée par une
// page précédente) n'a plus de sens : Retour qui y arrive passe à la suivante, pour qu'un appui
// sur Retour ait toujours un effet visible. Après les autres écouteurs, une fois les
// dialogues concernés fermés.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    setTimeout(() => {
      const s = dialogState(history.state);
      if (s && !opened.includes(s.dialog)) history.back();
    }, 0);
  });
}

/**
 * Ce qu'un dialogue modal doit faire, et que chaque panneau recopiait :
 * - Échap ferme (écouté en phase de capture, avant les raccourcis de la page), sauf
 *   quand le focus est dans un portail (menu déroulant), qui gère Échap lui-même ;
 * - la page derrière ne défile plus, jusqu'à la fermeture du dernier dialogue ouvert ;
 * - le focus entre dans le dialogue (`[data-autofocus]`, sinon le dialogue lui-même ;
 *   un `autoFocus` déjà posé est respecté), y tourne en boucle avec Tab (les portails
 *   marqués `data-dialog-portal` comptent comme dedans), et revient à l'élément
 *   d'origine (ou à `returnTo`) à la fermeture ;
 * - le bouton Retour (Android, navigateur) ferme le dialogue au lieu de quitter l'écran :
 *   une entrée d'historique est posée à l'ouverture, retirée à la fermeture.
 *
 * `ref` va sur l'élément `role="dialog"`. Les fonctions passées sont relues à chaque
 * appel : inutile de les mémoriser.
 */
export function useDialog({ onClose, canClose, label, returnTo }: Options): { ref: RefObject<HTMLDivElement | null> } {
  const ref = useRef<HTMLDivElement>(null);
  const [id] = useState(() => `${++seq}-${Math.random().toString(36).slice(2, 8)}`);
  // Lu au rendu : au moment des effets, un autoFocus du dialogue aurait déjà pris le focus.
  const [opener] = useState(() => document.activeElement);
  const latest = useRef({ onClose, canClose, label, returnTo });
  useEffect(() => {
    latest.current = { onClose, canClose, label, returnTo };
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
        // Menu déroulant ouvert : il se referme lui-même sur Tab et rend le focus à son bouton.
        if (inPortal(active)) return;
        const items = focusables(el);
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          e.preventDefault();
          el.focus({ preventScroll: true });
          return;
        }
        // Focus perdu hors du dialogue (élément retiré de la page…) ou sur le dialogue lui-même : on le ramène dedans.
        if (!active || active === el || !el.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey ? active === first : active === last) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);

    let myDepth = 0;
    const entry = () => {
      myDepth = ++depth;
      history.pushState({ dialog: id, depth: myDepth, label: latest.current.label } satisfies DialogState, '');
    };
    let mounted = true;
    let closedByPop = false;
    const onPop = () => {
      // Arrivé sur notre entrée (un dialogue ouvert par-dessus vient de fermer) ou au-dessus
      // (« Suivant ») : rien à faire. Plus bas (entrée posée avant la nôtre, d'une page
      // précédente, ou sans dialogue) : Retour a quitté notre entrée, on ferme.
      const s = dialogState(history.state);
      if (s && known.has(s.dialog) && s.depth >= myDepth) return;
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
    const current = dialogState(history.state);
    if (current?.dialog === id) myDepth = current.depth;
    else entry();
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
          if (!opened.includes(id) && dialogState(history.state)?.dialog === id) history.back();
        }, 0);
      const back = latest.current.returnTo;
      const target = (typeof back === 'function' ? back() : back) ?? opener;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
      else if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [id, opener]);

  return { ref };
}
