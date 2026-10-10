import { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Plus, Users } from 'lucide-react';
import { CloseButton, Dialog } from '../../Dialog';
import { Avatar } from '../../Avatar';
import { TYPE_LABEL, isInstructor, type Diver, type PalanqueeType, type Plan } from '../../../lib/palanquees';
import { describe } from './format';

export interface PalanqueeChoice {
  type: PalanqueeType;
  guide: Diver | null;
  members: Diver[];
}

/**
 * « Nouvelle palanquée » : on la compose d'un coup (type, encadrant éventuel,
 * plongeurs) plutôt que de créer une palanquée vide, que la synchronisation
 * avec les inscrits retirerait aussitôt. Chacun est proposé, qu'il soit libre
 * ou déjà dans une palanquée (indiquée) ; en prendre un déjà placé l'en retire,
 * avec une alerte générale : les messages de chaque palanquée diront ensuite
 * ce qui ne va plus.
 *
 * Fenêtre par-dessus l'écran DP (portail, comme la fiche membre).
 */
export function NewPalanqueeDialog({ plan, diving, onCreate, onClose }: { plan: Plan | null; diving: Diver[]; onCreate: (choice: PalanqueeChoice) => void; onClose: () => void }) {
  const titleId = useId();
  const [type, setType] = useState<PalanqueeType>('exploration');
  const [guideId, setGuideId] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // Où est chacun : « P2 », ou rien s'il est libre.
  const where = useMemo(() => {
    const m = new Map<string, string>();
    plan?.palanquees.forEach((p, i) => {
      for (const d of [p.guide, p.extra, ...p.members]) if (d) m.set(d.id, `P${i + 1}`);
    });
    return m;
  }, [plan]);

  const leaders = diving.filter((d) => isInstructor(d) && !d.training);
  const others = diving.filter((d) => d.id !== guideId);
  const members = others.filter((d) => picked.has(d.id));
  const guide = diving.find((d) => d.id === guideId) ?? null;
  const allocated = [guide, ...members].some((d) => d && where.has(d.id));
  const canCreate = !!guide || members.length > 0;
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const status = (d: Diver) => (where.has(d.id) ? `déjà en ${where.get(d.id)}` : 'libre');

  return createPortal(
    <Dialog label="new-palanquee" onClose={onClose} titleId={titleId} layer="z-[75]" backdropClassName="print:hidden" className="sm:max-w-xl h-dvh sm:h-auto sm:max-h-[90vh]">
      <header className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3">
        <Users className="w-6 h-6 text-brand shrink-0" />
        <h2 id={titleId} className="text-xl font-semibold text-brand flex-1 min-w-0">
          Nouvelle palanquée
        </h2>
        <CloseButton onClick={onClose} />
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 space-y-5">
        <fieldset>
          <legend className="label mb-2">Type</legend>
          <div role="radiogroup" aria-label="Type de palanquée" className="inline-flex gap-1 rounded-lg border border-field-border bg-surface p-1">
            {(['exploration', 'teaching'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className="tab-pill">
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="label block mb-2">{type === 'teaching' ? 'Enseignant' : 'Encadrant'}</span>
          <select value={guideId} onChange={(e) => setGuideId(e.target.value)} className="field w-full">
            <option value="">{type === 'teaching' ? 'Choisi d’après les élèves' : 'Aucun (palanquée autonome)'}</option>
            {leaders.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {describe(d)} · {status(d)}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="label mb-2">
            Plongeurs <span className="tabular-nums">· {members.length}</span>
          </legend>
          {others.length === 0 ? (
            <p className="text-sm text-muted">Personne d’autre ne plonge.</p>
          ) : (
            <ul className="space-y-1.5">
              {others.map((d) => {
                const placedIn = where.get(d.id);
                return (
                  <li key={d.id}>
                    <label className={`item-card flex items-center gap-3 px-3 py-2 cursor-pointer ${picked.has(d.id) ? 'border-brand bg-accent-soft' : ''}`}>
                      <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} className="w-5 h-5 accent-[var(--fill)] shrink-0" />
                      <Avatar name={d.name} picture={d.picture} size="sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium text-ink truncate">{d.name}</span>
                        <span className="block text-sm text-muted truncate">{describe(d)}</span>
                      </span>
                      <span className={`chip shrink-0 ${placedIn ? 'text-brand' : 'bg-ok-soft text-ok'}`}>{placedIn ?? 'libre'}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
      </div>

      <footer className="shrink-0 border-t border-line px-5 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-wrap items-center gap-3">
        {allocated && (
          <p role="status" className="basis-full text-sm text-warn inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Attention, plongeurs déjà alloués
          </p>
        )}
        <button type="button" onClick={() => onCreate({ type, guide, members })} disabled={!canCreate} className="btn btn-primary h-11">
          <Plus className="w-4 h-4" /> Créer la palanquée
        </button>
        <button type="button" onClick={onClose} className="btn btn-quiet sm:h-9 text-sm">
          Annuler
        </button>
      </footer>
    </Dialog>,
    document.body,
  );
}
