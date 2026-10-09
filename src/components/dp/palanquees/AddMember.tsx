import { useState } from 'react';
import { Check, Plus, UserPlus } from 'lucide-react';
import type { MemberMatch } from '../../../services/vpdive';
import { DIVE_ROLES, type DiveRole } from '../../../lib/outing';
import { message } from '../../../lib/errors';
import { Avatar } from '../../Avatar';
import { Spinner } from '../../Spinner';
import { MemberSearch } from '../MemberSearch';
import { ActionButton } from './SectionHead';

/**
 * Ajouter un membre VPDive qui ne s'est pas inscrit (DP, pilote, sécu désignés
 * par le club) : on le cherche par son nom, on coche ses rôles. Il n'est pas
 * inscrit sur VPDive ; s'il s'inscrit ensuite, il prend la place de cet ajout.
 */
export function AddMember({ onAdd, onSite }: { onAdd: (m: MemberMatch, roles: DiveRole[]) => Promise<void>; onSite: string[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<MemberMatch | null>(null);
  const [chosen, setChosen] = useState<DiveRole[]>(['dp']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setPicked(null);
    setChosen(['dp']);
    setError(null);
  };
  if (!open) {
    return (
      <div className="mt-2">
        <ActionButton onClick={() => setOpen(true)} icon={<UserPlus className="w-4 h-4" />} title="Un membre du club qui ne s’est pas inscrit">
          Membre non inscrit
        </ActionButton>
      </div>
    );
  }
  const add = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(picked, chosen);
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 card p-4 space-y-3">
      <p className="font-semibold text-brand">Membre non inscrit</p>
      {picked ? (
        <div className="flex items-center gap-2.5">
          <Avatar name={picked.name} picture={picked.picture} size="sm" initials={false} />
          <span className="flex-1 min-w-0 truncate font-medium text-ink">{picked.name}</span>
          <button type="button" onClick={() => setPicked(null)} className="btn btn-quiet sm:h-8 px-2.5 text-sm">
            Changer
          </button>
        </div>
      ) : (
        <MemberSearch onPick={setPicked} exclude={onSite} />
      )}
      <fieldset>
        <legend className="label mb-1.5">Rôles</legend>
        <div className="flex flex-wrap gap-2">
          {DIVE_ROLES.map((role) => {
            const on = chosen.includes(role.id);
            return (
              <button
                key={role.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChosen((c) => (on ? c.filter((x) => x !== role.id) : [...c, role.id]))}
                className={`btn sm:h-9 text-sm ${on ? 'border border-brand bg-tint text-brand' : 'btn-quiet'}`}
              >
                {on && <Check className="w-4 h-4" />} {role.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <p className="text-sm text-muted">Ajouté à la sortie dans l’appli seulement : il n’est pas inscrit sur VPDive et ne plonge pas tant qu’on ne le coche pas.</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void add()} disabled={!picked || busy} aria-busy={busy} className="btn btn-primary sm:h-9 text-sm">
          {busy ? <Spinner /> : <Plus className="w-4 h-4" />} Ajouter
        </button>
        <button type="button" onClick={close} className="btn btn-quiet sm:h-9 text-sm">
          Annuler
        </button>
      </div>
    </div>
  );
}
