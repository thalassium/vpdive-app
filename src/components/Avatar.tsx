import { useState } from 'react';

const SIZES = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-xs',
} as const;

/**
 * Photo d'un membre telle que renseignée dans VPDive, sinon ses initiales.
 * `picture` est vide quand VPDive n'a que son avatar par défaut (voir
 * pictureUrl dans services/vpdiveApi.ts) ; une photo qui ne charge plus
 * retombe aussi sur les initiales.
 */
export function Avatar({ name, picture, size = 'md', className = '' }: { name: string; picture?: string; size?: keyof typeof SIZES; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = `${SIZES[size]} rounded-full shrink-0 bg-tint ${className}`;
  if (picture && !broken) {
    return <img src={picture} alt="" loading="lazy" onError={() => setBroken(true)} className={`${box} object-cover`} />;
  }
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <span aria-hidden className={`${box} text-brand font-semibold inline-flex items-center justify-center`}>
      {initials}
    </span>
  );
}
