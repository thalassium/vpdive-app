import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { AlertTriangle, ChevronDown, ExternalLink, IdCard, Lock, RefreshCw, Search, ShieldCheck, Users } from 'lucide-react';
import { vpdive, isUnavailable, type MemberMatch } from '../services/vpdive';
import { appApi, type AppRole, type Me, type RoleEntry } from '../services/appApi';
import { normalizeName, rankByName } from '../lib/fuzzy';
import { findDuplicates, type DuplicateGroup } from '../lib/duplicates';
import { GabianLoader } from './Gabian';
import { message } from '../lib/errors';
import { sessionCache } from '../lib/cache';
import { Dialog, DialogHeader } from './Dialog';
import { MemberSheetButton } from './member/MemberLink';
import { useMemberSheet } from './member/sheetContext';

interface Props {
  me: Me;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

const VPDIVE_MEMBERS_URL = 'https://septentrion-env.vpdive.com/app/members';
const ROLES_HELP =
  'Admin : menus Gestion de sortie et Admin. Super-admin : peut en plus nommer ou retirer les admins. Les admins VPDive sont admins de l’appli par défaut ; le leur retirer ici ne change rien sur vpdive.com.';
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
  /** Dernière connexion à l'appli (pas à VPDive), par membre. */
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { openMember } = useMemberSheet();
  const canEdit = me.role === 'superadmin';

  /** Annuaire et rôles ; l'état « chargement » est posé par l'appelant (null au départ). `fresh` : sans le cache court de l'annuaire. */
  const fetchAll = useCallback(async (fresh = false) => {
    try {
      const [list, { roles: entries, seen: lastSeen }] = await Promise.all([vpdive.fetchMemberDirectory('assignment', { fresh }), appApi.rolesAndSeen()]);
      setRoles(new Map(entries.map((e) => [e.uct, e])));
      setSeen(lastSeen);
      setMembers(list);
    } catch (e) {
      if (onSessionLost(e)) return;
      setError(message(e));
    }
  }, [onSessionLost]);
  /** Relire (bouton) : on repart de l'état de chargement. */
  const load = () => {
    setError(null);
    setMembers(null);
    void fetchAll(true);
  };

  useEffect(() => {
    // fetchAll ne touche à l'état qu'après la réponse (la règle ne voit pas l'await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const roleOf = useCallback((m: MemberMatch): AppRole => roles.get(m.id)?.role ?? 'member', [roles]);

  const change = async (m: MemberMatch, patch: { admin?: boolean; superAdmin?: boolean }) => {
    setBusy(m.id);
    setRoleError(null);
    try {
      const entries = await appApi.setRole(m.id, patch);
      setRoles(new Map(entries.map((e) => [e.uct, e])));
    } catch (e) {
      if (onSessionLost(e)) return;
      setRoleError(`${m.name} : ${message(e)}`);
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

  // Doublons : homonymes de l'annuaire, puis seulement les comptes au statut « Membre ».
  // Le statut se lit fiche par fiche : seuls les homonymes sont lus (la file du transport les espace), gardés 6 h.
  const candidates = useMemo(() => (members ? findDuplicates(members) : []), [members]);
  /** true : membre ; false : en attente, désinscrit… ; null : fiche illisible (gardé). */
  const [memberOk, setMemberOk] = useState<Record<string, boolean | null>>({});
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const ids = [...new Set(candidates.flatMap((g) => g.members.map((m) => m.id)))];
    if (!ids.length) return;
    let live = true;
    void (async () => {
      setChecking(true);
      for (const id of ids) {
        if (!live) return;
        const cached = memberCache.read(id);
        if (cached !== null) {
          setMemberOk((p) => ({ ...p, [id]: cached }));
          continue;
        }
        try {
          const ok = await vpdive.isClubMember(id, { priority: 'low' });
          memberCache.write(id, ok);
          if (live) setMemberOk((p) => ({ ...p, [id]: ok }));
        } catch (e) {
          if (onSessionLost(e)) return;
          if (live) setMemberOk((p) => ({ ...p, [id]: null }));
          // VPDive ne répond plus (pare-feu, réseau) : les fiches suivantes restent non vérifiées (gardées).
          if (isUnavailable(e)) break;
        }
      }
      if (live) setChecking(false);
    })();
    return () => {
      live = false;
    };
  }, [candidates, onSessionLost]);
  const duplicates = useMemo(
    () => candidates.map((g) => ({ ...g, members: g.members.filter((m) => memberOk[m.id] !== false) })).filter((g) => g.members.length >= 2),
    [candidates, memberOk],
  );

  const adminCount = members?.filter((m) => roleOf(m) !== 'member').length ?? 0;

  return (
    <Dialog label="members" onClose={onClose} titleId="members-title" className="sm:max-w-3xl h-dvh sm:h-[90vh]">
      <DialogHeader
        titleId="members-title"
        kicker="Admin"
        icon={<Users className="w-6 h-6 text-brand" />}
        title="Membres du club"
        onClose={onClose}
        subtitle={
          members && (
            <p className="mt-1 text-sm text-muted">
              {members.length} membres sur VPDive · {adminCount} admin{adminCount > 1 ? 's' : ''} de l’appli
            </p>
          )
        }
      >
        <div className="relative mt-4">
          <Search className="w-4 h-4 text-muted absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un membre…"
            aria-label="Rechercher un membre"
            // Sur téléphone, le clavier ouvert d'office masquerait presque toute la liste.
            autoFocus={!window.matchMedia?.('(pointer: coarse)').matches}
            className="field w-full pl-11 pr-4 text-base"
          />
        </div>
        {canEdit && <p className="hidden sm:block mt-3 text-sm text-muted leading-relaxed">{ROLES_HELP}</p>}
      </DialogHeader>

      {roleError && (
        <div role="alert" className="mx-4 mt-3 p-3 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {roleError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3">
        {!members && !error && <GabianLoader label="Chargement des membres depuis VPDive…" />}
        {error && (
          <div role="alert" className="m-2 p-4 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <span className="font-semibold block">Liste des membres indisponible</span>
              {error}
            </div>
            <button type="button" onClick={load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
              <RefreshCw className="w-4 h-4" /> Réessayer
            </button>
          </div>
        )}
        {/* Sur téléphone, l'aide sur les rôles défile avec la liste au lieu d'alourdir l'en-tête. */}
        {canEdit && <p className="sm:hidden px-1 pb-3 text-sm text-muted leading-relaxed">{ROLES_HELP}</p>}
        {members && !query.trim() && <Duplicates groups={duplicates} checking={checking} />}
        {members && shown.length === 0 && <p className="py-10 text-center text-muted">Aucun membre ne correspond.</p>}
        {groups.map(({ label, list }) =>
          list.length === 0 && label ? null : (
            <section key={label || 'results'}>
              {label && <h3 className="label sticky -top-3 z-10 bg-surface px-3 pt-3 pb-1">{label}</h3>}
              <ul>
                {list.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    entry={roles.get(m.id)}
                    lastSeen={seen[m.id]}
                    isMe={m.id === me.uct}
                    canEdit={canEdit}
                    busy={busy === m.id}
                    onOpen={() => openMember({ uct: m.id, name: m.name, picture: m.picture })}
                    onRole={(patch) => change(m, patch)}
                  />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    </Dialog>
  );
}

/**
 * Doublons possibles de l'annuaire (même nom, ou nom à une faute près), repliés
 * par défaut. La fusion se fait dans VPDive, d'où le lien.
 */
function Duplicates({ groups, checking }: { groups: DuplicateGroup<MemberMatch>[]; checking: boolean }) {
  if (!groups.length) return null;
  return (
    <details className="group card border-l-4 border-l-warn overflow-hidden mx-1 mb-3">
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-raised">
        <AlertTriangle aria-hidden className="w-5 h-5 text-warn shrink-0" />
        <span className="flex-1 text-base font-semibold text-ink">
          Doublons possibles · <span className="tabular-nums">{groups.length}</span>
          {checking && <span className="ml-2 text-sm font-normal text-muted">vérification des statuts…</span>}
        </span>
        <ChevronDown aria-hidden className="w-5 h-5 text-muted shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line">
        <ul className="divide-y divide-line">
          {groups.map((g) => (
            <li key={g.members.map((m) => m.id).join('|')} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <ul className="flex-1 min-w-0 space-y-1.5">
                {g.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 min-w-0 text-base text-ink">
                    <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
                    <span className="truncate">{m.name}</span>
                    <MemberSheetButton member={{ uct: m.id, name: m.name, picture: m.picture }} className="-my-1" />
                  </li>
                ))}
              </ul>
              <span className={`shrink-0 px-2 py-0.5 rounded-lg text-sm font-semibold ${g.reason === 'same' ? 'bg-warn-soft text-warn' : 'bg-raised text-muted'}`}>
                {g.reason === 'same' ? 'même nom' : 'nom proche'}
              </span>
            </li>
          ))}
        </ul>
        <p className="px-4 py-3 border-t border-line text-sm text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex-1 min-w-0">La fusion de deux fiches se fait dans VPDive.</span>
          <a href={VPDIVE_MEMBERS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand underline underline-offset-2">
            Ouvrir dans VPDive <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </p>
      </div>
    </details>
  );
}

/** « le 8 oct. à 14 h 05 », « aujourd'hui à 9 h 12 ». */
function seenLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `aujourd’hui à ${time}`;
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) };
  return `le ${d.toLocaleDateString('fr-FR', opts)} à ${time}`;
}

/** Statut « Membre » d'un compte (fiche par fiche), gardé 6 h dans l'onglet. */
const memberCache = sessionCache('club-member-v2:', 6 * 3600_000, (v): v is boolean => typeof v === 'boolean', { field: 'ok' });

/** Un membre, ses rôles à droite ; la ligne ouvre sa fiche complète (MemberSheet), par-dessus la liste. */
function MemberRow({
  member,
  entry,
  lastSeen,
  isMe,
  canEdit,
  busy,
  onOpen,
  onRole,
}: {
  member: MemberMatch;
  entry: RoleEntry | undefined;
  /** Dernière connexion à l'appli (date ISO) ; absente : jamais vue. */
  lastSeen?: string;
  isMe: boolean;
  canEdit: boolean;
  busy: boolean;
  onOpen: () => void;
  onRole: (patch: { admin?: boolean; superAdmin?: boolean }) => void;
}) {
  const role = entry?.role ?? 'member';
  const locked = !!entry?.lockedSuperAdmin;

  const note = locked
    ? undefined
    : isMe
      ? 'Vous ne pouvez pas retirer vos propres rôles'
      : entry?.revoked
        ? 'Admin VPDive, rôle retiré dans l’appli'
        : entry?.vpdiveAdmin && role === 'admin'
          ? 'Admin VPDive'
          : undefined;

  return (
    <li className={busy ? 'opacity-60' : ''}>
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-raised">
        <button type="button" onClick={onOpen} aria-haspopup="dialog" title={`Fiche de ${member.name}`} className="flex-1 min-w-0 flex items-center gap-3 text-left">
          <Avatar name={member.name} picture={member.picture} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-ink font-medium">
              <span className="truncate">{member.name}</span>
              {isMe && <span className="shrink-0 text-muted font-normal">(vous)</span>}
            </span>
            {note && <span className="block text-sm text-muted truncate">{note}</span>}
            {lastSeen && <span className="block text-xs text-muted">Vu {seenLabel(lastSeen)}</span>}
          </span>
          {/* La ligne ouvre la fiche : la carte d'identité le dit. */}
          <IdCard aria-hidden className="w-4 h-4 text-muted shrink-0" />
        </button>
        {canEdit ? (
          <span className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Switch label="Admin" short="Admin" checked={role !== 'member'} disabled={busy || isMe || locked || role === 'superadmin'} onChange={(v) => onRole({ admin: v })} />
            <Switch label="Super-admin" short="Super" checked={role === 'superadmin'} locked={locked} disabled={busy || isMe || locked} onChange={(v) => onRole({ superAdmin: v })} />
          </span>
        ) : (
          role !== 'member' && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-tint text-brand text-sm font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" /> {role === 'superadmin' ? 'Super-admin' : 'Admin'}
            </span>
          )
        )}
      </div>
    </li>
  );
}

function Switch({
  label,
  short,
  checked,
  disabled,
  locked,
  onChange,
}: {
  label: string;
  /** Libellé court, posé sous l'interrupteur sur téléphone. */
  short: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex flex-col sm:flex-row items-center justify-center max-sm:min-h-11 max-sm:min-w-11 gap-0.5 sm:gap-1.5 text-sm font-semibold text-ink disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/*
        Contraste ≥ 3:1 (WCAG 1.4.11) : rail éteint en field-border (3,6:1 sur blanc), pastille blanche dessus ;
        allumé, rail marine cerclé de brand, visible aussi en thème sombre où le marine de fond est sombre.
      */}
      <span
        className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-fill ring-1 ring-brand' : 'bg-field-border'}`}
        aria-hidden
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
      <span aria-hidden className="sm:hidden inline-flex items-center gap-0.5 text-xs leading-none">
        {short}
        {locked && <Lock className="w-3 h-3 text-muted" />}
      </span>
      <span className="hidden sm:inline">{label}</span>
      {locked && <Lock className="hidden sm:block w-3 h-3 text-muted" />}
    </button>
  );
}
