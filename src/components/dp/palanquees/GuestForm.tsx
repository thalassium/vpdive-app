import { useState, type FormEvent } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { newGuest, type Guest } from '../../../lib/outing';
import { ActionButton } from './SectionHead';

/** Ajouter un plongeur qui n'est pas sur VPDive (baptême, invité) : prénom, nom, baptême, commentaire. */
export function GuestForm({ onAdd }: { onAdd: (g: Guest) => void }) {
  const empty = { firstname: '', lastname: '', baptism: false, comment: '' };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const guest = newGuest(form);
  if (!open) {
    return (
      <div className="mt-3">
        <ActionButton onClick={() => setOpen(true)} icon={<UserPlus className="w-4 h-4" />}>
          Plongeur hors VPDive
        </ActionButton>
      </div>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!guest) return;
    onAdd(guest);
    setForm(empty);
    setOpen(false);
  };
  return (
    <form onSubmit={submit} className="mt-3 card p-4 space-y-3">
      <p className="font-semibold text-brand">Plongeur hors VPDive</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="label block mb-1">Prénom</span>
          <input value={form.firstname} onChange={(e) => setForm({ ...form, firstname: e.target.value })} className="field w-full" autoComplete="off" autoFocus />
        </label>
        <label className="block">
          <span className="label block mb-1">Nom</span>
          <input value={form.lastname} onChange={(e) => setForm({ ...form, lastname: e.target.value })} className="field w-full" autoComplete="off" />
        </label>
      </div>
      <label className="inline-flex items-center gap-2.5 max-sm:min-h-11 cursor-pointer">
        <input type="checkbox" checked={form.baptism} onChange={(e) => setForm({ ...form, baptism: e.target.checked })} className="w-5 h-5 accent-[var(--fill)]" />
        <span className="text-ink">Baptême</span>
      </label>
      <label className="block">
        <span className="label block mb-1">Commentaire</span>
        <input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} className="field w-full" placeholder="Niveau, ami de…, matériel…" autoComplete="off" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!guest} className="btn btn-primary sm:h-9 text-sm">
          <Plus className="w-4 h-4" /> Ajouter
        </button>
        <button
          type="button"
          onClick={() => {
            setForm(empty);
            setOpen(false);
          }}
          className="btn btn-quiet sm:h-9 text-sm"
        >
          Annuler
        </button>
        {!form.baptism && guest && <span className="text-sm text-muted">Son aptitude se choisit ensuite dans la liste.</span>}
      </div>
    </form>
  );
}
