import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface HeaderMenuItem {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}

/**
 * Menu de l'en-tête (« Gestion sortie », « Admin ») : une icône, le libellé à
 * partir du grand écran, et la liste de ses écrans au clic.
 */
export function HeaderMenu({ icon, label, items }: { icon: ReactNode; label: string; items: HeaderMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`btn btn-quiet h-9 px-2.5 text-sm ${open ? 'bg-raised' : ''}`}
      >
        {icon}
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown aria-hidden className="hidden lg:block w-4 h-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-[min(17rem,calc(100vw-2rem))] panel border border-field-border z-40 animate-fade overflow-hidden py-1">
          <p className="label px-4 pt-1.5 pb-1">{label}</p>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-ink hover:bg-raised focus:bg-raised focus:outline-none"
            >
              <span className="text-brand shrink-0">{it.icon}</span>
              <span className="min-w-0">
                <span className="block">{it.label}</span>
                {it.hint && <span className="block text-sm text-muted">{it.hint}</span>}
              </span>
            </button>
          ))}
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
