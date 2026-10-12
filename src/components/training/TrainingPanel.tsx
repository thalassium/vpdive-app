import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpenCheck, ChevronRight, Plus, Search } from 'lucide-react';
import { appApi, type FicheAccess } from '../../services/appApi';
import { MODELS, byName, modelOf, todoCount, type FicheLevel, type FicheSummary } from '../../lib/training';
import { ymd } from '../../lib/dates';
import { message } from '../../lib/errors';
import { Avatar } from '../Avatar';
import { Dialog, DialogHeader } from '../Dialog';
import { GabianLoader } from '../Gabian';
import { Failure } from '../Feedback';
import { FicheView } from './FicheView';
import { NewFiche } from './NewFiche';

type Show = 'todo' | 'open' | 'certified';
const SHOW_LABEL: Record<Show, string> = { todo: 'À remplir', open: 'En cours', certified: 'Certifiés' };

/**
 * Formations : les fiches de suivi des élèves. Un admin les voit toutes (menu
 * Admin) ; un encadrant, celles des élèves dont il a encadré une séance (menu
 * Gestion de sortie). À gauche la liste, à trier par état et par niveau ; à
 * droite la fiche choisie. Les fiches et leurs séances naissent des sorties ;
 * un admin peut aussi en créer une à la main (« + Fiche », NewFiche).
 */
export function TrainingPanel({ onClose, onSessionLost }: { onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [data, setData] = useState<(FicheAccess & { fiches: FicheSummary[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [level, setLevel] = useState<FicheLevel | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [today] = useState(() => ymd(new Date()));

  const fetchList = useCallback(
    () =>
      appApi.fiches().then(setData, (e: unknown) => {
        if (onSessionLost(e)) return;
        setError(message(e));
      }),
    [onSessionLost],
  );
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const fiches = data?.fiches;
  /** Séances à remplir : toutes pour un admin, les siennes pour un encadrant. */
  const todoOf = useCallback((f: FicheSummary) => todoCount(f, today, data?.admin ? undefined : data?.me), [today, data?.admin, data?.me]);
  const counts = useMemo(() => {
    const all = fiches ?? [];
    return { todo: all.filter((f) => todoOf(f) > 0).length, open: all.filter((f) => !f.certified).length, certified: all.filter((f) => f.certified).length };
  }, [fiches, todoOf]);
  // Sans choix : ce qu'il y a à remplir s'il y en a, sinon les formations en cours.
  const shown: Show = show ?? (counts.todo > 0 ? 'todo' : 'open');
  const levels = useMemo(() => [...new Set((fiches ?? []).map((f) => f.level))].sort(), [fiches]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (fiches ?? [])
      .filter((f) => (shown === 'todo' ? todoOf(f) > 0 : shown === 'certified' ? f.certified : !f.certified))
      .filter((f) => !level || f.level === level)
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort(byName);
  }, [fiches, shown, level, query, todoOf]);

  return (
    <>
    <Dialog label="formations" onClose={onClose} onBackdrop={null} titleId="training-title" className="sm:max-w-6xl h-dvh sm:h-[94vh]">
      <DialogHeader
        titleId="training-title"
        before={
          selected && (
            <button type="button" onClick={() => setSelected(null)} aria-label="Toutes les fiches" className="icon-btn lg:hidden -ml-2">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )
        }
        icon={<BookOpenCheck className="w-6 h-6 text-brand shrink-0" />}
        title="Formations"
        actions={
          data?.admin && (
            <button type="button" onClick={() => setCreating(true)} aria-haspopup="dialog" className="btn btn-quiet sm:h-9 px-3 text-sm">
              <Plus className="w-4 h-4" /> Fiche
            </button>
          )
        }
        onClose={onClose}
      />

      <div className="flex-1 min-h-0 flex">
        <aside className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[22rem] shrink-0 border-r border-line overflow-y-auto overscroll-contain`}>
          {!data && !error && <GabianLoader label="Chargement des fiches…" />}
          {error && (
            <div className="p-4">
              <Failure
                look="soft"
                text={error}
                onRetry={() => {
                  setError(null);
                  void fetchList();
                }}
              />
            </div>
          )}
          {fiches && fiches.length === 0 && <p className="p-6 text-muted">Aucune fiche de suivi.</p>}
          {fiches && fiches.length > 0 && (
            <>
              <div className="sticky top-0 z-10 bg-surface border-b border-line p-3 space-y-2">
                <div role="group" aria-label="État" className="flex flex-wrap gap-1.5">
                  {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
                    <button key={s} type="button" aria-pressed={shown === s} onClick={() => setShow(s)} className="tab-pill max-sm:flex-1">
                      {SHOW_LABEL[s]}
                      <span className="tabular-nums font-normal">{counts[s]}</span>
                    </button>
                  ))}
                </div>
                {levels.length > 1 && (
                  <div role="group" aria-label="Niveau" className="flex flex-wrap gap-1.5">
                    {levels.map((l) => (
                      <button key={l} type="button" aria-pressed={level === l} onClick={() => setLevel(level === l ? null : l)} className="tab-pill max-sm:flex-1">
                        {MODELS[l]!.label}
                      </button>
                    ))}
                  </div>
                )}
                {fiches.length > 8 && (
                  <label className="relative block">
                    <span className="sr-only">Chercher un élève</span>
                    <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher un élève" className="field w-full pl-9" />
                  </label>
                )}
              </div>
              {list.length === 0 && <p className="p-6 text-muted">Aucune fiche.</p>}
              <ul>
                {list.map((f) => {
                  const todo = todoOf(f);
                  const forfait = modelOf(f).forfait;
                  const active = selected === f.id;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(f.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full text-left pl-3 pr-4 py-2.5 flex items-center gap-3 border-l-4 transition-colors ${active ? 'bg-accent-soft border-accent' : 'border-transparent hover:bg-raised'}`}
                      >
                        <Avatar name={f.name} picture={f.picture} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-semibold text-ink">{f.name}</span>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                            <span className="code">{f.level}</span>
                            <span className="tabular-nums">
                              {f.sessions}
                              {forfait > 0 && ` / ${forfait}`} séance{f.sessions > 1 ? 's' : ''}
                            </span>
                            {todo > 0 && <span className="px-1.5 rounded-md bg-pink text-on-pink font-bold whitespace-nowrap">{todo} à remplir</span>}
                            {f.certified && <span className="font-semibold text-ok">Certifié</span>}
                          </span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-muted shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>

        <main className={`${selected ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col overflow-y-auto overscroll-contain bg-canvas`}>
          {selected ? (
            <FicheView key={selected} id={selected} today={today} onChanged={() => void fetchList()} onGone={() => setSelected(null)} onSessionLost={onSessionLost} />
          ) : (
            fiches && fiches.length > 0 && <p className="m-auto p-8 text-muted">Choisissez une fiche.</p>
          )}
        </main>
      </div>
    </Dialog>
    {creating && (
      <NewFiche
        onCreated={(id) => {
          void fetchList();
          setSelected(id);
        }}
        onClose={() => setCreating(false)}
        onSessionLost={onSessionLost}
      />
    )}
    </>
  );
}
