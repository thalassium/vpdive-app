/**
 * Tailles du matériel loué et message au club.
 *
 * Quand le club a créé des déclinaisons (tailles) sur un matériel dans VPDive,
 * on propose celles-là et elles partent avec l'inscription comme dans l'appli
 * VPDive. Sinon, pour la combinaison et le gilet, on propose la grille standard
 * et la taille part dans le message au club, que l'encadrement voit sur la
 * page « Matériel réservé » de la sortie.
 */

export const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export type Size = (typeof SIZES)[number];

export type SizedKind = 'wetsuit' | 'bcd';
export const SIZED_KINDS: SizedKind[] = ['wetsuit', 'bcd'];
export const SIZED_LABEL: Record<SizedKind, string> = { wetsuit: 'Combinaison', bcd: 'Gilet stabilisateur' };

const flat = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Ce qui demande une taille dans un matériel, reconnu à son nom dans VPDive :
 * combinaison, gilet, ou les deux pour un pack (« Pack complet (hors
 * ordinateur) » au club). Rien pour un bloc, un détendeur, un ordinateur…
 */
export function sizedKinds(materialName: string): SizedKind[] {
  const n = flat(materialName);
  if (/\bpack\b|\bequipement complet\b/.test(n)) return ['wetsuit', 'bcd'];
  const kinds: SizedKind[] = [];
  if (/\b(combi|combinaison|shorty|wetsuit|semi ?etanche|etanche|neoprene)/.test(n)) kinds.push('wetsuit');
  if (/\b(gilet|stab|stabilisateur|bcd|wing)/.test(n)) kinds.push('bcd');
  return kinds;
}

/**
 * Message envoyé à VPDive : le commentaire du plongeur, puis les tailles qui
 * n'ont pas de déclinaison VPDive et le binôme souhaité, sur des lignes
 * lisibles telles quelles par le club.
 */
export function composeComment(comment: string, sizes: { label: string; size: string }[], buddy: string | null): string {
  const lines = [comment.trim()];
  if (sizes.length) lines.push(sizes.map((s) => `Taille ${s.label.toLowerCase()} : ${s.size}`).join(' · '));
  if (buddy?.trim()) lines.push(`Binôme souhaité : ${buddy.trim()}`);
  return lines.filter(Boolean).join('\n');
}

/**
 * L'inverse de composeComment, pour modifier une inscription : le message du
 * plongeur, les tailles et le binôme repris de ce que VPDive a enregistré.
 */
export function parseComment(text: string): { comment: string; sizes: Partial<Record<SizedKind, Size>>; buddy: string } {
  const sizes: Partial<Record<SizedKind, Size>> = {};
  let buddy = '';
  const rest: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const b = /^\s*Binôme souhaité\s*:\s*(.+)$/i.exec(line);
    if (b) {
      buddy = b[1]!.trim();
      continue;
    }
    const parts = line.split(' · ').map((p) => /^\s*Taille (.+?)\s*:\s*(\S+)\s*$/i.exec(p));
    if (parts.length && parts.every(Boolean)) {
      for (const m of parts) {
        const kind = SIZED_KINDS.find((k) => SIZED_LABEL[k].toLowerCase() === m![1]!.toLowerCase());
        const size = SIZES.find((s) => s === m![2]!.toUpperCase());
        if (kind && size) sizes[kind] = size;
      }
      continue;
    }
    rest.push(line);
  }
  return { comment: rest.join('\n').trim(), sizes, buddy };
}
