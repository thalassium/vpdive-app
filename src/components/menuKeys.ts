import type { KeyboardEvent } from 'react';

/** Style d'un élément de menu : surligné au survol ; au clavier, surligné et cerclé (anneau de focus visible). */
export const MENU_ITEM_CLS =
  'w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-raised outline-none focus-visible:bg-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

/**
 * Flèches d'un `role="menu"` (à poser en onKeyDown sur le conteneur) : ↑ ↓ passent
 * d'un élément à l'autre en boucle, Début et Fin vont au premier et au dernier.
 */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'ArrowDown' ? (i + 1) % items.length
    : e.key === 'ArrowUp' ? (i <= 0 ? items.length - 1 : i - 1)
    : e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : null;
  if (next === null) return;
  e.preventDefault();
  items[next]?.focus();
}
