/**
 * Doublons possibles dans l'annuaire du club : la même personne inscrite deux
 * fois sur VPDive, sous le même nom (« DUPONT Jean » / « Jean Dupont ») ou avec
 * une faute de frappe (« DUPONT Jean » / « DUPOND Jean »). La fusion se fait
 * dans VPDive ; ici on ne fait que les signaler.
 */
import { editDistance, normalizeName } from './fuzzy';

export type DuplicateReason = 'same' | 'close';

export interface DuplicateGroup<T> {
  /** 'same' : tous portent exactement le même nom ; 'close' : au moins une différence de quelques lettres. */
  reason: DuplicateReason;
  members: T[];
}

/** Nom sans accents ni casse, mots triés : l'ordre prénom/nom ne compte pas. */
const nameKey = (name: string) => normalizeName(name).split(' ').filter(Boolean).sort().join(' ');

/** Écart toléré pour un nom proche, et longueur minimale (en dessous, deux lettres changent tout). */
const MAX_DISTANCE = 2;
const MIN_LENGTH = 8;

/**
 * Groupes de membres qui pourraient être la même personne. Les rapprochements
 * sont transitifs (A ≈ B et B ≈ C : un seul groupe A, B, C) et chaque membre
 * n'apparaît que dans un groupe.
 */
export function findDuplicates<T extends { id: string; name: string }>(members: T[]): DuplicateGroup<T>[] {
  const keys = members.map((m) => nameKey(m.name));
  const parent = members.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < members.length; i++) {
    const a = keys[i]!;
    if (!a) continue;
    for (let j = i + 1; j < members.length; j++) {
      const b = keys[j]!;
      if (!b || members[i]!.id === members[j]!.id) continue;
      if (a === b) {
        union(i, j);
        continue;
      }
      if (a.length < MIN_LENGTH || b.length < MIN_LENGTH || Math.abs(a.length - b.length) > MAX_DISTANCE) continue;
      if (editDistance(a, b) <= MAX_DISTANCE) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  members.forEach((_, i) => {
    const r = find(i);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(i);
  });

  const groups: DuplicateGroup<T>[] = [];
  for (const idx of byRoot.values()) {
    if (idx.length < 2) continue;
    const same = idx.every((i) => keys[i] === keys[idx[0]!]);
    groups.push({ reason: same ? 'same' : 'close', members: idx.map((i) => members[i]!) });
  }
  return groups;
}
