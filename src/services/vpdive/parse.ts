/** Lecture prudente des réponses VPDive : chaque champ peut manquer ou changer de type. */

export type Json = Record<string, unknown>;

export const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const VPDIVE_ORIGIN = 'https://septentrion-env.vpdive.com';
/** VPDive returns site-relative paths; its default avatars live under /files/images/. */
export const pictureUrl = (path: string) =>
  !path || path.startsWith('/files/images/') ? '' : path.startsWith('http') ? path : `${VPDIVE_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
