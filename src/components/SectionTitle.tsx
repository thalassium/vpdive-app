import type { ReactNode } from 'react';

/**
 * Titre de section : le bandeau rose (utilitaire `section-title`) qui ouvre un
 * bloc d'écran. Numéro d'étape dans une pastille marine (`step-dot`), compteur
 * « · N » en marine atténué, précision et actions à droite (sur téléphone, les
 * actions prennent la ligne suivante et se la partagent).
 *
 *   flush  coins droits : en tête d'une carte, ou en résumé d'un <details>
 *   bleed  d'un bord à l'autre de la zone (écran DP) ; coins droits aussi
 *
 * Le titre lui-même est un vrai titre (h2, h3, h4), pour la navigation au
 * lecteur d'écran ; le compteur et la précision en font partie ou non selon
 * qu'ils disent quelque chose du titre (`count` oui, `hint` non).
 */
export function SectionTitle({
  as: Heading = 'h3',
  n,
  count,
  hint,
  actions,
  bleed,
  flush,
  id,
  className = '',
  children,
}: {
  as?: 'h2' | 'h3' | 'h4';
  /** Numéro d'étape. */
  n?: ReactNode;
  /** Compteur après le titre (« · 12 »). */
  count?: ReactNode;
  /** Précision, en texte normal après le titre. */
  hint?: ReactNode;
  /** Boutons à droite. */
  actions?: ReactNode;
  bleed?: boolean;
  flush?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const shape = bleed ? 'section-title-bleed' : flush ? '' : 'rounded-lg';
  return (
    <div className={`section-title ${shape} ${className}`}>
      <Heading id={id} className="flex items-center gap-2.5 min-w-0 text-base sm:text-lg font-bold leading-tight">
        {n !== undefined && <span className="step-dot">{n}</span>}
        <span className="min-w-0">
          {children}
          {count !== undefined && <span className="font-normal tabular-nums text-on-accent/80"> · {count}</span>}
        </span>
      </Heading>
      {hint && <span className="text-sm font-normal">{hint}</span>}
      {actions && <div className="flex flex-wrap w-full sm:w-auto sm:ml-auto items-center gap-2 font-normal">{actions}</div>}
    </div>
  );
}
