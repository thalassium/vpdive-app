/**
 * Gestion des adhésions : chaque membre vu par trois sources, pour une saison.
 *   HelloAsso  ce qui est payé (adhésion, licence, Pass plongée, assurance)
 *   FFESSM     la licence réellement prise (export « Liste des licences » de Mon Club)
 *   VPDive     la fiche à tenir à jour (saisons, licence, assurance, statut Membre)
 *
 * Une saison va du 1er septembre au 31 août ; on la désigne par son année de
 * fin, comme VPDive (« 2027 » pour 2026/2027). Fonctions pures, testées dans
 * membership.test.ts.
 */
import { nameScore, normalizeName } from './fuzzy';

// ── Saisons ──────────────────────────────────────────────────────

/** Saison d'une date AAAA-MM-JJ (année de fin : septembre 2026 → 2027). */
export const seasonOf = (ymd: string): number => {
  const y = Number(ymd.slice(0, 4));
  return Number(ymd.slice(5, 7)) >= 9 ? y + 1 : y;
};
export const seasonLabel = (season: number) => `${season - 1}/${season}`;

/**
 * Saisons couvertes par une adhésion du formulaire de la saison `formSeason`,
 * payée le `paidYmd`. Geste du club : payée en août, elle vaut aussi pour la
 * saison suivante (13 mois au plus). HelloAsso ne le montre pas ; c'est ici
 * qu'on le déduit.
 */
export function seasonsCovered(formSeason: number, paidYmd: string): number[] {
  const august = paidYmd.slice(5, 7) === '08' && Number(paidYmd.slice(0, 4)) === formSeason;
  return august ? [formSeason, formSeason + 1] : [formSeason];
}

// ── HelloAsso ────────────────────────────────────────────────────

/** Un article HelloAsso, tel que le serveur de l'appli le rend (server/helloasso.ts). */
export interface HaItem {
  id: number;
  /** Saison du formulaire d'adhésion (année de fin). */
  formSeason: number;
  /** Nom du tarif (« Adhésion à l'association », « Licence FFESSM ADULTE (+ de 16ans) »…). */
  tier: string;
  /** Type HelloAsso : Membership, Donation… */
  type: string;
  /** En centimes. */
  amount: number;
  /** Processed, Registered, Canceled… */
  state: string;
  /** Date de la commande (ISO). */
  date: string;
  /** Le bénéficiaire (l'adhérent), pas forcément le payeur. */
  firstName: string;
  lastName: string;
  /** AAAA-MM-JJ, champ « Date de naissance » du formulaire. */
  birthDate: string;
  /** Champ « Email personnel » du formulaire. */
  email: string;
  payerEmail: string;
  payerName: string;
}

export type TierKind = 'adhesion' | 'licence' | 'pass' | 'assurance' | 'don' | 'autre';

export function tierKind(tier: string, type: string): TierKind {
  if (type === 'Donation') return 'don';
  if (/pass\s*plong/i.test(tier)) return 'pass';
  if (/licence/i.test(tier)) return 'licence';
  if (/assurance/i.test(tier)) return 'assurance';
  if (/adh[ée]sion/i.test(tier)) return 'adhesion';
  return 'autre';
}

/** Payé : traité ou saisi à la main ; annulé, remboursé ou en attente ne compte pas. */
export const isPaid = (it: Pick<HaItem, 'state'>) => it.state === 'Processed' || it.state === 'Registered';

/** « Assurance … Formule 2 » → « Loisir 2 » (même nom qu'à la FFESSM) ; « … Formule 3 Top » → « Loisir 3 Top ». */
export const haInsurance = (tier: string): string | null => {
  const m = /formule\s*(\d)(\s*top)?/i.exec(tier);
  return m ? `Loisir ${m[1]}${m[2] ? ' Top' : ''}` : null;
};

/** « 31/12/2008 » ou « 2008-12-31… » → « 2008-12-31 » ; '' si illisible. */
export function ymdOf(s: string): string {
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s.trim());
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return iso ? iso[1]! : '';
}

// ── FFESSM (export « Liste des licences » de Mon Club) ───────────

export interface FfessmRow {
  /** A-16-733717 : ne change jamais d'une saison à l'autre. */
  licence: string;
  /** « NOM Prénom » tel que la FFESSM l'écrit. */
  name: string;
  birthDate: string;
  season: number;
  subscribedAt: string;
  /** « Aucune », « Loisir 1 », « Loisir 3 Top »… */
  insurance: string;
  /** Adulte, Jeune… */
  category: string;
  /** « Normal », ou « Réduction Pass Plongée » (pass converti en licence). */
  pricing: string;
}

/**
 * Texte d'un export Mon Club. Il sort en windows-1252 (« L\xe9a ») : lu en
 * UTF-8, chaque accent devient « � » et la jointure par nom avec HelloAsso
 * échoue (François, Loïc, Benoît…). UTF-8 strict d'abord (un export réenregistré
 * dans un tableur), windows-1252 sinon. Un « � » déjà écrit dans le fichier
 * reste : restoreAccents le rattrape à l'affichage.
 */
export function decodeExport(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Une ligne CSV, guillemets compris. */
function csvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Libellé sans accents ni caractère perdu à l'export (« N� du club » → « n du club »). */
const label = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/�/g, '')
    .toLowerCase()
    .trim();

/**
 * L'export Mon Club répète sur chaque ligne le libellé puis la valeur
 * (« Licence », « A-16-733717 », « Nom », « DUPONT Jean »…) : on lit chaque
 * valeur derrière son libellé, quel que soit l'ordre des colonnes.
 */
export function parseFfessmCsv(text: string): { rows: FfessmRow[]; period: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0] ?? '').split(';').length > (lines[0] ?? '').split(',').length ? ';' : ',';
  const rows: FfessmRow[] = [];
  let period = '';
  for (const line of lines) {
    const cells = csvLine(line, sep);
    const after = (name: string) => {
      const i = cells.findIndex((c) => label(c) === name);
      return i >= 0 ? (cells[i + 1] ?? '').trim() : '';
    };
    period ||= cells.find((c) => /^du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}$/i.test(c.trim()))?.trim() ?? '';
    const licence = after('licence');
    if (!/^[A-Z]-\d{2}-\d{4,}$/.test(licence)) continue;
    // « 2026/2027 », ou « 2026-2027 » selon l'export.
    const season = /^(\d{4})\s*[/-]\s*(\d{4})$/.exec(after('saison'));
    rows.push({
      licence,
      name: restoreAccents(after('nom')),
      birthDate: ymdOf(after('date de naissance')),
      season: season ? Number(season[2]) : 0,
      subscribedAt: ymdOf(after('souscription')),
      insurance: after('assurance') || 'Aucune',
      category: after('categorie'),
      pricing: restoreAccents(after('tarification')),
    });
  }
  return { rows, period };
}

/**
 * L'export Mon Club perd ses accents (« Plong�e », « m�tres ») : un « é »
 * le plus souvent, un « è » devant « tres » / « re ». La comparaison les ignore
 * de toute façon ; c'est pour l'affichage.
 */
export const restoreAccents = (s: string) =>
  s
    .replace(/�(?=(tres|re)\b)/g, 'è')
    .replace(/�/g, 'é')
    .trim();

/** Un brevet délivré, d'après l'export « Liste des brevets » de Mon Club. */
export interface FfessmBrevet {
  /** Licence du plongeur breveté. */
  licence: string;
  name: string;
  /** « Niveau 2 », « Plongeur Nitrox confirmé », « RIFA Plongée »… */
  brevet: string;
  obtainedAt: string;
}

/**
 * L'export des brevets a la même forme que celui des licences : chaque valeur
 * derrière son libellé (« Niveau », « Date Obtention »…). Le plongeur suit le
 * libellé « Plongeur » : son n° de licence, sa civilité, son nom ; puis vient le
 * moniteur. Les accents perdus à l'export sont rétablis (restoreAccents).
 */
export function parseFfessmBrevets(text: string): { rows: FfessmBrevet[]; period: string } {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (lines[0] ?? '').split(';').length > (lines[0] ?? '').split(',').length ? ';' : ',';
  const rows: FfessmBrevet[] = [];
  let period = '';
  for (const line of lines) {
    const cells = csvLine(line, sep).map(restoreAccents);
    const at = (name: string) => cells.findIndex((c) => label(c) === name);
    period ||= cells.find((c) => /^du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}$/i.test(c)) ?? '';
    const diver = at('plongeur');
    const level = at('niveau');
    const licence = diver >= 0 ? (cells[diver + 1] ?? '') : '';
    if (!/^[A-Z]-\d{2}-\d{4,}$/.test(licence) || level < 0) continue;
    const got = at('date obtention');
    rows.push({ licence, name: cells[diver + 3] ?? '', brevet: cells[level + 1] ?? '', obtainedAt: got >= 0 ? ymdOf(cells[got + 1] ?? '') : '' });
  }
  return { rows, period };
}

/** Brevets délivrés, par n° de licence. */
export const brevetsByLicence = (rows: FfessmBrevet[]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.licence] ??= []).includes(r.brevet) || out[r.licence]!.push(r.brevet);
  return out;
};

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Codes VPDive d'un brevet FFESSM (« Niveau 2 » → P2/N2, « Plongeur Nitrox confirmé » → PNC…) ; [] si inconnu. */
export function brevetCodes(brevet: string): string[] {
  const b = plain(brevet).trim();
  // « Niveau n » de plongée seulement : pas « Apnéiste Niveau 2 », ni hockey, nage, tir, photo…
  const other = /apn|hockey|nage|handi|orientation|\btir|photo|video|bio|archeo|souterrain|peche/.test(b);
  if (other) return [];
  const n = /niveau\s*(\d)/.exec(b);
  if (n && /^(niveau|plongeur)\b/.test(b)) return [`P${n[1]}`, `N${n[1]}`];
  if (/nitrox/.test(b) && /moniteur/.test(b)) return [/confirm/.test(b) ? 'MNC' : 'MN'];
  if (/nitrox/.test(b)) return [/confirm/.test(b) ? 'PNC' : 'PN'];
  const pa = /autonomie\s*(\d+)/.exec(b);
  if (pa) return [`PA${pa[1]}`];
  const pe = /encadre\s*(\d+)/.exec(b);
  if (pe) return [`PE${pe[1]}`];
  if (/rifa/.test(b)) return ['RIFA-P', 'RIFAP'];
  if (/plongeur (d.)?or\b/.test(b)) return ['POR'];
  if (/plongeur (d.)?argent/.test(b)) return ['PAR'];
  if (/plongeur (de )?bronze/.test(b)) return ['PBR'];
  return [];
}

/** Les codes d'un niveau VPDive : ce qui est entre parenthèses (« (P2-N2) (P2) » → P2-N2, P2, N2). */
const vpdiveCodes = (name: string): string[] =>
  [...name.matchAll(/\(([^()]+)\)/g)].flatMap((m) => {
    const code = m[1]!.trim().toUpperCase();
    return [code, ...code.split(/[\s-]+/)];
  });

/**
 * Correspondance choisie par les admins (roue crantée de la gestion des
 * adhésions) : brevet FFESSM, tel que l'export l'écrit → niveaux VPDive qui le
 * valent. Un brevet absent de la table suit la règle automatique (codes).
 */
export type BrevetMap = Record<string, string[]>;

/** Nom de niveau comparable : sans accents, casse ni fédération en fin de nom (« … F.F.E.S.S.M. »). */
const levelName = (s: string) =>
  plain(s)
    .replace(/\s+[a-z.]*\.[a-z.]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Même niveau VPDive, l'un pouvant être le nom tronqué de l'autre : la fiche
 * dit « P-Plongeur Niveau 4 (P4-N4) », le référentiel « P-Plongeur Niveau 4
 * (P4-N4) (P4-ANMP) A.N.M.P. ». Le nom court doit finir sur un code entre
 * parenthèses : « Plongeur Nitrox » n'est pas « Plongeur Nitrox confirmé ».
 */
export function sameLevel(a: string, b: string): boolean {
  const x = levelName(a);
  const y = levelName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.endsWith(')') && long.startsWith(`${short} `);
}

/** Premier code d'un niveau (« P - Plongeur(se) Niveau 2 (P2-N2) (P2) » → « P2-N2 ») ; « (se) » n'est pas un code. */
const firstCode = (name: string) => [...name.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]!.trim()).find((c) => /[A-Z0-9]/.test(c))?.toUpperCase() ?? '';
/** Même premier code (« P4-N4 ») : moins sûr que sameLevel (deux fédérations peuvent le partager), assez pour une relecture. */
export const sameLevelCode = (a: string, b: string) => !!firstCode(a) && firstCode(a) === firstCode(b);

/** Niveaux VPDive que la règle automatique accepte pour ce brevet (pour les montrer dans la table). */
export const automaticLevels = (brevet: string, names: string[]): string[] => {
  const codes = brevetCodes(brevet);
  return codes.length ? names.filter((n) => vpdiveCodes(n).some((c) => codes.includes(c))) : [];
};

/** VPDive a-t-il ce brevet FFESSM ? D'après la table des admins ; sinon par code ; sinon par les mots du brevet. */
export function hasBrevet(levels: string[], brevet: string, map: BrevetMap = {}): boolean {
  const chosen = map[brevet];
  // Les noms de la table viennent du référentiel, ceux de la fiche sont souvent tronqués.
  if (chosen?.length) return chosen.some((n) => levels.some((l) => sameLevel(l, n)));
  const codes = brevetCodes(brevet);
  if (codes.length) {
    const mine = new Set(levels.flatMap(vpdiveCodes));
    return codes.some((c) => mine.has(c));
  }
  const words = plain(brevet).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(plongeur|plongee|des|les)$/.test(w));
  return levels.some((l) => {
    const p = plain(l);
    return words.every((w) => p.includes(w));
  });
}

/** Un niveau du référentiel VPDive du club (/user/settings/capacities) : « l_125 », « t_3 »… */
export interface Capacity {
  group: string;
  name: string;
  id: string;
}
const isFfessmGroup = (group: string) => /f\.?f\.?e\.?s\.?s\.?m/i.test(group);

/**
 * Le niveau VPDive à cocher pour un brevet FFESSM, selon les mêmes règles que
 * hasBrevet (table des admins, puis code, puis mots du brevet), en préférant
 * les niveaux FFESSM. Null si aucun ou plusieurs possibles : à choisir dans la
 * correspondance des brevets.
 */
export function brevetTarget(brevet: string, map: BrevetMap, catalog: Capacity[]): Capacity | null {
  const unique = (found: Capacity[]) => {
    const fed = found.filter((c) => isFfessmGroup(c.group));
    const pool = fed.length ? fed : found;
    return new Set(pool.map((c) => c.id)).size === 1 ? pool[0]! : null;
  };
  const chosen = map[brevet];
  if (chosen?.length) {
    // Plusieurs équivalences choisies : la première qui désigne un seul niveau.
    for (const n of chosen) {
      const hit = unique(catalog.filter((c) => levelName(c.name) === levelName(n)));
      if (hit) return hit;
    }
    return null;
  }
  const codes = brevetCodes(brevet);
  if (codes.length) return unique(catalog.filter((c) => vpdiveCodes(c.name).some((x) => codes.includes(x))));
  const words = plain(brevet).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(plongeur|plongee|des|les)$/.test(w));
  return words.length ? unique(catalog.filter((c) => words.every((w) => plain(c.name).includes(w)))) : null;
}

// ── Personnes de la saison (HelloAsso + FFESSM) ──────────────────

export interface Person {
  /** Clé stable pour mémoriser un rapprochement : licence FFESSM, sinon nom + naissance. */
  key: string;
  /**
   * Clé HelloAsso (nom + naissance) d'une personne retrouvée ensuite dans
   * l'export FFESSM : sa clé devient `lic:`, mais les choix et validations
   * faits avant l'export sont rangés sous celle-ci.
   */
  haKey?: string;
  name: string;
  birthDate: string;
  email: string;
  payerEmail: string;
  /** Nom de famille seul (HelloAsso, ou mots en capitales de la FFESSM) : pour trouver les parents. */
  lastName: string;
  /** Qui a payé sur HelloAsso (souvent un parent pour un mineur). */
  payerName: string;
  ha: {
    adhesion: HaItem | null;
    /** Adhésion venue du formulaire précédent, payée en août (geste du club). */
    bonus: boolean;
    licence: HaItem | null;
    pass: HaItem | null;
    insurance: HaItem | null;
  } | null;
  ffessm: FfessmRow | null;
  /** HelloAsso et FFESSM réunis sans date de naissance commune : à vérifier. */
  joinedByNameOnly: boolean;
}

const personKey = (name: string, birth: string) => `ha:${normalizeName(name).split(' ').sort().join(' ')}|${birth}`;

/**
 * Les personnes de la saison : les adhérents qui ont payé sur HelloAsso
 * (adhésion de la saison, ou d'août précédent) et les licenciés de la saison à
 * la FFESSM, réunis par date de naissance et nom.
 */
export function buildPeople(items: HaItem[], rows: FfessmRow[], season: number): Person[] {
  const byPerson = new Map<string, Person>();
  for (const it of items) {
    if (!isPaid(it)) continue;
    const kind = tierKind(it.tier, it.type);
    if (kind === 'don' || kind === 'autre') continue;
    const day = it.date.slice(0, 10);
    const covers = kind === 'adhesion' ? seasonsCovered(it.formSeason, day).includes(season) : it.formSeason === season;
    if (!covers) continue;
    const name = `${it.firstName} ${it.lastName}`.trim();
    const key = personKey(name, it.birthDate);
    const p = byPerson.get(key) ?? {
      key,
      name,
      birthDate: it.birthDate,
      email: it.email,
      payerEmail: it.payerEmail,
      lastName: it.lastName,
      payerName: it.payerName,
      ha: { adhesion: null, bonus: false, licence: null, pass: null, insurance: null },
      ffessm: null,
      joinedByNameOnly: false,
    };
    p.email ||= it.email;
    const ha = p.ha!;
    if (kind === 'adhesion' && (!ha.adhesion || it.formSeason === season)) {
      ha.adhesion = it;
      ha.bonus = it.formSeason !== season;
    } else if (kind === 'licence') ha.licence = it;
    else if (kind === 'pass') ha.pass = it;
    else if (kind === 'assurance') ha.insurance = it;
    byPerson.set(key, p);
  }

  const people = [...byPerson.values()];
  for (const row of rows.filter((r) => r.season === season)) {
    // Même date de naissance et nom proche ; à défaut, nom quasi identique (à vérifier).
    const sameBirth = people.filter((p) => !p.ffessm && p.birthDate && p.birthDate === row.birthDate && nameScore(row.name, p.name) >= 0.6);
    const byName = sameBirth.length ? [] : people.filter((p) => !p.ffessm && !p.birthDate && nameScore(row.name, p.name) >= 0.92);
    const match = sameBirth.length === 1 ? sameBirth[0] : byName.length === 1 ? byName[0] : undefined;
    if (match) {
      match.ffessm = row;
      match.haKey = match.key;
      match.key = `lic:${row.licence}`;
      match.joinedByNameOnly = !sameBirth.length;
    } else {
      const caps = row.name.split(/\s+/).filter((w) => w && w === w.toUpperCase());
      people.push({ key: `lic:${row.licence}`, name: row.name, birthDate: row.birthDate, email: '', payerEmail: '', lastName: caps.join(' '), payerName: '', ha: null, ffessm: row, joinedByNameOnly: false });
    }
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// ── Rapprochement avec VPDive ────────────────────────────────────

export interface VpMember {
  /** Jeton d'adhésion (uct). */
  id: string;
  name: string;
  picture: string;
}

/** Ce qu'on lit de la fiche VPDive (/user?uct_token=). */
export interface VpRecord {
  email: string;
  birthday: string;
  /** Saisons d'adhésion (« 2027 »…). */
  seasons: string[];
  /** `id` et `verified` (vérifiée auprès de la FFESSM) : VPDive sait alors l'actualiser seul. */
  licences: { number: string; organization: string; expires: string; id?: number; verified?: boolean }[];
  insurance: string;
  insuranceYear: number | null;
  /** Statut « Membre » (sinon Invité). */
  member: boolean;
  /** Niveaux et diplômes tels que VPDive les nomme (pour comparer aux brevets FFESSM). */
  levels: string[];
}

/** Les membres VPDive dont le nom ressemble, du plus proche au moins proche. */
export function candidatesFor(p: Pick<Person, 'name'>, directory: VpMember[], max = 3): VpMember[] {
  return directory
    .map((m) => ({ m, s: nameScore(p.name, m.name) }))
    .filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.m);
}

export const flatLicence = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase();
const sameEmail = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Ce qui prouve que ce membre VPDive n'est PAS la personne : deux dates de
 * naissance connues et différentes (« Jean Dupont » 1980 n'est pas « DUPONT
 * Jeanne » 2010, ni le père homonyme). Aucune règle ne passe alors outre.
 */
export function contradiction(p: Pick<Person, 'birthDate'>, r: VpRecord | undefined): string | null {
  if (!r || !p.birthDate || !r.birthday || r.birthday === p.birthDate) return null;
  return `né(e) le ${r.birthday.split('-').reverse().join('/')} selon VPDive`;
}

/** E-mail propre différent sur la fiche (ni celui de l'adhérent, ni celui du payeur) : un doute pour un rapprochement par le nom seul. */
const otherEmail = (p: Pick<Person, 'email' | 'payerEmail'>, r: VpRecord) => !!r.email && !!p.email && !sameEmail(r.email, p.email) && !sameEmail(r.email, p.payerEmail);

/** Ce qui prouve que ce membre VPDive est bien la personne (jamais s'il y a une preuve contraire). */
export function evidence(p: Person, m: VpMember, r: VpRecord | undefined): string | null {
  if (!r || contradiction(p, r)) return null;
  if (p.ffessm && r.licences.some((l) => flatLicence(l.number) === flatLicence(p.ffessm!.licence))) return 'même n° de licence';
  const close = nameScore(p.name, m.name);
  if (p.birthDate && r.birthday === p.birthDate && close >= 0.75) return 'même date de naissance';
  if ((sameEmail(r.email, p.email) || sameEmail(r.email, p.payerEmail)) && close >= 0.6) return 'même e-mail';
  return null;
}

export type MatchStatus = 'sure' | 'confirm' | 'missing';

export interface Match {
  status: MatchStatus;
  /** Le membre VPDive retenu (sûr ou choisi par un admin). */
  member: VpMember | null;
  /** Pourquoi c'est sûr (« même n° de licence », « choisi par … »). */
  why: string;
  /** À confirmer : les membres possibles. */
  candidates: VpMember[];
  /** Mineur sans fiche, rattaché par un admin au compte d'un parent. */
  parent?: VpMember;
  /** Choix d'un admin devenu caduc (membre sorti de l'annuaire) : à refaire. */
  obsolete?: string;
}

/**
 * Choix mémorisé par un admin : le membre VPDive, « personne » ('none'), ou le
 * parent (relation 'parent') qui porte l'adhésion d'un mineur sans fiche.
 */
export interface LinkChoice {
  uct: string;
  by: string;
  at: string;
  relation?: 'parent';
}

/** Mêmes mots, aux accents, à la casse et à l'ordre près (« Cheminée Adrien » = « Adrien CHEMINEE »). */
export const sameName = (a: string, b: string) => normalizeName(a).split(' ').sort().join(' ') === normalizeName(b).split(' ').sort().join(' ');

/**
 * Pas de fiche à son nom : les membres qui portent le même nom de famille, et
 * celui qui a payé sur HelloAsso s'il est membre (souvent le parent d'un
 * mineur). Le payeur d'abord.
 */
export function familyCandidates(p: Pick<Person, 'name' | 'lastName' | 'payerName'>, directory: VpMember[], max = 4): VpMember[] {
  const last = normalizeName(p.lastName).split(' ').filter((w) => w.length > 1);
  const payer = p.payerName && !sameName(p.payerName, p.name) ? p.payerName : '';
  const scored = directory
    .map((m) => {
      const words = normalizeName(m.name).split(' ');
      const isPayer = !!payer && nameScore(payer, m.name) >= 0.85;
      const sameLast = last.length > 0 && last.every((w) => words.includes(w));
      return { m, rank: isPayer ? 2 : sameLast ? 1 : 0 };
    })
    .filter((x) => x.rank > 0 && !sameName(x.m.name, p.name))
    .sort((a, b) => b.rank - a.rank || a.m.name.localeCompare(b.m.name, 'fr'));
  return scored.slice(0, max).map((x) => x.m);
}

export function matchPerson(p: Person, directory: VpMember[], records: Record<string, VpRecord | undefined>, link?: LinkChoice): Match {
  if (link) {
    if (link.uct === 'none') return { status: 'missing', member: null, why: `pas dans VPDive, selon ${link.by}`, candidates: [] };
    const member = directory.find((m) => m.id === link.uct);
    if (member && link.relation === 'parent') return { status: 'missing', member: null, why: `rattaché à ${member.name} (parent), selon ${link.by}`, candidates: [], parent: member };
    if (member) return { status: 'sure', member, why: `choisi par ${link.by}`, candidates: [] };
    // Le membre choisi n'est plus dans l'annuaire : on le dit, et le rapprochement automatique ne vaut que proposition.
    const auto = matchPerson(p, directory, records);
    const obsolete = `choix obsolète : le membre choisi par ${link.by} n’est plus dans l’annuaire`;
    if (auto.status === 'sure') return { status: 'confirm', member: null, why: '', candidates: [auto.member!], obsolete };
    return { ...auto, obsolete };
  }
  const found = candidatesFor(p, directory);
  if (found.length === 0) return { status: 'missing', member: null, why: '', candidates: [] };
  // Comme pour les doublons : on pointe vers un compte « Membre », jamais vers un invité
  // tant qu'un homonyme a le statut Membre.
  const members = found.filter((m) => records[m.id]?.member);
  const candidates = members.length ? members : found;
  const proven = candidates.map((m) => ({ m, why: evidence(p, m, records[m.id]) })).filter((x) => x.why);
  if (proven.length === 1) return { status: 'sure', member: proven[0]!.m, why: proven[0]!.why!, candidates: [] };
  const allRead = found.every((m) => records[m.id]);
  // Par le nom seul : seulement si la fiche n'a pas de naissance (ou la même) et pas d'autre e-mail propre.
  const nameOnly = (m: VpMember) => {
    const r = records[m.id];
    return !!r && !contradiction(p, r) && ((!!p.birthDate && r.birthday === p.birthDate) || !otherEmail(p, r));
  };
  if (!proven.length && allRead && members.length === 1 && nameScore(p.name, members[0]!.name) >= 0.9 && nameOnly(members[0]!)) {
    return { status: 'sure', member: members[0]!, why: found.length > 1 ? 'seul compte Membre à ce nom' : 'même nom, compte Membre', candidates: [] };
  }
  // Un seul compte au même nom, accents et casse mis à part : c'est la personne.
  const same = candidates.filter((m) => sameName(p.name, m.name));
  if (!proven.length && allRead && same.length === 1 && nameOnly(same[0]!)) return { status: 'sure', member: same[0]!, why: 'même nom (accents près)', candidates: [] };
  return { status: 'confirm', member: null, why: '', candidates: proven.length ? proven.map((x) => x.m) : candidates };
}

// ── Trois éléments par membre : licence, adhésion, brevets ───────

/**
 * Pour chaque élément, ce que dit chaque source :
 *   ok       présent et conforme (✅)
 *   missing  absent alors qu'il devrait y être (❌)
 *   diff     présent mais différent (⚠️)
 *   na       sans objet pour cette source (—)
 */
export type Mark = 'ok' | 'missing' | 'diff' | 'na';
export interface Cell {
  mark: Mark;
  text: string;
}
export interface ItemView {
  helloasso: Cell;
  ffessm: Cell;
  vpdive: Cell;
}

/** Libellé VPDive d'une assurance FFESSM (« Loisir 3 Top » → « Assurance Loisir 3 TOP ») ; null pour « Aucune ». */
export function vpdiveInsurance(ffessm: string): string | null {
  const m = /loisir\s*(\d|base)(\s*top)?/i.exec(ffessm);
  // « Loisir Base » est la Loisir 1.
  if (m) return `Assurance Loisir ${/base/i.test(m[1]!) ? '1' : m[1]}${m[2] ? ' TOP' : ''}`;
  if (/piscine/i.test(ffessm)) return 'Assurance Piscine';
  return null;
}

/** Fin de validité d'une licence FFESSM de la saison : 31 décembre de l'année de fin. */
export const licenceEnd = (season: number) => `${season}-12-31`;
const NA: Cell = { mark: 'na', text: '—' };
const frDate = (ymd: string) => ymd.split('-').reverse().join('/');
/** « Licence FFESSM ADULTE (+ de 16ans) » → « Adulte ». */
const licenceTier = (tier: string) => {
  const m = /licence\s+ffessm\s+(\S+)/i.exec(tier);
  return m ? m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase() : 'Licence';
};
export const isFfessmLicence = (l: { number: string; organization: string }) => /F\.?F\.?E\.?S\.?S\.?M/i.test(l.organization) || /^A-?\d{2}-?\d{5,}$/i.test(l.number.trim());

/**
 * Licence FFESSM. Fait foi : HelloAsso (licence payée pour la saison). On
 * vérifie qu'elle a bien été prise à la FFESSM pour la saison, puis portée
 * dans VPDive (même numéro, valable jusqu'au 31/12 de l'année de fin).
 */
export function licenceView(p: Person, r: VpRecord | null, season: number): ItemView {
  const paid = p.ha?.licence;
  const pass = p.ha?.pass;
  const helloasso: Cell = paid ? { mark: 'ok', text: licenceTier(paid.tier) } : pass ? { mark: 'na', text: 'Pass plongée' } : { mark: 'missing', text: 'non payée' };
  const row = p.ffessm;
  const ffessm: Cell = row
    ? { mark: paid ? 'ok' : 'diff', text: paid ? row.licence : `${row.licence} · prise sans paiement` }
    : paid
      ? { mark: 'missing', text: 'non prise' }
      : NA;
  if (!r) return { helloasso, ffessm, vpdive: { mark: 'na', text: 'fiche à trouver' } };
  const expected = paid || row;
  const end = licenceEnd(season);
  const ffessmOnes = r.licences.filter(isFfessmLicence);
  // Sans ligne FFESSM, on ne connaît pas le numéro attendu : la licence FFESSM la plus récente de la fiche.
  const same = row ? latestLicence(ffessmOnes.filter((l) => flatLicence(l.number) === flatLicence(row.licence))) : latestLicence(ffessmOnes);
  let vpdive: Cell;
  if (same && same.expires >= end) vpdive = { mark: expected ? 'ok' : 'diff', text: `jusqu’au ${frDate(same.expires)}` };
  else if (same) {
    // Finie avant le début de la saison : expirée ; sinon, celle de la saison passée.
    const text = !same.expires ? 'sans date de fin' : same.expires < `${season - 1}-09-01` ? `expirée le ${frDate(same.expires)}` : `jusqu’au ${frDate(same.expires)}`;
    vpdive = { mark: expected ? 'diff' : 'na', text };
  } else if (ffessmOnes.length) vpdive = { mark: 'diff', text: `autre n° ${latestLicence(ffessmOnes)!.number}` };
  else vpdive = expected ? { mark: 'missing', text: 'absente' } : NA;
  return { helloasso, ffessm, vpdive };
}

/** De plusieurs licences (le même numéro saisi deux fois…), celle qui finit le plus tard ; une sans date en dernier recours. */
export function latestLicence<L extends { expires: string }>(list: L[]): L | undefined {
  return list.reduce<L | undefined>((best, l) => (!best || l.expires > best.expires ? l : best), undefined);
}

/** Adhésion de la saison. Fait foi : HelloAsso (geste d'août compris) ; VPDive doit avoir la saison et le statut Membre. */
export function adhesionView(p: Person, r: VpRecord | null, season: number): ItemView {
  const a = p.ha?.adhesion;
  const helloasso: Cell = a ? { mark: 'ok', text: p.ha!.bonus ? 'payée en août' : 'payée' } : { mark: 'missing', text: 'non payée' };
  if (!r) return { helloasso, ffessm: NA, vpdive: { mark: 'na', text: 'fiche à trouver' } };
  const has = r.seasons.includes(String(season));
  let vpdive: Cell;
  if (has && r.member) vpdive = { mark: a ? 'ok' : 'diff', text: a ? `saison ${seasonLabel(season)}` : 'saison sans paiement' };
  else if (has) vpdive = { mark: 'diff', text: 'statut Invité' };
  else vpdive = a ? { mark: 'missing', text: `saison ${seasonLabel(season)} absente${r.member ? '' : ' · Invité'}` } : NA;
  return { helloasso, ffessm: NA, vpdive };
}

/** Brevets. Fait foi : la FFESSM (export des brevets) ; VPDive doit avoir les mêmes. */
/** Brevets FFESSM de la personne absents de sa fiche VPDive. */
export function lackingBrevets(p: Person, r: VpRecord | null, brevets: Record<string, string[]> | null, map: BrevetMap = {}): string[] {
  if (!r || !brevets || !p.ffessm) return [];
  return (brevets[p.ffessm.licence] ?? []).filter((b) => !hasBrevet(r.levels, b, map));
}

export function brevetsView(p: Person, r: VpRecord | null, brevets: Record<string, string[]> | null, map: BrevetMap = {}): ItemView {
  const helloasso = NA;
  if (!brevets) return { helloasso, ffessm: { mark: 'na', text: 'export à déposer' }, vpdive: NA };
  const fed = p.ffessm ? (brevets[p.ffessm.licence] ?? []) : [];
  const ffessm: Cell = fed.length ? { mark: 'ok', text: fed.join(', ') } : NA;
  if (!r || !fed.length) return { helloasso, ffessm, vpdive: r ? NA : { mark: 'na', text: 'fiche à trouver' } };
  const lacking = fed.filter((b) => !hasBrevet(r.levels, b, map));
  const vpdive: Cell = !lacking.length ? { mark: 'ok', text: 'à jour' } : lacking.length === fed.length ? { mark: 'missing', text: `absents : ${lacking.join(', ')}` } : { mark: 'diff', text: `manque ${lacking.join(', ')}` };
  return { helloasso, ffessm, vpdive };
}

/** Assurance de la liste FFESSM dans VPDive (« Assurance Loisir 2 », « … Piscine ») ; une autre (DAN…) n'est jamais remplacée. */
export const isFfessmInsurance = (label: string) => /loisir|piscine/i.test(label);

/**
 * Le libellé VPDive de l'assurance à porter sur la fiche : celle prise à la
 * FFESSM s'il y a une ligne dans l'export (« Aucune » : rien), sinon celle
 * payée sur HelloAsso quand la formule se lit sûrement (« Formule 2 » →
 * « Assurance Loisir 2 »). Null si rien de sûr.
 */
export function insuranceWanted(p: Pick<Person, 'ffessm' | 'ha'>): string | null {
  if (p.ffessm) return vpdiveInsurance(p.ffessm.insurance);
  const paid = p.ha?.insurance;
  const loisir = paid ? haInsurance(paid.tier) : null;
  return loisir ? vpdiveInsurance(loisir) : null;
}

/**
 * Assurance. Fait foi : HelloAsso (assurance payée), puis la FFESSM (assurance
 * prise) ; VPDive doit l'avoir, pour la saison (année de début, voir
 * insuranceYearFor).
 */
export function insuranceView(p: Person, r: VpRecord | null, season: number): ItemView {
  const paid = p.ha?.insurance;
  const helloasso: Cell = paid ? { mark: 'ok', text: haInsurance(paid.tier) ?? paid.tier } : NA;
  const fed = p.ffessm && p.ffessm.insurance !== 'Aucune' ? p.ffessm.insurance : null;
  const ffessm: Cell = fed ? { mark: 'ok', text: fed } : paid && p.ffessm ? { mark: 'diff', text: 'aucune prise' } : NA;
  if (!paid && !fed) return { helloasso, ffessm, vpdive: NA };
  if (!r) return { helloasso, ffessm, vpdive: { mark: 'na', text: 'fiche à trouver' } };
  const year = insuranceYearFor(season);
  const wanted = insuranceWanted(p);
  let vpdive: Cell;
  if (!r.insurance) vpdive = { mark: 'missing', text: 'absente' };
  else if (!isFfessmInsurance(r.insurance)) vpdive = { mark: 'diff', text: `${r.insurance} (autre assurance)` };
  else if (r.insuranceYear !== year) vpdive = { mark: 'diff', text: `${r.insurance} (${r.insuranceYear ? insuranceSeason(r.insuranceYear) : 'sans année'})` };
  else vpdive = { mark: wanted && r.insurance !== wanted ? 'diff' : 'ok', text: `${r.insurance} (${insuranceSeason(year)})` };
  return { helloasso, ffessm, vpdive };
}

export interface PersonView {
  licence: ItemView;
  adhesion: ItemView;
  brevets: ItemView;
  insurance: ItemView;
}
export const viewOf = (p: Person, r: VpRecord | null, season: number, brevets: Record<string, string[]> | null, map: BrevetMap = {}): PersonView => ({
  licence: licenceView(p, r, season),
  adhesion: adhesionView(p, r, season),
  brevets: brevetsView(p, r, brevets, map),
  insurance: insuranceView(p, r, season),
});

/**
 * Mineur sans fiche rattaché au compte d'un parent : rien à lire côté VPDive,
 * ce n'est pas un écart (« rattaché au compte de X » au lieu de « fiche à trouver »).
 */
export function attachedView(v: PersonView, parent: string): PersonView {
  const attach = (i: ItemView): ItemView => (i.vpdive.text === 'fiche à trouver' ? { ...i, vpdive: { mark: 'na', text: `rattaché au compte de ${parent}` } } : i);
  return { licence: attach(v.licence), adhesion: attach(v.adhesion), brevets: attach(v.brevets), insurance: attach(v.insurance) };
}

/** À corriger dans VPDive : un élément ❌ ou ⚠️ côté VPDive. */
export const needsVpdiveFix = (v: PersonView) => [v.licence, v.adhesion, v.brevets, v.insurance].some((i) => i.vpdive.mark === 'missing' || i.vpdive.mark === 'diff');
/** Oubli probable : payé sur HelloAsso mais pas pris à la FFESSM (ou l'inverse), licence ou assurance. */
export const federationIssue = (v: PersonView) => v.licence.ffessm.mark === 'missing' || v.licence.ffessm.mark === 'diff' || v.insurance.ffessm.mark === 'diff';

// ── Corrections rapides (étape 3) et arbitrage (étape 4) ──────────

/**
 * Une correction sans risque, à pousser dans VPDive (une par une ou en lot) :
 * elle ajoute ou met à jour une valeur connue et sûre sur la fiche d'un membre
 * reconnu avec certitude, sans rien retirer.
 *   season       ajouter la saison payée sur HelloAsso (geste d'août compris)
 *   licence      porter la fin de la licence FFESSM au 31/12 (VPDive relit la
 *                FFESSM si la licence est vérifiée, sinon on saisit la date)
 *   licence-add  ajouter la licence FFESSM prise par le club, absente de la fiche
 *   insurance    reporter l'assurance prise à la FFESSM
 *   brevets      ajouter les brevets FFESSM absents de la fiche
 */
export type FixKind = 'season' | 'licence' | 'licence-add' | 'insurance' | 'brevets';
export interface Fix {
  kind: FixKind;
  before: string;
  after: string;
  /** Licence à mettre à jour (kind « licence ») ; `refresh` : VPDive sait la relire à la FFESSM. */
  licenceId?: number;
  refresh?: boolean;
  /** Brevets à ajouter (kind « brevets »). */
  brevets?: string[];
  /** Libellé VPDive de l'assurance à écrire (kind « insurance ») et son année. */
  insurance?: string;
  insuranceYear?: number;
}

/**
 * Année de l'assurance dans VPDive : la saison notée par son année de DÉBUT
 * (2026 = 2026/2027, affichée ainsi dans VPDive), à l'inverse des saisons
 * d'adhésion (années de fin). VPDive refuse 2027 en octobre 2026.
 */
export const insuranceYearFor = (season: number) => season - 1;
const insuranceSeason = (year: number) => `${year}/${year + 1}`;

/** Les corrections rapides d'une personne (aucune si elle n'est pas reconnue avec certitude). */
export function quickFixes(p: Person, match: Match, r: VpRecord | null, season: number, lacking: string[] = []): Fix[] {
  if (match.status !== 'sure' || !r) return [];
  const out: Fix[] = [];
  const label = seasonLabel(season);
  if (p.ha?.adhesion && !r.seasons.includes(String(season))) {
    const had = r.seasons.slice(0, 2).map((x) => seasonLabel(Number(x))).join(', ');
    out.push({ kind: 'season', before: had ? `saisons ${had}` : 'aucune saison', after: `+ ${label}${p.ha.bonus ? ' (payée en août)' : ''}` });
  }
  if (p.ffessm) {
    const ffessmOnes = r.licences.filter(isFfessmLicence);
    // Le même numéro saisi deux fois : celle qui finit le plus tard.
    const same = latestLicence(ffessmOnes.filter((l) => flatLicence(l.number) === flatLicence(p.ffessm!.licence)));
    if (same && (!same.expires || same.expires < licenceEnd(season))) {
      out.push({
        kind: 'licence',
        before: same.expires ? `jusqu’au ${frDate(same.expires)}` : 'sans date de fin',
        after: `jusqu’au 31/12/${season}`,
        ...(same.id ? { licenceId: same.id } : {}),
        refresh: !!(same.verified && same.id),
      });
    }
    if (!ffessmOnes.length) out.push({ kind: 'licence-add', before: 'aucune licence FFESSM', after: `${p.ffessm.licence}, jusqu’au 31/12/${season}` });
  }
  // Prise à la FFESSM, sinon payée sur HelloAsso (formule lue sûrement).
  const wanted = insuranceWanted(p);
  // Une autre assurance (DAN…) notée dans VPDive (« Autre ») reste : on ne remplace que vide ou FFESSM.
  const replaceable = !r.insurance || isFfessmInsurance(r.insurance);
  const year = insuranceYearFor(season);
  if (wanted && replaceable && (r.insurance !== wanted || r.insuranceYear !== year)) {
    out.push({ kind: 'insurance', before: r.insurance ? `${r.insurance}${r.insuranceYear ? ` (${insuranceSeason(r.insuranceYear)})` : ''}` : 'aucune', after: `${wanted} (${insuranceSeason(year)})`, insurance: wanted, insuranceYear: year });
  }
  if (lacking.length) out.push({ kind: 'brevets', before: r.levels.length ? `${r.levels.length} niveau${r.levels.length > 1 ? 'x' : ''}` : 'aucun niveau', after: `+ ${lacking.join(', ')}`, brevets: lacking });
  return out;
}

/** Ce qui se décide au cas par cas, à la main (dans l'appli, sur VPDive ou sur Mon Club). */
export type CaseKind = 'homonym' | 'family' | 'absent' | 'guest' | 'licence-other' | 'not-taken' | 'unpaid' | 'season-unpaid' | 'no-licence' | 'insurance-missing';
export interface Case {
  kind: CaseKind;
  text: string;
}

export function arbitrageCases(p: Person, match: Match, r: VpRecord | null, v: PersonView, season: number, family: VpMember[] = []): Case[] {
  const out: Case[] = [];
  if (match.status === 'confirm') out.push({ kind: 'homonym', text: 'Plusieurs membres VPDive possibles : choisir le bon.' });
  if (match.status === 'missing' && !match.why) {
    if (family.length) out.push({ kind: 'family', text: 'Pas de fiche à son nom. Un mineur dont un parent paie l’adhésion ? Rattacher au bon compte.' });
    else out.push({ kind: 'absent', text: 'Pas de fiche VPDive à ce nom : créer ou inviter la personne, ou la chercher sous un autre nom.' });
  }
  if (v.licence.ffessm.mark === 'missing') out.push({ kind: 'not-taken', text: 'Licence payée sur HelloAsso, pas prise à la FFESSM : à prendre sur Mon Club.' });
  if (v.licence.ffessm.mark === 'diff') out.push({ kind: 'unpaid', text: 'Licence prise à la FFESSM sans paiement HelloAsso : vérifier si elle n’a pas été prise dans un autre club.' });
  if (!p.ha?.licence && !p.ha?.pass && !p.ffessm && p.ha?.adhesion) out.push({ kind: 'no-licence', text: 'Ni licence ni Pass plongée payés au club : licence prise dans un autre club ?' });
  if (!r) return out;
  if (!r.member && p.ha?.adhesion) out.push({ kind: 'guest', text: 'Statut Invité dans VPDive : à passer en Membre.' });
  // Seulement face à une ligne FFESSM : sans elle, on ne sait pas quel numéro attendre.
  if (p.ffessm && v.licence.vpdive.mark === 'diff' && v.licence.vpdive.text.startsWith('autre n°')) {
    out.push({ kind: 'licence-other', text: `La fiche VPDive porte une autre licence FFESSM (${v.licence.vpdive.text.replace('autre n° ', '')}) que celle de la FFESSM (${p.ffessm?.licence ?? '?'}).` });
  }
  if (v.adhesion.vpdive.mark === 'diff' && r.member) out.push({ kind: 'season-unpaid', text: 'Saison présente dans VPDive sans adhésion HelloAsso.' });
  // Assurance payée sur HelloAsso : VPDive doit en avoir une FFESSM pour la saison. Sinon, correction rapide si
  // elle est sûre (libellé connu, fiche sans autre assurance) ; à défaut, ici.
  const year = insuranceYearFor(season);
  const covered = isFfessmInsurance(r.insurance) && r.insuranceYear === year;
  const fixable = match.status === 'sure' && !!insuranceWanted(p) && (!r.insurance || isFfessmInsurance(r.insurance));
  if (p.ha?.insurance && !covered && !fixable) {
    const why = !r.insurance ? 'aucune assurance sur la fiche' : !isFfessmInsurance(r.insurance) ? `la fiche a ${r.insurance}, que l’appli ne remplace pas` : `la fiche a ${r.insurance} d’une autre saison`;
    const fed = p.ffessm && p.ffessm.insurance === 'Aucune' ? ' Pas prise à la FFESSM non plus : à prendre sur Mon Club.' : '';
    out.push({ kind: 'insurance-missing', text: `Assurance payée sur HelloAsso (${p.ha.insurance.tier.trim()}), absente de VPDive : ${why}.${fed}` });
  }
  return out;
}

/** Vérification à la main d'un cas d'arbitrage : qui, quand, et pourquoi c'est bon. */
export interface CaseCheck {
  by: string;
  at: string;
  comment: string;
}
/**
 * Clé d'une validation manuelle : la personne, la saison, le cas
 * (« lic:A-16-733717|2027|unpaid »). Une validation vaut pour une saison :
 * l'an prochain, le même cas se revalide.
 */
export const caseKey = (p: Pick<Person, 'key'>, kind: CaseKind, season: number) => `${p.key}|${season}|${kind}`;

/** Les clés d'une personne : `lic:` d'abord, puis la clé HelloAsso d'avant l'export FFESSM. */
const keysOf = (p: Pick<Person, 'key' | 'haKey'>) => (p.haKey && p.haKey !== p.key ? [p.key, p.haKey] : [p.key]);
const inSeason = (at: string, season: number) => !!at && seasonOf(at.slice(0, 10)) === season;

/**
 * La validation manuelle d'un cas, et la clé sous laquelle elle est rangée
 * (pour la décocher ou la commenter) ; sans validation, la clé à utiliser.
 * Lue sous `lic:` puis sous `ha:` ; une validation d'avant les saisons dans la
 * clé (« lic:…|unpaid ») compte si elle a été faite pendant la saison.
 */
export function checkFor(p: Pick<Person, 'key' | 'haKey'>, kind: CaseKind, season: number, checks: Record<string, CaseCheck>): { key: string; check?: CaseCheck } {
  for (const k of keysOf(p)) {
    const key = `${k}|${season}|${kind}`;
    if (checks[key]) return { key, check: checks[key] };
    const legacy = checks[`${k}|${kind}`];
    if (legacy && inSeason(legacy.at, season)) return { key: `${k}|${kind}`, check: legacy };
  }
  return { key: caseKey(p, kind, season) };
}

/**
 * Le rapprochement choisi par un admin pour cette personne, et sa clé : sous
 * `lic:` puis sous `ha:`. « Pas dans VPDive » ne vaut que pour la saison où il
 * a été dit : la personne a pu créer sa fiche depuis.
 */
export function linkFor(p: Pick<Person, 'key' | 'haKey'>, links: Record<string, LinkChoice>, season: number): { key: string; link: LinkChoice } | null {
  for (const key of keysOf(p)) {
    const link = links[key];
    if (!link) continue;
    if (link.uct === 'none' && link.at && !inSeason(link.at, season)) continue;
    return { key, link };
  }
  return null;
}
