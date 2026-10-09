/**
 * Matériel à préparer pour une sortie : ce que les inscrits ont réservé sur
 * VPDive (« 1 Gilet stabilisateur », « 1 Combinaison - M »…), compté par
 * matériel et par taille, et une bouteille par plongeur : pas pour le pilote,
 * la sécurité surface ni le DP qui ne plongent pas. Quand la fiche de sortie
 * existe, elle dit qui plonge réellement (palanquées, « Qui plonge ? »).
 *
 * La taille vient de la déclinaison VPDive quand le club en a créé (« - M »,
 * « (Taille M) »), sinon du message au club (lib/gear.ts), sinon « taille ? ».
 * Les inscrits en liste d'attente ne sont pas comptés.
 */

import { BOTTLES, DEFAULT_BOTTLE, SIZES, parseComment, sizedKinds, type Bottle, type Size } from './gear';
import { DP_ROLE, SURFACE_ROLES } from './outingRoles';

/** Ce que fetchRoster donne, réduit à ce qu'il faut ici (testable sans le client VPDive). */
export interface MaterialRegistrant {
  /** Identifiant d'inscrit, pour savoir s'il plonge d'après la fiche de sortie. */
  id?: string;
  /** Jeton d'adhésion (uct) : ouvre sa fiche depuis la liste ; absent pour un plongeur hors VPDive. */
  uct?: string;
  name: string;
  /** Rôles VPDive de la sortie (« Pilote », « Directeur de plongée »…). */
  roles?: string[];
  picture?: string;
  waitingList: boolean;
  comment: string;
  material?: string[];
}

export interface MaterialItem {
  name: string;
  total: number;
  /** Taille → nombre. Vide pour un matériel sans taille (détendeur, ordinateur…). */
  bySize: Record<string, number>;
}

export interface MaterialPerson {
  name: string;
  picture: string;
  /** Jeton d'adhésion (uct), repris de l'inscrit : ouvre sa fiche. */
  uct?: string;
  /** « Gilet stabilisateur · M », « 2 × Détendeur », « Bouteille 15 L ». */
  lines: string[];
  /** Ne plonge pas, donc pas de bouteille : pourquoi (« pilote », « ne plonge pas d'après la fiche »). */
  noBottle?: string;
}

export interface MaterialSummary {
  items: MaterialItem[];
  bottles: Record<Bottle, number>;
  people: MaterialPerson[];
  /** Liste d'attente : affichée à part, jamais comptée. */
  waiting: MaterialPerson[];
}

export const UNKNOWN_SIZE = 'taille ?';
/** Une taille à demander au plongeur (inconnue en tout ou en partie). */
export const isUnknownSize = (size: string) => size.includes('?');

/** Libellé court d'une bouteille, pour les résumés. */
export const BOTTLE_SHORT: Record<Bottle, string> = { '12 L': '12 L', '15 L': '15 L', 'Enfant (8/10 L)': 'Enfant' };

const flat = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ALIASES: Record<string, Size> = { XXL: '2XL', XXXL: '3XL' };

/** Une taille de la grille dans un texte de déclinaison (« M », « Taille M », « XXL »). */
function sizeIn(text: string): Size | null {
  for (const word of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    const size = SIZES.find((s) => s === word) ?? ALIASES[word];
    if (size) return size;
  }
  return null;
}

/**
 * « 1 Gilet stabilisateur - M » → { qty: 1, name: 'Gilet stabilisateur', size: 'M' }.
 * La déclinaison n'est retirée du nom que si c'est une taille : « Pack complet
 * (hors ordinateur) » garde ses parenthèses.
 */
export function parseMaterialLine(line: string): { qty: number; name: string; size: Size | null } {
  const q = /^\s*(\d+)\s*[x×]?\s+(.+)$/i.exec(line);
  const qty = q ? Math.max(1, Number(q[1])) : 1;
  const text = (q ? q[2]! : line).trim();
  const variant = /^(.+?)\s+[-–]\s+([^-–]+)$/.exec(text) ?? /^(.+?)\s*\(([^()]+)\)$/.exec(text);
  if (variant) {
    const size = sizeIn(variant[2]!);
    if (size) return { qty, name: variant[1]!.trim(), size };
  }
  return { qty, name: text, size: null };
}

/** Taille d'un matériel loué : déclinaison, sinon message au club, sinon inconnue. */
function sizeFor(name: string, declination: Size | null, sizes: ReturnType<typeof parseComment>['sizes']): string | null {
  if (declination) return declination;
  const kinds = sizedKinds(name);
  if (!kinds.length) return null;
  if (kinds.length === 1) return sizes[kinds[0]!] ?? UNKNOWN_SIZE;
  // Pack : combinaison et gilet.
  const { wetsuit, bcd } = sizes;
  if (!wetsuit && !bcd) return UNKNOWN_SIZE;
  if (wetsuit === bcd) return wetsuit!;
  return `combi ${wetsuit ?? '?'}, gilet ${bcd ?? '?'}`;
}

/** Ordre des tailles : la grille, puis les combinaisons de tailles, puis l'inconnue. */
const sizeRank = (s: string) => {
  const i = (SIZES as readonly string[]).indexOf(s);
  return i >= 0 ? i : isUnknownSize(s) ? 1000 + (s === UNKNOWN_SIZE ? 1 : 0) : 100;
};
export const sortedSizes = (bySize: Record<string, number>): [string, number][] =>
  Object.entries(bySize).sort(([a], [b]) => sizeRank(a) - sizeRank(b) || a.localeCompare(b, 'fr'));

/** Rôles qui restent à bord : pilote, sécurité surface, DP. */
const ABOARD = (role: string) => SURFACE_ROLES.test(role) || DP_ROLE.test(role);

/**
 * Pourquoi un inscrit n'a pas de bouteille, ou null s'il plonge. `diving` : qui
 * plonge d'après la fiche de sortie (lib/outing.ts, divingIds) ; sans fiche,
 * celui dont tous les rôles restent à bord (pilote, sécurité surface, DP) ne plonge pas.
 */
function noBottleReason(r: MaterialRegistrant, diving: Set<string> | null): string | null {
  if (diving) return r.id && diving.has(r.id) ? null : 'ne plonge pas d’après la fiche de sortie';
  const roles = r.roles ?? [];
  return roles.length > 0 && roles.every(ABOARD) ? `${roles.map((x) => x.toLowerCase()).join(', ')}, ne plonge pas` : null;
}

export function aggregateMaterial(roster: MaterialRegistrant[], diving: Set<string> | null = null): MaterialSummary {
  const items = new Map<string, MaterialItem>();
  const bottles = Object.fromEntries(BOTTLES.map((b) => [b, 0])) as Record<Bottle, number>;
  const people: MaterialPerson[] = [];
  const waiting: MaterialPerson[] = [];

  for (const r of roster) {
    const { sizes, bottle } = parseComment(r.comment ?? '');
    const lines: string[] = [];
    for (const raw of r.material ?? []) {
      if (!raw.trim()) continue;
      const { qty, name, size: declination } = parseMaterialLine(raw);
      const size = sizeFor(name, declination, sizes);
      lines.push(`${qty > 1 ? `${qty} × ` : ''}${name}${size ? ` · ${size}` : ''}`);
      if (r.waitingList) continue;
      const key = flat(name);
      const item = items.get(key) ?? items.set(key, { name, total: 0, bySize: {} }).get(key)!;
      item.total += qty;
      if (size) item.bySize[size] = (item.bySize[size] ?? 0) + qty;
    }
    const noBottle = r.waitingList ? null : noBottleReason(r, diving);
    if (bottle !== DEFAULT_BOTTLE && !noBottle) lines.push(`Bouteille ${bottle}`);
    const person = { name: r.name, picture: r.picture ?? '', ...(r.uct ? { uct: r.uct } : {}), lines, ...(noBottle ? { noBottle } : {}) };
    if (r.waitingList) {
      waiting.push(person);
    } else {
      people.push(person);
      if (!noBottle) bottles[bottle] += 1;
    }

  }

  return {
    items: [...items.values()]
      .map((i) => ({ ...i, bySize: Object.fromEntries(sortedSizes(i.bySize)) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    bottles,
    people,
    waiting,
  };
}

/** « 12 L : 14 · 15 L : 3 · Enfant : 1 » */
export const bottlesLine = (bottles: Record<Bottle, number>) => BOTTLES.map((b) => `${BOTTLE_SHORT[b]} : ${bottles[b]}`).join(' · ');

/** Liste à copier (message, note) : le matériel avec ses tailles, puis les bouteilles. */
export function materialText(summary: MaterialSummary, title: string): string {
  const out = [title, ''];
  if (summary.items.length) {
    for (const i of summary.items) {
      const sizes = sortedSizes(i.bySize).map(([s, n]) => `${s} × ${n}`);
      out.push(`${i.name} : ${i.total}${sizes.length ? ` (${sizes.join(', ')})` : ''}`);
    }
  } else {
    out.push('Aucun matériel demandé.');
  }
  out.push('', `Bouteilles : ${bottlesLine(summary.bottles)}`);
  return out.join('\n');
}
