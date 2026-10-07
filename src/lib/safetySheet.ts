import { extraLabel, guideLabel, memberLabel, type Diver, type Palanquee } from './palanquees';
import type { SafetyHeader } from './outing';

/**
 * Contenu de la fiche de sécurité, commun à l'écran et au PDF : en-tête, et
 * pour chaque palanquée ses lignes (encadrant, plongeurs 1 à 4 ou plus, GP
 * suppl. en exploration encadrée).
 */

export const HEADER_FIELDS: { key: keyof SafetyHeader; label: string; type?: string; options?: string[] }[] = [
  { key: 'etablissement', label: 'Nom de l’établissement d’APS' },
  { key: 'reference', label: 'Référence (n° de club, RCS…)' },
  { key: 'bateau', label: 'Bateau' },
  { key: 'pilote', label: 'Pilote' },
  { key: 'dp', label: 'Directeur de plongée' },
  { key: 'securite', label: 'Sécurité de surface' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'creneau', label: 'Matin / Après-midi / Nuit', options: ['', 'Matin', 'Après-midi', 'Nuit'] },
  { key: 'lieu', label: 'Lieu de plongée' },
];

export const SHEET_FOOTNOTE =
  'Le non-respect des paramètres prévus par le DP engage potentiellement la responsabilité de l’encadrant de palanquée ou des plongeurs ' +
  'autonomes. Gaz : laisser vide pour une plongée à l’air. Aptitudes PE/PA pour les plongeurs, niveau pour les encadrants (GP = N4/P4, E1, E2, ' +
  'E3, E4) : le plus haut, en exploration comme en enseignement. Un GP/N4 qui assiste une formation ou un moniteur qui plonge en exploration ' +
  'est noté à la prérogative de la palanquée.';

export type SheetSlot = 'guide' | 'member' | 'extra';

/** Colonne APT de la fiche (note 5 du modèle) : mêmes étiquettes que l'écran et l'export (lib/palanquees). */
export function sheetApt(d: Diver, p: Palanquee, slot: SheetSlot): string {
  if (slot === 'extra') return extraLabel(p);
  if (slot === 'guide') return guideLabel(d, p);
  return memberLabel(d, p);
}

/**
 * Les lignes d'une palanquée sur la fiche, six d'ordinaire : une palanquée
 * autonome n'a pas d'encadrant, ses plongeurs prennent les lignes 1 à 4. Une
 * formation peut compter, en plus de ses 4 élèves, des moniteurs qui plongent
 * avec elle : une ligne de plus pour chacun. La ligne « GP suppl. » n'existe
 * qu'en exploration encadrée (ou si une ancienne composition en a un).
 */
export function sheetRows(p: Palanquee): { label: string; d: Diver | null; slot: SheetSlot }[] {
  const divers = p.kind === 'autonomous' ? [p.guide, ...p.members].filter((d): d is Diver => !!d) : p.members;
  const lines = Array.from({ length: Math.max(4, divers.length) }, (_, n) => n);
  return [
    { label: p.kind === 'teaching' ? 'Enseignant' : 'Encadrant', d: p.kind === 'autonomous' ? null : p.guide, slot: 'guide' },
    ...lines.map((n) => ({ label: `Plongeur ${n + 1}`, d: divers[n] ?? null, slot: 'member' as const })),
    ...(p.kind === 'guided' || p.extra ? [{ label: 'GP suppl.', d: p.extra, slot: 'extra' as const }] : []),
  ];
}

export const lastNameOf = (d: Diver) => (d.lastname ?? d.name).toUpperCase();
export const firstNameOf = (d: Diver) => d.firstname ?? '';

/** Valeur d'en-tête telle qu'imprimée : la date en toutes lettres. */
export function headerText(key: keyof SafetyHeader, value: string): string {
  if (key !== 'date' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
