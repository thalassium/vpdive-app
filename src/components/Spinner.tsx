import { Loader2 } from 'lucide-react';

/**
 * Roue d'attente dans un bouton ou à côté d'un texte. Décorative (aria-hidden) : l'attente
 * se dit sur l'élément concerné, `aria-busy` sur le bouton qui travaille, ou par le texte
 * (« Écriture 3/12… »).
 */
export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 aria-hidden className={`w-4 h-4 shrink-0 animate-spin ${className}`} />;
}
