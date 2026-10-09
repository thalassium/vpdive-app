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

/**
 * La photo (ou les initiales) d'un membre, avec l'icône « fiche » posée en
 * pastille en bas à droite quand sa fiche est accessible : elle ne prend aucune
 * place dans la ligne et ne pousse ni le nom ni les boutons. Sans accès, la
 * photo seule.
 *
 * `mobile` : là où la photo est cachée sur téléphone faute de place, 'icon' y
 * laisse l'icône seule (28 px, zone de toucher étendue à 44 px) et 'none' n'y met
 * rien (l'écran pose l'icône ailleurs, sous le nom).
 */
export function MemberAvatar({
  name,
  picture,
  member,
  size = 'sm',
  mobile,
}: {
  name: string;
  picture?: string;
  member: MemberRef | null | undefined;
  size?: 'sm' | 'md';
  mobile?: 'icon' | 'none';
}) {
  const mobileHidden = !!mobile;
  const { openMember, canOpenMember } = useMemberSheet();
  const open = !!member && sheetAccess({ uct: member.uct, full: canOpenMember || !!member.full, roster: !!member.roster }) !== 'none';
  if (!open) return <Avatar name={name} picture={picture} size={size} className={mobileHidden ? 'max-sm:hidden' : ''} />;
  const label = `Fiche de ${name}`;
  const badge = mobileHidden
    ? 'relative w-7 h-7 border-line before:-inset-2 sm:absolute sm:-bottom-1.5 sm:-right-2 sm:w-4 sm:h-4 sm:border-field-border sm:before:-inset-2'
    : 'absolute -bottom-1.5 -right-2 w-4 h-4 border-field-border before:-inset-2 max-sm:before:-inset-3.5';
  return (
    <span className={`relative inline-flex shrink-0 sm:mr-1.5 ${mobile ? '' : 'mr-1.5'} ${mobile === 'none' ? 'max-sm:hidden' : ''}`}>
      <Avatar name={name} picture={picture} size={size} className={mobileHidden ? 'max-sm:hidden' : ''} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          openMember(member);
        }}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        className={`${badge} rounded-full border bg-surface text-brand inline-flex items-center justify-center shadow-sm hover:bg-tint before:absolute before:content-[''] focus-visible:outline-2 focus-visible:outline-brand`}
      >
        <IdCard aria-hidden className={mobileHidden ? 'w-4 h-4 sm:w-2.5 sm:h-2.5' : 'w-2.5 h-2.5'} />
      </button>
    </span>
  );
}

/** La photo d'un inscrit de la sortie ouverte dans l'écran DP, avec son icône « fiche » (voir MemberAvatar). */
export function OutingMemberAvatar({ id, name, picture, size, mobile }: { id: string; name: string; picture?: string; size?: 'sm' | 'md'; mobile?: 'icon' | 'none' }) {
  const member = useOutingMember(id);
  return <MemberAvatar name={name} picture={picture} member={member} size={size} mobile={mobile} />;
}

/** Photo (avec l'icône « fiche ») et nom, là où le nom est un simple texte (classements, listes). */
export function MemberName({ member, className = '' }: { member: MemberRef; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <MemberAvatar name={member.name} picture={member.picture} member={member} />
      <span className="truncate text-ink">{member.name}</span>
    </span>
  );
}
