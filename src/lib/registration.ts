/**
 * Inscription à une sortie : « Je viens comme… » plongeur, encadrant ou
 * bénévole, d'après les rôles que VPDive propose pour la sortie
 * (available_roles) et les niveaux du membre.
 *
 *   - Plongeur   rôle « diver » : formule, matériel, binôme.
 *   - Encadrant  réservé aux N4/GP, P5 et E1…E4. « J'encadre » envoie le rôle
 *                Enseignant/Encadrant (VPDive recalcule les tarifs : plongées
 *                à 0 €), « Je plonge pour moi » envoie le rôle plongeur, au
 *                tarif plein.
 *   - Bénévole   un poste de surface (Sécurité surface, Gonfleur, Pilote…) :
 *                ni formule, ni matériel, ni binôme.
 *
 * Le rôle Directeur de plongée n'est jamais proposé : le club l'attribue. En
 * modification, un rôle DP (ou un rôle que la sortie ne propose plus) est
 * gardé tel quel et renvoyé inchangé.
 */

import { aptitudesFromLabels, isInstructor } from './palanquees';
import { DP_ROLE, type RoleOption } from '../services/vpdiveApi';

export type Entry = 'diver' | 'instructor' | 'volunteer';
export type InstructorMode = 'supervise' | 'dive';

export interface RoleClasses {
  diver: RoleOption | null;
  dp: RoleOption | null;
  instructor: RoleOption | null;
  /** Postes de surface : tout rôle qui n'est ni plongeur, ni DP, ni encadrant. */
  volunteers: RoleOption[];
}

const DIVER_ROLE = /plongeur/i;
const INSTRUCTOR_ROLE = /enseignant|encadrant|moniteur/i;

/** Libellé sans l'indication de prix que VPDive ajoute : « Pilote (dès 32€) » → « Pilote ». */
export const cleanRoleLabel = (label: string): string => label.replace(/\s*\([^()]*€[^()]*\)\s*$/, '').trim();

/** Rôles de la sortie reconnus à leur nom ; le premier de chaque sorte compte. */
export function classifyRoles(roles: RoleOption[]): RoleClasses {
  const cls: RoleClasses = { diver: null, dp: null, instructor: null, volunteers: [] };
  for (const r of roles) {
    if (r.key === 'diver' || DIVER_ROLE.test(r.label)) cls.diver ??= r;
    else if (DP_ROLE.test(r.label)) cls.dp ??= r;
    else if (INSTRUCTOR_ROLE.test(r.label)) cls.instructor ??= r;
    else cls.volunteers.push(r);
  }
  return cls;
}

/** Peut encadrer : N4/GP ou E1…E4 d'après le moteur des palanquées, ou un libellé P5 / DPE. */
export function canSupervise(labels: string[]): boolean {
  return labels.some((l) => /\bP5\b|\bDPE\b/i.test(l)) || isInstructor(aptitudesFromLabels(labels));
}

export type Preselect = { entry: Entry; mode?: InstructorMode; post?: string } | { fixed: RoleOption } | null;

/**
 * Pour pré-remplir la modification d'une inscription : d'où vient le rôle
 * enregistré. `fixed` : DP, ou rôle que la sortie ne propose plus (libellé
 * vide), gardé tel quel.
 */
export function entryFromRole(roleKey: string | null, cls: RoleClasses): Preselect {
  if (!roleKey) return null;
  if (cls.diver && roleKey === cls.diver.key) return { entry: 'diver' };
  if (cls.instructor && roleKey === cls.instructor.key) return { entry: 'instructor', mode: 'supervise' };
  const post = cls.volunteers.find((v) => v.key === roleKey);
  if (post) return { entry: 'volunteer', post: post.key };
  if (cls.dp && roleKey === cls.dp.key) return { fixed: cls.dp };
  return { fixed: { key: roleKey, label: '' } };
}

export interface Asks {
  tariff: boolean;
  gear: boolean;
  buddy: boolean;
}

/** Ce que le formulaire demande : tout sans rôle choisi ; rien d'un bénévole ; pas de binôme pour qui encadre. */
export function asksFor(entry: Entry | null, mode: InstructorMode | null): Asks {
  if (entry === 'volunteer') return { tariff: false, gear: false, buddy: false };
  return { tariff: true, gear: true, buddy: entry !== 'instructor' || mode === 'dive' };
}

/** Clé de rôle à envoyer à VPDive (role_suggestion), null pour le rôle par défaut. */
export function roleKeyFor(entry: Entry | null, mode: InstructorMode | null, post: string | null, cls: RoleClasses): string | null {
  if (!entry) return null;
  if (entry === 'volunteer') return post;
  if (entry === 'instructor' && mode === 'supervise') return cls.instructor?.key ?? null;
  return cls.diver?.key ?? null;
}

export type VolunteerTotal = { zero: true } | { zero: false; from: number } | { unknown: true };

/**
 * Ce que coûte un poste de bénévole, d'après l'indication que VPDive écrit
 * dans le nom du rôle : « Sécurité surface (0€) » → 0 €, « Pilote (dès 32€) »
 * → dès 32 €. Sans indication, on ne sait pas : le montant exact arrive
 * dans le panier après l'inscription.
 */
export function volunteerTotal(roleLabel: string): VolunteerTotal {
  const m = /\((?:dès\s*)?(\d+(?:[.,]\d+)?)\s*€\)\s*$/i.exec(roleLabel);
  if (!m) return { unknown: true };
  const from = Number(m[1]!.replace(',', '.'));
  return from > 0 ? { zero: false, from } : { zero: true };
}
