import type { ReactNode } from 'react';

/**
 * Bouton d'action d'un titre de section de l'écran DP (Réinitialiser, Refaire,
 * Partager…) : blanc sur le bandeau rose. Sur téléphone, les boutons d'un même
 * titre se partagent la ligne.
 */
export function ActionButton({ onClick, icon, title, children }: { onClick: () => void; icon: ReactNode; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="btn btn-quiet sm:h-9 px-2.5 sm:px-4 gap-1.5 sm:gap-2 text-sm flex-auto sm:flex-none"
    >
      {icon}
      {children}
    </button>
  );
}
