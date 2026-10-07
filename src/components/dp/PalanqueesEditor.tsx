import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, ClipboardCopy, Lock, Pencil, Plus, ShieldCheck, Sparkles, Star, Trash2, UserX, X } from 'lucide-react';
import type { RosterEntry } from '../../services/vpdiveApi';
import { Avatar } from '../Avatar';
import {
  TYPE_LABEL,
  typeOf,
  trainingLabel,
  trainingTargetOf,
  aptitudesFromLabels,
  canGuideExploration,
  depthOf,
  canTeach,
  extraLabel,
  guideLabel,
  hasStudent,
  isInstructor,
  memberLabel,
  objectiveLabel,
  prerogativeCode,
  studentsOf,
  prerogativeLabel,
  proposePalanquees,
  validate,
  type Diver,
  type Palanquee,
  type PalanqueeKind,
  type PalanqueeType,
  type Plan,
} from '../../lib/palanquees';
import {
  PREROGATIVE_OPTIONS,
  TRAINING_MENU,
  NO_TRAINING,
  addPalanquee,
  assignGuide,
  deletePalanquee,
  buddyPairs,
  moveDiver,
  planToText,
  refreshDivers,
  rosterToDivers,
  setDiverChoice,
  setExtra,
  removeGuide,
  setType,
} from '../../lib/palanqueeEdit';
import { DIVE_ROLES, dayParticipants, defaultRoles, rolesOf, toggleRole, type Dive, type DiveRole, type OutingDoc, type Roles } from '../../lib/outing';
import { Menu } from '../Menu';

interface Props {
  title: string;
  roster: RosterEntry[];
  doc: OutingDoc;
  dive: Dive;
  onSettings: (settings: OutingDoc['settings']) => void;
  /** Rôles de la sortie, et celui qui vient de changer (pour l'en-tête de la fiche). */
  onRoles: (roles: Roles, role: DiveRole) => void;
  onPlan: (plan: Plan) => void;
  onValidate: () => void;
  onReopen: () => void;
}

const TYPES: PalanqueeType[] = ['exploration', 'teaching'];

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
const shownLevel = (d: Diver) => (d.training ? `${trainingLabel(d)} · ${describe(d)}` : describe(d));
const byName = (a: Diver, b: Diver) => a.name.localeCompare(b.name, 'fr');
/** Colonnes Apt. et F# de « Qui plonge ? » : même largeur pour les menus et leurs titres, tout tient sur 375 px. */
const APT_COL = 'w-[5.5rem] sm:w-28 shrink-0 justify-between';
const FN_COL = 'w-[4.25rem] sm:w-24 shrink-0 justify-between';
/** Encadrants du plus haut au plus bas : E4, E3, E2, E1, puis GP. */
const GUIDE_ORDER: Record<string, number> = { E4: 4, E3: 3, GP: 2, E1: 1 };
const byRank = (a: Diver, b: Diver) => b.teach - a.teach || (GUIDE_ORDER[b.guide ?? ''] ?? 0) - (GUIDE_ORDER[a.guide ?? ''] ?? 0) || byName(a, b);

/** Rôles de la sortie de chaque inscrit (DP, pilote, sécurité surface), pour les badges à côté des noms. */
const RolesContext = createContext<Map<string, DiveRole[]>>(new Map());

function RoleBadges({ id }: { id: string }) {
  const mine = useContext(RolesContext).get(id) ?? [];
  return mine.map((role) => (
    <span key={role} className="shrink-0 px-1.5 rounded-md bg-tint text-brand text-sm font-semibold leading-6">
      {DIVE_ROLES.find((r) => r.id === role)!.short}
    </span>
  ));
}

/**
 * Palanquées d'une plongée, en deux temps. 1. Qui plonge : les inscrits avec
 * leur prérogative VPDive (à choisir seulement si elle manque, brevet étranger)
 * et, pour chacun, s'il est en formation ; le DP valide cette liste. 2. Les
 * palanquées : générées ou composées à la main, puis validées, ce qui fige la
 * composition et débloque la fiche de sécurité, où se fixent les profondeurs.
 */
export function PalanqueesEditor({ title, roster, doc, dive, onSettings, onRoles, onPlan, onValidate, onReopen }: Props) {
  const [copied, setCopied] = useState(false);
  const settings = doc.settings;
  const excluded = useMemo(() => new Set(settings.excluded), [settings.excluded]);
  const divers = useMemo(() => rosterToDivers(roster, settings), [roster, settings]);
  const diving = divers.filter((d) => !excluded.has(d.id));
  const locked = !!dive.validated;
  // Tant que ce n'est pas validé, chaque plongeur apparaît avec ses réglages actuels.
  const plan = dive.plan && !locked ? refreshDivers(dive.plan, divers) : dive.plan;
  const roles = useMemo(() => doc.roles ?? defaultRoles(roster), [doc.roles, roster]);
  const roleMap = useMemo(() => new Map(roster.map((r) => [r.id, rolesOf(roles, r.id)])), [roster, roles]);

  const generate = () => {
    if (plan && !window.confirm('Refaire les palanquées ? La composition actuelle sera remplacée.')) return;
    const ids = new Set(diving.map((d) => d.id));
    const buddies = buddyPairs(roster).filter(([a, b]) => ids.has(a) && ids.has(b));
    // Le DP (rôle de la sortie) reste sur le bateau, sauf si sans lui des plongeurs restaient à terre.
    onPlan(proposePalanquees(diving, { buddies, lastResort: roles.dp ?? [] }));
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
  const unknownLevels = diving.filter((d) => !d.pe && !d.beginner && !isInstructor(d) && !d.training);
  // Les sorties enregistrées avant cette étape, avec une composition : la liste est tenue pour validée.
  const rosterOk = settings.confirmed ?? !!dive.plan;
  const setConfirmed = (confirmed: boolean) => onSettings({ ...settings, confirmed });

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
    else if (target.startsWith('extra:')) onPlan(setExtra(plan, target.slice(6), d));
    else onPlan(moveDiver(plan, d, target));
  };
  const targetsFor = (exclude?: string): Target[] =>
    (plan?.palanquees ?? [])
      .map((p, i) => ({ id: p.id, label: `P${i + 1}`, kind: p.kind, students: studentsOf(p), extraOk: p.kind === 'guided' && !p.extra && depthOf(p) <= 40 }))
      .filter((t) => t.id !== exclude);

  /**
   * Une ligne par inscrit : plonge ou pas, nom, rôles, et à droite sa
   * prérogative. Celle de VPDive fait foi ; elle ne se choisit que si elle
   * manque (brevet étranger). Les plongeurs ont en plus le bouton Formation.
   */
  const rosterRow = (d: Diver) => {
    const r = roster.find((x) => x.id === d.id)!;
    const out = excluded.has(d.id);
    const fromVpdive = prerogativeCode(aptitudesFromLabels(r.levels));
    const forcedRaw = settings.levels?.[d.id];
    const forced = forcedRaw ? prerogativeCode(aptitudesFromLabels([forcedRaw])) || forcedRaw : undefined;
    const prerogative = forced ?? fromVpdive;
    const fnChoice = settings.training?.[d.id];
    const fn = fnChoice === NO_TRAINING ? undefined : fnChoice;
    const prepa = aptitudesFromLabels(r.training).training;
    const current = fn ?? (prepa && fnChoice !== NO_TRAINING ? `FN${prepa}` : '');
    const setLevel = (v: string) => onSettings({ ...settings, ...setDiverChoice(settings, 'levels', d.id, v) });
    const setTraining = (v: string) => onSettings({ ...settings, ...setDiverChoice(settings, 'training', d.id, v) });
    // Sous le nom : mineur, liste d'attente, et le niveau tel que VPDive l'écrit (P2, PADI - AOW…).
    const below = [d.minor && 'mineur', r.waitingList && 'liste d’attente', r.display.join(', ')].filter(Boolean).join(' · ');
    const hasRoles = (roleMap.get(d.id)?.length ?? 0) > 0;
    return (
      <li key={d.id} className={`flex items-center gap-1.5 px-3 sm:px-3.5 py-2 ${out ? 'opacity-50' : ''}`}>
        <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={!out}
            onChange={() => onSettings({ ...settings, excluded: out ? settings.excluded.filter((x) => x !== d.id) : [...settings.excluded, d.id] })}
            className="w-5 h-5 accent-[var(--fill)] shrink-0"
          />
          <Avatar name={d.name} picture={d.picture} size="sm" initials={false} className="hidden sm:block" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink leading-snug break-words line-clamp-2 sm:line-clamp-none sm:truncate">{d.name}</span>
            {(hasRoles || below) && (
              <span className="flex items-start gap-1.5 mt-0.5">
                <RoleBadges id={d.id} />
                {below && <span className="min-w-0 text-sm text-muted leading-snug line-clamp-2 sm:truncate">{below}</span>}
              </span>
            )}
          </span>
        </label>
        {/* Apt. : la prérogative VPDive, ou celle retenue par le DP (brevet étranger, N1 porté à PE40…). */}
        <Menu
          ariaLabel={`Aptitude de ${d.name}`}
          triggerClassName={`btn h-9 px-1.5 gap-0.5 text-sm ${APT_COL} ${
            !prerogative ? (out ? 'btn-quiet text-muted' : 'border border-warn bg-warn-soft text-warn') : forced ? 'border border-brand bg-tint text-brand' : 'btn-quiet'
          }`}
          trigger={
            <>
              <span className={`truncate ${prerogative ? 'font-bold tabular-nums' : ''}`}>{prerogative ? prerogative.replace(' · ', '/') : 'Apt. ?'}</span>
              <ChevronDown className="hidden sm:block w-3.5 h-3.5 shrink-0 opacity-60" />
            </>
          }
          sections={[
            // Revenir à VPDive : retire l'aptitude retenue à la main (sans aptitude VPDive, le plongeur redevient « Apt. ? »).
            {
              selected: forcedRaw ? undefined : '',
              onSelect: setLevel,
              options: [{ value: '', label: fromVpdive ? `${fromVpdive.replace(' · ', '/')} (VPDive)` : 'Aucune (retirer)', hint: forcedRaw ? 'annule le choix' : undefined }],
            },
            { title: 'Plongeur', selected: forcedRaw, onSelect: setLevel, options: PREROGATIVE_OPTIONS.divers.map((v) => ({ value: v, label: v })) },
            { title: 'Encadrant', selected: forcedRaw, onSelect: setLevel, options: PREROGATIVE_OPTIONS.instructors.map((v) => ({ value: v, label: v })) },
          ]}
        />
        {/* F# : formation du jour, vers un niveau (FN2) ou une aptitude (FPA20). Un moniteur aussi peut être élève ce jour-là. */}
        <Menu
          ariaLabel={`Formation de ${d.name}`}
          triggerClassName={`btn h-9 px-1.5 gap-0.5 text-sm ${FN_COL} ${current ? 'border border-brand bg-tint text-brand' : 'btn-quiet text-muted'}`}
          trigger={
            <>
              <span className={`truncate ${current ? 'font-bold tabular-nums' : ''}`}>{current || '—'}</span>
              <ChevronDown className="hidden sm:block w-3.5 h-3.5 shrink-0 opacity-60" />
            </>
          }
          sections={[
            {
              selected: current ? undefined : fnChoice === NO_TRAINING ? NO_TRAINING : '',
              onSelect: setTraining,
              options: prepa ? [{ value: NO_TRAINING, label: 'Pas en formation' }, { value: '', label: `Prépa N${prepa}`, hint: 'VPDive' }] : [{ value: '', label: 'Pas en formation' }],
            },
            ...TRAINING_MENU.map((group) => ({
              title: group.title,
              selected: current,
              onSelect: setTraining,
              options: group.options.filter((o) => o.value !== `FN${prepa}`).map((o) => ({ value: o.value, label: o.label })),
            })),
          ]}
        />
      </li>
    );
  };

  return (
    <RolesContext.Provider value={roleMap}>
    <div className="space-y-7">
      {locked && (
        <div className="p-4 rounded-xl bg-ok-soft text-ok flex flex-wrap items-center gap-3">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          <p className="flex-1 min-w-0 text-sm">
            <strong className="font-semibold">Palanquées validées</strong> par {dive.validated!.by} le{' '}
            {new Date(dive.validated!.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}. La fiche de sécurité est débloquée.
          </p>
          <button type="button" onClick={onReopen} className="btn btn-quiet h-9 text-sm border-green/50 text-ok">
            <Pencil className="w-4 h-4" /> Modifier les palanquées
          </button>
        </div>
      )}

      <RolesSection roster={roster} roles={roles} excluded={excluded} onRoles={onRoles} />

      {/* 1. Qui plonge : encadrants du plus haut au plus bas, puis plongeurs ; validé par le DP avant les palanquées */}
      {!locked && !rosterOk && (
        <section>
          <Heading n={1} hint={`${diving.length} à l’eau sur ${roster.length} inscrit${roster.length > 1 ? 's' : ''}`}>
            Qui plonge ?
          </Heading>
          {roster.length === 0 ? (
            <p className="text-muted">Personne n’est encore inscrit à cette sortie.</p>
          ) : (
            <div className="space-y-4">
              <RosterGroup title="Encadrants" count={divers.filter(isInstructor).length}>
                {divers.filter(isInstructor).sort(byRank).map(rosterRow)}
              </RosterGroup>
              <RosterGroup title="Plongeurs" count={divers.filter((d) => !isInstructor(d)).length}>
                {divers.filter((d) => !isInstructor(d)).sort(byName).map(rosterRow)}
              </RosterGroup>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirmed(true)}
              disabled={diving.length === 0 || unknownLevels.length > 0}
              className="btn btn-primary h-11"
            >
              <Check className="w-4 h-4" /> Valider les plongeurs
            </button>
            {unknownLevels.length > 0 && (
              <span className="text-sm text-warn inline-flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Prérogative à choisir : {unknownLevels.map((d) => d.name).join(', ')}
              </span>
            )}
          </div>
        </section>
      )}

      {!locked && rosterOk && (
        <section>
          <Heading n={1} hint={`${diving.filter((d) => isInstructor(d) && !d.training).length} encadrant${diving.filter((d) => isInstructor(d) && !d.training).length > 1 ? 's' : ''} · ${diving.filter((d) => d.training).length} en formation`}>
            {diving.length} à l’eau
          </Heading>
          <ActionButton onClick={() => setConfirmed(false)} icon={<Pencil className="w-4 h-4" />}>
            Modifier les plongeurs
          </ActionButton>
        </section>
      )}

      {/* 2. Palanquées : générées ou composées, puis validées */}
      {!locked && rosterOk && !plan && (
        <section>
          <Heading n={2}>Palanquées</Heading>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generate}
              className="btn btn-primary h-11"
            >
              <Sparkles className="w-4 h-4" /> Générer les palanquées
            </button>
            <button
              type="button"
              onClick={() => onPlan(addPalanquee(null, diving))}
              className="btn btn-quiet h-9 text-sm"
            >
              <Plus className="w-4 h-4" /> Composer à la main
            </button>
          </div>
        </section>
      )}

      {plan && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            {locked ? (
              <h3 className="text-lg font-semibold text-brand">
                {plan.palanquees.length} palanquée{plan.palanquees.length > 1 ? 's' : ''}
              </h3>
            ) : (
              <Heading n={2} hint={`${plan.palanquees.length} palanquée${plan.palanquees.length > 1 ? 's' : ''}`}>
                Palanquées
              </Heading>
            )}
            <div className="flex items-center gap-2">
              {!locked && (
                <ActionButton onClick={generate} icon={<Sparkles className="w-4 h-4" />}>
                  Refaire
                </ActionButton>
              )}
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
                onType={(t) => onPlan(setType(plan, p.id, t))}
                onRemoveGuide={() => onPlan(removeGuide(plan, p.id))}
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
                onClick={() => {
                  // On fige la composition telle qu’elle s’affiche (réglages à jour), pour la fiche de sécurité.
                  onPlan(plan);
                  onValidate();
                }}
                disabled={issues.length > 0 || plan.palanquees.length === 0}
                className="btn btn-primary h-11"
              >
                <Lock className="w-4 h-4" /> Valider les palanquées
              </button>
              <span className="text-sm text-muted">
                {issues.length > 0 ? `${issues.length} point${issues.length > 1 ? 's' : ''} à corriger avant de valider.` : 'La validation débloque la fiche de sécurité.'}
              </span>
            </div>
          )}

        </section>
      )}
    </div>
    </RolesContext.Provider>
  );
}

/**
 * Rôles de la sortie : DP, pilote, sécurité surface. N'importe quel inscrit de la
 * journée, encadrant ou non, qu'il plonge ou non ; un même inscrit peut en cumuler.
 */
function RolesSection({ roster, roles, excluded, onRoles }: { roster: RosterEntry[]; roles: Roles; excluded: Set<string>; onRoles: (roles: Roles, role: DiveRole) => void }) {
  const people = dayParticipants(roster).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const byId = new Map(roster.map((r) => [r.id, r]));
  return (
    <section>
      <h3 className="text-lg font-semibold text-brand mb-2">Rôles de la sortie</h3>
      <ul className="card divide-y divide-line">
        {DIVE_ROLES.map((role) => {
          const ids = roles[role.id] ?? [];
          return (
            <li key={role.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
              <span className="w-full sm:w-44 shrink-0 font-semibold text-ink">{role.label}</span>
              <span className="flex-1 flex flex-wrap items-center gap-2">
                {ids.map((id) => {
                  const person = byId.get(id);
                  const name = person?.name ?? 'Inscrit retiré';
                  return (
                    <span key={id} className="inline-flex items-center gap-2 h-9 pl-1 pr-1 rounded-lg border border-field-border bg-tint text-brand font-semibold">
                      <Avatar name={name} picture={person?.picture} size="sm" initials={false} />
                      {name}
                      <button
                        type="button"
                        onClick={() => onRoles(toggleRole(roles, role.id, id), role.id)}
                        aria-label={`Retirer ${name} : ${role.label}`}
                        className="icon-btn w-7 h-7 rounded-md hover:text-danger hover:bg-danger-soft"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </span>
                  );
                })}
                <Menu
                  ariaLabel={`${role.label} : choisir`}
                  triggerClassName="btn btn-quiet h-9 text-sm border-dashed"
                  trigger={
                    <>
                      <Plus className="w-4 h-4" />
                      {ids.length ? 'Ajouter' : 'Choisir…'}
                    </>
                  }
                  sections={[
                    {
                      onSelect: (id) => onRoles(toggleRole(roles, role.id, id), role.id),
                      options: people
                        .filter((r) => !ids.includes(r.id))
                        .map((r) => ({ value: r.id, label: r.name, hint: excluded.has(r.id) ? 'ne plonge pas' : undefined })),
                    },
                  ]}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RosterGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div>
      {/* Titres de colonne alignés sur les menus (même largeur, même retrait que les lignes). */}
      <div className="flex items-end gap-1.5 mb-2 pr-[calc(0.75rem+1px)] sm:pr-[calc(0.875rem+1px)]">
        <h4 className="label flex-1">
          {title} <span className="font-normal">· {count}</span>
        </h4>
        {count > 0 && (
          <>
            <span className={`label text-center ${APT_COL}`}>Apt.</span>
            <span className={`label text-center ${FN_COL}`}>F#</span>
          </>
        )}
      </div>
      {count ? <ul className="card divide-y divide-line">{children}</ul> : <p className="text-sm text-muted">Aucun.</p>}
    </div>
  );
}

/**
 * Pastille d'un plongeur dans cette palanquée : l'étiquette commune à l'écran,
 * la fiche et l'export (memberLabel), et sa profondeur propre, pour signaler
 * celui qui limite la palanquée.
 */
function ownPrerogative(d: Diver, p: Palanquee): { label: string; depth: number } {
  const depth = p.kind === 'autonomous' ? d.pa : p.kind === 'teaching' && d.training ? trainingTargetOf(d) : d.pe || (d.beginner ? 6 : 0);
  return { label: memberLabel(d, p), depth };
}

function PalanqueeCard({
  index,
  p,
  locked,
  instructors,
  targets,
  onMove,
  onGuide,
  onType,
  onRemoveGuide,
  onDelete,
}: {
  index: number;
  p: Palanquee;
  locked: boolean;
  instructors: Diver[];
  targets: Target[];
  onMove: (d: Diver, target: string) => void;
  onGuide: (d: Diver) => void;
  onType: (t: PalanqueeType) => void;
  onRemoveGuide: () => void;
  onDelete: () => void;
}) {
  const issues = validate(p);
  const legal = depthOf(p);
  // Qui peut prendre la tête de cette palanquée : un élève (FN#) jamais ; en formation un enseignant qui suffit à ses élèves ; en exploration un N4/GP au moins.
  const eligible = instructors.filter((d) => !d.training && (p.kind === 'teaching' ? canTeach(d, studentsOf(p)) : canGuideExploration(d)));

  return (
    <article className={`card border-l-4 overflow-hidden ${issues.length ? 'border-l-danger' : 'border-l-brand'}`}>
      {/* En-tête : numéro, type, prérogative en code */}
      <header className={`flex items-center justify-between gap-3 px-4 py-3 border-b border-line ${issues.length ? 'bg-danger-soft' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">P{index}</span>
          <span className="min-w-0">
            {locked || hasStudent(p) ? (
              <span className="block font-semibold text-ink" title={locked ? undefined : 'Un élève en formation (FN#) : palanquée de formation'}>
                {TYPE_LABEL[typeOf(p)]}
              </span>
            ) : (
              <Menu
                ariaLabel="Type de palanquée"
                triggerClassName="btn btn-quiet h-8 px-2.5 text-sm"
                trigger={
                  <>
                    {TYPE_LABEL[typeOf(p)]}
                    <ChevronDown className="w-4 h-4 opacity-70" />
                  </>
                }
                sections={[{ selected: typeOf(p), onSelect: (v) => onType(v as PalanqueeType), options: TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })) }]}
              />
            )}
            {/* Exploration : encadrée ou autonome. Formation : l'objectif (ce que les élèves préparent), s'il y en a un. */}
            {p.kind !== 'teaching' ? (
              <span className="block text-sm text-muted">{p.guide ? 'Encadrée' : 'Autonome'}</span>
            ) : (
              objectiveLabel(p) && <span className="block text-sm text-muted">Objectif {objectiveLabel(p)}</span>
            )}
          </span>
          {!locked && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Supprimer P${index}`}
              title="Supprimer la palanquée (ses participants redeviennent disponibles)"
              className="icon-btn w-9 h-9 hover:text-danger hover:bg-danger-soft"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className={`code text-lg shrink-0 ${legal ? '' : 'text-danger'}`}>{prerogativeLabel(p)}</span>
      </header>

      {/* Plongeurs, avec leur prérogative ; celui qui fixe celle de la palanquée est signalé */}
      <ul className="px-4 pt-3 pb-3 space-y-2.5 text-base">
        <GuideRow p={p} eligible={eligible} locked={locked} targets={targets} onMove={onMove} onGuide={onGuide} onRemove={onRemoveGuide} />
        {p.members.map((m) => {
          const own = ownPrerogative(m, p);
          // Signalé seulement s'il fait descendre la palanquée : un autre plongeur aurait pu aller plus loin.
          const depths = p.members.map((x) => ownPrerogative(x, p).depth);
          const floor = Math.min(...depths);
          const limiting = own.depth === floor && depths.some((x) => x > floor);
          return (
            <DiverRow key={m.id} d={m} own={own.label} limiting={limiting} locked={locked} targets={targets} onMove={onMove} />
          );
        })}
        {p.extra && <DiverRow d={p.extra} own={extraLabel(p)} locked={locked} targets={targets} onMove={onMove} />}
        {p.members.length === 0 && <li className="text-muted">Aucun plongeur.</li>}
      </ul>

      {issues.length > 0 && (
        <ul className="px-4 pb-3.5 space-y-1.5 text-sm text-danger">
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
 * VPDive. Cliquer sur le nom ouvre la liste des encadrants possibles. En
 * exploration sans encadrant, la ligne propose d'en ajouter un : la palanquée
 * passe alors d'autonome à encadrée.
 */
function GuideRow({
  p,
  eligible,
  locked,
  targets,
  onMove,
  onGuide,
  onRemove,
}: {
  p: Palanquee;
  eligible: Diver[];
  locked: boolean;
  targets: Target[];
  onMove: (d: Diver, target: string) => void;
  onGuide: (d: Diver) => void;
  onRemove: () => void;
}) {
  const g = p.guide;
  const teaching = p.kind === 'teaching';
  const role = teaching ? 'Enseignant' : 'Encadrant';
  const editable = !locked && eligible.length > 0;
  if (!g && !teaching && locked) return null;
  // Formation sans enseignant : à corriger. Exploration sans encadrant : simplement autonome.
  const missingTone = teaching ? 'border border-dashed border-danger/50 text-danger' : 'border border-dashed border-field-border text-muted';
  return (
    <li className={`-mx-2 px-2 py-1.5 rounded-lg flex items-center gap-2 ${g ? 'bg-raised border border-line' : missingTone}`}>
      <span className={`chip min-w-16 ${g ? 'text-brand' : teaching ? 'bg-danger-soft text-danger' : 'text-muted'}`}>
        <Star className={`w-3 h-3 text-pink ${g ? 'fill-current' : ''}`} />
        {g ? guideLabel(g, p) : role}
      </span>
      {g && <Avatar name={g.name} picture={g.picture} size="sm" initials={false} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
        {editable ? (
          <Menu
            ariaLabel={role}
            triggerClassName={`max-w-full inline-flex items-center gap-1 text-left ${g ? 'font-semibold text-ink' : teaching ? 'font-semibold text-danger' : 'font-medium text-muted'}`}
            trigger={
              <>
                <span className="truncate">{g ? g.name : teaching ? 'Choisir l’enseignant…' : 'Ajouter un encadrant…'}</span>
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
          <span className={`block truncate ${g ? 'font-semibold text-ink' : ''}`}>{g ? g.name : teaching ? 'Aucun enseignant disponible' : 'Sans encadrant'}</span>
        )}
        {g && <RoleBadges id={g.id} />}
        </div>
        <span className="block text-sm text-muted truncate">
          {g ? role : teaching ? 'Enseignant à choisir' : 'Plongeurs autonomes'}
          {g && diplomas(g).length > 0 && ` · ${diplomas(g).join(' · ')}`}
        </span>
      </div>
      {g && !locked && (
        <MoveSelect targets={targets} onMove={(t) => (t === 'unassigned' ? onRemove() : onMove(g, t))} diver={g} unassignLabel={teaching ? 'Retirer l’enseignant' : 'Retirer l’encadrant (autonome)'} />
      )}
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
  const chipCls = `chip min-w-16 ${limiting ? 'bg-warn-soft text-warn' : 'text-brand'}`;
  return (
    <li className="flex items-center gap-2">
      <span className={chipCls} title={limiting ? 'Fixe la prérogative de la palanquée' : undefined}>
        {own}
      </span>
      <Avatar name={d.name} picture={d.picture} size="sm" initials={false} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-ink">{d.name}</span>
          <RoleBadges id={d.id} />
        </span>
        <span className="block text-sm text-muted truncate">
          {d.training ? `en formation ${trainingLabel(d)} · ${describe(d)}` : describe(d)}
          {d.original && <span title="Le DP a retenu un équivalent FFESSM"> · équivalent retenu</span>}
          {d.minor ? ' · mineur' : ''}
          {limiting ? ' · fixe la prérogative' : ''}
        </span>
      </span>
      {!locked && <MoveSelect targets={targets} onMove={(t) => onMove(d, t)} diver={d} />}
    </li>
  );
}

function FreeList({ title, items, targets, onMove, instructor }: { title: string; items: Plan['unassigned']; targets: Target[]; onMove: (d: Diver, t: string) => void; instructor?: boolean }) {
  return (
    <div className={instructor ? 'card p-4' : 'rounded-xl border border-warn/40 bg-warn-soft p-4'}>
      <p className={`font-semibold flex items-center gap-2 mb-2 ${instructor ? 'text-brand' : 'text-warn'}`}>
        {instructor ? <Star className="w-4 h-4" /> : <UserX className="w-4 h-4" />} {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Aucun.</p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ diver, reason }) => (
            <li key={diver.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
              <Avatar name={diver.name} picture={diver.picture} size="sm" initials={false} />
              <span className="font-medium text-ink">{diver.name}</span>
              <RoleBadges id={diver.id} />
              <span className="text-sm text-muted">{shownLevel(diver)}</span>
              <span className="basis-full text-sm text-muted">{reason}</span>
              <MoveSelect targets={targets} onMove={(t) => onMove(diver, t)} diver={diver} allowUnassign={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Une palanquée cible du menu Déplacer : ses élèves (pour savoir qui peut l'enseigner) et si elle accepte un plongeur supplémentaire. */
type Target = { id: string; label: string; kind: PalanqueeKind; students: Diver[]; extraOk: boolean };

/**
 * Déplacer vers une palanquée : comme plongeur ; comme enseignant ou encadrant
 * si le plongeur peut l'être de cette palanquée-là (jamais un élève ; en
 * formation un enseignant qui suffit, en exploration un N4/GP au moins) ;
 * comme plongeur supplémentaire d'une exploration encadrée ≤ 40 m pour un
 * GP/N4 ; vers une nouvelle palanquée ; ou retirer.
 */
function MoveSelect({
  targets,
  onMove,
  diver,
  allowUnassign = true,
  unassignLabel = 'Retirer de la palanquée',
}: {
  targets: Target[];
  onMove: (t: string) => void;
  diver: Diver;
  allowUnassign?: boolean;
  unassignLabel?: string;
}) {
  const instructor = isInstructor(diver);
  const asGuide = diver.training ? [] : targets.filter((t) => (t.kind === 'teaching' ? canTeach(diver, t.students) : canGuideExploration(diver)));
  const asExtra = diver.canBeExtra && !diver.training ? targets.filter((t) => t.extraOk) : [];
  return (
    <Menu
      ariaLabel="Déplacer"
      triggerClassName="btn btn-quiet h-9 text-sm shrink-0 px-2 sm:px-2.5 gap-1"
      trigger={
        <>
          {/* Sur téléphone, l'icône seule : la place va au nom. */}
          <ArrowLeftRight className="w-4 h-4 sm:hidden" />
          <span className="hidden sm:inline">Déplacer</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </>
      }
      sections={[
        ...(asGuide.length
          ? [{ title: 'Comme encadrant', onSelect: onMove, options: asGuide.map((t) => ({ value: `guide:${t.id}`, label: `${t.kind === 'teaching' ? 'Enseignant' : 'Encadrant'} de ${t.label}` })) }]
          : []),
        ...(asExtra.length
          ? [{ title: 'Comme plongeur supplémentaire', onSelect: onMove, options: asExtra.map((t) => ({ value: `extra:${t.id}`, label: `GP suppl. de ${t.label}`, hint: '≤ 40 m' })) }]
          : []),
        {
          title: instructor ? 'Comme plongeur' : undefined,
          onSelect: onMove,
          options: [
            ...targets.map((t) => ({ value: t.id, label: instructor ? `Plongeur dans ${t.label}` : `Vers ${t.label}`, hint: t.kind === 'teaching' ? 'Formation' : t.kind === 'guided' ? 'Exploration encadrée' : 'Exploration autonome' })),
            { value: 'new', label: 'Nouvelle palanquée' },
            ...(allowUnassign ? [{ value: 'unassigned', label: unassignLabel }] : []),
          ],
        },
      ]}
    />
  );
}

export function Heading({ n, hint, children }: { n: number; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-brand">
        <span className="w-6 h-6 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">{n}</span>
        {children}
      </h3>
      {hint && <span className="text-sm text-muted text-right">{hint}</span>}
    </div>
  );
}

export function ActionButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-quiet h-9 text-sm"
    >
      {icon}
      {children}
    </button>
  );
}
