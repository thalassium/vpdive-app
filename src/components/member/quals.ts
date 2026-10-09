/*
 * Niveaux, prérogatives et certificat médical d'un membre, quelle que soit leur
 * source : sa fiche VPDive (profil, fiche membre) ou la liste des inscrits d'une
 * sortie. Partagés par « Mon profil » et la fiche membre (MemberSheet). À part pour
 * que les .tsx n'exportent que des composants (rechargement à chaud de Vite).
 */
import type { MemberProfile, RosterEntry } from '../../services/vpdive';
import { ymd } from '../../lib/dates';

/** Niveaux, prérogatives et certificat médical, quelle que soit leur source. */
export interface Quals {
  groups: { label: string; items: string[] }[];
  training: string[];
  medical: { until: string | null; valid: boolean } | null;
}

export const hasAny = (q: Quals | null): q is Quals => !!q && (q.groups.some((g) => g.items.length > 0) || q.training.length > 0 || !!q.medical);

/** Fiche membre VPDive (permission `member_view`) : niveaux, enseignement et qualifications séparés. */
export function fromProfile(p: MemberProfile): Quals {
  const until = p.medicalUntil || null;
  return {
    groups: [
      { label: 'Niveaux', items: p.levels },
      { label: 'Enseignement', items: p.teaching },
      { label: 'Qualifications', items: p.qualifications },
    ],
    training: [],
    medical: until ? { until, valid: until >= ymd(new Date()) } : null,
  };
}

/** Liste des inscrits d'une sortie : niveaux et diplômes mêlés, prépas, certificat. */
export function fromRoster(r: RosterEntry): Quals {
  return {
    groups: [{ label: 'Niveaux et diplômes', items: r.display }],
    training: r.training,
    medical: r.medical.until || r.medical.valid ? r.medical : null,
  };
}
