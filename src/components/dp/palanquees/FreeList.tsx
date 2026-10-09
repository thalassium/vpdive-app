import { Star, UserX } from 'lucide-react';
import type { Diver, Plan } from '../../../lib/palanquees';
import { MoveSelect } from './MoveSelect';
import { RoleBadges } from './RoleBadges';
import { shownLevel, type Target } from './format';
import { OutingMemberAvatar } from '../../member/MemberLink';

/** Encadrants disponibles, ou plongeurs non placés : à déplacer dans une palanquée. */
export function FreeList({ title, items, targets, onMove, instructor }: { title: string; items: Plan['unassigned']; targets: Target[]; onMove: (d: Diver, t: string) => void; instructor?: boolean }) {
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
              <OutingMemberAvatar id={diver.id} name={diver.name} picture={diver.picture} size="md" />
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
