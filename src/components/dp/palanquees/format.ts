/*
 * Palanquées (écran DP) : présentation d'un plongeur, tris, largeurs de colonnes,
 * cibles du menu Déplacer et rôles de la sortie partagés par les composants du dossier.
 */
import { createContext, type ReactNode } from 'react';
import { memberLabel, prerogativeCode, trainingLabel, trainingTargetOf, type Diver, type Palanquee, type PalanqueeKind, type PalanqueeType } from '../../../lib/palanquees';
import type { DiveRole } from '../../../lib/outing';

export const TYPES: PalanqueeType[] = ['exploration', 'teaching'];

/**
 * Comment on présente quelqu'un : sa prérogative (E3, GP, PE40 · PA20…), puis
 * son niveau ou son diplôme tel que VPDive l'écrit (DEJEPS, MF1, P2…). Un E3
 * peut être MF1 ou DEJEPS : on ne le devine jamais.
 */
export const describe = (d: Diver) => [prerogativeCode({ ...d, training: 0 }) || 'niveau ?', ...diplomas(d)].join(' · ');
/** Niveaux et diplômes VPDive, sans ceux qui répètent la prérogative (« PE-40 » à côté de « PE40 »). */
export const diplomas = (d: Diver) => {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = new Set(prerogativeCode({ ...d, training: 0 }).split(' · ').map(flat));
  return (d.display ?? []).filter((x) => !parts.has(flat(x)));
};
export const shownLevel = (d: Diver) => (d.training ? `${trainingLabel(d)} · ${describe(d)}` : describe(d));
export const byName = (a: Diver, b: Diver) => a.name.localeCompare(b.name, 'fr');
/** Colonnes Apt. et F# de « Qui plonge ? » : même largeur pour les menus et leurs titres, tout tient sur 375 px. */
export const APT_COL = 'w-[6rem] sm:w-28 shrink-0 justify-between';
export const FN_COL = 'w-[4.25rem] sm:w-24 shrink-0 justify-between';
/** Encadrants du plus haut au plus bas : E4, E3, E2, E1, puis GP. */
const GUIDE_ORDER: Record<string, number> = { E4: 4, E3: 3, GP: 2, E1: 1 };
export const byRank = (a: Diver, b: Diver) => b.teach - a.teach || (GUIDE_ORDER[b.guide ?? ''] ?? 0) - (GUIDE_ORDER[a.guide ?? ''] ?? 0) || byName(a, b);

/** Rôles de la sortie de chaque inscrit (DP, pilote, sécurité surface), pour les badges à côté des noms. */
export const RolesContext = createContext<Map<string, DiveRole[]>>(new Map());

/** Une palanquée cible du menu Déplacer : ses élèves (pour savoir qui peut l'enseigner) et si elle accepte un encadrant supplémentaire de plus (toute formation). */
export type Target = { id: string; label: string; kind: PalanqueeKind; students: Diver[]; extraOk: boolean };

export const hasRows = (children: ReactNode) => (Array.isArray(children) ? children.flat().length > 0 : !!children);

/**
 * Pastille d'un plongeur dans cette palanquée : l'étiquette commune à l'écran,
 * la fiche et l'export (memberLabel), et sa profondeur propre, pour signaler
 * celui qui limite la palanquée.
 */
export function ownPrerogative(d: Diver, p: Palanquee): { label: string; depth: number } {
  const depth = p.kind === 'autonomous' ? d.pa : p.kind === 'teaching' && d.training ? trainingTargetOf(d) : d.pe || (d.beginner ? 6 : 0);
  return { label: memberLabel(d, p), depth };
}
