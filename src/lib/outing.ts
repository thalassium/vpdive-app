/**
 * Une sortie côté DP : ses plongées, les palanquées de chacune et la fiche de
 * sécurité (art. A322-72 du Code du sport), sur le modèle de
 * ressourcedev/Fiche-securite-plongee.xlsx. Enregistrée sur le serveur de
 * l'appli (server/handler.ts), partagée entre les admins et le DP de la sortie.
 */
import type { Plan } from './palanquees';
import type { DiverSettings } from './palanqueeEdit';
import { DP_ROLE, SURFACE_ROLES, type CalendarEvent, type RosterEntry } from '../services/vpdiveApi';

export interface DiveParams {
  /** Durée en minutes, profondeur en mètres, heure de mise à l'eau (HH:MM). */
  duration: string;
  depth: string;
  time: string;
}

export interface PalanqueeSheet {
  planned: DiveParams;
  actual: DiveParams;
}

export interface Dive {
  id: string;
  label: string;
  plan: Plan | null;
  /** Palanquées validées : la fiche de sécurité est débloquée. */
  validated: { by: string; at: string } | null;
  /** id de palanquée → paramètres prévus / réalisés */
  sheets: Record<string, PalanqueeSheet>;
  /** id de plongeur → gaz (vide = air) */
  gas: Record<string, string>;
}

export interface SafetyHeader {
  etablissement: string;
  reference: string;
  bateau: string;
  pilote: string;
  dp: string;
  securite: string;
  date: string;
  creneau: string;
  lieu: string;
}

export interface OutingDoc {
  rev?: number;
  updatedAt?: string;
  updatedBy?: string;
  settings: DiverSettings & { excluded: string[] };
  header: SafetyHeader;
  dives: Dive[];
  /** Bénévoles de la sortie : id de poste → inscrits (2 au plus). Absent sur les sorties enregistrées avant. */
  volunteers?: Volunteers;
  /** DP, pilote, sécurité surface : id de rôle → inscrits. Absent sur les sorties enregistrées avant. */
  roles?: Roles;
}

/**
 * Rôles de la sortie, à part des bénévoles : chacun est tenu par un inscrit,
 * encadrant ou non, qu'il plonge ou non. Ils remplissent l'en-tête de la fiche de sécurité.
 */
export const DIVE_ROLES = [
  { id: 'dp', label: 'Directeur de plongée', short: 'DP' },
  { id: 'pilote', label: 'Pilote', short: 'Pilote' },
  { id: 'securite', label: 'Sécurité surface', short: 'Sécu' },
] as const;
export type DiveRole = (typeof DIVE_ROLES)[number]['id'];
export type Roles = Partial<Record<DiveRole, string[]>>;

const ROLE_FROM_VPDIVE: Record<DiveRole, RegExp> = { dp: DP_ROLE, pilote: /pilote/i, securite: /s[ée]curit[ée] surface/i };

/** Rôles proposés au départ : ceux que VPDive connaît déjà (rôles de la sortie). */
export function defaultRoles(roster: RosterEntry[]): Roles {
  const out: Roles = {};
  for (const { id } of DIVE_ROLES) {
    const ids = dayParticipants(roster)
      .filter((r) => r.roles.some((x) => ROLE_FROM_VPDIVE[id].test(x)))
      .map((r) => r.id);
    if (ids.length) out[id] = ids;
  }
  return out;
}

/** Donne ou retire un rôle à un inscrit. */
export function toggleRole(roles: Roles, role: DiveRole, id: string): Roles {
  const current = roles[role] ?? [];
  return { ...roles, [role]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
}

/** Rôles d'un inscrit, dans l'ordre DP, pilote, sécurité surface. */
export const rolesOf = (roles: Roles, id: string): DiveRole[] => DIVE_ROLES.filter((r) => roles[r.id]?.includes(id)).map((r) => r.id);

/** En-tête de la fiche (DP, pilote, sécurité surface) d'après les rôles : « Prénom Nom, Prénom Nom ». */
export function headerFromRoles(roster: RosterEntry[], roles: Roles): Pick<SafetyHeader, DiveRole> {
  const byId = new Map(roster.map((r) => [r.id, r]));
  const names = (role: DiveRole) =>
    (roles[role] ?? [])
      .map((id) => byId.get(id))
      .filter((r): r is RosterEntry => !!r)
      .map((r) => `${r.firstname} ${r.lastname}`.trim() || r.name)
      .join(', ');
  return { dp: names('dp'), pilote: names('pilote'), securite: names('securite') };
}

/** Postes tenus par des bénévoles pendant la sortie (un par ligne de l'écran Bénévoles). Pilote et sécurité surface sont des rôles (DIVE_ROLES). */
export const VOLUNTEER_POSTS = [
  { id: 'matelotage', label: 'Matelotage' },
  { id: 'detendeurs', label: 'Détendeurs' },
  { id: 'gilets', label: 'Gilets stabilisateurs' },
  { id: 'eau', label: 'Eau / Vaisselle' },
  { id: 'check', label: 'Check final' },
] as const;
export type VolunteerPost = (typeof VOLUNTEER_POSTS)[number]['id'];
export type Volunteers = Partial<Record<VolunteerPost, string[]>>;
/** Deux personnes au plus par poste ; une même personne peut tenir plusieurs postes. */
export const MAX_PER_POST = 2;

/** Ceux qu'on peut désigner : les inscrits de la journée, hors liste d'attente. */
export const dayParticipants = (roster: RosterEntry[]) => roster.filter((r) => !r.waitingList);

/** Met (ou retire, avec null) une personne à une place d'un poste. Pas de doublon sur un même poste. */
export function setVolunteer(v: Volunteers, post: VolunteerPost, slot: number, id: string | null): Volunteers {
  const current = [...(v[post] ?? [])];
  if (id && current.some((x, i) => x === id && i !== slot)) return v;
  if (id) current[slot] = id;
  else current.splice(slot, 1);
  return { ...v, [post]: current.filter(Boolean).slice(0, MAX_PER_POST) };
}

/** Qui fait quoi : id d'inscrit → postes, pour le récapitulatif. */
export function postsByPerson(v: Volunteers): Map<string, VolunteerPost[]> {
  const out = new Map<string, VolunteerPost[]>();
  for (const { id } of VOLUNTEER_POSTS) for (const person of v[id] ?? []) out.set(person, [...(out.get(person) ?? []), id]);
  return out;
}

export const emptyParams = (): DiveParams => ({ duration: '', depth: '', time: '' });
export const emptySheet = (): PalanqueeSheet => ({ planned: emptyParams(), actual: emptyParams() });

/** Nouvelle sortie : en-tête et rôles pré-remplis depuis VPDive, personne en liste d'attente ni à terre dans l'eau. */
export function newOuting(event: CalendarEvent, roster: RosterEntry[], clubName: string): OutingDoc {
  const start = new Date(event.start);
  const hour = start.getHours();
  const roles = defaultRoles(roster);
  return {
    settings: {
      levels: {},
      training: {},
      excluded: roster.filter((r) => r.waitingList || (r.roles.length > 0 && r.roles.every((x) => SURFACE_ROLES.test(x)))).map((r) => r.id),
    },
    header: {
      etablissement: clubName,
      reference: '',
      bateau: '',
      ...headerFromRoles(roster, roles),
      date: event.start.slice(0, 10),
      creneau: event.allDay ? '' : hour < 12 ? 'Matin' : hour < 18 ? 'Après-midi' : 'Nuit',
      lieu: event.title,
    },
    dives: [{ id: 'd1', label: 'Plongée 1', plan: null, validated: null, sheets: {}, gas: {} }],
    volunteers: {},
    roles,
  };
}

/**
 * Plongée suivante : mêmes palanquées que la précédente (encore modifiables,
 * non validées), paramètres vierges.
 */
export function nextDive(doc: OutingDoc): Dive {
  const prev = doc.dives[doc.dives.length - 1];
  const n = doc.dives.length + 1;
  return {
    id: `d${Date.now().toString(36)}`,
    label: `Plongée ${n}`,
    plan: prev?.plan ? structuredClone(prev.plan) : null,
    validated: null,
    sheets: {},
    gas: prev ? { ...prev.gas } : {},
  };
}

/** Nombre de plongeurs à l'eau pour une plongée (en-tête de la fiche). */
export const diversInWater = (dive: Dive) =>
  dive.plan?.palanquees.reduce((n, p) => n + p.members.length + (p.guide ? 1 : 0) + (p.extra ? 1 : 0), 0) ?? 0;
