import { Plus, X } from 'lucide-react';
import type { MemberMatch, RosterEntry } from '../../../services/vpdive';
import { DIVE_ROLES, dayParticipants, toggleRole, type DiveRole, type Roles } from '../../../lib/outing';
import { Avatar } from '../../Avatar';
import { Menu } from '../../Menu';
import { AddMember } from './AddMember';
import { SectionTitle } from '../../SectionTitle';
import { OutingMemberButton } from '../../member/MemberLink';

/**
 * Rôles de la sortie : DP, pilote, sécurité surface. N'importe quel inscrit de la
 * journée, encadrant ou non, qu'il plonge ou non ; un même inscrit peut en cumuler.
 */
export function RolesSection({
  roster,
  roles,
  excluded,
  onRoles,
  onAddMember,
}: {
  roster: RosterEntry[];
  roles: Roles;
  excluded: Set<string>;
  onRoles: (roles: Roles, role: DiveRole) => void;
  onAddMember: (m: MemberMatch, roles: DiveRole[]) => Promise<void>;
}) {
  const people = dayParticipants(roster).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const byId = new Map(roster.map((r) => [r.id, r]));
  return (
    <section>
      <SectionTitle bleed className="mb-4" hint="DP, pilote, sécurité surface">
        Rôles de la sortie
      </SectionTitle>
      <ul className="card border-l-4 border-l-brand divide-y divide-line">
        {DIVE_ROLES.map((role) => {
          const ids = roles[role.id] ?? [];
          return (
            <li key={role.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
              <span className="w-full sm:w-44 shrink-0 font-semibold text-ink">{role.label}</span>
              <span className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                {ids.map((id) => {
                  const person = byId.get(id);
                  const name = person?.name ?? 'Inscrit retiré';
                  return (
                    <span key={id} className="inline-flex max-w-full min-w-0 items-center gap-2 h-9 pl-1 pr-1 rounded-lg border border-field-border bg-tint text-brand font-semibold">
                      <Avatar name={name} picture={person?.picture} size="sm" initials={false} />
                      <span className="truncate">{name}</span>
                      <OutingMemberButton id={id} size="sm" className="-mx-1" />
                      <button
                        type="button"
                        onClick={() => onRoles(toggleRole(roles, role.id, id), role.id)}
                        aria-label={`Retirer ${name} : ${role.label}`}
                        className="icon-btn relative w-7 h-7 rounded-md hover:text-danger hover:bg-danger-soft max-sm:before:absolute max-sm:before:-inset-2"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </span>
                  );
                })}
                <Menu
                  ariaLabel={`${role.label} : choisir`}
                  triggerClassName="btn btn-quiet sm:h-9 text-sm border-dashed"
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
      <AddMember onAdd={onAddMember} onSite={roster.map((r) => r.uct ?? '').filter(Boolean)} />
    </section>
  );
}
