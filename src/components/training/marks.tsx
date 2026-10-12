import { Check } from 'lucide-react';
import { EVAL_LABEL, type EvalCode, type SessionState } from '../../lib/training';

const EVAL_CLS: Record<EvalCode, string> = {
  A: 'bg-ok-soft text-ok',
  ECA: 'bg-warn-soft text-warn',
  NA: 'bg-danger-soft text-danger',
  NE: 'text-muted',
};

/** Une évaluation dans la grille : le code (le sens ne tient pas qu'à la couleur), rien si la compétence n'a pas été vue. */
export function EvalMark({ code, className = '' }: { code: EvalCode | undefined; className?: string }) {
  if (!code) return null;
  return (
    <span title={EVAL_LABEL[code]} className={`inline-flex items-center justify-center min-w-8 h-6 px-1 rounded-md text-xs font-bold ${EVAL_CLS[code]} ${className}`}>
      {code}
    </span>
  );
}

/** Où en est une séance : à remplir (rose, c'est ce qu'on cherche), à venir, remplie. */
export function SessionPill({ state }: { state: SessionState }) {
  if (state === 'todo') return <span className="shrink-0 px-2 py-0.5 rounded-md bg-pink text-on-pink text-sm font-bold whitespace-nowrap">À remplir</span>;
  if (state === 'upcoming') return <span className="shrink-0 px-2 py-0.5 rounded-md bg-raised text-muted text-sm font-semibold whitespace-nowrap">À venir</span>;
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-ok whitespace-nowrap">
      <Check aria-hidden className="w-4 h-4" /> Remplie
    </span>
  );
}
