import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Lock, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { appApi, type AppUser, type Me } from '../services/appApi';

interface Props {
  me: Me;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

/**
 * Super-admin : qui est admin ou super-admin dans l'appli. La liste est celle
 * des personnes qui se sont déjà connectées à l'appli. Retirer le rôle admin
 * ici ne touche pas à VPDive : la personne garde ses droits sur vpdive.com.
 */
export function RolesPanel({ me, onClose, onSessionLost }: Props) {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setUsers(await appApi.users());
    } catch (e) {
      if (onSessionLost(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = async (u: AppUser, patch: { admin?: boolean; superAdmin?: boolean }) => {
    setBusy(u.id);
    setError(null);
    try {
      await appApi.setRole(u.id, patch);
      setUsers(await appApi.users());
    } catch (e) {
      if (onSessionLost(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const admins = users?.filter((u) => u.vpdiveAdmin || u.role !== 'member') ?? [];
  const others = users?.filter((u) => !u.vpdiveAdmin && u.role === 'member') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-black/55 backdrop-blur-[3px] animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="roles-title" className="relative bg-surface w-full sm:max-w-2xl h-dvh sm:h-auto sm:max-h-[88vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-sheet sm:animate-pop">
        <div className="bg-band text-white px-5 sm:px-6 py-4 shrink-0 flex items-start gap-3">
          <div className="flex-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-pink block mb-1">Super-admin</span>
            <h2 id="roles-title" className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-pink" /> Rôles dans l’appli
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="w-10 h-10 -mr-2 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          <p className="text-sm text-muted leading-relaxed">
            Les admins de VPDive sont admins de l’appli, sauf si vous leur retirez ce rôle ici. Cela ne change rien sur vpdive.com. Une personne
            apparaît dans la liste après s’être connectée une première fois à l’appli.
          </p>
          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-danger-soft text-danger text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              <button onClick={load} className="ml-auto inline-flex items-center gap-1 font-semibold underline">
                <RefreshCw className="w-4 h-4" /> Recharger
              </button>
            </div>
          )}
          {!users && !error && <p className="text-muted">Chargement…</p>}

          {users && (
            <>
              <UserTable title="Admins VPDive et rôles de l’appli" users={admins} me={me} busy={busy} onChange={change} />
              {others.length > 0 && <UserTable title="Autres personnes connectées" users={others} me={me} busy={busy} onChange={change} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UserTable({
  title,
  users,
  me,
  busy,
  onChange,
}: {
  title: string;
  users: AppUser[];
  me: Me;
  busy: number | null;
  onChange: (u: AppUser, patch: { admin?: boolean; superAdmin?: boolean }) => void;
}) {
  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wider text-muted mb-2">{title}</h3>
      <ul className="rounded-xl border border-line divide-y divide-line">
        {users.map((u) => {
          const isSuper = u.role === 'superadmin';
          const isAdmin = u.role !== 'member';
          return (
            <li key={u.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${busy === u.id ? 'opacity-60' : ''}`}>
              <span className="flex-1 min-w-48">
                <span className="block font-medium text-ink">
                  {u.name || u.email}
                  {u.id === me.id && <span className="text-muted font-normal"> (vous)</span>}
                </span>
                <span className="block text-xs text-muted">
                  {u.email}
                  {u.vpdiveAdmin ? ' · admin VPDive' : ''}
                  {u.revoked ? ' · rôle admin retiré dans l’appli' : ''}
                </span>
              </span>
              <Toggle
                label="Admin"
                checked={isAdmin}
                disabled={busy !== null || isSuper || (!u.vpdiveAdmin && !isAdmin)}
                hint={isSuper ? 'Un super-admin est toujours admin' : !u.vpdiveAdmin ? 'Seuls les admins VPDive peuvent être admins (droits sur les membres)' : undefined}
                onChange={(v) => onChange(u, { admin: v })}
              />
              <Toggle
                label="Super-admin"
                checked={isSuper}
                locked={u.lockedSuperAdmin}
                disabled={busy !== null || u.lockedSuperAdmin || u.id === me.id}
                hint={u.lockedSuperAdmin ? 'Défini dans les réglages Vercel (SUPER_ADMIN_EMAILS)' : u.id === me.id ? 'Vous ne pouvez pas retirer votre propre rôle' : undefined}
                onChange={(v) => onChange(u, { superAdmin: v })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Toggle({ label, checked, disabled, locked, hint, onChange }: { label: string; checked: boolean; disabled?: boolean; locked?: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={hint}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm font-medium text-ink disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-fill' : 'bg-line'}`} aria-hidden>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
      {label}
      {locked && <Lock className="w-3.5 h-3.5 text-muted" />}
    </button>
  );
}
