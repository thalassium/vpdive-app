import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Lock, Pencil, Plus, ShieldCheck, Sparkles, Star, Trash2, UserX } from 'lucide-react';
import type { RosterEntry } from '../../services/vpdiveApi';
import {
  DEPTHS,
  KIND_LABEL,
  TRAINING_TARGET,
  aptitudesFromLabels,
  chosenDepth,
  depthOf,
  levelName,
  prerogativeLabel,
  proposePalanquees,
  validate,
  type Depth,
  type Diver,
  type Palanquee,
  type PalanqueeKind,
  type Plan,
} from '../../lib/palanquees';
import { LEVEL_OVERRIDES, TRAINING_OPTIONS, addPalanquee, assignGuide, deletePalanquee, buddyPairs, chooseLevel, levelChoice, moveDiver, planToText, rosterToDivers, setDepth, setKind } from '../../lib/palanqueeEdit';
import type { Dive, OutingDoc } from '../../lib/outing';

interface Props {
  title: string;
  roster: RosterEntry[];
  doc: OutingDoc;
  dive: Dive;
  onSettings: (settings: OutingDoc['settings']) => void;
  onPlan: (plan: Plan) => void;
  onValidate: () => void;
  onReopen: () => void;
}

const KINDS: PalanqueeKind[] = ['teaching', 'guided', 'autonomous'];

/** Niveau d'un plongeur tel qu'on le lit sur la carte : FN# pour un élève, sinon MF1, E2, N4 / GP, N2… */
const shownLevel = (d: Diver) => (d.training ? `FN${d.training}` : levelName(d) || 'niveau ?');
const isInstructor = (d: Diver) => !!d.guide;

/**
 * Palanquées d'une plongée. Une palanquée = un type (Formation, Encadrée,
 * Autonome), un encadrant si le type en demande un, et une prérogative (PE12…
 * PA60) qui découle des gens qui la composent. Validées, elles sont figées et
 * débloquent la fiche de sécurité ; « Modifier » les rouvre.
 */
export function PalanqueesEditor({ title, roster, doc, dive, onSettings, onPlan, onValidate, onReopen }: Props) {
  const [copied, setCopied] = useState(false);
  const settings = doc.settings;
  const excluded = useMemo(() => new Set(settings.excluded), [settings.excluded]);
  const divers = useMemo(() => rosterToDivers(roster, settings), [roster, settings]);
  const diving = divers.filter((d) => !excluded.has(d.id));
  const plan = dive.plan;
  const locked = !!dive.validated;

  const generate = () => {
    const ids = new Set(diving.map((d) => d.id));
    const buddies = buddyPairs(roster).filter(([a, b]) => ids.has(a) && ids.has(b));
    onPlan(proposePalanquees(diving, { buddies }));
  };

  // Qui est où dans le plan ; ceux qui plongent sans y figurer sont « disponibles ».
  const placed = new Map<string, Diver>();
  for (const p of plan?.palanquees ?? []) for (const d of [p.guide, p.extra, ...p.members]) if (d) placed.set(d.id, d);
  const free = plan
    ? [
        ...plan.unassigned.filter((u) => !excluded.has(u.diver.id)),
        ...diving.filter((d) => !placed.has(d.id) && !plan.unassigned.some((u) => u.diver.id === d.id)).map((diver) => ({ diver, reason: 'Ajouté après la génération.' })),
      ]
    : [];
  /** Tous ceux qui peuvent encadrer, où qu'ils soient. */
  const instructors = diving.filter(isInstructor).map((d) => placed.get(d.id) ?? d);

  const issues = plan ? plan.palanquees.flatMap((p) => validate(p)) : [];
  const unknownLevels = diving.filter((d) => !d.pe && !d.beginner && !d.guide && !d.training);

  const copy = async () => {
    if (!plan) return;
    const text = planToText(`${title} · ${dive.label}`, plan);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copiez la composition :', text);
    }
  };

  const moveTo = (d: Diver, target: string) => {
    if (!plan) return;
    if (target.startsWith('guide:')) onPlan(assignGuide(plan, target.slice(6), d));
    else onPlan(moveDiver(plan, d, target));
  };
  const targetsFor = (exclude?: string) => (plan?.palanquees ?? []).map((p, i) => ({ id: p.id, label: `P${i + 1}`, kind: p.kind })).filter((t) => t.id !== exclude);

  const rosterRow = (d: Diver) => {
    const r = roster.find((x) => x.id === d.id)!;
    const out = excluded.has(d.id);
    const unknown = !d.pe && !d.beginner && !d.guide && !d.training;
    const found = levelName(aptitudesFromLabels(r.levels));
    const choice = levelChoice(settings, d.id);
    const forced = settings.levels?.[d.id];
    return (
      <li key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 ${out ? 'opacity-50' : ''}`}>
        <label className="flex items-center gap-2.5 min-w-[14rem] flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={!out}
            onChange={() => onSettings({ ...settings, excluded: out ? settings.excluded.filter((x) => x !== d.id) : [...settings.excluded, d.id] })}
            className="w-5 h-5 accent-[var(--fill)] shrink-0"
          />
          <span className="min-w-0">
            <span className="font-medium text-ink truncate block">{d.name}</span>
            <span className="text-xs text-muted">
              VPDive : {r.levels.join(', ') || 'aucun niveau'}
              {forced && <span className="text-brand font-semibold"> → retenu : {forced}</span>}
              {d.minor && ' · mineur'}
              {r.roles.length > 0 && ` · ${r.roles.join(', ')}`}
              {r.waitingList && ' · liste d’attente'}
            </span>
          </span>
        </label>
        <select
          value={choice}
          onChange={(e) => onSettings({ ...settings, ...chooseLevel(settings, d.id, e.target.value) })}
          aria-label={`Niveau retenu pour ${d.name}`}
          className={`h-9 min-w-36 rounded-lg border px-2 text-sm bg-surface font-semibold ${
            unknown && !out ? 'border-warn text-warn' : choice ? 'border-brand bg-tint text-brand' : 'border-line text-brand'
          }`}
        >
          <option value="">{found ? `${found} (VPDive)` : 'Niveau ?'}</option>
          <optgroup label="Équivalent retenu">
            {LEVEL_OVERRIDES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </optgroup>
          {!isInstructor(d) && (
            <optgroup label="En formation">
              {TRAINING_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t} · vers le N{t.slice(2)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </li>
    );
  };

  return (
    <div className="space-y-7">
      {locked && (
        <div className="p-4 rounded-xl bg-ok-soft text-ok flex flex-wrap items-center gap-3">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          <p className="flex-1 min-w-0 text-sm">
            <strong className="font-semibold">Palanquées validées</strong> par {dive.validated!.by} le{' '}
            {new Date(dive.validated!.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}. La fiche de sécurité est débloquée.
          </p>
          <button type="button" onClick={onReopen} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-green/50 bg-surface text-sm font-semibold text-ok">
            <Pencil className="w-4 h-4" /> Modifier les palanquées
          </button>
        </div>
      )}

      {/* 1. Qui plonge : encadrants d'un côté, plongeurs de l'autre */}
      {!locked && (
        <section>
          <Heading n={1} hint={`${diving.length} à l’eau sur ${roster.length} inscrit${roster.length > 1 ? 's' : ''}`}>
            Qui plonge ?
          </Heading>
          {roster.length === 0 ? (
            <p className="text-muted font-serif italic">Personne n’est encore inscrit à cette sortie.</p>
          ) : (
            <div className="space-y-4">
              <RosterGroup title="Encadrants" count={divers.filter(isInstructor).length}>
                {divers.filter(isInstructor).map(rosterRow)}
              </RosterGroup>
              <RosterGroup title="Plongeurs" count={divers.filter((d) => !isInstructor(d)).length}>
                {divers.filter((d) => !isInstructor(d)).map(rosterRow)}
              </RosterGroup>
            </div>
          )}
          {unknownLevels.length > 0 && (
            <p className="mt-2 text-sm text-warn flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              Niveau non reconnu pour {unknownLevels.map((d) => d.name).join(', ')} : choisissez-le, sinon ils ne seront pas placés.
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={diving.length === 0}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-fill hover:bg-fill-hover text-white font-semibold disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {plan ? 'Refaire les palanquées' : 'Générer les palanquées'}
            </button>
            {!plan && (
              <button
                type="button"
                onClick={() => onPlan(addPalanquee(null, diving))}
                disabled={diving.length === 0}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-brand/40 text-brand font-semibold hover:bg-tint disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Composer à la main
              </button>
            )}
            <span className="text-sm text-muted">Autonomes par niveau, puis formations avec un E1/E2/E3, puis encadrés avec un N4/GP au moins.</span>
          </div>
        </section>
      )}

      {/* 2. Palanquées */}
      {plan && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-base font-semibold text-brand">
              {plan.palanquees.length} palanquée{plan.palanquees.length > 1 ? 's' : ''}
            </h3>
            <div className="flex items-center gap-2">
              {!locked && (
                <ActionButton onClick={() => onPlan(addPalanquee(plan, diving))} icon={<Plus className="w-4 h-4" />}>
                  Nouvelle palanquée
                </ActionButton>
              )}
              <ActionButton onClick={copy} icon={copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}>
                {copied ? 'Copié' : 'Copier'}
              </ActionButton>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {plan.palanquees.map((p, i) => (
              <PalanqueeCard
                key={p.id}
                index={i + 1}
                p={p}
                locked={locked}
                instructors={instructors}
                targets={targetsFor(p.id)}
                onMove={moveTo}
                onGuide={(d) => onPlan(assignGuide(plan, p.id, d))}
                onKind={(k) => onPlan(setKind(plan, p.id, k))}
                onDepth={(d) => onPlan(setDepth(plan, p.id, d))}
                onDelete={() => {
                  const people = [p.guide, p.extra, ...p.members].filter(Boolean).length;
                  if (people && !window.confirm(`Supprimer P${i + 1} ? Ses ${people} participant${people > 1 ? 's' : ''} redeviendront disponibles.`)) return;
                  onPlan(deletePalanquee(plan, p.id));
                }}
              />
            ))}
          </div>

          {free.length > 0 && !locked && (
            <div className="mt-4 grid md:grid-cols-2 gap-3">
              <FreeList title="Encadrants disponibles" items={free.filter((u) => isInstructor(u.diver))} targets={targetsFor()} onMove={moveTo} instructor />
              <FreeList title="Plongeurs non placés" items={free.filter((u) => !isInstructor(u.diver))} targets={targetsFor()} onMove={moveTo} />
            </div>
          )}

          {!locked && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onValidate}
                disabled={issues.length > 0 || plan.palanquees.length === 0}
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-ok text-white dark:text-canvas font-semibold disabled:opacity-40"
              >
                <Lock className="w-4 h-4" /> Valider les palanquées
              </button>
              <span className="text-sm text-muted">
                {issues.length > 0 ? `${issues.length} point${issues.length > 1 ? 's' : ''} à corriger avant de valider.` : 'La validation débloque la fiche de sécurité.'}
              </span>
            </div>
          )}

          <p className="mt-4 text-xs text-muted leading-relaxed">
            Code du sport (annexes III-14 à III-16, plongée à l’air) : formation et encadrée avec un encadrant (4 élèves ou plongeurs au plus, +1
            GP/N4 jusqu’à 40 m), autonome de 2 à 3 plongeurs majeurs autonomes. La prérogative de la palanquée est celle du moins formé. Le directeur
            de plongée reste seul juge de la composition finale.
          </p>
        </section>
      )}
    </div>
  );
}

function RosterGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
        {title} <span className="font-normal">· {count}</span>
      </h4>
      {count ? <ul className="rounded-xl border border-line divide-y divide-line">{children}</ul> : <p className="text-sm text-muted font-serif italic">Aucun.</p>}
    </div>
  );
}

/** Prérogative propre d'un plongeur dans cette palanquée (PA en autonomie, PE encadré, FN# en formation). */
function ownPrerogative(d: Diver, p: Palanquee): { label: string; depth: number } {
  if (p.kind === 'autonomous') return d.pa ? { label: `PA${d.pa}`, depth: d.pa } : { label: 'pas PA', depth: 0 };
  if (p.kind === 'teaching' && d.training) return { label: `FN${d.training}`, depth: TRAINING_TARGET[d.training] };
  if (d.pe) return { label: `PE${d.pe}`, depth: d.pe };
  return d.beginner ? { label: 'Débutant', depth: 6 } : { label: '?', depth: 0 };
}

function PalanqueeCard({
  index,
  p,
  locked,
  instructors,
  targets,
  onMove,
  onGuide,
  onKind,
  onDepth,
  onDelete,
}: {
  index: number;
  p: Palanquee;
  locked: boolean;
  instructors: Diver[];
  targets: Target[];
  onMove: (d: Diver, target: string) => void;
  onGuide: (d: Diver) => void;
  onKind: (k: PalanqueeKind) => void;
  onDepth: (d: Depth | undefined) => void;
  onDelete: () => void;
}) {
  const issues = validate(p);
  const legal = depthOf(p);
  const depth = chosenDepth(p);
  const needsGuide = p.kind !== 'autonomous';
  const eligible = instructors.filter((d) => (p.kind === 'teaching' ? d.teach > 0 : !!d.guide));
  const letter = p.kind === 'autonomous' ? 'PA' : 'PE';
  const selectable = !locked && p.kind !== 'teaching' && legal > 0;

  return (
    <article className={`rounded-2xl border-2 bg-surface overflow-hidden ${issues.length ? 'border-danger/60' : 'border-line'}`}>
      {/* Type + prérogative, en grand */}
      <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">P{index}</span>
          {locked ? (
            <span className="font-semibold text-brand">{KIND_LABEL[p.kind]}</span>
          ) : (
            <select value={p.kind} onChange={(e) => onKind(e.target.value as PalanqueeKind)} aria-label="Type de palanquée" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm font-semibold text-brand">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
          {!locked && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Supprimer P${index}`}
              title="Supprimer la palanquée (ses participants redeviennent disponibles)"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger-soft"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">Prérogative</span>
          {selectable ? (
            <select
              value={depth}
              onChange={(e) => onDepth(Number(e.target.value) as Depth)}
              aria-label="Prérogative de la palanquée"
              className="h-11 rounded-xl bg-fill text-white text-2xl font-bold tabular-nums px-3 cursor-pointer"
            >
              {DEPTHS.filter((d) => d <= legal && (d > 6 || legal === 6)).map((d) => (
                <option key={d} value={d} className="text-base text-ink bg-surface">
                  {letter}
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <span className={`inline-block h-11 leading-[2.75rem] rounded-xl px-3 text-2xl font-bold tabular-nums ${depth ? 'bg-fill text-white' : 'bg-danger-soft text-danger text-base'}`}>
              {prerogativeLabel(p)}
            </span>
          )}
        </div>
      </header>

      {/* Encadrant : bandeau plein */}
      {needsGuide && (
        <div className={`mx-4 mb-3 rounded-xl px-3.5 py-3 ${p.guide ? 'bg-band text-white shadow-card' : 'border-2 border-dashed border-danger/50 text-danger'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider opacity-80">
              <Star className="w-4 h-4 fill-current text-pink" />
              {p.kind === 'teaching' ? 'Enseignant' : 'Encadrant'}
            </span>
            {p.guide && !locked && <MoveSelect targets={targets} onMove={(t) => onMove(p.guide!, t)} instructor dark />}
          </div>
          {locked || !eligible.length ? (
            <span className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold">{p.guide ? p.guide.name : 'Aucun encadrant disponible'}</span>
              {p.guide && <span className="px-2 py-0.5 rounded-md bg-pink text-on-pink text-sm font-bold">{levelName(p.guide)}</span>}
            </span>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <select
                value={p.guide?.id ?? ''}
                onChange={(e) => {
                  const d = eligible.find((x) => x.id === e.target.value);
                  if (d) onGuide(d);
                }}
                aria-label={p.kind === 'teaching' ? 'Enseignant' : 'Encadrant'}
                className={`flex-1 min-w-0 bg-transparent text-lg font-bold focus:outline-none -ml-0.5 cursor-pointer ${p.guide ? 'text-white' : 'text-danger'}`}
              >
                {!p.guide && <option value="">Choisir l’encadrant…</option>}
                {eligible.map((d) => (
                  <option key={d.id} value={d.id} className="text-base text-ink bg-surface font-normal">
                    {d.name} · {levelName(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Plongeurs, avec leur prérogative ; celui qui fixe celle de la palanquée est signalé */}
      <ul className="px-4 pb-3 space-y-1.5 text-sm">
        {p.members.map((m) => {
          const own = ownPrerogative(m, p);
          // Signalé seulement s'il fait descendre la palanquée : un autre plongeur aurait pu aller plus loin.
          const depths = p.members.map((x) => ownPrerogative(x, p).depth);
          const floor = Math.min(...depths);
          const limiting = own.depth === floor && depths.some((x) => x > floor);
          return <DiverRow key={m.id} d={m} own={own.label} limiting={limiting} locked={locked} targets={targets} onMove={onMove} />;
        })}
        {p.extra && <DiverRow d={p.extra} own="GP suppl." locked={locked} targets={targets} onMove={onMove} />}
        {p.members.length === 0 && <li className="text-muted font-serif italic">Aucun plongeur.</li>}
      </ul>

      {issues.length > 0 && (
        <ul className="px-4 pb-3.5 space-y-1 text-sm text-danger">
          {issues.map((i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {i}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function DiverRow({
  d,
  own,
  limiting,
  locked,
  targets,
  onMove,
}: {
  d: Diver;
  own: string;
  limiting?: boolean;
  locked: boolean;
  targets: Target[];
  onMove: (d: Diver, target: string) => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`shrink-0 min-w-16 text-center px-1.5 py-0.5 rounded-md text-xs font-bold tabular-nums ${limiting ? 'bg-warn-soft text-warn ring-1 ring-warn/40' : 'bg-raised text-ink'}`}
        title={limiting ? 'Fixe la prérogative de la palanquée' : undefined}
      >
        {own}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block truncate text-ink">{d.name}</span>
        <span className="block text-xs text-muted truncate">
          {d.training ? `en formation · ${levelName({ ...d, training: 0 }) || 'niveau ?'}` : levelName(d) || 'niveau ?'}
          {d.original && <span title="Niveau dans VPDive"> · VPDive : {d.original.join(', ') || 'aucun'}</span>}
          {d.minor ? ' · mineur' : ''}
          {limiting ? ' · fixe la prérogative' : ''}
        </span>
      </span>
      {!locked && <MoveSelect targets={targets} onMove={(t) => onMove(d, t)} instructor={!!d.guide} />}
    </li>
  );
}

function FreeList({ title, items, targets, onMove, instructor }: { title: string; items: Plan['unassigned']; targets: Target[]; onMove: (d: Diver, t: string) => void; instructor?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${instructor ? 'border-line bg-raised' : 'border-warn/40 bg-warn-soft'}`}>
      <p className={`font-semibold flex items-center gap-2 mb-2 ${instructor ? 'text-brand' : 'text-warn'}`}>
        {instructor ? <Star className="w-4 h-4" /> : <UserX className="w-4 h-4" />} {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted font-serif italic">Aucun.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ diver, reason }) => (
            <li key={diver.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-ink">{diver.name}</span>
              <span className="text-xs text-muted">{shownLevel(diver)}</span>
              <span className="basis-full text-xs text-muted">{reason}</span>
              <MoveSelect targets={targets} onMove={(t) => onMove(diver, t)} instructor={instructor} allowUnassign={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Target = { id: string; label: string; kind: PalanqueeKind };

/** Déplacer vers une palanquée (comme plongeur, ou comme encadrant pour un encadrant), une nouvelle, ou retirer. */
function MoveSelect({
  targets,
  onMove,
  instructor,
  dark,
  allowUnassign = true,
}: {
  targets: Target[];
  onMove: (t: string) => void;
  instructor?: boolean;
  dark?: boolean;
  allowUnassign?: boolean;
}) {
  return (
    <select
      value=""
      onChange={(e) => e.target.value && onMove(e.target.value)}
      aria-label="Déplacer"
      className={`h-8 shrink-0 rounded-lg border px-1.5 text-xs ${dark ? 'border-white/30 bg-white/10 text-white' : 'border-line bg-surface text-muted'}`}
    >
      <option value="">Déplacer…</option>
      {instructor &&
        targets
          .filter((t) => t.kind !== 'autonomous')
          .map((t) => (
            <option key={`g${t.id}`} value={`guide:${t.id}`}>
              encadrant de {t.label}
            </option>
          ))}
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          {instructor ? `plongeur dans ${t.label}` : `vers ${t.label}`}
        </option>
      ))}
      <option value="new">nouvelle palanquée</option>
      {allowUnassign && <option value="unassigned">retirer</option>}
    </select>
  );
}

export function Heading({ n, hint, children }: { n: number; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="flex items-center gap-2.5 text-base font-semibold text-brand">
        <span className="w-6 h-6 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">{n}</span>
        {children}
      </h3>
      {hint && <span className="text-xs text-muted text-right">{hint}</span>}
    </div>
  );
}

export function ActionButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-line bg-surface text-sm font-medium text-ink hover:border-brand/40 hover:text-brand"
    >
      {icon}
      {children}
    </button>
  );
}
