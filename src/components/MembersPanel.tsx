import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Lock, RefreshCw, Search, ShieldCheck, Users, X } from 'lucide-react';
import { vpdive, type MemberMatch, type MemberProfile } from '../services/vpdiveApi';
import { appApi, type AppRole, type Me, type RoleEntry } from '../services/appApi';
import { normalizeName, rankByName } from '../lib/fuzzy';

interface Props {
  me: Me;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

const roleRank: Record<AppRole, number> = { superadmin: 0, admin: 1, member: 2 };
const byName = (a: MemberMatch, b: MemberMatch) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

/**
 * Membres du club (admin), et rôles dans l'appli : les admins en premier, puis
 * les membres, chacun par ordre alphabétique. Un super-admin y nomme ou retire
 * les admins et les super-admins. Les noms et photos viennent de la recherche
 * VPDive ; le filtre tolère les fautes, comme le choix du binôme.
 */
export function MembersPanel({ me, onClose, onSessionLost }: Props) {
  const [members, setMembers] = useState<MemberMatch[] | null>(null);
  const [roles, setRoles] = useState<Map<string, RoleEntry>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const canEdit = me.role === 'superadmin';

  const load = useCallback(async () => {
    setError(null);
    setMembers(null);
    try {
      const [list, entries] = await Promise.all([vpdive.fetchMemberDirectory(), appApi.roles()]);
      setRoles(new Map(entries.map((e) => [e.uct, e])));
      setMembers(list);
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const roleOf = useCallback((m: MemberMatch): AppRole => roles.get(m.id)?.role ?? 'member', [roles]);

  const change = async (m: MemberMatch, patch: { admin?: boolean; superAdmin?: boolean }) => {
    setBusy(m.id);
    setRoleError(null);
    try {
      const entries = await appApi.setRole(m.id, patch);
      setRoles(new Map(entries.map((e) => [e.uct, e])));
    } catch (e) {
      if (onSessionLost(e)) return;
      setRoleError(`${m.name} : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    if (!members) return [];
    const q = query.trim();
    const sorted = (list: MemberMatch[]) => [...list].sort((a, b) => Math.min(roleRank[roleOf(a)], 1) - Math.min(roleRank[roleOf(b)], 1) || byName(a, b));
    if (!q) return sorted(members);
    // Sous-chaîne exacte d'abord (« dup » → Dupont, Dupuis), puis les noms approchants.
    const exact = members.filter((m) => normalizeName(m.name).includes(normalizeName(q)));
    const close = rankByName(q, members, (m) => m.name, 0.6)
      .map((r) => r.item)
      .filter((m) => !exact.includes(m));
    return [...sorted(exact), ...close];
  }, [members, query, roleOf]);

  // Sans filtre : les admins, puis les membres regroupés par initiale.
  const groups = useMemo(() => {
    if (query.trim()) return [{ label: '', list: shown }];
    const admins = shown.filter((m) => roleOf(m) !== 'member');
    const map = new Map<string, MemberMatch[]>();
    for (const m of shown.filter((x) => roleOf(x) === 'member')) {
      const letter = normalizeName(m.name).charAt(0).toUpperCase() || '#';
      (map.get(letter) ?? map.set(letter, []).get(letter)!).push(m);
    }
    return [{ label: `Admins de l’appli · ${admins.length}`, list: admins }, ...[...map].map(([label, list]) => ({ label, list }))];
  }, [shown, query, roleOf]);

  const adminCount = members?.filter((m) => roleOf(m) !== 'member').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-black/55 backdrop-blur-[3px] animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="members-title" className="relative bg-surface w-full sm:max-w-3xl h-dvh sm:h-[90vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-sheet sm:animate-pop">
        <div className="bg-band text-white px-5 sm:px-6 pt-4 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-pink block mb-1">Admin</span>
              <h2 id="members-title" className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
                <Users className="w-6 h-6 text-pink" /> Membres du club
              </h2>
              {members && (
                <p className="text-sm text-white/75 mt-0.5">
                  {members.length} membres sur VPDive · {adminCount} admin{adminCount > 1 ? 's' : ''} de l’appli
                </p>
              )}
            </div>
            <button onClick={onClose} aria-label="Fermer" className="w-10 h-10 -mr-2 shrink-0 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="relative mt-4">
            <Search className="w-4 h-4 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un membre…"
              aria-label="Rechercher un membre"
              autoFocus
              className="w-full bg-surface text-ink border border-line rounded-full pl-11 pr-4 h-11 text-base placeholder-muted/70 focus:outline-none focus:ring-4 focus:ring-white/20"
            />
          </div>
          {canEdit && (
            <p className="mt-3 text-xs text-white/70 leading-relaxed">
              Admin : accès aux écrans Membres et DP. Super-admin : peut en plus nommer ou retirer les admins. Les admins VPDive sont admins de l’appli
              par défaut ; le leur retirer ici ne change rien sur vpdive.com.
            </p>
          )}
        </div>

        {roleError && (
          <div role="alert" className="mx-4 mt-3 p-3 rounded-xl bg-danger-soft text-danger text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {roleError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
          {!members && !error && <p className="py-10 text-center text-muted">Chargement des membres depuis VPDive…</p>}
          {error && (
            <div role="alert" className="m-2 p-4 rounded-xl bg-danger-soft text-danger text-sm flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <span className="font-semibold block">Liste des membres indisponible</span>
                {error}
              </div>
              <button type="button" onClick={load} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            </div>
          )}
          {members && shown.length === 0 && <p className="py-10 text-center text-muted font-serif italic">Aucun membre ne correspond.</p>}
          {groups.map(({ label, list }) =>
            list.length === 0 && label ? null : (
              <section key={label || 'results'}>
                {label && <h3 className="sticky top-0 z-10 bg-surface/95 backdrop-blur px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted">{label}</h3>}
                <ul>
                  {list.map((m) => (
                    <MemberRow
                      key={m.id}
                      member={m}
                      entry={roles.get(m.id)}
                      isMe={m.id === me.uct}
                      canEdit={canEdit}
                      busy={busy === m.id}
                      open={openId === m.id}
                      onToggle={() => setOpenId(openId === m.id ? null : m.id)}
                      onRole={(patch) => change(m, patch)}
                      onSessionLost={onSessionLost}
                    />
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** Un membre, ses rôles à droite ; ouvert, ses niveaux et qualifications lus dans son profil VPDive. */
function MemberRow({
  member,
  entry,
  isMe,
  canEdit,
  busy,
  open,
  onToggle,
  onRole,
  onSessionLost,
}: {
  member: MemberMatch;
  entry: RoleEntry | undefined;
  isMe: boolean;
  canEdit: boolean;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onRole: (patch: { admin?: boolean; superAdmin?: boolean }) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const role = entry?.role ?? 'member';
  const locked = !!entry?.lockedSuperAdmin;

  useEffect(() => {
    if (!open || profile) return;
    vpdive.memberProfile(member.id).then(setProfile, (e) => {
      if (!onSessionLost(e)) setError(e instanceof Error ? e.message : String(e));
    });
  }, [open, profile, member.id, onSessionLost]);

  const note = locked
    ? 'Super-admin défini dans les réglages Vercel'
    : isMe
      ? 'Vous ne pouvez pas retirer vos propres rôles'
      : entry?.revoked
        ? 'Admin VPDive, rôle retiré dans l’appli'
        : entry?.vpdiveAdmin && role === 'admin'
          ? 'Admin VPDive'
          : undefined;

  return (
    <li className={busy ? 'opacity-60' : ''}>
      <div className={`flex items-center gap-3 px-3 py-2 rounded-xl ${open ? 'bg-tint' : 'hover:bg-raised'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-3 text-left">
          <Avatar member={member} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-ink font-medium truncate">
              {member.name}
              {isMe && <span className="text-muted font-normal">(vous)</span>}
            </span>
            {note && <span className="block text-xs text-muted truncate">{note}</span>}
          </span>
          <ChevronDown className={`w-4 h-4 text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {canEdit ? (
          <span className="flex items-center gap-3 shrink-0">
            <Switch label="Admin" checked={role !== 'member'} disabled={busy || isMe || locked || role === 'superadmin'} onChange={(v) => onRole({ admin: v })} />
            <Switch label="Super-admin" checked={role === 'superadmin'} locked={locked} disabled={busy || isMe || locked} onChange={(v) => onRole({ superAdmin: v })} />
          </span>
        ) : (
          role !== 'member' && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tint text-brand text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" /> {role === 'superadmin' ? 'Super-admin' : 'Admin'}
            </span>
          )
        )}
      </div>
      {open && (
        <div className="ml-14 mr-3 mb-2 mt-1 text-sm space-y-1.5">
          {!profile && !error && <p className="text-muted">Lecture du profil VPDive…</p>}
          {error && <p className="text-danger">{error}</p>}
          {profile && (
            <>
              <Line label="Niveaux" values={profile.levels} />
              <Line label="Enseignement" values={profile.teaching} />
              <Line label="Qualifications" values={profile.qualifications} />
              {profile.medicalUntil && (
                <p className="text-muted">
                  Certificat médical jusqu’au <span className="text-ink">{new Date(profile.medicalUntil).toLocaleDateString('fr-FR')}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Switch({ label, checked, disabled, locked, onChange }: { label: string; checked: boolean; disabled?: boolean; locked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-fill' : 'bg-line'}`} aria-hidden>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
      <span className="hidden sm:inline">{label}</span>
      {locked && <Lock className="w-3 h-3 text-muted" />}
    </button>
  );
}

function Line({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <p className="text-muted">
      {label} : <span className="text-ink">{values.join(' · ')}</span>
    </p>
  );
}

function Avatar({ member }: { member: MemberMatch }) {
  const [broken, setBroken] = useState(false);
  const initials =
    member.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?';
  if (member.picture && !broken) {
    return <img src={member.picture} alt="" loading="lazy" onError={() => setBroken(true)} className="w-9 h-9 rounded-full object-cover shrink-0 bg-tint" />;
  }
  return <span className="w-9 h-9 rounded-full shrink-0 bg-tint text-brand text-xs font-semibold flex items-center justify-center">{initials}</span>;
}
