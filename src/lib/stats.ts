/**
 * Statistiques de la saison, calculées dans l'appli à partir des sorties
 * (agenda VPDive) et de leurs listes d'inscrits : VPDive refuse son export
 * aux comptes du club. Fonctions pures, testées dans stats.test.ts.
 *
 * Une « place » est une inscription hors liste d'attente à une sortie de
 * plongée ; un « plongeur » est une personne distincte ayant au moins une place.
 * Réunions, repas et cours théoriques comptent dans les sorties, pas dans les
 * plongeurs.
 */
import { aptitudesFromLabels, isInstructor, type Aptitudes } from './palanquees';
import { normalizeName } from './fuzzy';
import { seasonLabel, seasonOf } from './membership';
import { DP_ROLE, SURFACE_ROLES } from '../services/vpdiveApi';

export interface StatEvent {
  token: string;
  /** Début, heure locale (« 2026-03-14T08:15:00 »). */
  start: string;
  /** Activité VPDive en français (« Sortie », « Cours pratique », « Réunion »…). */
  activity: string;
  registered: number;
  max: number | null;
}

/** Équipe de la sortie qui n'est pas inscrite (pilote, DP désigné…) : compte pour les rôles, pas comme plongeur. */
export interface StatStaff {
  id: string;
  name: string;
  picture?: string;
  roles: string[];
}

export interface StatPerson {
  id: string;
  name: string;
  picture?: string;
  age: number | null;
  levels: string[];
  training: string[];
  roles: string[];
  waitingList: boolean;
}

/** Ce qui n'est pas de la plongée : on le compte comme sortie, pas comme plongée. */
const NOT_DIVING = /r[ée]union|repas|th[ée]orique|m[ée]dical|vie (de l|associative)|salle|assembl/i;
export const isDiveActivity = (activity: string) => !NOT_DIVING.test(activity);

const INSTRUCTOR_ROLE = /enseignant|encadrant|moniteur/i;

/** Profondeurs de la coupe, de la surface au fond. */
export const DEPTHS = [6, 12, 20, 40, 60] as const;
export type DepthBand = (typeof DEPTHS)[number];

/** Encadrement, du plus haut au plus bas. */
export const STAFF = ['E4', 'E3', 'E2', 'E1', 'GP'] as const;
export type StaffLevel = (typeof STAFF)[number];

export interface LevelCount {
  label: string;
  count: number;
}

export interface Stats {
  outings: number;
  diveOutings: number;
  /** Activités, de la plus fréquente à la moins fréquente. */
  activities: LevelCount[];
  /** Un mois par entrée (« 2026-03 »), dans l'ordre. */
  months: { key: string; outings: number; places: number }[];
  /** Sorties de plongée par jour, lundi = 0. */
  weekdays: number[];
  places: number;
  divers: number;
  waiting: number;
  /** Remplissage moyen des sorties à jauge (0…1), null si aucune. */
  fill: number | null;
  /**
   * Les plongeurs distincts, répartis sans reste (la somme fait `divers`) : niveau de
   * plongeur FFESSM (ou ANMP, FSGT), encadrement, brevet d'une autre école, aucun niveau.
   */
  groups: { divers: number; staff: number; otherSchool: number; none: number };
  /** Niveaux de plongeur, du Débutant au N3. */
  levels: LevelCount[];
  /** Brevets d'autres écoles, par école (PADI, SSI…). */
  otherSchools: LevelCount[];
  staff: { level: StaffLevel; count: number }[];
  /** Sorties de plongée dont on connaît le DP (appli ou VPDive), sur celles dont on a lu la liste. */
  dpKnown: { known: number; of: number };
  /** Âges par tranche ; `median` en années. */
  ages: { bins: { label: string; from: number; count: number }[]; median: number | null; minors: number; known: number };
  directors: { id: string; name: string; picture?: string; count: number }[];
  instructors: { id: string; name: string; picture?: string; count: number }[];
  regulars: { id: string; name: string; picture?: string; count: number }[];
  /** En formation (prépa VPDive), par niveau visé. */
  training: LevelCount[];
  /** Personnes inscrites sous plusieurs comptes VPDive (même nom), comptées une fois : nom, nombre de comptes. */
  merged: { name: string; accounts: number }[];
}

const AGE_BINS = [
  { label: '< 18', from: 0 },
  { label: '18-29', from: 18 },
  { label: '30-39', from: 30 },
  { label: '40-49', from: 40 },
  { label: '50-59', from: 50 },
  { label: '60 +', from: 60 },
];

/** Niveau lisible d'un plongeur (hors encadrement), à partir de sa prérogative. */
export function diverLevel(a: Aptitudes): { depth: DepthBand; label: string } | null {
  if (a.beginner) return { depth: 6, label: 'Débutant' };
  const depth = Math.max(a.pe, a.pa);
  if (!depth) return null;
  const band: DepthBand = depth <= 6 ? 6 : depth <= 12 ? 12 : depth <= 20 ? 20 : depth <= 40 ? 40 : 60;
  if (a.pe >= 60 && a.pa >= 60) return { depth: 60, label: 'N3' };
  if (a.pe >= 40 && a.pa >= 20) return { depth: band, label: a.pa >= 40 ? 'N2 + PA40' : 'N2' };
  if (a.pe === 20 && a.pa <= 12) return { depth: 20, label: 'N1' };
  const parts = [a.pe && `PE${a.pe}`, a.pa && `PA${a.pa}`].filter(Boolean);
  return { depth: band, label: parts.join(' + ') };
}

/** Échelon d'encadrement : E1…E4 (E2 = initiateur + GP), GP pour un N4 sans enseignement. */
export function staffLevel(a: Aptitudes): StaffLevel | null {
  if (!isInstructor(a)) return null;
  if (a.teach >= 4 || a.guide === 'E4') return 'E4';
  if (a.teach === 3 || a.guide === 'E3') return 'E3';
  if (a.teach === 2) return 'E2';
  if (a.teach === 1 || a.guide === 'E1') return 'E1';
  return 'GP';
}

const tally = (map: Map<string, number>, key: string, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const sortedCounts = (map: Map<string, number>): LevelCount[] =>
  [...map].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Écoles autres que la FFESSM et ses équivalents français, reconnues dans le nom du brevet. */
const OTHER_SCHOOL = /\b(PADI|SSI|GUE|CMAS|NAUI|BSAC|IANTD|TDI|SDI|RAID|PSAI)\b/i;

/** Ordre d'affichage des niveaux de plongeur. */
const LEVEL_ORDER = ['Débutant', 'N1', 'PE20 + PA20', 'PE40', 'N2', 'N2 + PA40', 'PE60', 'PA60', 'N3'];

/**
 * Nom sans accents ni casse, mots triés : « SARTORETTO Stéphane » = « Stephane
 * Sartoretto ». Vide pour un nom d'un seul mot (« Sans nom ») : trop peu pour réunir.
 */
const personKey = (name: string) => {
  const words = normalizeName(name).split(' ').filter(Boolean);
  return words.length >= 2 ? words.sort().join(' ') : '';
};

/**
 * Même personne, plusieurs comptes VPDive (un compte invité puis un compte
 * membre, cas Sartoretto ; un DP ajouté dans l'appli sans inscription, « uct:… ») :
 * identifiant retenu pour chacun. Seuls les noms identiques sont réunis (comme
 * findDuplicates « same ») : deux noms proches peuvent être deux personnes.
 * L'identifiant VPDive l'emporte sur celui de l'appli, puis le premier vu.
 */
function canonicalIds(people: { id: string; name: string }[]): { of: (id: string) => string; merged: Map<string, Set<string>> } {
  const byKey = new Map<string, string[]>();
  for (const p of people) {
    const key = personKey(p.name);
    if (!key) continue;
    const ids = byKey.get(key) ?? byKey.set(key, []).get(key)!;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  const canonical = new Map<string, string>();
  const merged = new Map<string, Set<string>>();
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    const keep = ids.find((id) => !id.startsWith('uct:')) ?? ids[0]!;
    for (const id of ids) canonical.set(id, keep);
    merged.set(keep, new Set(ids));
  }
  return { of: (id) => canonical.get(id) ?? id, merged };
}

/**
 * `rosters` : liste des inscrits par sortie (jeton) ; une sortie absente (pas
 * encore lue) compte dans les sorties, ses places viennent de l'agenda, ses
 * plongeurs manquent encore.
 * `dpFromApp` : DP choisis dans l'appli (Rôles de la sortie), qui l'emportent sur
 * le rôle pris à l'inscription dans VPDive. Un DP ajouté dans l'appli sans
 * inscription (« uct:… ») doit figurer dans `crewByEvent` avec son nom.
 * Une même personne sous plusieurs comptes (même nom) est comptée une fois.
 */
export function computeStats(
  events: StatEvent[],
  rosters: Record<string, StatPerson[] | undefined>,
  dpFromApp: Record<string, string[] | undefined> = {},
  crewByEvent: Record<string, StatStaff[] | undefined> = {},
): Stats {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const activities = new Map<string, number>();
  const months = new Map<string, { outings: number; places: number }>();
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const people = new Map<string, { person: StatPerson; count: number }>();
  const directors = new Map<string, { person: StatStaff; count: number }>();
  const instructors = new Map<string, { person: StatStaff; count: number }>();
  let places = 0;
  let waiting = 0;
  const fills: number[] = [];
  let dpKnown = 0;
  let dpOf = 0;
  const ids = canonicalIds([...Object.values(rosters), ...Object.values(crewByEvent)].flatMap((list) => list ?? []));
  const usedMerges = new Set<string>();

  for (const e of sorted) {
    tally(activities, e.activity || 'Autre');
    const month = e.start.slice(0, 7);
    const m = months.get(month) ?? { outings: 0, places: 0 };
    months.set(month, m);
    if (!isDiveActivity(e.activity)) continue;
    m.outings++;
    const day = new Date(e.start.slice(0, 10) + 'T12:00:00').getDay();
    weekdays[(day + 6) % 7]!++;
    const roster = rosters[e.token];
    const taken = roster ? roster.filter((p) => !p.waitingList) : null;
    const n = taken ? taken.length : e.registered;
    places += n;
    m.places += n;
    if (e.max) fills.push(Math.min(1, n / e.max));
    if (!roster) continue;
    waiting += roster.length - taken!.length;
    // L'équipe : les inscrits, plus ceux que VPDive désigne sans les inscrire (pilote, DP…).
    const crew: StatStaff[] = [...taken!, ...(crewByEvent[e.token] ?? []).filter((x) => !roster.some((p) => p.id === x.id))];
    // DP : celui de l'appli s'il y en a un, sinon le rôle pris dans VPDive ; sans DP du
    // tout, le pilote ou la sécurité surface de la sortie (règle du club).
    const appDp = (dpFromApp[e.token] ?? []).filter((id) => crew.some((p) => p.id === id));
    const withRole = (re: RegExp) => crew.filter((p) => p.roles.some((r) => re.test(r))).map((p) => p.id);
    const vpDp = withRole(DP_ROLE);
    const dpIds = new Set((appDp.length ? appDp : vpDp.length ? vpDp : withRole(SURFACE_ROLES)).map(ids.of));
    dpOf++;
    if (dpIds.size) dpKnown++;
    // Une personne compte une fois par sortie, même inscrite sous deux comptes.
    const counted = new Set<string>();
    for (const p of taken!) {
      const id = ids.of(p.id);
      if (id !== p.id || ids.merged.has(id)) usedMerges.add(id);
      if (counted.has(id)) continue;
      counted.add(id);
      // La plus récente sortie fait foi pour le niveau et l'âge ; un compte sans niveau garde ceux de l'autre.
      const seen = people.get(id);
      const person = { ...p, id, levels: p.levels.length || !seen ? p.levels : seen.person.levels, age: p.age ?? seen?.person.age ?? null };
      people.set(id, { person, count: (seen?.count ?? 0) + 1 });
    }
    const bumped = new Set<string>();
    for (const p of crew) {
      const id = ids.of(p.id);
      const bump = (map: typeof directors, tag: string) => {
        if (bumped.has(tag + id)) return;
        bumped.add(tag + id);
        map.set(id, { person: { ...(map.get(id)?.person ?? p), id }, count: (map.get(id)?.count ?? 0) + 1 });
      };
      if (dpIds.has(id)) bump(directors, 'dp:');
      if (p.roles.some((r) => INSTRUCTOR_ROLE.test(r))) bump(instructors, 'e:');
    }
  }

  // Niveaux, âges, formations : une fois par personne.
  const levels = new Map<string, number>();
  const depthOfLabel = new Map<string, number>();
  const staff = new Map<StaffLevel, number>();
  const schools = new Map<string, number>();
  const training = new Map<string, number>();
  const ages: number[] = [];
  let none = 0;
  for (const { person } of people.values()) {
    const a = aptitudesFromLabels(person.levels);
    const s = staffLevel(a);
    const lv = s ? null : diverLevel(a);
    if (s) tally(staff as Map<string, number>, s);
    else if (lv) {
      tally(levels, lv.label);
      depthOfLabel.set(lv.label, lv.depth);
    } else {
      const school = person.levels.map((l) => OTHER_SCHOOL.exec(l)?.[1]?.toUpperCase()).find(Boolean);
      if (school) tally(schools, school);
      else none++;
    }
    if (person.age !== null && person.age > 0) ages.push(person.age);
    const target = aptitudesFromLabels(person.training).training;
    if (target && !s) tally(training, `N${target}`);
  }

  // Les n premiers, plus les ex aequo du dernier : l'ordre alphabétique ne départage personne (jusqu'à 2n lignes).
  const top = (map: Map<string, { person: StatStaff; count: number }>, n: number) => {
    const all = [...map.values()].sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name, 'fr'));
    const last = all[n - 1]?.count;
    return all
      .filter((x, i) => i < n || (x.count === last && i < 2 * n))
      .map(({ person, count }) => ({ id: person.id, name: person.name, ...(person.picture ? { picture: person.picture } : {}), count }));
  };

  return {
    outings: sorted.length,
    diveOutings: sorted.filter((e) => isDiveActivity(e.activity)).length,
    activities: sortedCounts(activities),
    months: [...months].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.key.localeCompare(b.key)),
    weekdays,
    places,
    divers: people.size,
    waiting,
    fill: fills.length ? fills.reduce((s, f) => s + f, 0) / fills.length : null,
    groups: {
      divers: [...levels.values()].reduce((s, x) => s + x, 0),
      staff: [...staff.values()].reduce((s, x) => s + x, 0),
      otherSchool: [...schools.values()].reduce((s, x) => s + x, 0),
      none,
    },
    levels: sortedCounts(levels).sort((x, y) => {
      const rank = (l: string) => (LEVEL_ORDER.includes(l) ? LEVEL_ORDER.indexOf(l) : 100 + (depthOfLabel.get(l) ?? 0));
      return rank(x.label) - rank(y.label);
    }),
    otherSchools: sortedCounts(schools),
    staff: STAFF.map((level) => ({ level, count: staff.get(level) ?? 0 })),
    dpKnown: { known: dpKnown, of: dpOf },
    ages: {
      bins: AGE_BINS.map((b, i) => ({ ...b, count: ages.filter((x) => x >= b.from && x < (AGE_BINS[i + 1]?.from ?? Infinity)).length })),
      median: median(ages),
      minors: ages.filter((x) => x < 18).length,
      known: ages.length,
    },
    directors: top(directors, 6),
    instructors: top(instructors, 8),
    regulars: top(people, 10),
    training: sortedCounts(training).sort((a, b) => a.label.localeCompare(b.label)),
    // Comptes réunis parmi les plongeurs de la période.
    merged: [...usedMerges]
      .filter((id) => people.has(id) && (ids.merged.get(id)?.size ?? 0) > 1)
      .map((id) => ({ name: people.get(id)!.person.name, accounts: ids.merged.get(id)!.size }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  };
}

/** « 1er janvier », « 8 octobre » (avec l'année si demandé), depuis AAAA-MM-JJ. */
export function dateFr(ymd: string, withYear = false): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  const day = d === 1 ? `1er ${date.toLocaleDateString('fr-FR', { month: 'long' })}` : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return withYear ? `${day} ${y}` : day;
}

/** « janv », « févr »… depuis une clé de mois AAAA-MM. */
export function monthShort(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
}

/** Chaque mois de la période, même sans sortie, dans l'ordre. */
export function monthSeries(months: Stats['months'], from: string, to: string): Stats['months'] {
  const byKey = new Map(months.map((m) => [m.key, m]));
  const out: Stats['months'] = [];
  const last = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 1);
  for (let d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1); d <= last; d.setMonth(d.getMonth() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push(byKey.get(key) ?? { key, outings: 0, places: 0 });
  }
  return out;
}

export type PresetId = 'season' | 'last-season' | 'year' | '12m' | 'last-year';

/**
 * Période des préréglages (AAAA-MM-JJ) : saison en cours (du 1er septembre à
 * aujourd'hui), saison précédente (1er septembre – 31 août), depuis le 1er
 * janvier, 12 derniers mois, année précédente.
 */
export function presetRange(preset: PresetId, today: Date): { from: string; to: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const y = today.getFullYear();
  // Saison désignée par son année de fin (lib/membership.ts) : 2027 va du 1er septembre 2026 au 31 août 2027.
  const season = seasonOf(ymd(today));
  if (preset === 'season') return { from: `${season - 1}-09-01`, to: ymd(today) };
  if (preset === 'last-season') return { from: `${season - 2}-09-01`, to: `${season - 1}-08-31` };
  if (preset === 'last-year') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (preset === '12m') {
    const from = new Date(today);
    from.setFullYear(y - 1);
    from.setDate(from.getDate() + 1);
    return { from: ymd(from), to: ymd(today) };
  }
  return { from: `${y}-01-01`, to: ymd(today) };
}

/** « Saison 2026/2027 » pour le préréglage, d'après la date du jour. */
export const seasonPresetLabel = (preset: 'season' | 'last-season', today: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  const season = seasonOf(`${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`);
  return `Saison ${seasonLabel(preset === 'season' ? season : season - 1)}`;
};
