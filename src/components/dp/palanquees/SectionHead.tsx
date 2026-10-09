import type { ReactNode } from 'react';

/**
 * Bandeau de titre d'un bloc de l'écran DP, d'un bord à l'autre de la zone :
 * c'est lui qui sépare les blocs. Sa couleur suit la coupe de mer des
 * statistiques, de la surface vers le fond au fil des étapes : rôles de la
 * sortie (surface), qui plonge (on descend), palanquées (au fond). Le rose
 * reste aux pavillons P1, P2… des palanquées.
 */
const TONE: Record<'surface' | 'mid' | 'deep', string> = { surface: 'var(--sea-12)', mid: 'var(--sea-40)', deep: 'var(--sea-60)' };

export function SectionHead({ n, tone, hint, actions, children }: { n?: number; tone: keyof typeof TONE; hint?: string; actions?: ReactNode; children: ReactNode }) {
  const color = TONE[tone];
  return (
    <div className="relative -mx-5 sm:-mx-6 mb-4 px-5 sm:px-6 py-2.5 bg-raised border-y border-line flex flex-wrap items-center gap-x-3 gap-y-2 print:mx-0 print:px-0 print:bg-transparent print:border-0">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: color }} />
      <h3 className="flex items-center gap-2.5 text-base sm:text-lg font-semibold text-brand leading-tight">
        {n !== undefined && (
          <span className="w-6 h-6 rounded-full text-white text-sm font-bold flex items-center justify-center shrink-0" style={{ background: color }}>
            {n}
          </span>
        )}
        {children}
      </h3>
      {hint && <span className="text-sm text-muted">{hint}</span>}
      {/* Sur téléphone, les actions prennent la ligne suivante et se la partagent. */}
      {actions && <div className="flex flex-wrap w-full sm:w-auto sm:ml-auto items-center gap-2">{actions}</div>}
    </div>
  );
}

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
