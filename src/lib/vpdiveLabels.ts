/** Libellés VPDive remis en français : référentiels (activité, type de sortie…) et refus d'inscription. */

/**
 * VPDive renvoie ses libellés de référence (activité, type de sortie, domaine,
 * catégories du calendrier) en anglais, en clés minuscules, même pour un club
 * français. On les remet en français ; un libellé inconnu passe tel quel.
 * Relevés dans fixtures/*.json (npm run probe).
 */
const FRENCH: Record<string, string> = {
  'diving leisure': 'Plongée loisir',
  'natural sea': 'Mer',
  'natural other': 'Autre milieu naturel',
  room: 'Salle',
  'practical courses': 'Cours pratique',
  'theoretical course': 'Cours théorique',
  'practical internship': 'Stage pratique',
  'initial internship': 'Stage initial',
  'final internship': 'Stage final',
  exam: 'Examen',
  outing: 'Sortie',
  training: 'Formation',
  meeting: 'Réunion',
  meal: 'Repas',
  medical: 'Médical',
  competition: 'Compétition',
  'life of the organization': 'Vie de l’organisation',
  'association life': 'Vie associative',
  children: 'Enfants',
  baptisms: 'Baptêmes',
  divee: 'Plongée',
  'sport diving': 'Plongée sportive',
  'teak diving': 'Plongée Tek',
  trimix: 'Trimix',
  nitrox: 'Nitrox',
  recycler: 'Recycleur',
  apnea: 'Apnée',
  handisub: 'Handisub',
  'swimming with fins': 'Nage avec palmes',
  'whitewater swimming': 'Nage en eau vive',
  'bio and environment': 'Bio et environnement',
  'visual audio': 'Audiovisuel',
};
export const french = (name: string): string => FRENCH[name.trim().toLowerCase()] ?? name;

/** Pourquoi VPDive refuse une inscription (`can_register`), dit au membre. */
export const REFUSAL_LABELS: Record<string, string> = {
  'registration too late': 'Les inscriptions sont closes.',
  'registration too early': 'Les inscriptions ne sont pas encore ouvertes.',
  full: 'La sortie est complète.',
};
