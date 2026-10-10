import { depthOf, extraLabel, guideLabel, memberLabel, type Diver, type Palanquee } from './palanquees';
import { parseDepth, type Dive, type GuideNote, type SafetyHeader } from './outing';

/**
 * Contenu de la fiche de sécurité, commun à l'écran et au PDF : en-tête, et
 * pour chaque palanquée ses lignes (encadrant, plongeurs 1 à 4 ou plus,
 * encadrant suppl. en formation).
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
  { key: 'accompagnants', label: 'Accompagnants' },
];

export type SheetSlot = 'guide' | 'member' | 'extra';
/** Ligne de l'encadrant supplémentaire d'une formation (N4/GP ou enseignant qui assiste, hors effectif). */
const EXTRA_ROW_LABEL = 'Encadrant suppl.';

/** Colonne APT de la fiche (note 5 du modèle) : mêmes étiquettes que l'écran et l'export (lib/palanquees). */
export function sheetApt(d: Diver, p: Palanquee, slot: SheetSlot): string {
  if (slot === 'extra') return extraLabel(d, p);
  if (slot === 'guide') return guideLabel(d, p);
  return memberLabel(d, p);
}

/**
 * Les lignes d'une palanquée sur la fiche, six d'ordinaire : une palanquée
 * autonome n'a pas d'encadrant, ses plongeurs prennent les lignes 1 à 4. Une
 * formation peut compter, en plus de ses 4 élèves, des moniteurs qui plongent
 * avec elle : une ligne de plus pour chacun. La ligne « Encadrant suppl. »
 * (EXTRA_ROW_LABEL) n'existe qu'en formation (ou si une ancienne composition
 * d'exploration en a encore un).
 */
export function sheetRows(p: Palanquee): { label: string; d: Diver | null; slot: SheetSlot }[] {
  const divers = p.kind === 'autonomous' ? [p.guide, ...p.members].filter((d): d is Diver => !!d) : p.members;
  const lines = Array.from({ length: Math.max(4, divers.length) }, (_, n) => n);
  return [
    { label: p.kind === 'teaching' ? 'Enseignant' : 'Encadrant', d: p.kind === 'autonomous' ? null : p.guide, slot: 'guide' },
    ...lines.map((n) => ({ label: `Plongeur ${n + 1}`, d: divers[n] ?? null, slot: 'member' as const })),
    ...(p.kind === 'teaching' || p.extra ? [{ label: EXTRA_ROW_LABEL, d: p.extra, slot: 'extra' as const }] : []),
  ];
}

export const lastNameOf = (d: Diver) => (d.lastname ?? d.name).toUpperCase();
export const firstNameOf = (d: Diver) => d.firstname ?? '';

/** Ce que la fiche doit dire avant d'être imprimée : sans eux, elle ne vaut rien le jour J. */
const REQUIRED: (keyof SafetyHeader)[] = ['dp', 'pilote', 'date', 'lieu'];

/** Champs indispensables de l'en-tête restés vides (libellés de la fiche). */
export function missingHeader(header: SafetyHeader): string[] {
  return REQUIRED.filter((k) => !(header[k] ?? '').trim()).map((k) => HEADER_FIELDS.find((f) => f.key === k)!.label);
}

/** Palanquées dont la profondeur prévue dépasse la prérogative : « P2 », prévue, permise. */
export function overDepth(dive: Pick<Dive, 'plan' | 'sheets'>): { label: string; planned: number; legal: number }[] {
  return (dive.plan?.palanquees ?? []).flatMap((p, i) => {
    const planned = parseDepth(dive.sheets[p.id]?.planned.depth ?? '');
    const legal = depthOf(p);
    return planned !== undefined && planned > legal ? [{ label: `P${i + 1}`, planned, legal }] : [];
  });
}

/** Avertissements à confirmer avant le PDF ou l'impression ; vide : rien à dire. */
export function printWarnings(header: SafetyHeader, dive: Pick<Dive, 'plan' | 'sheets'>): string[] {
  const missing = missingHeader(header);
  return [
    ...(missing.length ? [`Non renseigné : ${missing.join(', ')}.`] : []),
    ...overDepth(dive).map((o) => `${o.label} : ${o.planned} m prévus, au-delà de sa prérogative (${o.legal} m).`),
  ];
}

/** Commentaire sur l'encadrant tel qu'il s'imprime : le texte, qui, quand. */
export const noteText = (n: GuideNote) =>
  `${n.text} (${n.by}, ${new Date(n.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })})`;

/** Valeur d'en-tête telle qu'imprimée : la date en toutes lettres. */
export function headerText(key: keyof SafetyHeader, value: string): string {
  if (key !== 'date' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
