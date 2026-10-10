import { AlertTriangle, ChevronDown, Star, Trash2 } from 'lucide-react';
import { Menu } from '../../Menu';
import {
  TYPE_LABEL,
  canGuideExploration,
  canTeach,
  depthOf,
  extraLabel,
  guideLabel,
  hasStudent,
  objectiveLabel,
  prerogativeLabel,
  studentsOf,
  trainingLabel,
  typeOf,
  validate,
  type Diver,
  type Palanquee,
  type PalanqueeType,
} from '../../../lib/palanquees';
import { MoveSelect } from './MoveSelect';
import { TYPES, describe, diplomas, ownPrerogative, type Target } from './format';
import { OutingMemberAvatar } from '../../member/MemberLink';

/** Une palanquée : type, encadrant, plongeurs avec leur prérogative, points à corriger. */
export function PalanqueeCard({
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
      <header className={`flex flex-wrap items-center justify-between gap-3 gap-y-1 px-4 py-3 border-b border-line ${issues.length ? 'bg-danger-soft' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          {/* Numéro de palanquée sur un pavillon Alpha : le repère du club */}
          <span className="alpha h-8 shrink-0 pl-2 bg-pink text-on-pink text-sm font-bold tabular-nums inline-flex items-center">P{index}</span>
          <span className="min-w-0">
            {locked || hasStudent(p) ? (
              <span className="block font-semibold text-ink" title={locked ? undefined : 'Un élève en formation (FN#) : palanquée de formation'}>
                {TYPE_LABEL[typeOf(p)]}
              </span>
            ) : (
              <Menu
                ariaLabel="Type de palanquée"
                triggerClassName="btn btn-quiet sm:h-8 px-2.5 text-sm"
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
              className="icon-btn sm:w-9 sm:h-9 hover:text-danger hover:bg-danger-soft"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <span className={`code text-lg shrink-0 ml-auto ${legal ? '' : 'text-danger'}`}>{prerogativeLabel(p)}</span>
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
        {/* Encadrant supplémentaire d'une formation : il assiste, hors effectif. */}
        {p.extra && <DiverRow d={p.extra} own={extraLabel(p.extra, p)} role="Encadrant supplémentaire" locked={locked} targets={targets} onMove={onMove} />}
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
      {g && <OutingMemberAvatar id={g.id} name={g.name} picture={g.picture} size="md" mobile="icon" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
        {editable ? (
          <Menu
            ariaLabel={role}
            triggerClassName={`relative max-w-full inline-flex items-center gap-1 text-left max-sm:before:absolute max-sm:before:-inset-y-2.5 max-sm:before:inset-x-0 ${g ? 'font-semibold text-ink' : teaching ? 'font-semibold text-danger' : 'font-medium text-muted'}`}
            trigger={
              <>
                <span className="break-words line-clamp-2 sm:line-clamp-none sm:truncate">{g ? g.name : teaching ? 'Choisir l’enseignant…' : 'Ajouter un encadrant…'}</span>
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
          <span className={`break-words line-clamp-2 sm:line-clamp-none sm:truncate ${g ? 'font-semibold text-ink' : ''}`}>{g ? g.name : teaching ? 'Aucun enseignant disponible' : 'Sans encadrant'}</span>
        )}
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
  role,
  limiting,
  locked,
  targets,
  onMove,
}: {
  d: Diver;
  own: string;
  /** Rôle écrit avant le niveau, pour qui n'est pas simple plongeur (« Encadrant supplémentaire »). */
  role?: string;
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
      <OutingMemberAvatar id={d.id} name={d.name} picture={d.picture} size="md" mobile="icon" />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="break-words line-clamp-2 sm:line-clamp-none sm:truncate text-ink">{d.name}</span>
        </span>
        <span className="block text-sm text-muted truncate">
          {role && `${role} · `}
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
