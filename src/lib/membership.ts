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

/** « Assurance … Formule 2 » → « Loisir 2 » (même nom qu'à la FFESSM). */
export const haInsurance = (tier: string): string | null => {
  const m = /formule\s*(\d)/i.exec(tier);
  return m ? `Loisir ${m[1]}` : null;
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
    const season = /^(\d{4})\/(\d{4})$/.exec(after('saison'));
    rows.push({
      licence,
      name: after('nom'),
      birthDate: ymdOf(after('date de naissance')),
      season: season ? Number(season[2]) : 0,
      subscribedAt: ymdOf(after('souscription')),
      insurance: after('assurance') || 'Aucune',
      category: after('categorie'),
      pricing: after('tarification').replace(/�/g, 'é'),
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
  const b = plain(brevet);
  const n = /niveau\s*(\d)/.exec(b);
  if (n && !/photo|video|bio|souterrain|tir|apnee|archeo|nageur|pecheur/.test(b)) return [`P${n[1]}`, `N${n[1]}`];
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

/** Niveaux VPDive que la règle automatique accepte pour ce brevet (pour les montrer dans la table). */
export const automaticLevels = (brevet: string, names: string[]): string[] => {
  const codes = brevetCodes(brevet);
  return codes.length ? names.filter((n) => vpdiveCodes(n).some((c) => codes.includes(c))) : [];
};

/** VPDive a-t-il ce brevet FFESSM ? D'après la table des admins ; sinon par code ; sinon par les mots du brevet. */
export function hasBrevet(levels: string[], brevet: string, map: BrevetMap = {}): boolean {
  const chosen = map[brevet];
  if (chosen?.length) {
    const mine = new Set(levels.map(levelName));
    return chosen.some((n) => mine.has(levelName(n)));
  }
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

// ── Personnes de la saison (HelloAsso + FFESSM) ──────────────────

export interface Person {
  /** Clé stable pour mémoriser un rapprochement : licence FFESSM, sinon nom + naissance. */
  key: string;
  name: string;
  birthDate: string;
  email: string;
  payerEmail: string;
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
      match.key = `lic:${row.licence}`;
      match.joinedByNameOnly = !sameBirth.length;
    } else {
      people.push({ key: `lic:${row.licence}`, name: row.name, birthDate: row.birthDate, email: '', payerEmail: '', ha: null, ffessm: row, joinedByNameOnly: false });
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
  licences: { number: string; organization: string; expires: string }[];
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

const flatLicence = (s: string) => s.replace(/[^a-z0-9]/gi, '').toUpperCase();
const sameEmail = (a: string, b: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Ce qui prouve que ce membre VPDive est bien la personne. */
export function evidence(p: Person, m: VpMember, r: VpRecord | undefined): string | null {
  if (!r) return null;
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
}

/** Choix mémorisé par un admin : le membre VPDive, ou « personne » ('none'). */
export interface LinkChoice {
  uct: string;
  by: string;
  at: string;
}

export function matchPerson(p: Person, directory: VpMember[], records: Record<string, VpRecord | undefined>, link?: LinkChoice): Match {
  if (link) {
    if (link.uct === 'none') return { status: 'missing', member: null, why: `pas dans VPDive, selon ${link.by}`, candidates: [] };
    const member = directory.find((m) => m.id === link.uct);
    if (member) return { status: 'sure', member, why: `choisi par ${link.by}`, candidates: [] };
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
  if (!proven.length && allRead && members.length === 1 && nameScore(p.name, members[0]!.name) >= 0.9) {
    return { status: 'sure', member: members[0]!, why: found.length > 1 ? 'seul compte Membre à ce nom' : 'même nom, compte Membre', candidates: [] };
  }
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
  const m = /loisir\s*(\d)(\s*top)?/i.exec(ffessm);
  if (m) return `Assurance Loisir ${m[1]}${m[2] ? ' TOP' : ''}`;
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
const isFfessmLicence = (l: { number: string; organization: string }) => /F\.?F\.?E\.?S\.?S\.?M/i.test(l.organization) || /^A-?\d{2}-?\d{5,}$/i.test(l.number.trim());

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
  const same = row ? ffessmOnes.find((l) => flatLicence(l.number) === flatLicence(row.licence)) : ffessmOnes.find((l) => l.expires >= end);
  let vpdive: Cell;
  if (same && same.expires >= end) vpdive = { mark: expected ? 'ok' : 'diff', text: `jusqu’au ${frDate(same.expires)}` };
  else if (same) vpdive = { mark: 'diff', text: same.expires ? `jusqu’au ${frDate(same.expires)}` : 'sans date de fin' };
  else if (ffessmOnes.length) vpdive = { mark: expected ? 'diff' : 'na', text: `autre n° ${ffessmOnes[0]!.number}` };
  else vpdive = expected ? { mark: 'missing', text: 'absente' } : NA;
  return { helloasso, ffessm, vpdive };
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

export interface PersonView {
  licence: ItemView;
  adhesion: ItemView;
  brevets: ItemView;
}
export const viewOf = (p: Person, r: VpRecord | null, season: number, brevets: Record<string, string[]> | null, map: BrevetMap = {}): PersonView => ({
  licence: licenceView(p, r, season),
  adhesion: adhesionView(p, r, season),
  brevets: brevetsView(p, r, brevets, map),
});

/** À corriger dans VPDive : un élément ❌ ou ⚠️ côté VPDive. */
export const needsVpdiveFix = (v: PersonView) => [v.licence, v.adhesion, v.brevets].some((i) => i.vpdive.mark === 'missing' || i.vpdive.mark === 'diff');
/** Oubli probable : payé sur HelloAsso mais pas pris à la FFESSM (ou l'inverse). */
export const federationIssue = (v: PersonView) => v.licence.ffessm.mark === 'missing' || v.licence.ffessm.mark === 'diff';
