/**
 * Rapprochement d'un nom tapé à la main (« Jean Dupond ») avec les membres du
 * club (« DUPONT Jean »), malgré les fautes, les accents, la casse et l'ordre
 * prénom/nom.
 *
 * La recherche de VPDive ne trouve que des sous-chaînes exactes : on l'interroge
 * avec plusieurs fragments (searchFragments) puis on classe nous-mêmes les
 * candidats reçus (rankByName).
 */

export const normalizeName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (s: string) => normalizeName(s).split(' ').filter(Boolean);

/** Distance d'édition de Damerau-Levenshtein (une inversion de deux lettres compte pour 1). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Ressemblance de deux mots entre 0 et 1 ; un préfixe (« Seb » / « Sébastien ») compte presque autant qu'un mot entier. */
function wordSimilarity(typed: string, actual: string): number {
  if (typed === actual) return 1;
  if (typed.length >= 3 && actual.startsWith(typed)) return 0.9;
  const dist = editDistance(typed, actual);
  return Math.max(0, 1 - dist / Math.max(typed.length, actual.length));
}

/**
 * Score entre 0 et 1 : chaque mot tapé est apparié au mot du nom qui lui
 * ressemble le plus (l'ordre prénom/nom ne compte donc pas).
 */
export function nameScore(typed: string, candidate: string): number {
  const t = words(typed);
  const c = words(candidate);
  if (!t.length || !c.length) return 0;
  const left = [...c];
  let total = 0;
  for (const w of t) {
    let best = 0;
    let bestIdx = -1;
    left.forEach((cw, i) => {
      const s = wordSimilarity(w, cw);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    total += best;
    if (bestIdx >= 0) left.splice(bestIdx, 1);
  }
  // Pénalité légère si le nom du membre a des mots en plus de ceux tapés (prénom composé…).
  return (total / t.length) * (1 - 0.05 * left.length);
}

/** Candidats triés du plus proche au plus lointain, sans ceux qui ne ressemblent à rien. */
export function rankByName<T>(typed: string, candidates: T[], nameOf: (c: T) => string, threshold = 0.55): { item: T; score: number }[] {
  return candidates
    .map((item) => ({ item, score: nameScore(typed, nameOf(item)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Requêtes à envoyer à la recherche VPDive pour retrouver un nom mal orthographié :
 * chaque mot entier, puis le début de chaque mot (3 lettres), qui survit aux fautes
 * en fin de nom (« Dupond » → « dup » trouve « Dupont »).
 */
export function searchFragments(typed: string): string[] {
  const ws = words(typed).filter((w) => w.length >= 2);
  const out = new Set<string>();
  for (const w of ws) out.add(w);
  for (const w of ws) if (w.length >= 5) out.add(w.slice(0, 3));
  return [...out].slice(0, 6);
}

/**
 * Même personne, quel que soit l'ordre prénom/nom, la casse ou les accents :
 * « DUPONT Jean » (inscrits d'une sortie) et « Jean Dupont » (annuaire).
 */
/**
 * Deux noms qui peuvent désigner la même personne (homonymes à départager) :
 * chaque mot du nom le plus court a son pareil dans l'autre (accents, casse et
 * ordre ignorés ; des mots en plus sont tolérés : prénom composé, deuxième nom),
 * avec au plus une faute de frappe d'une lettre sur un mot d'au moins 5 lettres
 * (« Mathieu » / « Matthieu »). Un nom de famille en commun ne suffit pas
 * (« Margaux Boyer » / « Arnaud BOYER » : un parent), ni deux noms voisins
 * (« Charrier » / « Charret »).
 */
export function couldBeSamePerson(a: string, b: string): boolean {
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  if (!short.length) return false;
  const left = [...long];
  let typos = 0;
  // Les mots identiques d'abord, pour qu'une faute ne leur vole pas leur pareil.
  const rest = short.filter((w) => {
    const i = left.indexOf(w);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
  for (const w of rest) {
    const i = left.findIndex((x) => Math.min(w.length, x.length) >= 5 && editDistance(w, x) <= 1);
    if (i < 0 || ++typos > 1) return false;
    left.splice(i, 1);
  }
  return true;
}

export const sameName = (a: string, b: string): boolean => {
  const key = (s: string) => words(s).sort().join(' ');
  return key(a) !== '' && key(a) === key(b);
};
