import { ChevronDown, X } from 'lucide-react';
import type { RosterEntry } from '../../services/vpdiveApi';
import { MAX_PER_POST, VOLUNTEER_POSTS, dayParticipants, postsByPerson, setVolunteer, type VolunteerPost, type Volunteers } from '../../lib/outing';
import { Menu } from '../Menu';

interface Props {
  roster: RosterEntry[];
  volunteers: Volunteers;
  onChange: (v: Volunteers) => void;
}

const nameOf = (r: RosterEntry) => `${r.firstname} ${r.lastname}`.trim() || r.name;
const postLabel = (id: VolunteerPost) => VOLUNTEER_POSTS.find((p) => p.id === id)?.label ?? id;

/**
 * Bénévoles de la sortie : qui tient chaque poste (matelotage, détendeurs,
 * eau…), deux personnes au plus par poste, choisies parmi les inscrits
 * de la journée. Une même personne peut tenir plusieurs postes.
 */
export function VolunteersPanel({ roster, volunteers, onChange }: Props) {
  const people = dayParticipants(roster).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fr'));
  const byId = new Map(people.map((r) => [r.id, r]));
  const load = postsByPerson(volunteers);
  const recap = [...load]
    .flatMap(([id, posts]) => {
      const r = byId.get(id);
      return r ? [{ r, posts }] : [];
    })
    .sort((a, b) => nameOf(a.r).localeCompare(nameOf(b.r), 'fr'));

  if (people.length === 0) return <p className="text-muted font-serif italic">Personne n’est encore inscrit à cette sortie.</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Deux personnes au plus par poste, parmi les {people.length} inscrits de la journée. Une même personne peut tenir plusieurs postes.
      </p>

      <ul className="rounded-2xl border border-line divide-y divide-line">
        {VOLUNTEER_POSTS.map((post) => {
          const assigned = volunteers[post.id] ?? [];
          return (
            <li key={post.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="w-44 shrink-0 font-semibold text-ink">{post.label}</span>
              <span className="flex-1 flex flex-wrap items-center gap-2">
                {Array.from({ length: MAX_PER_POST }, (_, slot) => {
                  // La seconde place n'apparaît qu'une fois la première remplie.
                  if (slot > assigned.length) return null;
                  const id = assigned[slot];
                  const person = id ? byId.get(id) : undefined;
                  return (
                    <span key={slot} className="inline-flex items-center">
                      <Menu
                        ariaLabel={`${post.label} : ${slot === 0 ? 'première' : 'seconde'} personne`}
                        triggerClassName={`h-10 min-w-48 inline-flex items-center justify-between gap-2 rounded-lg border px-3 text-base ${
                          id ? 'border-brand/40 bg-tint text-brand font-semibold' : 'border-dashed border-line text-muted hover:border-brand/40'
                        }`}
                        trigger={
                          <>
                            <span className="truncate">{id ? (person ? nameOf(person) : 'Inscrit retiré') : slot === 0 ? 'Choisir…' : 'Ajouter une 2ᵉ personne…'}</span>
                            <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
                          </>
                        }
                        sections={[
                          {
                            selected: id,
                            onSelect: (v) => onChange(setVolunteer(volunteers, post.id, slot, v)),
                            options: people
                              .filter((r) => r.id === id || !assigned.includes(r.id))
                              .map((r) => {
                                // Ce que la personne fait déjà ailleurs, pour répartir les tâches.
                                const elsewhere = (load.get(r.id) ?? []).filter((p) => p !== post.id);
                                return { value: r.id, label: nameOf(r), hint: elsewhere.length ? elsewhere.map(postLabel).join(', ') : undefined };
                              }),
                          },
                        ]}
                      />
                      {id && (
                        <button
                          type="button"
                          onClick={() => onChange(setVolunteer(volunteers, post.id, slot, null))}
                          aria-label={`Retirer ${person ? nameOf(person) : 'cette personne'} de ${post.label}`}
                          className="ml-1 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger-soft"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>

      {recap.length > 0 && (
        <section>
          <h4 className="text-sm font-bold uppercase tracking-wider text-muted mb-2">Qui fait quoi</h4>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-base">
            {recap.map(({ r, posts }) => (
              <li key={r.id} className="flex gap-2">
                <span className="font-medium text-ink">{nameOf(r)}</span>
                <span className="text-muted">{posts.map(postLabel).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
