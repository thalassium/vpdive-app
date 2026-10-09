import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';

interface DialogProps {
  /** Nom court de l'entrée d'historique (hooks/useDialog). */
  label: string;
  /** Échap, bouton Retour du téléphone ou du navigateur. */
  onClose: () => void;
  /** false : fermeture refusée pour l'instant (envoi en cours…). */
  canClose?: () => boolean;
  /** Clic sur le voile, à côté de la fenêtre : `onClose` par défaut, null pour ne rien faire. */
  onBackdrop?: (() => void) | null;
  /** Identifiant du titre (aria-labelledby). */
  titleId: string;
  /** Taille de la fenêtre : largeur et hauteur à partir du grand écran (« sm:max-w-5xl h-dvh sm:h-[92vh] »). */
  className: string;
  /** En plus sur le voile (impression…). */
  backdropClassName?: string;
  children: ReactNode;
}

/**
 * Coquille commune des fenêtres de l'appli : voile, fenêtre plein écran sur
 * téléphone et centrée au-delà, et tout ce que fait useDialog (Échap, bouton
 * Retour, focus gardé dedans, page figée derrière).
 */
export function Dialog({ label, onClose, canClose, onBackdrop, titleId, className, backdropClassName = '', children }: DialogProps) {
  const { ref } = useDialog({ onClose, canClose, label });
  const backdrop = onBackdrop === undefined ? onClose : onBackdrop;
  return (
    <div
      className={`fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade ${backdropClassName}`}
      onMouseDown={(e) => e.target === e.currentTarget && backdrop?.()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative bg-surface w-full ${className} sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop`}
      >
        {children}
      </div>
    </div>
  );
}

/** La croix de fermeture. */
export function CloseButton({ onClick, disabled, className = '' }: { onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label="Fermer" className={`icon-btn ${className}`}>
      <X className="w-6 h-6" />
    </button>
  );
}

interface HeaderProps {
  titleId: string;
  title: ReactNode;
  /** Icône devant le titre. */
  icon?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  /** Boutons avant la croix. */
  actions?: ReactNode;
  /**
   * En-tête large : surtitre (« Admin ») au-dessus du titre, sous-titre et contenu
   * dessous (recherche, onglets). Sans lui, en-tête d'une ligne.
   */
  kicker?: ReactNode;
  wide?: boolean;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Avant l'icône (retour à la liste sur téléphone), en-tête d'une ligne. */
  before?: ReactNode;
  className?: string;
}

/** En-tête de fenêtre : bandeau rose, icône, titre, croix. */
export function DialogHeader({ titleId, title, icon, onClose, closeDisabled, actions, kicker, wide, subtitle, children, before, className = '' }: HeaderProps) {
  if (!wide && kicker === undefined) {
    return (
      <header className={`border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3 ${className}`}>
        {before}
        {icon}
        <h2 id={titleId} className="text-xl font-semibold text-brand flex-1 min-w-0">
          {title}
        </h2>
        {actions}
        <CloseButton onClick={onClose} disabled={closeDisabled} className="-mr-2" />
      </header>
    );
  }
  return (
    <header className={`relative border-t-[3px] border-pink border-b border-line px-5 sm:px-6 pt-4 pb-4 shrink-0 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker && <span className="label block mb-0.5">{kicker}</span>}
          <h2 id={titleId} className={`text-xl font-semibold text-brand leading-snug ${icon ? 'flex items-center gap-2' : ''}`}>
            {icon}
            {title}
          </h2>
          {subtitle}
        </div>
        <div className="flex items-center gap-1 -mr-2 -mt-1 shrink-0">
          {actions}
          <CloseButton onClick={onClose} disabled={closeDisabled} />
        </div>
      </div>
      {children}
    </header>
  );
}
