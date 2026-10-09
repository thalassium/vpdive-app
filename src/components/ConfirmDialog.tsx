import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';

export interface ConfirmOptions {
  /** La question, courte : « Supprimer la plongée 2 ? ». */
  title: string;
  /** Précisions sous le titre (conséquences, ce qui sera perdu…). */
  message?: ReactNode;
  /** Texte à copier, affiché sélectionné dans une zone de lecture (remplace window.prompt « Copiez… »). */
  text?: string;
  /** Bouton qui accepte ; « Confirmer » par défaut. */
  confirmLabel?: string;
  /** Bouton qui refuse ; « Annuler » par défaut, null pour un simple avertissement à un seul bouton. */
  cancelLabel?: string | null;
  /** Action destructrice (supprimer, désinscrire…) : bouton en rouge, focus d'abord sur Annuler. */
  danger?: boolean;
}

/**
 * Fenêtre de confirmation, à la place de window.confirm : aux couleurs de l'appli (thème
 * clair ou sombre), au-dessus des panneaux, fermée par Échap ou le bouton Retour du
 * téléphone (= Annuler). S'utilise par le hook useConfirm (hooks/useConfirm.tsx).
 */
export function ConfirmDialog({ title, message, text, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger, onAnswer }: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const { ref } = useDialog({ onClose: () => onAnswer(false), label: 'confirmation' });
  const titleId = useId();
  const messageId = useId();
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textArea.current?.select();
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-scrim p-0 sm:p-4 animate-fade" onClick={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div
        ref={ref}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="panel w-full sm:max-w-md rounded-b-none sm:rounded-xl border-t-[3px] border-t-pink p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-sheet sm:animate-pop outline-none"
      >
        <div className="flex items-start gap-3">
          {danger && <AlertTriangle aria-hidden className="w-5 h-5 mt-0.5 shrink-0 text-danger" />}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-brand">
              {title}
            </h2>
            {message && (
              <div id={messageId} className="mt-1.5 text-muted whitespace-pre-line">
                {message}
              </div>
            )}
          </div>
        </div>
        {text !== undefined && (
          <textarea ref={textArea} data-autofocus="" readOnly value={text} rows={Math.min(10, text.split('\n').length + 1)} aria-label={title} className="field w-full h-auto py-2 mt-4 font-mono text-sm" />
        )}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {cancelLabel !== null && (
            <button type="button" onClick={() => onAnswer(false)} data-autofocus={danger ? '' : undefined} className="btn btn-quiet">
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => onAnswer(true)}
            data-autofocus={danger && cancelLabel !== null ? undefined : ''}
            className={`btn ${danger ? 'bg-surface text-danger border border-danger hover:bg-danger-soft' : 'btn-primary'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
