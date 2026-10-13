import { Fragment, useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { appApi, type FicheAccess, type FicheOp } from '../../services/appApi';
import { MODELS, VARIANTS, modelOf, progress, sessionState, SLOTS, type Fiche, type FicheModel, type FicheSession, type ReviewStatus } from '../../lib/training';
import { frDate, shortDay } from '../../lib/dates';
import { message } from '../../lib/errors';
import { useConfirm } from '../../hooks/useConfirm';
import { Avatar } from '../Avatar';
import { GabianLoader } from '../Gabian';
import { Failure } from '../Feedback';
import { SectionTitle } from '../SectionTitle';
import { MemberSheetButton } from '../member/MemberLink';
import { EvalMark, SessionPill } from './marks';
import { SessionEditor } from './SessionEditor';

/**
 * La fiche de suivi d'un élève, comme l'onglet du classeur : ses séances (une
 * par plongée de formation, à remplir par l'enseignant), la grille des
 * compétences séance par séance, les cours théoriques et ce qui est réservé aux
 * responsables plongée. Un encadrant remplit ses séances ; un admin, tout.
 */
export function FicheView({
  id,
  today,
  onChanged,
  onGone,
  onSessionLost,
}: {
  id: string;
  /** AAAA-MM-JJ. */
  today: string;
  /** La fiche a changé : la liste est à relire. */
  onChanged: () => void;
  /** La fiche n'existe plus (supprimée). */
  onGone: () => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [access, setAccess] = useState<FicheAccess>({ admin: false, me: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const fetchFiche = useCallback(
    () =>
      appApi.fiche(id).then(
        (r) => {
          setFiche(r.fiche);
          setAccess({ admin: r.admin, me: r.me });
        },
        (e: unknown) => {
          if (onSessionLost(e)) return;
          setLoadError(message(e));
        },
      ),
    [id, onSessionLost],
  );
  useEffect(() => {
    void fetchFiche();
  }, [fetchFiche]);

  /** Une opération sur la fiche ; la fiche rendue par le serveur remplace celle de l'écran. */
  const run = async (op: FicheOp): Promise<Fiche | null | false> => {
    setError(null);
    try {
      const next = await appApi.ficheOp(id, op);
      if (next) setFiche(next);
      onChanged();
      if (!next) onGone();
      return next;
    } catch (e) {
      if (!onSessionLost(e)) setError(message(e));
      return false;
    }
  };

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <Failure
          text={loadError}
          onRetry={() => {
            setLoadError(null);
            void fetchFiche();
          }}
        />
      </div>
    );
  }
  if (!fiche) return <GabianLoader className="py-16" />;

  const model = modelOf(fiche);
  const { admin, me } = access;
  const mine = (s: FicheSession) => admin || me.includes(s.teacher.id);
  const done = progress(fiche);
  const edited = fiche.sessions.find((s) => s.id === editing);

  const remove = async () => {
    if (!(await confirm({ title: `Supprimer la fiche de ${fiche.name} ?`, message: `${fiche.sessions.length} séance${fiche.sessions.length > 1 ? 's' : ''}.`, confirmLabel: 'Supprimer', danger: true }))) return;
    await run({ op: 'delete' });
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={fiche.name} picture={fiche.picture} />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-brand leading-snug flex items-center gap-1">
              <span className="min-w-0">{fiche.name}</span>
              {fiche.uct && <MemberSheetButton member={{ uct: fiche.uct, name: fiche.name, picture: fiche.picture }} size="sm" />}
            </h3>
            <p className="text-sm text-muted">{model.title}</p>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-base">
          <div className="flex gap-2">
            <dt className="text-muted">Séances</dt>
            <dd className="font-bold tabular-nums text-brand">
              {fiche.sessions.length}
              {model.forfait > 0 && ` / ${model.forfait}`}
            </dd>
          </div>
          {done.total > 0 && (
            <div className="flex gap-2">
              <dt className="text-muted">Acquis</dt>
              <dd className="font-bold tabular-nums text-brand">
                {done.acquired} / {done.total}
              </dd>
            </div>
          )}
        </dl>
        {VARIANTS[fiche.level].length > 1 && (
          <label className="flex flex-wrap items-center gap-2">
            <span className="label">Fiche</span>
            <select value={model.id} onChange={(e) => void run({ op: 'general', model: e.target.value })} className="field flex-1 min-w-0 sm:flex-none">
              {VARIANTS[fiche.level].map((v) => (
                <option key={v} value={v}>
                  {MODELS[v]!.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {error && (
        <p role="alert" className="p-3 rounded-xl bg-danger-soft text-danger">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <SectionTitle
          count={fiche.sessions.length}
          actions={
            !adding && (
              <button type="button" onClick={() => setAdding(true)} className="btn btn-quiet sm:h-9 text-sm max-sm:flex-1">
                <Plus className="w-4 h-4" /> Séance
              </button>
            )
          }
        >
          Séances
        </SectionTitle>
        {adding && (
          <AddSession
            admin={admin}
            teacherLabel={model.teacherLabel}
            today={today}
            onCancel={() => setAdding(false)}
            onAdd={async (input) => {
              const known = new Set(fiche.sessions.map((s) => s.id));
              const next = await run({ op: 'add_session', ...input });
              if (!next) return;
              setAdding(false);
              // La séance ajoutée s'ouvre aussitôt, pour la remplir.
              setEditing(next.sessions.find((s) => !known.has(s.id))?.id ?? null);
            }}
          />
        )}
        <ol className="space-y-2">
          {fiche.sessions.map((s, i) => (
            <li key={s.id}>
              <SessionCard session={s} number={i + 1} state={sessionState(s, today)} onOpen={mine(s) ? () => setEditing(s.id) : undefined} />
            </li>
          ))}
        </ol>
      </section>

      {model.sections.length > 0 && fiche.sessions.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Compétences</SectionTitle>
          <Grid model={model} sessions={fiche.sessions} />
        </section>
      )}

      {model.theory.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Cours théoriques</SectionTitle>
          <ul className="space-y-2">
            {model.theory.map((t) => {
              const course = fiche.theory[t.id] ?? { date: '', teacher: '', note: '' };
              const save = (change: Partial<typeof course>) => void run({ op: 'theory', key: t.id, ...course, ...change });
              return (
                <li key={t.id} className="card p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-[1fr_auto_10rem_6rem] items-end gap-3">
                  <p className="col-span-2 sm:col-span-1 sm:self-center font-semibold text-ink">{t.label}</p>
                  <label className="block">
                    <span className="label block mb-1">Date</span>
                    <input type="date" value={course.date} onChange={(e) => save({ date: e.target.value })} className="field w-full" />
                  </label>
                  <label className="block">
                    <span className="label block mb-1">Moniteur</span>
                    <BlurInput value={course.teacher} maxLength={120} onCommit={(teacher) => save({ teacher })} />
                  </label>
                  {t.exam && (
                    <label className="block">
                      <span className="label block mb-1">Note</span>
                      <BlurInput value={course.note} maxLength={40} onCommit={(note) => save({ note })} />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <SectionTitle>Commentaire général</SectionTitle>
        <BlurInput multiline value={fiche.general} maxLength={2000} onCommit={(text) => void run({ op: 'general', text })} />
      </section>

      <section className="space-y-2">
        <SectionTitle>Réservé aux responsables plongée</SectionTitle>
        <Review fiche={fiche} model={model} admin={admin} onSave={(review) => void run({ op: 'review', ...review })} />
      </section>

      {admin && (
        <button type="button" onClick={() => void remove()} className="btn btn-quiet text-danger max-sm:w-full">
          <Trash2 className="w-4 h-4" /> Supprimer la fiche
        </button>
      )}

      {edited && (
        <SessionEditor
          key={edited.id}
          fiche={fiche}
          model={model}
          session={edited}
          number={fiche.sessions.indexOf(edited) + 1}
          admin={admin}
          onSave={async (patch) => !!(await run({ op: 'session', session: edited.id, patch }))}
          onRemove={edited.event ? undefined : async () => !!(await run({ op: 'remove_session', session: edited.id }))}
          onIgnore={admin && !edited.filled ? async (ignored) => !!(await run({ op: 'ignore', session: edited.id, ignored })) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}

/** Une séance dans la liste : numéro, date, enseignant, paramètres, commentaire. Un bouton si l'appelant peut la remplir. */
function SessionCard({ session: s, number, state, onOpen }: { session: FicheSession; number: number; state: ReturnType<typeof sessionState>; onOpen?: () => void }) {
  const params = [s.depth && `Profondeur ${s.depth}`, s.duration && `Durée ${s.duration}`, s.weight && `Lestage ${s.weight}`].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="flex items-start gap-3">
        <span className="step-dot mt-0.5">{number}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold text-ink">
            {s.date ? shortDay(s.date) : 'Sans date'}
            {s.slot && ` · ${s.slot}`}
            {s.objective && <span className="code"> · {s.objective}</span>}
          </span>
          <span className="block text-sm text-muted">{[s.teacher.name, s.label].filter(Boolean).join(' · ')}</span>
        </span>
        <SessionPill state={state} />
      </span>
      {params && <span className="block mt-2 text-sm text-ink">{params}</span>}
      {s.comment && <span className="block mt-1.5 text-sm text-ink whitespace-pre-line">{s.comment}</span>}
    </>
  );
  if (!onOpen) return <div className="item-card">{body}</div>;
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" className="item-card block w-full text-left hover:bg-raised">
      {body}
    </button>
  );
}

/** La grille du classeur : une ligne par compétence, une colonne par séance. La première colonne reste en place quand on fait défiler les séances. */
function Grid({ model, sessions }: { model: FicheModel; sessions: FicheSession[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface text-left px-3 py-2 label w-[46vw] sm:w-auto min-w-[10rem]">
              Séance
            </th>
            {sessions.map((s, i) => (
              <th key={s.id} scope="col" title={s.date ? frDate(s.date) : undefined} className="px-1 py-2 text-center font-bold tabular-nums text-brand min-w-10">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.sections.map((sec) => (
            <Fragment key={sec.title}>
              {sec.group && (
                <tr>
                  <th scope="colgroup" colSpan={sessions.length + 1} className="text-left px-3 pt-3 pb-1 label border-t border-line">
                    <span className="sticky left-3">{sec.group}</span>
                  </th>
                </tr>
              )}
              <tr>
                <th scope="colgroup" colSpan={sessions.length + 1} className="text-left px-3 py-2 bg-raised font-bold text-brand border-t border-line">
                  <span className="sticky left-3">{sec.title}</span>
                </th>
              </tr>
              {sec.items.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-surface text-left font-normal text-ink px-3 py-1.5 w-[46vw] sm:w-auto min-w-[10rem]">
                    {c.label}
                  </th>
                  {sessions.map((s) => (
                    <td key={s.id} className="px-1 py-1 text-center">
                      <EvalMark code={s.evals[c.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Séance ajoutée à la main : une plongée de formation faite avant la fiche, ou hors d'une sortie de l'agenda. */
function AddSession({
  admin,
  teacherLabel,
  today,
  onAdd,
  onCancel,
}: {
  admin: boolean;
  teacherLabel: string;
  today: string;
  onAdd: (input: { date: string; slot: string; teacher?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState('');
  const [teacher, setTeacher] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card p-3 sm:p-4 grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onAdd({ date, slot, ...(teacher.trim() ? { teacher: teacher.trim() } : {}) }).finally(() => setBusy(false));
      }}
    >
      <label className="block">
        <span className="label block mb-1">Date</span>
        <input type="date" required value={date} max={today} onChange={(e) => setDate(e.target.value)} className="field w-full" />
      </label>
      <label className="block">
        <span className="label block mb-1">Matin / Après-midi</span>
        <select value={slot} onChange={(e) => setSlot(e.target.value)} className="field w-full">
          <option value="">—</option>
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {admin && (
        <label className="block col-span-2 sm:flex-1 sm:min-w-[10rem]">
          <span className="label block mb-1">{teacherLabel}</span>
          <input value={teacher} onChange={(e) => setTeacher(e.target.value)} maxLength={120} className="field w-full" />
        </label>
      )}
      <button type="button" onClick={onCancel} disabled={busy} className="btn btn-quiet">
        Annuler
      </button>
      <button type="submit" disabled={busy || !date} className="btn btn-primary">
        Ajouter
      </button>
    </form>
  );
}

/** Théorie, pratique, certification : ATTENTE ou VALIDE, dates et responsable. Lecture seule pour un encadrant. */
function Review({ fiche, model, admin, onSave }: { fiche: Fiche; model: FicheModel; admin: boolean; onSave: (review: Fiche['review']) => void }) {
  const review = fiche.review;
  const status = (id: string): ReviewStatus => review.status[id] ?? 'ATTENTE';
  const toggle = (id: string) => onSave({ ...review, status: { ...review.status, [id]: status(id) === 'VALIDE' ? 'ATTENTE' : 'VALIDE' } });
  return (
    <div className="card p-3 sm:p-4 space-y-4">
      <ul className="space-y-2">
        {model.review.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex-1 min-w-[10rem] text-base">{r.label}</span>
            {admin ? (
              <button type="button" role="switch" aria-checked={status(r.id) === 'VALIDE'} aria-label={r.label} onClick={() => toggle(r.id)} className="tab-pill min-w-24 border border-line">
                {status(r.id)}
              </button>
            ) : (
              <span className={`font-bold ${status(r.id) === 'VALIDE' ? 'text-ok' : 'text-muted'}`}>{status(r.id)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {model.theoryDate && (
          <label className="block">
            <span className="label block mb-1">Date de validation de la théorie</span>
            <input type="date" value={review.theoryDate} disabled={!admin} onChange={(e) => onSave({ ...review, theoryDate: e.target.value })} className="field w-full disabled:opacity-70" />
          </label>
        )}
        <label className="block">
          <span className="label block mb-1">Date de certification</span>
          <input type="date" value={review.certDate} disabled={!admin} onChange={(e) => onSave({ ...review, certDate: e.target.value })} className="field w-full disabled:opacity-70" />
        </label>
        <label className="block">
          <span className="label block mb-1">Responsable</span>
          <BlurInput value={review.responsable} maxLength={120} disabled={!admin} onCommit={(responsable) => onSave({ ...review, responsable })} />
        </label>
      </div>
    </div>
  );
}

/** Champ enregistré quand on le quitte, s'il a changé (pas à chaque frappe). */
function BlurInput({ value, onCommit, maxLength, multiline, disabled }: { value: string; onCommit: (value: string) => void; maxLength: number; multiline?: boolean; disabled?: boolean }) {
  const [text, setText] = useState(value);
  // La valeur enregistrée a changé (réponse du serveur, autre fiche) : elle remplace la saisie.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim());
  };
  if (multiline) return <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} rows={3} maxLength={maxLength} disabled={disabled} className="field w-full h-auto py-2.5 leading-snug" />;
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} maxLength={maxLength} disabled={disabled} className="field w-full disabled:opacity-70" />;
}
