import { useContext } from 'react';
import { DIVE_ROLES } from '../../../lib/outing';
import { RolesContext } from './format';

/** Badges des rôles de la sortie (DP, pilote, sécurité surface) à côté d'un nom. */
export function RoleBadges({ id }: { id: string }) {
  const mine = useContext(RolesContext).get(id) ?? [];
  return mine.map((role) => (
    <span key={role} className="shrink-0 px-1.5 rounded-md bg-tint text-brand text-sm font-semibold leading-6">
      {DIVE_ROLES.find((r) => r.id === role)!.short}
    </span>
  ));
}
