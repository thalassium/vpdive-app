import { instructorMemberLabel, type Diver, type Palanquee } from './palanquees';
import type { SafetyHeader } from './outing';

/**
 * Contenu de la fiche de sécurité, commun à l'écran et au PDF : en-tête, et
 * pour chaque palanquée ses lignes (encadrant, plongeurs 1 à 4, GP suppl.).
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
  'autonomes. Gaz : laisser vide pour une plongée à l’air. Aptitudes PE/PA pour les plongeurs, niveau pour les encadrants (GP/P4, E1, E2, ' +
  'E3, E4) : le plus haut, en exploration comme en enseignement.';

export type SheetSlot = 'guide' | 'member' | 'extra';

/**
 * Colonne APT de la fiche (note 5 du modèle) : aptitude PE/PA pour les
 * plongeurs, niveau le plus haut pour les encadrants (un E4 qui guide en
 * exploration reste E4), FN# pour un élève. Un moniteur plongeur : son statut en
 * formation, la prérogative de la palanquée en exploration.
 */
export function sheetApt(d: Diver, p: Palanquee, slot: SheetSlot): string {
  if (slot === 'extra') return 'GP / P4';
  if (slot === 'guide') {
    if (p.kind === 'teaching') return d.teach ? `E${d.teach}` : '?';
    // Exploration : sa prérogative la plus haute (un E4 qui guide reste E4), N4/GP au minimum.
    return d.teach ? `E${d.teach}` : d.guide === 'GP' ? 'GP / P4' : '?';
  }
  const instructor = instructorMemberLabel(d, p);
  if (instructor) return instructor;
  if (d.training && p.kind === 'teaching') return `FN${d.training}`;
  if (p.kind === 'autonomous') return d.pa ? `PA${d.pa}` : '?';
  if (d.beginner && !d.pe) return 'Débutant';
  return d.pe ? `PE${d.pe}` : '?';
}

/**
 * Les lignes d'une palanquée sur la fiche, six d'ordinaire : une palanquée autonome n'a pas
 * d'encadrant, ses plongeurs prennent les lignes 1 à 4. Une formation peut compter, en plus
 * de ses 4 élèves, des moniteurs qui plongent avec elle : une ligne de plus pour chacun.
 */
export function sheetRows(p: Palanquee): { label: string; d: Diver | null; slot: SheetSlot }[] {
  const divers = p.kind === 'autonomous' ? [p.guide, ...p.members].filter((d): d is Diver => !!d) : p.members;
  const lines = Array.from({ length: Math.max(4, divers.length) }, (_, n) => n);
  return [
    { label: p.kind === 'teaching' ? 'Enseignant' : 'Encadrant', d: p.kind === 'autonomous' ? null : p.guide, slot: 'guide' },
    ...lines.map((n) => ({ label: `Plongeur ${n + 1}`, d: divers[n] ?? null, slot: 'member' as const })),
    { label: 'GP suppl.', d: p.extra, slot: 'extra' },
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
