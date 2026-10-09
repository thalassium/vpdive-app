/**
 * Dates à la française, pour tout l'écran : jour local AAAA-MM-JJ, jj/mm/aaaa,
 * « sam. 11 oct. », noms des mois et des jours.
 */

/** Local-time YYYY-MM-DD (toISOString would shift to UTC and give the previous day in France). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** « 2026-10-10 » (ou le début d'une date ISO) → « 10/10/2026 » ; vide si vide. */
export const frDate = (iso: string): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** Une date AAAA-MM-JJ prise à midi (aucun fuseau ne la fait changer de jour), ou une date-heure ISO. */
const toDate = (s: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
/** « sam. 11 oct. » */
export const shortDay = (s: string): string => toDate(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
/** « samedi 11 octobre » */
export const longDay = (s: string): string => toDate(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const MONTHS_SHORT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
/** Jours de la semaine, du lundi au dimanche (en-têtes d'agenda, statistiques). */
export const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
/** « Sam. » : le jour d'une date, abrégé avec une majuscule. */
export const weekdayShort = (d: Date): string => {
  const w = WEEKDAYS[(d.getDay() + 6) % 7]!;
  return w.charAt(0).toUpperCase() + w.slice(1);
};
