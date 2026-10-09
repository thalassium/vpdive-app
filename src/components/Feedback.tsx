import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Échec d'une lecture, avec « Réessayer ». Trois allures selon l'endroit :
 * card  carte dans une liste (matériel, météo) ;
 * soft  encadré teinté (onglets de la gestion des adhésions) ;
 * line  une ligne dans une section (profil).
 */
export function Failure({ text, onRetry, look = 'card' }: { text: ReactNode; onRetry: () => void; look?: 'card' | 'soft' | 'line' }) {
  if (look === 'soft') {
    return (
      <div role="alert" className="p-4 rounded-xl bg-danger-soft text-danger flex flex-wrap items-center gap-3">
        <span className="flex-1 min-w-0">{text}</span>
        <button type="button" onClick={onRetry} className="btn btn-quiet sm:h-9 text-sm">
          Réessayer
        </button>
      </div>
    );
  }
  return (
    <div role="alert" className={`${look === 'card' ? 'card p-4 ' : ''}flex flex-wrap items-center gap-3`}>
      <p className="flex-1 min-w-0 text-danger">{text}</p>
      <button type="button" onClick={onRetry} className="btn btn-quiet">
        {look === 'card' && <RefreshCw className="w-4 h-4" />} Réessayer
      </button>
    </div>
  );
}

/** Liste vide : une phrase au milieu. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-12 text-center text-muted">{children}</p>;
}
