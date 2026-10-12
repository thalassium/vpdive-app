import { useId, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogHeader } from '../Dialog';
import { Spinner } from '../Spinner';
import { useConfirm } from '../../hooks/useConfirm';
import { shortDay } from '../../lib/dates';
import { EVAL_CODES, EVAL_LABEL, SLOTS, latestEvals, type EvalCode, type Fiche, type FicheModel, type FicheSession } from '../../lib/training';
import type { FicheOp } from '../../services/appApi';
import { EvalMark } from './marks';

type Patch = Extract<FicheOp, { op: 'session' }>['patch'];

/**
 * Une séance à remplir par son enseignant : paramètres de la plongée, chaque
 * compétence de la grille (NA, ECA, A, NE ; un second appui retire
 * l'évaluation), commentaire. À côté de chaque compétence, où elle en était
 * avant cette séance. Rien n'est enregistré avant « Enregistrer ».
 */
export function SessionEditor({
  fiche,
  model,
  session,
  number,
  admin,
  onSave,
  onRemove,
  onClose,
}: {
  fiche: Fiche;
  model: FicheModel;
  session: FicheSession;
  number: number;
  admin: boolean;
  /** Enregistre ; false si le serveur a refusé (le message est montré par la fiche, la fenêtre reste ouverte). */
  onSave: (patch: Patch) => Promise<boolean>;
  /** Séance ajoutée à la main seulement. */
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const titleId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const manual = !session.event;
  const [draft, setDraft] = useState({
    date: session.date,
    teacher: session.teacher.name,
    slot: session.slot,
    depth: session.depth,
    duration: session.duration,
    weight: session.weight,
    comment: session.comment,
    evals: session.evals,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const before = useMemo(() => latestEvals(fiche.sessions, session.id), [fiche.sessions, session.id]);

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const setEval = (id: string, code: EvalCode) => {
    setDraft((d) => {
      const evals = { ...d.evals };
      if (evals[id] === code) delete evals[id];
      else evals[id] = code;
      return { ...d, evals };
    });
    setDirty(true);
  };

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Fermer sans enregistrer ?', confirmLabel: 'Fermer', cancelLabel: 'Rester', danger: true }))) return;
    onClose();
  };
  const save = async () => {
    setSaving(true);
    const { date, teacher, ...rest } = draft;
    const ok = await onSave(manual ? { ...rest, date, ...(admin ? { teacher } : {}) } : rest);
    setSaving(false);
    if (ok) onClose();
  };
  const remove = async () => {
    if (!onRemove || !(await confirm({ title: `Supprimer la séance ${number} ?`, confirmLabel: 'Supprimer', danger: true }))) return;
    setSaving(true);
    const ok = await onRemove();
    setSaving(false);
    if (ok) onClose();
  };

  const field = (label: string, key: 'depth' | 'duration' | 'weight', inputMode?: 'decimal') => (
    <label className="block">
      <span className="label block mb-1">{label}</span>
      <input value={draft[key]} onChange={(e) => set(key, e.target.value)} inputMode={inputMode} maxLength={key === 'weight' ? 60 : 30} className="field w-full" />
    </label>
  );

  return (
    <>
      <Dialog label="seance" onClose={() => void close()} canClose={() => !saving} onBackdrop={null} titleId={titleId} className="sm:max-w-3xl h-dvh sm:h-[92vh]" layer="z-[60]">
        <DialogHeader
          titleId={titleId}
          title={
            <>
              Séance {number}
              <span className="font-normal text-muted"> · {fiche.name}</span>
            </>
          }
          onClose={() => void close()}
          closeDisabled={saving}
        />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-canvas p-4 sm:p-6 space-y-5">
          <div className="card p-4 space-y-4">
            {manual ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="label block mb-1">Date</span>
                  <input type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} className="field w-full" />
                </label>
                <label className="block">
                  <span className="label block mb-1">{model.teacherLabel}</span>
                  <input value={draft.teacher} onChange={(e) => set('teacher', e.target.value)} disabled={!admin} maxLength={120} className="field w-full disabled:opacity-70" />
                </label>
              </div>
            ) : (
              <p className="text-base">
                <span className="font-semibold text-brand">{session.date ? shortDay(session.date) : 'Sans date'}</span>
                {session.label && ` · ${session.label}`}
                {session.teacher.name && ` · ${session.teacher.name}`}
                {session.objective && <span className="code"> · {session.objective}</span>}
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 items-end gap-3">
              <label className="block">
                <span className="label block mb-1">Matin / Après-midi</span>
                <select value={draft.slot} onChange={(e) => set('slot', e.target.value)} className="field w-full">
                  <option value="">—</option>
                  {SLOTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              {field('Profondeur max atteinte', 'depth')}
              {field('Durée', 'duration')}
              {field('Lestage (initial puis si variation)', 'weight')}
            </div>
          </div>

          {model.sections.length > 0 && (
            <p className="text-sm text-muted">
              {EVAL_CODES.map((c) => (
                <span key={c} className="inline-block mr-3">
                  <span className="font-bold text-ink">{c}</span> {EVAL_LABEL[c]}
                </span>
              ))}
            </p>
          )}
          {model.sections.map((sec) => (
            <section key={sec.title} className="card overflow-hidden">
              {sec.group && <p className="px-4 pt-3 label">{sec.group}</p>}
              <h3 className="px-4 py-2.5 font-bold text-brand leading-tight">{sec.title}</h3>
              <ul>
                {sec.items.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-t border-line">
                    <span className="flex-1 min-w-[14rem] flex items-center gap-3">
                      <span id={`${titleId}-${c.id}`} className="flex-1 min-w-0 text-base">
                        {c.label}
                      </span>
                      {before[c.id] && (
                        <span className="shrink-0 inline-flex items-center gap-1.5 text-sm text-muted">
                          avant <EvalMark code={before[c.id]} />
                        </span>
                      )}
                    </span>
                    <span role="radiogroup" aria-labelledby={`${titleId}-${c.id}`} className="flex gap-1 max-sm:w-full">
                      {EVAL_CODES.map((code) => (
                        <button
                          key={code}
                          type="button"
                          role="radio"
                          aria-checked={draft.evals[c.id] === code}
                          aria-label={EVAL_LABEL[code]}
                          title={EVAL_LABEL[code]}
                          onClick={() => setEval(c.id, code)}
                          className="tab-pill min-w-11 px-2 border border-line max-sm:flex-1"
                        >
                          {code}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <label className="block">
            <span className="label block mb-1">Commentaires de l’enseignant et exercices complémentaires</span>
            <textarea value={draft.comment} onChange={(e) => set('comment', e.target.value)} rows={5} maxLength={2000} className="field w-full h-auto py-2.5 leading-snug" />
          </label>
        </div>
        <footer className="shrink-0 border-t border-line px-4 sm:px-6 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] flex items-center gap-2">
          {manual && onRemove && (
            <button type="button" onClick={() => void remove()} disabled={saving} className="btn btn-quiet text-danger">
              <Trash2 className="w-4 h-4" /> Supprimer
            </button>
          )}
          <button type="button" onClick={() => void save()} disabled={saving} aria-busy={saving} className="btn btn-primary ml-auto max-sm:flex-1">
            {saving && <Spinner />} Enregistrer
          </button>
        </footer>
      </Dialog>
      {confirmDialog}
    </>
  );
}
