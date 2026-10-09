/*
 * Fiche membre (components/member) : qui peut l'ouvrir, et ce qu'elle montre.
 *
 *   full  fiche complète, lue sur VPDive (GET /user?uct_token=, permission member_view) :
 *         les admins et super-admins de l'appli ;
 *   dive  fiche « plongée », tirée de la liste des inscrits d'une sortie : le DP non
 *         admin, pour les inscrits de SA sortie (l'écran DP fournit la ligne) ;
 *   none  pas d'icône : un simple membre, ou personne sans jeton d'adhésion.
 */
import type { AppRole } from '../services/appApi';
import { VpDiveError } from '../services/vpdive/transport';

export type SheetAccess = 'full' | 'dive' | 'none';

/** La fiche du membre sur le site VPDive du club (admins). */
export const VPDIVE_MEMBER = (uct: string) => `https://septentrion-env.vpdive.com/app/member/${encodeURIComponent(uct)}`;

/** Fiche complète : admins et super-admins (rôle dans l'appli, celui simulé par « Voir en tant que » compris). */
export const canOpenMember = (role: AppRole) => role === 'admin' || role === 'superadmin';

/**
 * Ce que l'icône d'un membre ouvre. `full` : fiche complète permise (admin, ou
 * écran réservé au super-admin) ; `roster` : la ligne d'inscrit fournie par
 * l'écran DP. Sans jeton d'adhésion (invité hors VPDive), rien.
 */
export function sheetAccess({ uct, full, roster }: { uct?: string; full: boolean; roster: boolean }): SheetAccess {
  if (!uct) return 'none';
  if (full) return 'full';
  return roster ? 'dive' : 'none';
}

/**
 * Lecture de la fiche complète refusée ou ratée : que montrer à la place.
 *   dive       VPDive refuse (403 en JSON, pas le pare-feu) et la ligne d'inscrit est là ;
 *   forbidden  VPDive refuse, sans ligne d'inscrit : « Réservé aux admins » ;
 *   missing    fiche introuvable (404) ;
 *   error      autre échec (réseau, pare-feu…) : message et « Réessayer ».
 */
export function sheetFallback(e: unknown, hasRoster: boolean): 'dive' | 'forbidden' | 'missing' | 'error' {
  if (!(e instanceof VpDiveError) || e.kind !== 'api') return 'error';
  if (e.status === 403) return hasRoster ? 'dive' : 'forbidden';
  if (e.status === 404) return 'missing';
  return 'error';
}
