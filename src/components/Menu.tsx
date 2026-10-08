import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

export interface MenuOption {
  value: string;
  label: ReactNode;
  /** Petit texte à droite (niveau, nombre…). */
  hint?: ReactNode;
}

export interface MenuSection {
  title?: string;
  options: MenuOption[];
  /** Valeur cochée dans cette section. */
  selected?: string;
  onSelect: (value: string) => void;
}

interface Props {
  /** Contenu du bouton (le choix actuel). */
  trigger: ReactNode;
  sections: MenuSection[];
  ariaLabel: string;
  triggerClassName?: string;
  disabled?: boolean;
  /** Sections côte à côte plutôt qu'empilées : tout est visible sans faire défiler. */
  columns?: boolean;
}

/**
 * Menu déroulant fait maison, à la place du <select> natif dans l'écran DP.
 *
 * Pourquoi : un <select> natif se referme dès que la zone qui le contient
 * défile, ce qui arrive quand on clique pendant que la liste glisse encore
 * (défilement à inertie) ; et sur un fond coloré ses options s'affichaient en
 * blanc sur blanc. Ce menu s'affiche par-dessus la page (portail), suit son
 * bouton quand la page défile au lieu de se fermer, et ne se ferme qu'au
 * choix, à un clic ailleurs ou sur Échap.
 */
export function Menu({ trigger, sections, ariaLabel, triggerClassName = '', disabled, columns }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; maxHeight: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Toujours entier à l'écran : calé sur sa largeur et sa hauteur réelles, ouvert du côté
  // qui a le plus de place, et défilant à l'intérieur s'il ne tient pas.
  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minWidth = Math.min(Math.max(r.width, columns ? 380 : 200), vw - 16);
    const width = Math.min(Math.max(panel.current?.offsetWidth ?? minWidth, minWidth), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const want = Math.min(panel.current?.scrollHeight ?? 320, vh * 0.6);
    const up = below < want && above > below;
    const maxHeight = Math.max(120, Math.min(vh * 0.6, up ? above : below));
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, minWidth, maxHeight, up });
  }, [columns]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    // Le défilement déplace le menu avec son bouton, il ne le ferme pas.
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('[aria-selected=true], [role=option]')?.focus({ preventScroll: true });
  }, [open, pos?.up]);

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: 'fixed',
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              minWidth: pos?.minWidth,
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: pos?.maxHeight,
              transform: pos?.up ? 'translateY(-100%)' : undefined,
            }}
            className={`z-[70] overflow-y-auto overscroll-contain panel rounded-lg border border-field-border text-ink py-1 animate-fade ${
              columns ? 'grid grid-cols-2 divide-x divide-line' : ''
            }`}
          >
            {sections.map((s, si) => (
              <div key={si} className={si > 0 && !columns ? 'border-t border-line mt-1 pt-1' : ''}>
                {s.title && <div className="label px-3 pt-2 pb-1">{s.title}</div>}
                {s.options.map((o) => {
                  const selected = s.selected === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        s.onSelect(o.value);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-base focus:outline-none focus:bg-raised hover:bg-raised ${selected ? 'bg-tint font-semibold text-brand' : ''}`}
                    >
                      <span className="w-4 shrink-0">{selected && <Check className="w-4 h-4" strokeWidth={2.5} />}</span>
                      <span className="flex-1 min-w-0">{o.label}</span>
                      {o.hint && <span className="text-sm text-muted shrink-0">{o.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
