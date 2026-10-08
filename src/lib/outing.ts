/**
 * Une sortie côté DP : ses plongées, les palanquées de chacune et la fiche de
 * sécurité (art. A322-72 du Code du sport), sur le modèle de
 * ressourcedev/Fiche-securite-plongee.xlsx. Enregistrée sur le serveur de
 * l'appli (server/handler.ts), partagée entre les admins et le DP de la sortie.
 */
import type { Diver, Plan } from './palanquees';
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
  /** Personnes à bord qui ne plongent pas (nombre ou noms). Absent sur les sorties enregistrées avant. */
  accompagnants: string;
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

/**
 * En-tête de la fiche (DP, pilote, sécurité surface) d'après les rôles :
 * « Prénom Nom, Prénom Nom ». Avec `only`, seulement ce champ : changer un
 * rôle ne réécrit pas ce que le DP a saisi à la main dans les deux autres.
 */
export function headerFromRoles(roster: RosterEntry[], roles: Roles, only?: DiveRole): Partial<Pick<SafetyHeader, DiveRole>> {
  const byId = new Map(roster.map((r) => [r.id, r]));
  const names = (role: DiveRole) =>
    (roles[role] ?? [])
      .map((id) => byId.get(id))
      .filter((r): r is RosterEntry => !!r)
      .map((r) => `${r.firstname} ${r.lastname}`.trim() || r.name)
      .join(', ');
  const out: Partial<Pick<SafetyHeader, DiveRole>> = {};
  for (const { id } of DIVE_ROLES) if (!only || only === id) out[id] = names(id);
  return out;
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

/**
 * Met (ou retire, avec null) une personne à une place d'un poste. Pas de doublon
 * sur un même poste. Ne garde que les postes actuels : les anciens « pilotage »
 * et « securite » (devenus des rôles) disparaissent à la première modification.
 */
export function setVolunteer(v: Volunteers, post: VolunteerPost, slot: number, id: string | null): Volunteers {
  const current = [...(v[post] ?? [])];
  if (id && current.some((x, i) => x === id && i !== slot)) return v;
  if (id) current[slot] = id;
  else current.splice(slot, 1);
  const out: Volunteers = {};
  for (const { id: key } of VOLUNTEER_POSTS) if (v[key]) out[key] = v[key];
  return { ...out, [post]: current.filter(Boolean).slice(0, MAX_PER_POST) };
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
      dp: '',
      pilote: '',
      securite: '',
      ...headerFromRoles(roster, roles),
      date: event.start.slice(0, 10),
      creneau: event.allDay ? '' : hour < 12 ? 'Matin' : hour < 18 ? 'Après-midi' : 'Nuit',
      lieu: '',
      accompagnants: '',
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

/**
 * Tient la sortie d'accord avec la liste des inscrits et avec « Qui plonge ? »,
 * au chargement comme à chaque modification. N'est dans l'eau (palanquées,
 * non-placés, gaz) que celui qui est inscrit et coché « plonge » ; les rôles
 * et les postes de bénévoles ne demandent que d'être inscrit. Une palanquée
 * qui perd son encadrant garde ses plongeurs, désormais sans encadrant (« À
 * revoir ») ; une palanquée vidée disparaît. Une plongée validée dont la
 * composition change est dévalidée : sa fiche de sécurité n'est plus juste.
 * `departed` : les désinscrits retirés d'une composition, pour le dire au DP.
 * Rien ne change : les mêmes plongées (même objet) sont rendues.
 */
export function syncWithRoster(doc: OutingDoc, roster: RosterEntry[]): { doc: OutingDoc; departed: string[] } {
  const present = new Set(dayParticipants(roster).map((r) => r.id));
  const excluded = new Set(doc.settings.excluded);
  const gone = new Map<string, string>();
  let moved = 0;
  const keep = <T extends Diver | null>(d: T): T => {
    if (!d) return d;
    if (!present.has(d.id)) {
      gone.set(d.id, d.name);
      return null as T;
    }
    if (excluded.has(d.id)) {
      moved++;
      return null as T;
    }
    return d;
  };
  const onlyPresent = (ids: string[] | undefined) => ids?.filter((id) => present.has(id));

  const dives = doc.dives.map((dive) => {
    const gas = Object.fromEntries(Object.entries(dive.gas).filter(([id]) => present.has(id) && !excluded.has(id)));
    if (!dive.plan) return Object.keys(gas).length === Object.keys(dive.gas).length ? dive : { ...dive, gas };
    const before = gone.size + moved;
    const palanquees = dive.plan.palanquees
      .map((p) => ({ ...p, guide: keep(p.guide), extra: keep(p.extra), members: p.members.filter((m) => keep(m) !== null) }))
      .filter((p) => p.guide || p.extra || p.members.length > 0);
    const unassigned = dive.plan.unassigned.filter((u) => keep(u.diver) !== null);
    const changed = gone.size + moved > before || palanquees.length !== dive.plan.palanquees.length;
    if (!changed) return Object.keys(gas).length === Object.keys(dive.gas).length ? dive : { ...dive, gas };
    const kept = new Set(palanquees.map((p) => p.id));
    const sheets = Object.fromEntries(Object.entries(dive.sheets).filter(([id]) => kept.has(id)));
    return { ...dive, plan: { palanquees, unassigned }, validated: null, sheets, gas };
  });

  const roles: Roles = {};
  for (const { id } of DIVE_ROLES) {
    const ids = onlyPresent(doc.roles?.[id]);
    if (ids?.length) roles[id] = ids;
  }
  const volunteers: Volunteers = {};
  for (const { id } of VOLUNTEER_POSTS) {
    const ids = onlyPresent(doc.volunteers?.[id]);
    if (ids?.length) volunteers[id] = ids;
  }

  const unchanged = dives.every((d, i) => d === doc.dives[i]) && sameIds(roles, doc.roles) && sameIds(volunteers, doc.volunteers) && doc.settings.excluded.every((id) => present.has(id));
  if (unchanged) return { doc, departed: [] };
  return {
    doc: {
      ...doc,
      settings: { ...doc.settings, excluded: doc.settings.excluded.filter((id) => present.has(id)) },
      dives,
      ...(doc.roles ? { roles } : {}),
      ...(doc.volunteers ? { volunteers } : {}),
    },
    departed: [...new Set(gone.values())],
  };
}

/** Mêmes identifiants par clé (les clés vides comptent comme absentes). */
function sameIds(a: Record<string, string[] | undefined>, b: Record<string, string[] | undefined> | undefined): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b ?? {})]);
  return [...keys].every((k) => (a[k] ?? []).join() === (b?.[k] ?? []).join());
}

/**
 * Sorties enregistrées avant un changement de la fiche : champs ajoutés depuis
 * (accompagnants) et lieu pré-rempli avec le titre de la sortie, effacé — le
 * lieu se choisit désormais (liste à venir), il n'est plus deviné.
 */
export function normalizeOuting(doc: OutingDoc, event: Pick<CalendarEvent, 'title'>): OutingDoc {
  const header = { ...doc.header, accompagnants: doc.header.accompagnants ?? '' };
  if (header.lieu === event.title) header.lieu = '';
  return header.accompagnants === doc.header.accompagnants && header.lieu === doc.header.lieu ? doc : { ...doc, header };
}

/** Nombre de plongeurs à l'eau pour une plongée (en-tête de la fiche). */
export const diversInWater = (dive: Dive) =>
  dive.plan?.palanquees.reduce((n, p) => n + p.members.length + (p.guide ? 1 : 0) + (p.extra ? 1 : 0), 0) ?? 0;
