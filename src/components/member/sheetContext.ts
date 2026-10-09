/*
 * Fiche membre : les contextes partagés par la fenêtre (MemberSheet), son
 * fournisseur (MemberSheetContext.tsx, posé dans App.tsx) et les icônes posées à
 * côté des noms (MemberLink.tsx). À part pour que les .tsx n'exportent que des
 * composants (rechargement à chaud de Vite).
 */
import { createContext, useContext } from 'react';
import type { RosterEntry } from '../../services/vpdive';

/** Le membre dont on ouvre la fiche. */
export interface MemberRef {
  /** Jeton d'adhésion au club (uct) : la clé de sa fiche VPDive. */
  uct: string;
  name: string;
  picture?: string;
  /** Sa ligne dans la liste des inscrits d'une sortie : la fiche « plongée » d'un DP non admin, ou le repli d'un refus. */
  roster?: RosterEntry;
  /** Fiche complète permise quel que soit le rôle simulé : écran réservé au super-admin (« Voir en tant que »). */
  full?: boolean;
}

export interface MemberSheetApi {
  /** Ouvre la fiche par-dessus l'écran courant (une seule à la fois : la nouvelle remplace l'ancienne). */
  openMember: (ref: MemberRef) => void;
  /** Fiche complète permise : admin ou super-admin de l'appli. */
  canOpenMember: boolean;
}

export const MemberSheetContext = createContext<MemberSheetApi>({ openMember: () => {}, canOpenMember: false });

export const useMemberSheet = () => useContext(MemberSheetContext);

/**
 * Inscrits de la sortie ouverte dans l'écran DP (inscrits VPDive, membres ajoutés,
 * plongeurs hors VPDive), par identifiant d'inscrit : sur le modèle de RolesContext
 * (dp/palanquees/format.ts). Hors de l'écran DP : null.
 */
export const OutingRosterContext = createContext<ReadonlyMap<string, RosterEntry> | null>(null);

/** Le membre d'un inscrit de la sortie, de quoi ouvrir sa fiche ; null pour un plongeur hors VPDive (pas de fiche). */
export function useOutingMember(id: string): MemberRef | null {
  const entry = useContext(OutingRosterContext)?.get(id);
  if (!entry?.uct || entry.outside) return null;
  return { uct: entry.uct, name: entry.name, ...(entry.picture ? { picture: entry.picture } : {}), roster: entry };
}
