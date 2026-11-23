import type { ReactNode } from 'react';
import { Gift } from 'lucide-react';

/** En-tête commun aux deux pages : le cadeau, « Secret Santa », le nom du tirage. */
export function SantaHeading({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <header className="text-center mb-5">
      <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent text-on-accent mb-3">
        <Gift aria-hidden className="w-7 h-7" />
      </span>
      <h1 className="text-xl font-semibold text-brand">Secret Santa</h1>
      {title && <p className="text-muted mt-0.5">{title}</p>}
      {children}
    </header>
  );
}
