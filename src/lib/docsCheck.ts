/**
 * Documents d'un inscrit pour une sortie, tels que le club les exige : il doit
 * être couvert LE JOUR DE LA SORTIE.
 *   - CACI (certificat médical) absent ou périmé à cette date : rouge.
 *   - Pas de licence FFESSM valable à cette date : jaune.
 *   - Adhésion de la saison de la sortie (du 1er septembre au 31 août) non
 *     confirmée : jaune ; si la fiche du membre n'a pas pu être lue, « adhésion
 *     non vérifiée » (discret).
 *
 * Sources : la liste des inscrits (RosterEntry, certificat et licences) et, si
 * on a pu la lire, la fiche du membre (vpdive.memberStatus : saisons et
 * licences avec leur fédération). Les dates sont des chaînes AAAA-MM-JJ, que
 * l'ordre alphabétique compare comme des dates.
 */

import type { RosterEntry } from '../services/vpdive';
import { seasonLabel, seasonOf } from './membership';
import { frDate, ymd } from './dates';

/** Saison d'une sortie, pour les messages de relance (« 2026/2027 »). */
export const seasonOfOuting = (outingDate: string) => seasonLabel(seasonOf(outingDate));

export type DocKind = 'caci' | 'licence' | 'adhesion';
export type DocLevel = 'red' | 'yellow' | 'ok';

export interface DocIssue {
  kind: DocKind;
  /** muted : rien de sûr (fiche non lue), ne compte pas dans le niveau. */
  level: 'red' | 'yellow' | 'muted';
  text: string;
}

export interface DocsResult {
  level: DocLevel;
  issues: DocIssue[];
}

/** Ce que vpdive.memberStatus renvoie. */
export interface DocsStatus {
  seasons: string[];
  licences: { number: string; organization: string; expires: string; expired: boolean; validated: boolean }[];
}

/**
 * Numéro de licence FFESSM, saisi de mille façons dans VPDive (« A-26-123456 »,
 * « A26-123456 », « A 26 12345 », « a261045719 ») : un A suivi de l'année et du
 * numéro, une fois retirés espaces, tirets et autres séparateurs.
 */
export const FFESSM_NUMBER = /^A\d{6,}$/i;

/**
 * Licence FFESSM ? L'organisation fait foi quand elle est connue (« F.F.E.S.S.M. »,
 * « FFESSM », points et casse ignorés) ; sinon, la forme du numéro.
 */
export function isFfessm(organization: string, number: string): boolean {
  const org = organization.replace(/[^a-z]/gi, '').toUpperCase();
  if (org) return org.includes('FFESSM');
  return FFESSM_NUMBER.test(number.replace(/[^a-z0-9]/gi, ''));
}

const localToday = (): string => ymd(new Date());

/** « expiré le » pour une date passée, « expire le » pour une date à venir (mais avant la sortie). */
const expiry = (until: string, today: string, feminine: boolean) =>
  `${until < today ? (feminine ? 'expirée' : 'expiré') : 'expire'} le ${frDate(until)}`;

export function checkDocs(
  entry: Pick<RosterEntry, 'medical' | 'licences'>,
  outingDate: string,
  status: DocsStatus | null,
  today: string = localToday(),
): DocsResult {
  const issues: DocIssue[] = [];

  // CACI
  const { until, valid } = entry.medical;
  if (until ? until < outingDate : !valid) {
    issues.push({ kind: 'caci', level: 'red', text: until ? `CACI ${expiry(until, today, false)}` : 'CACI manquant' });
  }

  // Licence FFESSM : la fiche du membre d'abord, sinon les licences de la liste des inscrits.
  const ffessm: { until: string | null; ok: boolean }[] = status
    ? status.licences
        .filter((l) => isFfessm(l.organization, l.number))
        .map((l) => ({ until: l.expires || null, ok: l.expires ? l.expires >= outingDate : !l.expired }))
    : (entry.licences ?? [])
        .filter((l) => isFfessm('', l.number))
        .map((l) => ({ until: l.until, ok: l.until ? l.until >= outingDate : l.valid }));
  if (!ffessm.some((l) => l.ok)) {
    const last = ffessm
      .map((l) => l.until)
      .filter((d): d is string => !!d)
      .sort()
      .pop();
    issues.push({ kind: 'licence', level: 'yellow', text: last ? `Licence FFESSM ${expiry(last, today, true)}` : 'Licence FFESSM manquante' });
  }

  // Adhésion de la saison de la sortie (1er septembre → 31 août ; VPDive la note par son année de fin).
  const season = seasonOf(outingDate);
  if (!status) {
    issues.push({ kind: 'adhesion', level: 'muted', text: 'Adhésion non vérifiée' });
  } else if (!status.seasons.map(String).includes(String(season))) {
    issues.push({ kind: 'adhesion', level: 'yellow', text: `Adhésion ${seasonLabel(season)} non confirmée` });
  }

  const level: DocLevel = issues.some((i) => i.level === 'red') ? 'red' : issues.some((i) => i.level === 'yellow') ? 'yellow' : 'ok';
  return { level, issues };
}

/** Ce qui manque, en toutes lettres, pour le message de relance. */
const WHAT: Record<DocKind, (year: string) => { text: string; it: string }> = {
  caci: () => ({ text: 'un certificat médical (CACI) valable le jour de la sortie', it: 'le' }),
  licence: () => ({ text: 'une licence FFESSM en cours de validité', it: 'la' }),
  adhesion: (year) => ({ text: `ton adhésion au club pour la saison ${year}`, it: 'la' }),
};

const joinFr = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;

export const PROFILE_URL = 'https://septentrion-env.vpdive.com/app/profile';

/** Relance d'une personne, pour sa prochaine sortie concernée. */
export function reminderText(p: { firstName: string; date: string; title: string; kinds: DocKind[]; year: string; from: string }): string {
  const kinds = (['caci', 'licence', 'adhesion'] as const).filter((k) => p.kinds.includes(k));
  const items = kinds.map((k) => WHAT[k](p.year));
  const it = items.length === 1 ? items[0]!.it : 'les';
  const hello = p.firstName.trim() ? `Bonjour ${p.firstName.trim()},` : 'Bonjour,';
  return (
    `${hello}\n\nPour la sortie du ${p.date} (${p.title}), il manque dans ton dossier VPDive : ${joinFr(items.map((i) => i.text))}.\n` +
    `Peux-tu ${it} mettre à jour sur ${PROFILE_URL} ?\n\nMerci,\n${p.from}`
  );
}

/** Relance groupée : un seul texte pour tous, qui rappelle les trois documents. */
export function bulkReminderText(p: { year: string; from: string }): string {
  return (
    'Bonjour,\n\nPour tes prochaines sorties avec le club, ton dossier VPDive n’est pas complet. Il doit contenir, valables le jour de la sortie :\n' +
    `- ${WHAT.caci(p.year).text.replace(' valable le jour de la sortie', '')} ;\n` +
    `- ${WHAT.licence(p.year).text} ;\n` +
    `- ${WHAT.adhesion(p.year).text}.\n\n` +
    `Peux-tu les mettre à jour sur ${PROFILE_URL} ?\n\nMerci,\n${p.from}`
  );
}
