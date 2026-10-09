import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { MENU_ITEM_CLS, menuKeys } from './menuKeys';
import { usePopover } from '../hooks/usePopover';

export interface HeaderMenuItem {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}

/**
 * Menu de l'en-tête (« Gestion de sortie », « Admin ») : une icône, le libellé à
 * partir du grand écran, et la liste de ses écrans au clic. En rose, la couleur
 * des écrans réservés à l'encadrement.
 *
 * Clavier : le focus va au premier écran à l'ouverture, ↑ ↓ Début Fin pour se
 * déplacer, Échap ou Tab pour refermer. Un écran choisi s'ouvre avec le focus
 * rendu d'abord au bouton du menu : c'est là qu'il revient à sa fermeture.
 */
export function HeaderMenu({ icon, label, items }: { icon: ReactNode; label: string; items: HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Clic ailleurs, Échap (focus rendu au bouton) ou Tab : le menu se referme.
  usePopover({ open, onClose: () => setOpen(false), inside: [box], button, tab: 'close' });
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        className={`inline-flex items-center gap-2 h-11 sm:h-9 px-2.5 rounded-lg bg-pink text-on-pink text-sm font-semibold transition-[filter] hover:brightness-95 ${open ? 'brightness-90' : ''}`}
      >
        {icon}
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown aria-hidden className="hidden lg:block w-4 h-4" />
      </button>
      {open && (
        // Téléphone : toute la largeur sous l'en-tête, le bouton n'étant pas au bord droit ;
        // au-delà, sous le bouton, aligné à sa droite. Le titre est hors du role="menu",
        // qui ne contient que ses éléments.
        <div className="fixed inset-x-3 top-[4.5rem] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[17rem] max-h-[calc(100dvh-6rem)] overflow-y-auto panel border border-field-border border-t-[3px] border-t-pink z-40 animate-fade py-1">
          <p aria-hidden className="label px-4 pt-1.5 pb-1">
            {label}
          </p>
          <div ref={list} id={menuId} role="menu" aria-label={label} onKeyDown={menuKeys}>
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  // Le focus d'abord sur le bouton du menu : l'écran ouvert le prend comme point de retour.
                  button.current?.focus({ preventScroll: true });
                  setOpen(false);
                  it.onClick();
                }}
                className={`${MENU_ITEM_CLS} text-ink`}
              >
                <span className="text-brand shrink-0">{it.icon}</span>
                <span className="min-w-0">
                  <span className="block">{it.label}</span>
                  {it.hint && <span className="block text-sm text-muted">{it.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Casquette de capitaine, au trait comme les icônes lucide. */
export function CaptainHat({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* calotte */}
      <path d="M4 12.5c-1.2-1.6-1.4-3.6.2-4.9C6.5 5.8 10 5 12.6 5c3.9 0 7.2 1.3 7.9 3.3.5 1.5-.3 3-1.5 4.2" />
      {/* bandeau */}
      <path d="M4 12.5h15v3H4z" />
      {/* visière */}
      <path d="M4 15.5c1.5 2.3 5.8 3.5 9.8 3 2.4-.3 4.4-1.3 5.2-3" />
      {/* insigne */}
      <path d="M12 8.2v2" />
      <path d="M11 9.2h2" />
    </svg>
  );
}
