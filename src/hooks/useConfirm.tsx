import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmOptions } from '../components/ConfirmDialog';

/**
 * Demander une confirmation sans window.confirm (ni window.prompt pour « copiez ce texte ») :
 * une fenêtre aux couleurs de l'appli, qui gère Échap, le bouton Retour et le focus (useDialog).
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *
 *   async function remove() {
 *     if (!(await confirm({ title: `Supprimer « ${dive.label} » ?`, message: 'Sa fiche de sécurité sera supprimée aussi.', confirmLabel: 'Supprimer', danger: true }))) return;
 *     …
 *   }
 *
 *   return (
 *     <>
 *       …
 *       {confirmDialog}
 *     </>
 *   );
 *
 * - `confirm(options)` renvoie une promesse : true (bouton de confirmation), false (Annuler,
 *   Échap, Retour, clic sur le voile). Une seule question à la fois : une nouvelle question
 *   répond false à celle encore ouverte.
 * - `{confirmDialog}` doit être rendu quelque part dans le composant (n'importe où : la
 *   fenêtre est en position fixe, au-dessus des panneaux).
 * - Options (ConfirmOptions) : title (obligatoire), message, confirmLabel (« Confirmer »),
 *   cancelLabel (« Annuler », null = un seul bouton), danger (bouton rouge, focus sur Annuler),
 *   text (texte à copier, présélectionné : remplace window.prompt('Copiez…', texte)).
 * - Si le composant est démonté pendant la question, la promesse répond false.
 */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: ReactNode } {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const current = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        current.current?.(false);
        current.current = resolve;
        setPending({ ...options, resolve });
      }),
    [],
  );

  // Démonté avec une question ouverte : on y répond « non » pour ne laisser personne attendre.
  useEffect(
    () => () => {
      current.current?.(false);
      current.current = null;
    },
    [],
  );

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    if (current.current === pending?.resolve) current.current = null;
    setPending(null);
  };

  const confirmDialog = pending ? <ConfirmDialog key={String(pending.title)} {...pending} onAnswer={answer} /> : null;
  return { confirm, confirmDialog };
}
