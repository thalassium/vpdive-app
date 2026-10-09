import { useEffect, useRef, type RefObject } from 'react';

interface Options {
  open: boolean;
  /** Referme le menu (l'état seulement : le focus est rendu ici quand il le faut). */
  onClose: () => void;
  /** Ce qui compte comme « dedans » : le bouton, la liste (même dans un portail)… */
  inside: RefObject<HTMLElement | null>[];
  /** Le bouton du menu, où revient le focus après Échap. */
  button: RefObject<HTMLElement | null>;
  /**
   * Tab : 'close' referme et laisse le focus suivre ; 'return' referme et rend le focus
   * au bouton (liste en portail, hors de l'ordre de tabulation) ; absent : rien ici.
   */
  tab?: 'close' | 'return';
  /** Les autres touches, menu ouvert (flèches d'une liste en portail). */
  onKeyDown?: (e: KeyboardEvent) => void;
}

/**
 * Ce qui referme un menu déroulant, commun aux menus de l'appli (Menu,
 * AccountMenu, HeaderMenu) : un clic ailleurs, Échap (le focus revient au
 * bouton, et Échap ne ferme pas aussi le dialogue autour), Tab au choix.
 * Écouté à la capture, avant le reste de la page.
 */
export function usePopover(options: Options) {
  // Toujours les dernières valeurs, sans réabonner les écouteurs à chaque rendu.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const { open } = options;
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!latest.current.inside.some((r) => r.current?.contains(t))) latest.current.onClose();
    };
    const key = (e: KeyboardEvent) => {
      const { onClose, button, tab, onKeyDown } = latest.current;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        button.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key === 'Tab' && tab) {
        if (tab === 'return') {
          // Tab quitte la liste : le focus repart du bouton, le dialogue garde sa boucle.
          e.preventDefault();
          button.current?.focus({ preventScroll: true });
        }
        onClose();
        return;
      }
      onKeyDown?.(e);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
}
