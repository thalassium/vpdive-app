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
  /** id de palanquée → commentaire libre à côté de l'encadrant (qui, quand). Absent sur les sorties enregistrées avant. */
  notes?: Record<string, GuideNote>;
}

/** Commentaire sur l'encadrant d'une palanquée : le texte, qui l'a écrit et quand (posés par le serveur). */
export interface GuideNote {
  text: string;
  by: string;
  at: string;
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
  settings: DiverSettings & {
    excluded: string[];
    /** Accompagnants : à bord, ne plongent pas (désignés par le DP, ou « accompagnant » dans leur message d'inscription). */
    companions?: string[];
    /**
     * Inscrits déjà vus par la fiche : un inscrit arrivé depuis reçoit les choix
     * par défaut d'un nouvel inscrit (pilote, sécurité surface, accompagnant :
     * décochés). Absent sur les sorties enregistrées avant : personne n'est nouveau.
     */
    seen?: string[];
  };
  header: SafetyHeader;
  dives: Dive[];
  /** Bénévoles de la sortie : id de poste → inscrits (2 au plus). Absent sur les sorties enregistrées avant. */
  volunteers?: Volunteers;
  /** DP, pilote, sécurité surface : id de rôle → inscrits. Absent sur les sorties enregistrées avant. */
  roles?: Roles;
  /** Plongeurs hors VPDive ajoutés par le DP (baptêmes, invités…). */
  guests?: Guest[];
  /** Membres VPDive ajoutés par le DP sans qu'ils se soient inscrits (DP, pilote, sécu désignés…). */
  members?: AddedMember[];
  /** Inscrits que le DP a désinscrits de VPDive depuis cet écran : affichés barrés. */
  unregistered?: Unregistered[];
}

export interface Guest {
  /** « ext-… » : jamais un identifiant VPDive. */
  id: string;
  firstname: string;
  lastname: string;
  baptism: boolean;
  comment: string;
}

export interface Unregistered {
  id: string;
  name: string;
  /** Rangé avec les encadrants ou avec les plongeurs. */
  instructor: boolean;
  by: string;
  at: string;
}

export interface AddedMember {
  /** « uct:<jeton d'adhésion> » : remplacé par l'identifiant VPDive s'il s'inscrit (adoptRegistrations). */
  id: string;
  uct: string;
  name: string;
  picture: string;
  /** Codes de niveau (P4, E3…) et niveaux tels que VPDive les écrit, lus sur sa fiche à l'ajout. */
  levels: string[];
  display: string[];
}

export const addedMemberId = (uct: string) => `uct:${uct}`;

/** Le membre ajouté tel que l'écran DP lit un inscrit. */
export function memberEntry(m: AddedMember): RosterEntry {
  // « NOM COMPOSÉ Prénom » : les mots tout en capitales forment le nom.
  const words = m.name.trim().split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w) => w !== w.toUpperCase());
  return {
    id: m.id,
    name: m.name,
    firstname: cut < 0 ? '' : words.slice(cut).join(' '),
    lastname: (cut < 0 ? words : words.slice(0, cut)).join(' '),
    levels: m.levels,
    display: m.display,
    training: [],
    roles: [],
    age: null,
    waitingList: false,
    comment: '',
    medical: { until: null, valid: false },
    ...(m.picture ? { picture: m.picture } : {}),
    uct: m.uct,
    added: true,
  };
}

/**
 * Un membre ajouté qui s'est inscrit depuis : il devient l'inscrit VPDive,
 * avec ses rôles, sa place et ses réglages (son identifiant est remplacé partout).
 */
export function adoptRegistrations(doc: OutingDoc, roster: RosterEntry[]): OutingDoc {
  const members = doc.members ?? [];
  const byUct = new Map(roster.filter((r) => r.uct).map((r) => [r.uct!, r.id]));
  const adopted = members.filter((m) => byUct.has(m.uct));
  if (!adopted.length) return doc;
  let text = JSON.stringify({ ...doc, members: members.filter((m) => !byUct.has(m.uct)) });
  for (const m of adopted) text = text.split(JSON.stringify(m.id)).join(JSON.stringify(byUct.get(m.uct)));
  return JSON.parse(text) as OutingDoc;
}

/** Nouveau plongeur hors VPDive ; null sans prénom ni nom. */
export function newGuest(input: Omit<Guest, 'id'>, id = `ext-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): Guest | null {
  const firstname = input.firstname.trim();
  const lastname = input.lastname.trim();
  if (!firstname && !lastname) return null;
  return { id, firstname, lastname, baptism: input.baptism, comment: input.comment.trim() };
}

/** Le plongeur hors VPDive tel que l'écran DP lit un inscrit ; un baptême part débutant. */
export function guestEntry(g: Guest): RosterEntry {
  return {
    id: g.id,
    name: `${g.lastname.toUpperCase()} ${g.firstname}`.trim(),
    firstname: g.firstname,
    lastname: g.lastname,
    levels: g.baptism ? ['Baptême'] : [],
    display: g.baptism ? ['Baptême'] : [],
    training: [],
    roles: [],
    age: null,
    waitingList: false,
    comment: g.comment,
    medical: { until: null, valid: false },
    outside: true,
  };
}

/** Les inscrits VPDive, plus les membres ajoutés par le DP et les plongeurs hors VPDive de la sortie. */
export function withGuests(roster: RosterEntry[], doc: Pick<OutingDoc, 'guests' | 'members'> | null): RosterEntry[] {
  const guests = doc?.guests ?? [];
  const members = (doc?.members ?? []).filter((m) => !roster.some((r) => r.id === m.id || (r.uct && r.uct === m.uct)));
  return guests.length || members.length ? [...roster, ...members.map(memberEntry), ...guests.map(guestEntry)] : roster;
}

/** Désinscrits depuis cet écran qui ne sont pas revenus dans la liste VPDive. */
export const stillUnregistered = (doc: Pick<OutingDoc, 'unregistered'>, roster: RosterEntry[]) =>
  (doc.unregistered ?? []).filter((u) => !roster.some((r) => r.id === u.id));

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
 * Qui ne plonge pas : décoché par le DP, ou en liste d'attente sur VPDive. La
 * liste d'attente compte toujours, même pour quelqu'un qui s'y est mis après
 * la création de la fiche ; pour le faire plonger, on l'inscrit sur VPDive.
 */
export function outOfWater(roster: RosterEntry[], settings: OutingDoc['settings']): Set<string> {
  return new Set([...settings.excluded, ...roster.filter((r) => r.waitingList).map((r) => r.id)]);
}

/** Coche ou décoche un inscrit dans « Qui plonge ? ». Cocher un accompagnant en fait un plongeur. */
export function toggleDiving(settings: OutingDoc['settings'], id: string, diving: boolean): OutingDoc['settings'] {
  const excluded = settings.excluded.filter((x) => x !== id);
  const companions = diving && settings.companions?.includes(id) ? { companions: settings.companions.filter((x) => x !== id) } : {};
  return { ...settings, ...companions, excluded: diving ? excluded : [...excluded, id] };
}

/** Message d'inscription d'un accompagnant (« Un accompagnant non plongeur ») : VPDive n'a pas de statut pour cela. */
const COMPANION_COMMENT = /accompagn|non[- ]?plongeu/i;
export const companionByComment = (r: Pick<RosterEntry, 'comment'>) => COMPANION_COMMENT.test(r.comment);

/**
 * Accompagnant ou non : un accompagnant est à bord sans plonger. Le désigner le
 * décoche ; le retirer le laisse décoché (le DP le coche s'il plonge).
 */
export function toggleCompanion(settings: OutingDoc['settings'], id: string, companion: boolean): OutingDoc['settings'] {
  const companions = (settings.companions ?? []).filter((x) => x !== id);
  if (!companion) return { ...settings, companions };
  return { ...settings, companions: [...companions, id], excluded: settings.excluded.includes(id) ? settings.excluded : [...settings.excluded, id] };
}

/**
 * Hors de l'eau par défaut, pour un nouvel inscrit : liste d'attente, pilote ou
 * sécurité surface seulement, accompagnant d'après son message.
 */
const outByDefault = (r: RosterEntry) => r.waitingList || (r.roles.length > 0 && r.roles.every((x) => SURFACE_ROLES.test(x))) || companionByComment(r);

/**
 * Ceux qui plongent sans être dans aucune palanquée et qu'il faut placer avant
 * de valider : tous, sauf ceux qui ont un rôle de la sortie (DP, pilote,
 * sécurité surface : ils peuvent rester à bord) et les accompagnants.
 */
export function mustBePlaced<T extends { id: string }>(unplaced: T[], roles: Roles, settings: OutingDoc['settings']): T[] {
  const companions = new Set(settings.companions ?? []);
  return unplaced.filter((d) => !companions.has(d.id) && rolesOf(roles, d.id).length === 0);
}

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
      excluded: roster.filter(outByDefault).map((r) => r.id),
      companions: roster.filter((r) => !r.waitingList && companionByComment(r)).map((r) => r.id),
      seen: roster.map((r) => r.id),
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
 * Un inscrit arrivé depuis la dernière fois (`settings.seen`) reçoit les choix
 * d'un nouvel inscrit : pilote, sécurité surface ou accompagnant, il est décoché.
 * `departed` : les désinscrits retirés d'une composition, `waitlisted` ceux
 * passés en liste d'attente, pour le dire au DP.
 * Rien ne change : le même objet est rendu.
 */
export function syncWithRoster(doc: OutingDoc, roster: RosterEntry[]): { doc: OutingDoc; departed: string[]; waitlisted: string[] } {
  const present = new Set(dayParticipants(roster).map((r) => r.id));
  const listed = new Set(roster.map((r) => r.id));
  // Nouveaux inscrits : décochés s'ils ne plongent pas d'ordinaire, comme à la création de la fiche.
  const seenBefore = doc.settings.seen ? new Set(doc.settings.seen) : null;
  const newcomers = seenBefore ? roster.filter((r) => !seenBefore.has(r.id)) : [];
  const newOut = newcomers.filter((r) => outByDefault(r) && !doc.settings.excluded.includes(r.id)).map((r) => r.id);
  const newCompanions = newcomers.filter((r) => !r.waitingList && companionByComment(r) && !doc.settings.companions?.includes(r.id)).map((r) => r.id);
  const settingsIn =
    newOut.length || newCompanions.length
      ? { ...doc.settings, excluded: [...doc.settings.excluded, ...newOut], companions: [...(doc.settings.companions ?? []), ...newCompanions] }
      : doc.settings;
  const excluded = outOfWater(roster, settingsIn);
  const gone = new Map<string, string>();
  const waiting = new Map<string, string>();
  let moved = 0;
  const keep = <T extends Diver | null>(d: T): T => {
    if (!d) return d;
    if (!present.has(d.id)) {
      // Encore dans la liste mais plus inscrit : passé en liste d'attente, pas désinscrit.
      (listed.has(d.id) ? waiting : gone).set(d.id, d.name);
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
    const before = gone.size + waiting.size + moved;
    const palanquees = dive.plan.palanquees
      .map((p) => ({ ...p, guide: keep(p.guide), extra: keep(p.extra), members: p.members.filter((m) => keep(m) !== null) }))
      .filter((p) => p.guide || p.extra || p.members.length > 0);
    const unassigned = dive.plan.unassigned.filter((u) => keep(u.diver) !== null);
    const changed = gone.size + waiting.size + moved > before || palanquees.length !== dive.plan.palanquees.length;
    if (!changed) return Object.keys(gas).length === Object.keys(dive.gas).length ? dive : { ...dive, gas };
    return pruneOrphans({ ...dive, plan: { palanquees, unassigned }, validated: null, gas });
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

  // Ce que la fiche a vu : la liste actuelle (un désinscrit qui revient redevient un nouvel inscrit).
  const seen = roster.map((r) => r.id);
  const sameSeen = !!seenBefore && seenBefore.size === seen.length && seen.every((id) => seenBefore.has(id));
  const unchanged =
    settingsIn === doc.settings &&
    sameSeen &&
    dives.every((d, i) => d === doc.dives[i]) &&
    sameIds(roles, doc.roles) &&
    sameIds(volunteers, doc.volunteers) &&
    doc.settings.excluded.every((id) => listed.has(id)) &&
    (doc.settings.companions ?? []).every((id) => listed.has(id));
  if (unchanged) return { doc, departed: [], waitlisted: [] };
  return {
    doc: {
      ...doc,
      settings: {
        ...settingsIn,
        excluded: settingsIn.excluded.filter((id) => listed.has(id)),
        ...(settingsIn.companions ? { companions: settingsIn.companions.filter((id) => listed.has(id)) } : {}),
        seen,
      },
      dives,
      ...(doc.roles ? { roles } : {}),
      ...(doc.volunteers ? { volunteers } : {}),
    },
    departed: [...new Set(gone.values())],
    waitlisted: [...new Set(waiting.values())],
  };
}

/**
 * Fiches de palanquée (paramètres) et commentaires d'encadrant qui ne
 * correspondent plus à aucune palanquée de la plongée (palanquées refaites ou
 * supprimées) : retirés. Rien à retirer : la même plongée est rendue.
 */
export function pruneOrphans(dive: Dive): Dive {
  const ids = new Set(dive.plan?.palanquees.map((p) => p.id) ?? []);
  const orphan = (rec: Record<string, unknown> | undefined) => Object.keys(rec ?? {}).some((id) => !ids.has(id));
  if (!orphan(dive.sheets) && !orphan(dive.notes)) return dive;
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => ids.has(id)));
  return { ...dive, sheets: keep(dive.sheets), ...(dive.notes ? { notes: keep(dive.notes) } : {}) };
}

/** Écrit (ou efface, avec un texte vide) le commentaire sur l'encadrant d'une palanquée. */
export function setGuideNote(dive: Dive, palanqueeId: string, text: string, by: string, at = new Date().toISOString()): Dive {
  const notes = { ...(dive.notes ?? {}) };
  const clean = text.trim().slice(0, 500);
  if (clean) notes[palanqueeId] = { text: clean, by, at };
  else delete notes[palanqueeId];
  return { ...dive, notes };
}

/** Profondeur saisie sur la fiche (« 25 », « 25 m », « 18,5 ») → mètres ; undefined si rien de lisible. */
export function parseDepth(text: string): number | undefined {
  const m = /\d+(?:[.,]\d+)?/.exec(text);
  const n = m ? Number(m[0].replace(',', '.')) : NaN;
  return n > 0 ? n : undefined;
}

/**
 * Qui plonge réellement : les plongeurs placés dans les palanquées d'au moins
 * une plongée ; sans composition encore, ceux qui sont cochés « plonge ».
 * `roster` : la liste telle que l'écran DP la lit (withGuests).
 */
export function divingIds(doc: OutingDoc, roster: RosterEntry[]): Set<string> {
  const plans = doc.dives.map((d) => d.plan).filter((p): p is Plan => !!p && p.palanquees.length > 0);
  if (plans.length) {
    return new Set(plans.flatMap((p) => p.palanquees.flatMap((x) => [x.guide, x.extra, ...x.members])).filter((d): d is Diver => !!d).map((d) => d.id));
  }
  const out = outOfWater(roster, doc.settings);
  return new Set(roster.filter((r) => !out.has(r.id)).map((r) => r.id));
}

/** Même contenu de fiche, sans compter la révision ni qui l'a enregistrée (pour un brouillon déjà parti). */
export function sameContent(a: OutingDoc, b: OutingDoc): boolean {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, stable(o[k])]),
    );
  };
  const strip = ({ rev: _r, updatedAt: _a, updatedBy: _b, ...rest }: OutingDoc) => rest;
  return JSON.stringify(stable(strip(a))) === JSON.stringify(stable(strip(b)));
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
