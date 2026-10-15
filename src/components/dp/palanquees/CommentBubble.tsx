import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareText } from 'lucide-react';
import { usePopover } from '../../../hooks/usePopover';

interface Props {
  /** Commentaire laissé à l'inscription sur VPDive. */
  text: string;
  name: string;
}

/**
 * Bulle à côté du nom : le commentaire de l'inscription VPDive. Au survol sur
 * ordinateur, au toucher sur téléphone ; un clic la garde ouverte jusqu'au
 * clic suivant, à un clic ailleurs ou sur Échap.
 *
 * Pas un <button> : la liste est dans un fieldset désactivé en lecture seule,
 * et le commentaire doit rester lisible par tous.
 */
export function CommentBubble({ text, name }: Props) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const button = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || pinned;

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    const height = panel.current?.offsetHeight ?? 80;
    const up = window.innerHeight - r.bottom < height + 16 && r.top > height + 16;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left, up });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  usePopover({
    open: pinned,
    onClose: () => {
      setPinned(false);
      setHover(false);
    },
    inside: [button, panel],
    button,
    tab: 'close',
  });

  const toggle = () => {
    setPinned((p) => !p);
    setHover(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggle();
  };

  return (
    <>
      <span
        ref={button}
        role="button"
        tabIndex={0}
        aria-label={`Commentaire d’inscription de ${name}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={toggle}
        onKeyDown={onKeyDown}
        // Souris seulement : sur un écran tactile, le toucher passe par le clic.
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        className={`inline-flex items-center justify-center w-7 h-7 -my-1 rounded-full shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand ${
          pinned ? 'bg-tint text-brand' : 'text-brand hover:bg-raised'
        }`}
      >
        <MessageSquareText className="w-4 h-4" />
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            data-dialog-portal=""
            style={{
              position: 'fixed',
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: 'min(320px, calc(100vw - 16px))',
              transform: pos?.up ? 'translateY(-100%)' : undefined,
            }}
            className="z-[70] panel rounded-lg border border-field-border px-3 py-2 text-sm text-ink shadow-lg animate-fade"
          >
            <p className="label mb-1">Commentaire à l’inscription</p>
            <p className="whitespace-pre-line break-words">{text}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
