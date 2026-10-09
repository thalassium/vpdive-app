import { IdCard } from 'lucide-react';
import { Avatar } from '../Avatar';
import { useMemberSheet, useOutingMember, type MemberRef } from './sheetContext';
import { sheetAccess } from '../../lib/memberSheet';

/**
 * Petite icône « fiche » (carte d'identité) à côté d'un nom : ouvre la fiche du
 * membre par-dessus l'écran (MemberSheet). Toujours posée À CÔTÉ du bouton, de
 * l'étiquette ou du menu qui porte le nom, jamais dedans : le nom garde son rôle
 * (cocher, choisir, ouvrir un menu). Le clic ne remonte pas à la ligne.
 *
 * Montrée aux admins (fiche complète) ; à un DP non admin seulement si l'écran
 * fournit la ligne d'inscrit (`roster`, écran DP de SA sortie) ; à personne
 * d'autre. Sans jeton d'adhésion (invité hors VPDive) : rien.
 *
 * Taille : 32 px (`md`) ou 28 px (`sm`, dans une pastille) ; sur téléphone, la zone
 * de toucher est étendue à 44 px (comme les petites croix de retrait).
 */
export function MemberSheetButton({
  member,
  size = 'md',
  className = '',
  onOpen,
}: {
  member: MemberRef | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
  /** Avant l'ouverture : refermer le menu qui la contient (le focus revient alors à son bouton). */
  onOpen?: () => void;
}) {
  const { openMember, canOpenMember } = useMemberSheet();
  if (!member || sheetAccess({ uct: member.uct, full: canOpenMember || !!member.full, roster: !!member.roster }) === 'none') return null;
  const label = `Fiche de ${member.name}`;
  const box = size === 'sm' ? 'w-7 h-7 rounded-md max-sm:before:-inset-2' : 'w-8 h-8 max-sm:before:-inset-1.5';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onOpen?.();
        openMember(member);
      }}
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      className={`icon-btn relative ${box} max-sm:before:absolute ${className}`}
    >
      <IdCard aria-hidden className="w-4 h-4" />
    </button>
  );
}

/** L'icône pour un inscrit de la sortie ouverte dans l'écran DP (OutingRosterContext), par son identifiant d'inscrit. */
export function OutingMemberButton({ id, size, className }: { id: string; size?: 'sm' | 'md'; className?: string }) {
  const member = useOutingMember(id);
  return <MemberSheetButton member={member} size={size} className={className} />;
}

/** Photo, nom et icône « fiche », là où le nom est un simple texte (classements, listes). */
export function MemberName({ member, className = '' }: { member: MemberRef; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <Avatar name={member.name} picture={member.picture} size="sm" initials={false} />
      <span className="truncate text-ink">{member.name}</span>
      <MemberSheetButton member={member} className="-my-1" />
    </span>
  );
}
