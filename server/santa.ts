/**
 * Secret Santa : partie publique de l'appli, sans compte VPDive (POST /api/app?action=santa).
 *
 * Deux secrets, tous deux tirés au hasard (128 bits) et jamais mis dans une adresse côté serveur
 * (toujours dans le corps de la requête ; dans le navigateur ils sont dans le fragment #…) :
 *   clé d'organisation   ouvre la page de suivi (#santa-admin=<clé>) : liens, qui a ouvert le sien
 *   jeton de lien        un par participant (#santa=<jeton>) : montre une seule fois qui il a tiré
 *
 * Opérations ({op, …} dans le corps) :
 *   draw    {key?, title, names, exclusions}  tirer au sort ; avec `key`, remplace le tirage (anciens liens morts)
 *   status  {key}                             titre, participants, liens, date d'ouverture de chacun
 *   renew   {key, name}                       nouveau lien pour un participant (l'ancien meurt), même tirage
 *   peek    {token}                           à qui est ce lien, est-il déjà ouvert
 *   reveal  {token}                           le prénom tiré, une seule fois : 410 ensuite
 *
 * La page de suivi ne reçoit jamais les paires : l'organisateur participe aussi.
 *
 * Clés du stockage [120 jours après le dernier enregistrement] :
 *   santa:draw:<clé>      le tirage
 *   santa:link:<jeton>    à quel tirage et à quel participant mène un lien
 *   santa:count:<jour>    tirages créés ce jour-là (plafond contre l'abus) [2 jours]
 * Elles ne sont pas dans la sauvegarde quotidienne (motif club:*).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { HttpError } from './auth.js';
import { acquireLock, type Store } from './store.js';

export const SANTA_TTL_S = 120 * 86_400;
export const MAX_PEOPLE = 60;
export const MAX_NAME = 40;
export const MAX_TITLE = 80;
/** Tirages créés par jour, tous visiteurs confondus : la création est ouverte à qui connaît l'adresse. */
export const MAX_DRAWS_PER_DAY = 30;

interface Person {
  name: string;
  token: string;
  /** Indice, dans `people`, de la personne à qui il offre. */
  to: number;
  openedAt: string | null;
}

export interface SantaDraw {
  v: 1;
  title: string;
  createdAt: string;
  people: Person[];
  /** Paires interdites, dans les deux sens (noms). */
  exclusions: [string, string][];
}

interface Link {
  key: string;
  i: number;
}

/** Ce que voit la page de suivi : pas de `to`. */
export interface SantaStatus {
  key: string;
  title: string;
  createdAt: string;
  people: { name: string; token: string; openedAt: string | null }[];
  exclusions: [string, string][];
}

const drawKey = (key: string) => `santa:draw:${key}`;
const linkKey = (token: string) => `santa:link:${token}`;
const secret = () => randomBytes(16).toString('base64url');
const SECRET_RE = /^[A-Za-z0-9_-]{22}$/;
const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');

const GONE = 'Ce lien n’existe plus.';
const NOT_FOUND = 'Tirage introuvable.';
const IMPOSSIBLE = 'Tirage impossible avec ces paires interdites.';

/**
 * Tire au sort qui offre à qui : `allowed[i][j]` dit si i peut offrir à j. Renvoie, pour
 * chaque i, l'indice de celui à qui il offre ; null si aucun tirage ne respecte les interdits.
 *
 * D'abord des permutations au hasard, gardées si elles conviennent (tous les tirages
 * possibles ont alors la même chance) ; si aucune ne passe, un couplage par chemins
 * augmentants, qui trouve une solution dès qu'il en existe une.
 */
export function drawPairs(allowed: boolean[][], rand: (n: number) => number = randomInt): number[] | null {
  const n = allowed.length;
  const shuffled = (list: number[]) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const all = Array.from({ length: n }, (_, i) => i);
  for (let attempt = 0; attempt < 300; attempt++) {
    const to = shuffled(all);
    if (to.every((j, i) => allowed[i]![j])) return to;
  }
  // givenBy[j] : qui offre à j.
  const givenBy = new Array<number>(n).fill(-1);
  const options = all.map((i) => shuffled(all.filter((j) => allowed[i]![j])));
  const place = (i: number, seen: boolean[]): boolean => {
    for (const j of options[i]!) {
      if (seen[j]) continue;
      seen[j] = true;
      if (givenBy[j] === -1 || place(givenBy[j]!, seen)) {
        givenBy[j] = i;
        return true;
      }
    }
    return false;
  };
  for (const i of shuffled(all)) if (!place(i, new Array<boolean>(n).fill(false))) return null;
  const to = new Array<number>(n).fill(-1);
  givenBy.forEach((i, j) => (to[i] = j));
  return to;
}

/** Noms et paires interdites reçus du formulaire, vérifiés. */
export function parseDrawInput(body: Record<string, unknown>): { title: string; names: string[]; exclusions: [string, string][] } {
  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE);
  if (!Array.isArray(body.names)) throw new HttpError(400, 'Liste des participants manquante.');
  const names = body.names.map((n) => String(n ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (names.length < 3) throw new HttpError(400, 'Il faut au moins 3 participants.');
  if (names.length > MAX_PEOPLE) throw new HttpError(400, `${MAX_PEOPLE} participants au plus.`);
  if (names.some((n) => n.length > MAX_NAME)) throw new HttpError(400, `Un nom fait ${MAX_NAME} caractères au plus.`);
  const byNorm = new Map(names.map((n) => [norm(n), n]));
  if (byNorm.size !== names.length) throw new HttpError(400, 'Deux participants portent le même nom.');
  const rawPairs = Array.isArray(body.exclusions) ? body.exclusions : [];
  if (rawPairs.length > 500) throw new HttpError(400, 'Trop de paires interdites.');
  const seen = new Set<string>();
  const exclusions: [string, string][] = [];
  for (const pair of rawPairs) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new HttpError(400, 'Paire interdite illisible.');
    const a = byNorm.get(norm(String(pair[0] ?? '')));
    const b = byNorm.get(norm(String(pair[1] ?? '')));
    if (!a || !b) throw new HttpError(400, 'Une paire interdite cite quelqu’un qui ne participe pas.');
    if (a === b) continue;
    const id = [a, b].sort().join('\n');
    if (seen.has(id)) continue;
    seen.add(id);
    exclusions.push([a, b]);
  }
  return { title, names, exclusions };
}

const toStatus = (key: string, d: SantaDraw): SantaStatus => ({
  key,
  title: d.title,
  createdAt: d.createdAt,
  people: d.people.map(({ name, token, openedAt }) => ({ name, token, openedAt })),
  exclusions: d.exclusions,
});

/** Lecture-modification-écriture d'un tirage sous verrou : deux ouvertures simultanées d'un lien n'en font qu'une. */
async function locked<T>(store: Store, key: string, run: () => Promise<T>): Promise<T> {
  const lockKey = `${drawKey(key)}:lock`;
  if (!(await acquireLock(store, lockKey))) throw new HttpError(409, 'Réessayez dans un instant.');
  try {
    return await run();
  } finally {
    await store.unlock(lockKey).catch(() => {});
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** Un secret bien formé, sinon l'erreur donnée (jamais de lecture du stockage avec une clé arbitraire). */
function secretOf(v: unknown, error: string, status = 404): string {
  const s = str(v);
  if (!SECRET_RE.test(s)) throw new HttpError(status, error);
  return s;
}

async function linkOf(store: Store, token: string): Promise<{ link: Link; draw: SantaDraw; person: Person }> {
  const link = await store.get<Link>(linkKey(token));
  const draw = link ? await store.get<SantaDraw>(drawKey(link.key)) : null;
  const person = draw?.people[link!.i];
  // Lien remplacé (nouveau lien, nouveau tirage) : le jeton ne correspond plus.
  if (!link || !draw || !person || person.token !== token) throw new HttpError(404, GONE);
  return { link, draw, person };
}

export async function santa(store: Store, body: Record<string, unknown> | null, now = new Date()): Promise<unknown> {
  const op = str(body?.op);
  const ex = { ex: SANTA_TTL_S };

  if (op === 'peek') {
    const { draw, person } = await linkOf(store, secretOf(body!.token, GONE));
    return { name: person.name, title: draw.title, opened: !!person.openedAt };
  }

  if (op === 'reveal') {
    const token = secretOf(body!.token, GONE);
    const { link } = await linkOf(store, token);
    return locked(store, link.key, async () => {
      // Relu sous verrou : l'état d'avant le verrou peut dater.
      const { draw, person } = await linkOf(store, token);
      if (person.openedAt) throw new HttpError(410, 'Ce lien a déjà été ouvert.');
      person.openedAt = now.toISOString();
      await store.set(drawKey(link.key), draw, ex);
      return { name: person.name, title: draw.title, to: draw.people[person.to]!.name };
    });
  }

  if (op === 'status') {
    const key = secretOf(body!.key, NOT_FOUND);
    const draw = await store.get<SantaDraw>(drawKey(key));
    if (!draw) throw new HttpError(404, NOT_FOUND);
    return toStatus(key, draw);
  }

  if (op === 'renew') {
    const key = secretOf(body!.key, NOT_FOUND);
    return locked(store, key, async () => {
      const draw = await store.get<SantaDraw>(drawKey(key));
      if (!draw) throw new HttpError(404, NOT_FOUND);
      const i = draw.people.findIndex((p) => p.name === str(body!.name));
      if (i < 0) throw new HttpError(404, 'Participant introuvable.');
      const person = draw.people[i]!;
      const old = person.token;
      person.token = secret();
      person.openedAt = null;
      await store.set(linkKey(person.token), { key, i } satisfies Link, ex);
      await store.set(drawKey(key), draw, ex);
      await store.del(linkKey(old));
      return toStatus(key, draw);
    });
  }

  if (op === 'draw') {
    const { title, names, exclusions } = parseDrawInput(body!);
    const banned = new Set(exclusions.flatMap(([a, b]) => [`${a}\n${b}`, `${b}\n${a}`]));
    const to = drawPairs(names.map((a, i) => names.map((b, j) => i !== j && !banned.has(`${a}\n${b}`))));
    if (!to) throw new HttpError(422, IMPOSSIBLE);
    const replacing = body!.key !== undefined && body!.key !== null && body!.key !== '';
    const key = replacing ? secretOf(body!.key, NOT_FOUND) : secret();

    if (!replacing) {
      const countKey = `santa:count:${now.toISOString().slice(0, 10)}`;
      const count = (await store.get<number>(countKey)) ?? 0;
      if (count >= MAX_DRAWS_PER_DAY) throw new HttpError(429, 'Trop de tirages créés aujourd’hui : réessayez demain.');
      await store.set(countKey, count + 1, { ex: 2 * 86_400 });
    }

    return locked(store, key, async () => {
      const previous = await store.get<SantaDraw>(drawKey(key));
      if (replacing && !previous) throw new HttpError(404, NOT_FOUND);
      const draw: SantaDraw = {
        v: 1,
        title,
        createdAt: now.toISOString(),
        people: names.map((name, i) => ({ name, token: secret(), to: to[i]!, openedAt: null })),
        exclusions,
      };
      for (const [i, p] of draw.people.entries()) await store.set(linkKey(p.token), { key, i } satisfies Link, ex);
      await store.set(drawKey(key), draw, ex);
      for (const p of previous?.people ?? []) await store.del(linkKey(p.token));
      return toStatus(key, draw);
    });
  }

  throw new HttpError(400, 'Opération inconnue.');
}
