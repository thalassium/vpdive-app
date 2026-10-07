import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Lock, Pencil, ShieldCheck, Sparkles, UserX } from 'lucide-react';
import type { RosterEntry } from '../../services/vpdiveApi';
import {
  DEPTHS,
  GUIDE_LABEL,
  aptLabel,
  chosenDepth,
  depthOf,
  prerogativeLabel,
  proposePalanquees,
  validate,
  type Depth,
  type Diver,
  type Palanquee,
  type PalanqueeKind,
  type Plan,
} from '../../lib/palanquees';
import { LEVEL_OVERRIDES, TRAINING_OPTIONS, buddyPairs, moveDiver, planToText, rosterToDivers, setDepth, setGuide, setKind } from '../../lib/palanqueeEdit';
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

const KIND_LABEL: Record<PalanqueeKind, string> = { guided: 'Encadrée (PE)', autonomous: 'Autonome (PA)', teaching: 'Formation' };

/**
 * Palanquées d'une plongée : qui plonge et à quel niveau, proposition
 * automatique, ajustements, puis validation (qui débloque la fiche de sécurité).
 * Une fois validées, elles sont figées ; « Modifier » les rouvre.
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

  const issues = plan ? plan.palanquees.flatMap((p) => validate(p)) : [];
  const unknownLevels = diving.filter((d) => !d.pe && !d.beginner && !d.guide && !d.training);
  const placedIds = new Set(plan?.palanquees.flatMap((p) => [p.guide, p.extra, ...p.members].filter(Boolean).map((d) => d!.id)) ?? []);
  const notPlaced = plan ? diving.filter((d) => !placedIds.has(d.id) && !plan.unassigned.some((u) => u.diver.id === d.id)) : [];

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

  const setSetting = (key: 'levels' | 'training', id: string, value: string) => {
    const next = { ...(settings[key] ?? {}) };
    if (value) next[id] = value;
    else delete next[id];
    onSettings({ ...settings, [key]: next });
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

      {/* 1. Qui plonge */}
      {!locked && (
        <section>
          <Heading n={1} hint={`${diving.length} plongeur${diving.length > 1 ? 's' : ''} sur ${roster.length} inscrit${roster.length > 1 ? 's' : ''}`}>
            Qui plonge ?
          </Heading>
          {roster.length === 0 ? (
            <p className="text-muted font-serif italic">Personne n’est encore inscrit à cette sortie.</p>
          ) : (
            <ul className="rounded-xl border border-line divide-y divide-line">
              {divers.map((d) => {
                const r = roster.find((x) => x.id === d.id)!;
                const out = excluded.has(d.id);
                const unknown = !d.pe && !d.beginner && !d.guide && !d.training;
                return (
                  <li key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 ${out ? 'opacity-50' : ''}`}>
                    <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!out}
                        onChange={() => onSettings({ ...settings, excluded: out ? settings.excluded.filter((x) => x !== d.id) : [...settings.excluded, d.id] })}
                        className="w-5 h-5 accent-[var(--fill)] shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-ink truncate block">{d.name}</span>
                        <span className="text-xs text-muted">
                          {aptLabel(d)}
                          {d.minor && ' · mineur'}
                          {r.roles.length > 0 && ` · ${r.roles.join(', ')}`}
                          {r.waitingList && ' · liste d’attente'}
                        </span>
                      </span>
                    </label>
                    <span className="flex flex-wrap items-center gap-1.5 text-sm">
                      {!settings.levels?.[d.id] && r.levels.map((l) => <Chip key={l}>{l}</Chip>)}
                      <select
                        value={settings.levels?.[d.id] ?? ''}
                        onChange={(e) => setSetting('levels', d.id, e.target.value)}
                        aria-label={`Niveau retenu pour ${d.name}`}
                        className={`h-8 rounded-lg border px-2 text-sm bg-surface ${unknown && !out ? 'border-warn text-warn' : 'border-line text-muted'}`}
                      >
                        <option value="">{r.levels.length ? 'Niveau VPDive' : 'Niveau ?'}</option>
                        {LEVEL_OVERRIDES.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <select
                        value={settings.training?.[d.id] ?? ''}
                        onChange={(e) => setSetting('training', d.id, e.target.value)}
                        aria-label={`Formation de ${d.name}`}
                        className={`h-8 rounded-lg border px-2 text-sm bg-surface ${d.training ? 'border-brand text-brand font-semibold' : 'border-line text-muted'}`}
                      >
                        <option value="">{d.training && !settings.training?.[d.id] ? `FN${d.training} (prépa)` : 'Pas en formation'}</option>
                        {TRAINING_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t} · en formation
                          </option>
                        ))}
                      </select>
                    </span>
                  </li>
                );
              })}
            </ul>
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
            <span className="text-sm text-muted">Profondeur proposée : la prérogative de chaque palanquée, 40 m au plus. Les 60 m se choisissent à la main.</span>
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
            <ActionButton onClick={copy} icon={copied ? <Check className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}>
              {copied ? 'Copié' : 'Copier'}
            </ActionButton>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {plan.palanquees.map((p, i) => (
              <PalanqueeCard
                key={p.id}
                index={i + 1}
                p={p}
                locked={locked}
                targets={plan.palanquees.filter((x) => x.id !== p.id).map((x) => ({ id: x.id, label: `P${plan.palanquees.indexOf(x) + 1}` }))}
                onMove={(d, target) => onPlan(moveDiver(plan, d, target))}
                onGuide={(id) => onPlan(setGuide(plan, p.id, id))}
                onKind={(k) => onPlan(setKind(plan, p.id, k))}
                onDepth={(d) => onPlan(setDepth(plan, p.id, d))}
              />
            ))}
          </div>

          {(plan.unassigned.length > 0 || notPlaced.length > 0) && !locked && (
            <div className="mt-4 rounded-xl border border-warn/40 bg-warn-soft p-4">
              <p className="font-semibold text-warn flex items-center gap-2 mb-2">
                <UserX className="w-4 h-4" /> Non placés
              </p>
              <ul className="space-y-2">
                {[...plan.unassigned, ...notPlaced.map((diver) => ({ diver, reason: 'Ajouté depuis la génération : à placer ou refaire les palanquées.' }))].map(
                  ({ diver, reason }) => (
                    <li key={diver.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ink">{diver.name}</span>
                      <span className="text-muted">— {reason}</span>
                      <MoveSelect targets={plan.palanquees.map((x, i) => ({ id: x.id, label: `P${i + 1}` }))} onMove={(t) => onPlan(moveDiver(plan, diver, t))} allowUnassign={false} />
                    </li>
                  ),
                )}
              </ul>
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
            Règles du Code du sport (annexes III-14 à III-16, plongée à l’air) : 4 plongeurs encadrés ou élèves au plus par encadrant (+1 GP/N4
            jusqu’à 40 m), 2 à 3 plongeurs majeurs en autonomie, élèves FN# avec un enseignant (E1 6 m, E2 20 m, E3 40 m). Le directeur de plongée
            reste seul juge de la composition finale.
          </p>
        </section>
      )}
    </div>
  );
}

function PalanqueeCard({
  index,
  p,
  locked,
  targets,
  onMove,
  onGuide,
  onKind,
  onDepth,
}: {
  index: number;
  p: Palanquee;
  locked: boolean;
  targets: { id: string; label: string }[];
  onMove: (d: Diver, target: string) => void;
  onGuide: (id: string) => void;
  onKind: (k: PalanqueeKind) => void;
  onDepth: (d: Depth | undefined) => void;
}) {
  const issues = validate(p);
  const legal = depthOf(p);
  const depth = chosenDepth(p);
  const guideRole = p.kind === 'teaching' ? (p.guide?.teach ? `Enseignant E${p.guide.teach}` : 'Enseignant') : p.guide?.guide ? GUIDE_LABEL[p.guide.guide] : 'Encadrant';
  return (
    <article className={`rounded-2xl border-2 p-4 bg-surface ${issues.length ? 'border-danger/50' : 'border-line'}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="flex items-center gap-2 font-semibold text-brand min-w-0">
          <span className="w-7 h-7 shrink-0 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">P{index}</span>
          {locked ? (
            <span className="text-sm">{KIND_LABEL[p.kind]}</span>
          ) : (
            <select
              value={p.kind}
              onChange={(e) => onKind(e.target.value as PalanqueeKind)}
              aria-label="Type de palanquée"
              className="h-8 rounded-lg border border-line bg-surface px-1.5 text-sm font-semibold text-brand"
            >
              {(Object.keys(KIND_LABEL) as PalanqueeKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </h4>
        {locked ? (
          <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${depth ? 'bg-tint text-brand' : 'bg-danger-soft text-danger'}`}>{prerogativeLabel(p)}</span>
        ) : (
          <select
            value={p.depth && p.depth <= legal ? p.depth : ''}
            onChange={(e) => onDepth(e.target.value ? (Number(e.target.value) as Depth) : undefined)}
            aria-label="Profondeur de la palanquée"
            className={`h-8 rounded-full border px-2 text-sm font-semibold ${depth ? 'border-brand/30 bg-tint text-brand' : 'border-danger/40 bg-danger-soft text-danger'}`}
          >
            <option value="">{legal ? `${prerogativeLabel({ ...p, depth: undefined })} (auto)` : 'À revoir'}</option>
            {DEPTHS.filter((d) => d <= legal).map((d) => (
              <option key={d} value={d}>
                {prerogativeLabel({ ...p, depth: d })}
                {d === 60 ? ' · à la main' : ''}
              </option>
            ))}
          </select>
        )}
      </header>

      <ul className="space-y-1.5 text-sm">
        {p.guide && <DiverRow d={p.guide} role={guideRole} strong locked={locked} targets={targets} onMove={onMove} />}
        {p.members.map((m) => (
          <DiverRow
            key={m.id}
            d={m}
            locked={locked}
            targets={targets}
            onMove={onMove}
            onMakeGuide={!locked && p.kind !== 'autonomous' && (p.kind === 'teaching' ? m.teach > 0 : !!m.guide) ? () => onGuide(m.id) : undefined}
          />
        ))}
        {p.extra && <DiverRow d={p.extra} role="GP supplémentaire" locked={locked} targets={targets} onMove={onMove} />}
      </ul>

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-danger">
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
  role,
  strong,
  locked,
  targets,
  onMove,
  onMakeGuide,
}: {
  d: Diver;
  role?: string;
  strong?: boolean;
  locked: boolean;
  targets: { id: string; label: string }[];
  onMove: (d: Diver, target: string) => void;
  onMakeGuide?: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex-1 min-w-0">
        <span className={`block truncate ${strong ? 'font-semibold text-ink' : 'text-ink'}`}>{d.name}</span>
        <span className="block text-xs text-muted truncate">
          {role ?? aptLabel(d)}
          {d.minor ? ' · mineur' : ''}
        </span>
      </span>
      {onMakeGuide && (
        <button type="button" onClick={onMakeGuide} className="text-xs text-brand underline underline-offset-2 shrink-0">
          encadrant
        </button>
      )}
      {!locked && <MoveSelect targets={targets} onMove={(t) => onMove(d, t)} />}
    </li>
  );
}

function MoveSelect({ targets, onMove, allowUnassign = true }: { targets: { id: string; label: string }[]; onMove: (t: string) => void; allowUnassign?: boolean }) {
  return (
    <select value="" onChange={(e) => e.target.value && onMove(e.target.value)} aria-label="Déplacer" className="h-8 shrink-0 rounded-lg border border-line bg-surface px-1.5 text-xs text-muted">
      <option value="">Déplacer…</option>
      {targets.map((t) => (
        <option key={t.id} value={t.id}>
          vers {t.label}
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

function Chip({ children }: { children: ReactNode }) {
  return <span className="px-2 py-0.5 rounded-full bg-raised text-muted text-xs font-medium">{children}</span>;
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
