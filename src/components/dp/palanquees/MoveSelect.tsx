import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import { Menu } from '../../Menu';
import { canGuideExploration, canTeach, isInstructor, type Diver } from '../../../lib/palanquees';
import type { Target } from './format';

/**
 * Déplacer vers une palanquée : comme plongeur ; comme enseignant ou encadrant
 * si le plongeur peut l'être de cette palanquée-là (jamais un élève ; en
 * formation un enseignant qui suffit, en exploration un N4/GP au moins) ;
 * comme plongeur supplémentaire d'une exploration encadrée ≤ 40 m pour un
 * GP/N4 ; vers une nouvelle palanquée ; ou retirer.
 */
export function MoveSelect({
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
      triggerClassName="btn btn-quiet sm:h-9 text-sm shrink-0 px-2 sm:px-2.5 gap-1"
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
