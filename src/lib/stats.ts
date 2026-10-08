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
 * `rosters` : liste des inscrits par sortie (jeton) ; une sortie absente (pas
 * encore lue) compte dans les sorties, ses places viennent de l'agenda, ses
 * plongeurs manquent encore.
 * `dpFromApp` : DP choisis dans l'appli (Rôles de la sortie), qui l'emportent sur
 * le rôle pris à l'inscription dans VPDive.
 */
export function computeStats(events: StatEvent[], rosters: Record<string, StatPerson[] | undefined>, dpFromApp: Record<string, string[] | undefined> = {}): Stats {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const activities = new Map<string, number>();
  const months = new Map<string, { outings: number; places: number }>();
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const people = new Map<string, { person: StatPerson; count: number }>();
  const directors = new Map<string, { person: StatPerson; count: number }>();
  const instructors = new Map<string, { person: StatPerson; count: number }>();
  let places = 0;
  let waiting = 0;
  const fills: number[] = [];
  let dpKnown = 0;
  let dpOf = 0;

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
    // DP : celui de l'appli s'il y en a un, sinon le rôle pris à l'inscription ; sans DP du
    // tout, le pilote ou la sécurité surface de la sortie (règle du club).
    const appDp = (dpFromApp[e.token] ?? []).filter((id) => roster.some((p) => p.id === id));
    const withRole = (re: RegExp) => taken!.filter((p) => p.roles.some((r) => re.test(r))).map((p) => p.id);
    const vpDp = withRole(DP_ROLE);
    const dpIds = new Set(appDp.length ? appDp : vpDp.length ? vpDp : withRole(SURFACE_ROLES));
    dpOf++;
    if (dpIds.size) dpKnown++;
    for (const p of taken!) {
      // La plus récente sortie fait foi pour le niveau et l'âge.
      const seen = people.get(p.id);
      people.set(p.id, { person: p, count: (seen?.count ?? 0) + 1 });
      const bump = (map: typeof directors) => map.set(p.id, { person: p, count: (map.get(p.id)?.count ?? 0) + 1 });
      if (dpIds.has(p.id)) bump(directors);
      if (p.roles.some((r) => INSTRUCTOR_ROLE.test(r))) bump(instructors);
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

  const top = (map: Map<string, { person: StatPerson; count: number }>, n: number) =>
    [...map.values()]
      .sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name, 'fr'))
      .slice(0, n)
      .map(({ person, count }) => ({ id: person.id, name: person.name, ...(person.picture ? { picture: person.picture } : {}), count }));

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
  };
}

/** Période par défaut et préréglages : du 1er janvier à aujourd'hui, etc. (AAAA-MM-JJ). */
export function presetRange(preset: 'year' | '12m' | 'last-year', today: Date): { from: string; to: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const y = today.getFullYear();
  if (preset === 'last-year') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  if (preset === '12m') {
    const from = new Date(today);
    from.setFullYear(y - 1);
    from.setDate(from.getDate() + 1);
    return { from: ymd(from), to: ymd(today) };
  }
  return { from: `${y}-01-01`, to: ymd(today) };
}
