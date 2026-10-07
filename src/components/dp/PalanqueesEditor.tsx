import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, ClipboardCopy, Lock, Pencil, Plus, ShieldCheck, Sparkles, Star, Trash2, UserX } from 'lucide-react';
import type { RosterEntry } from '../../services/vpdiveApi';
import {
  DEPTHS,
  KIND_LABEL,
  TRAINING_TARGET,
  aptitudesFromLabels,
  chosenDepth,
  depthOf,
  prerogativeCode,
  prerogativeLabel,
  proposePalanquees,
  validate,
  type Depth,
  type Diver,
  type Palanquee,
  type PalanqueeKind,
  type Plan,
} from '../../lib/palanquees';
import {
  PREROGATIVE_OPTIONS,
  TRAINING_OPTIONS,
  addPalanquee,
  assignGuide,
  deletePalanquee,
  buddyPairs,
  moveDiver,
  planToText,
  rosterToDivers,
  setDepth,
  setDiverChoice,
  setKind,
} from '../../lib/palanqueeEdit';
import type { Dive, OutingDoc } from '../../lib/outing';
import { Menu } from '../Menu';

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

/**
 * Comment on présente quelqu'un : sa prérogative (E3, GP, PE40 · PA20…), puis
 * son niveau ou son diplôme tel que VPDive l'écrit (DEJEPS, MF1, P2…). Un E3
 * peut être MF1 ou DEJEPS : on ne le devine jamais.
 */
const describe = (d: Diver) => [prerogativeCode({ ...d, training: 0 }) || 'niveau ?', ...diplomas(d)].join(' · ');
/** Niveaux et diplômes VPDive, sans ceux qui répètent la prérogative (« PE-40 » à côté de « PE40 »). */
const diplomas = (d: Diver) => {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = new Set(prerogativeCode({ ...d, training: 0 }).split(' · ').map(flat));
  return (d.display ?? []).filter((x) => !parts.has(flat(x)));
};
const shownLevel = (d: Diver) => (d.training ? `FN${d.training} · ${describe(d)}` : describe(d));
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
    const fromVpdive = prerogativeCode(aptitudesFromLabels(r.levels));
    const forced = settings.levels?.[d.id];
    const fn = settings.training?.[d.id];
    const prerogative = forced ?? fromVpdive;
    // Brevet étranger ou niveau inconnu : sans prérogative, le plongeur ne peut pas être placé.
    const missing = !prerogative && !d.training;
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
              VPDive : {r.display.join(', ') || 'aucun niveau'}
              {forced && <span className="text-brand font-semibold"> → prérogative retenue : {forced}</span>}
              {d.minor && ' · mineur'}
              {r.roles.length > 0 && ` · ${r.roles.join(', ')}`}
              {r.waitingList && ' · liste d’attente'}
            </span>
          </span>
        </label>
        <Menu
          ariaLabel={`Prérogative et formation de ${d.name}`}
          triggerClassName={`h-9 min-w-36 inline-flex items-center justify-between gap-2 rounded-lg border px-2.5 text-sm font-semibold ${
            missing && !out ? 'border-warn bg-warn-soft text-warn' : forced || fn ? 'border-brand bg-tint text-brand' : 'border-line bg-surface text-brand'
          }`}
          trigger={
            <>
              <span>
                {prerogative || 'Prérogative ?'}
                {fn ? ` · ${fn}` : !forced && d.training ? ` · FN${d.training}` : ''}
              </span>
              <ChevronDown className="w-4 h-4 opacity-60" />
            </>
          }
          sections={[
            {
              title: 'Prérogative',
              selected: forced ?? '',
              onSelect: (v) => onSettings({ ...settings, ...setDiverChoice(settings, 'levels', d.id, v) }),
              options: [
                { value: '', label: fromVpdive ? `${fromVpdive}` : 'Aucune', hint: 'VPDive' },
                ...PREROGATIVE_OPTIONS.divers.map((v) => ({ value: v, label: v })),
                ...PREROGATIVE_OPTIONS.instructors.map((v) => ({ value: v, label: v, hint: v === 'GP' ? 'guide' : 'enseignant' })),
              ],
            },
            ...(isInstructor(d)
              ? []
              : [
                  {
                    title: 'En formation',
                    selected: fn ?? '',
                    onSelect: (v: string) => onSettings({ ...settings, ...setDiverChoice(settings, 'training', d.id, v) }),
                    options: [
                      { value: '', label: d.training && !fn ? `FN${d.training}` : 'Pas en formation', hint: d.training && !fn ? 'prépa VPDive' : undefined },
                      ...TRAINING_OPTIONS.map((t) => ({ value: t, label: t, hint: `vers le N${t.slice(2)}` })),
                    ],
                  },
                ]),
          ]}
        />
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
              Pas de prérogative pour {unknownLevels.map((d) => d.name).join(', ')} (brevet d’une autre école ou niveau absent de VPDive) :
              choisissez-la, sinon ils ne seront pas placés.
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
      {/* En-tête coloré : numéro, type, prérogative en grand */}
      <header className={`flex items-center justify-between gap-3 px-4 py-3 text-white ${depth && !issues.length ? 'bg-band' : 'bg-danger'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">P{index}</span>
          {locked ? (
            <span className="font-semibold">{KIND_LABEL[p.kind]}</span>
          ) : (
            <Menu
              ariaLabel="Type de palanquée"
              triggerClassName="h-9 inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 hover:bg-white/20 px-2.5 text-sm font-semibold text-white"
              trigger={
                <>
                  {KIND_LABEL[p.kind]}
                  <ChevronDown className="w-4 h-4 opacity-70" />
                </>
              }
              sections={[{ selected: p.kind, onSelect: (v) => onKind(v as PalanqueeKind), options: KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) }]}
            />
          )}
          {!locked && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Supprimer P${index}`}
              title="Supprimer la palanquée (ses participants redeviennent disponibles)"
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/15"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-white/70">Prérogative</span>
          {selectable ? (
            <Menu
              ariaLabel="Prérogative de la palanquée"
              triggerClassName={`h-10 inline-flex items-center gap-1 rounded-xl bg-surface text-brand font-bold tabular-nums px-3 ${prerogativeLabel(p).length > 5 ? 'text-base' : 'text-2xl'}`}
              trigger={
                <>
                  {prerogativeLabel(p)}
                  <ChevronDown className="w-4 h-4 opacity-60" />
                </>
              }
              sections={[
                {
                  selected: String(depth),
                  onSelect: (v) => onDepth(Number(v) as Depth),
                  options: DEPTHS.filter((d) => d <= legal && (d > 6 || legal === 6)).map((d) => ({
                    value: String(d),
                    label: `${letter}${d}`,
                    hint: d === 60 ? 'à la main' : undefined,
                  })),
                },
              ]}
            />
          ) : (
            <span className={`inline-block h-10 leading-10 rounded-xl px-3 font-bold tabular-nums whitespace-nowrap ${depth ? 'bg-surface text-brand' : 'bg-white/15 text-white'} ${depth && prerogativeLabel(p).length <= 5 ? 'text-2xl' : 'text-base'}`}>
              {prerogativeLabel(p)}
            </span>
          )}
        </div>
      </header>

      {/* Plongeurs, avec leur prérogative ; celui qui fixe celle de la palanquée est signalé */}
      <ul className="px-4 pt-3 pb-3 space-y-1.5 text-sm">
        {needsGuide && (
          <GuideRow p={p} eligible={eligible} locked={locked} targets={targets} onMove={onMove} onGuide={onGuide} />
        )}
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

/**
 * L'encadrant, présenté comme un plongeur mais toujours en tête de palanquée,
 * en gras sur fond gris clair : sa prérogative (E3, GP…), son nom, son diplôme
 * VPDive. Cliquer sur le nom ouvre la liste des encadrants possibles.
 */
function GuideRow({
  p,
  eligible,
  locked,
  targets,
  onMove,
  onGuide,
}: {
  p: Palanquee;
  eligible: Diver[];
  locked: boolean;
  targets: Target[];
  onMove: (d: Diver, target: string) => void;
  onGuide: (d: Diver) => void;
}) {
  const g = p.guide;
  const role = p.kind === 'teaching' ? 'Enseignant' : 'Encadrant';
  const editable = !locked && eligible.length > 0;
  return (
    <li className={`-mx-2 px-2 py-1.5 rounded-lg flex items-center gap-2 ${g ? 'bg-raised border border-line' : 'border-2 border-dashed border-danger/50 text-danger'}`}>
      <span className={`shrink-0 min-w-16 inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-bold ${g ? 'bg-pink text-on-pink' : 'bg-danger-soft'}`}>
        <Star className="w-3 h-3 fill-current" />
        {g ? prerogativeCode(g) || '?' : role}
      </span>
      <div className="flex-1 min-w-0">
        {editable ? (
          <Menu
            ariaLabel={role}
            triggerClassName={`max-w-full inline-flex items-center gap-1 font-bold text-left ${g ? 'text-ink' : 'text-danger'}`}
            trigger={
              <>
                <span className="truncate">{g ? g.name : 'Choisir l’encadrant…'}</span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" />
              </>
            }
            sections={[
              {
                selected: g?.id ?? '',
                onSelect: (id) => {
                  const d = eligible.find((x) => x.id === id);
                  if (d) onGuide(d);
                },
                options: eligible.map((d) => ({ value: d.id, label: d.name, hint: describe(d) })),
              },
            ]}
          />
        ) : (
          <span className="block font-bold truncate text-ink">{g ? g.name : 'Aucun encadrant disponible'}</span>
        )}
        <span className="block text-xs text-muted truncate">
          {role}
          {g && diplomas(g).length > 0 && ` · ${diplomas(g).join(' · ')}`}
        </span>
      </div>
      {g && !locked && <MoveSelect targets={targets} onMove={(t) => onMove(g, t)} instructor />}
    </li>
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
          {d.training ? `en formation · ${describe(d)}` : describe(d)}
          {d.original && <span title="Le DP a retenu un équivalent FFESSM"> · équivalent retenu</span>}
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
function MoveSelect({ targets, onMove, instructor, allowUnassign = true }: { targets: Target[]; onMove: (t: string) => void; instructor?: boolean; allowUnassign?: boolean }) {
  const asGuide = instructor ? targets.filter((t) => t.kind !== 'autonomous') : [];
  return (
    <Menu
      ariaLabel="Déplacer"
      triggerClassName="h-8 shrink-0 inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs text-muted hover:border-brand/40 hover:text-brand"
      trigger={
        <>
          Déplacer
          <ChevronDown className="w-3.5 h-3.5" />
        </>
      }
      sections={[
        ...(asGuide.length ? [{ title: 'Comme encadrant', onSelect: onMove, options: asGuide.map((t) => ({ value: `guide:${t.id}`, label: `Encadrant de ${t.label}` })) }] : []),
        {
          title: instructor ? 'Comme plongeur' : undefined,
          onSelect: onMove,
          options: [
            ...targets.map((t) => ({ value: t.id, label: instructor ? `Plongeur dans ${t.label}` : `Vers ${t.label}`, hint: KIND_LABEL[t.kind] })),
            { value: 'new', label: 'Nouvelle palanquée' },
            ...(allowUnassign ? [{ value: 'unassigned', label: 'Retirer de la palanquée' }] : []),
          ],
        },
      ]}
    />
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
