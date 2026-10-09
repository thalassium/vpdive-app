import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MemberSheet } from './MemberSheet';
import { MemberSheetContext, type MemberRef } from './sheetContext';

/**
 * Fournit à toute l'appli connectée (App.tsx) de quoi ouvrir la fiche d'un
 * membre : `openMember(ref)` et `canOpenMember` (useMemberSheet). La fenêtre est
 * posée sur <body> (portail, comme useConfirm) : un panneau transformé ou qui
 * rogne ce qui dépasse ne la gêne pas, et ses événements ne remontent qu'ici, pas
 * dans la ligne dont on l'a ouverte. Une fiche à la fois : la suivante remplace.
 *
 * `canOpen` : admin ou super-admin (rôle simulé par « Voir en tant que » compris).
 */
export function MemberSheetProvider({ canOpen, onSessionLost, children }: { canOpen: boolean; onSessionLost: (e: unknown) => boolean; children: ReactNode }) {
  const [open, setOpen] = useState<{ ref: MemberRef; seq: number } | null>(null);
  const openMember = useCallback((ref: MemberRef) => setOpen((o) => ({ ref, seq: (o?.seq ?? 0) + 1 })), []);
  const api = useMemo(() => ({ openMember, canOpenMember: canOpen }), [openMember, canOpen]);
  return (
    <MemberSheetContext.Provider value={api}>
      {children}
      {open &&
        createPortal(
          <MemberSheet key={`${open.ref.uct}|${open.seq}`} member={open.ref} full={canOpen || !!open.ref.full} onClose={() => setOpen(null)} onSessionLost={onSessionLost} />,
          document.body,
        )}
    </MemberSheetContext.Provider>
  );
}
