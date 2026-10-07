import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, Search, Users, X } from 'lucide-react';
import { vpdive, type MemberMatch, type MemberProfile } from '../services/vpdiveApi';
import { normalizeName, rankByName } from '../lib/fuzzy';

interface Props {
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

/**
 * Annuaire des membres du club (admin). Les noms et photos viennent de la
 * recherche VPDive ; le filtre tolère les fautes, comme le choix du binôme.
 */
export function MembersPanel({ onClose, onSessionLost }: Props) {
  const [members, setMembers] = useState<MemberMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setMembers(null);
    try {
      setMembers(await vpdive.fetchMemberDirectory());
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

  const shown = useMemo(() => {
    if (!members) return [];
    const q = query.trim();
    if (!q) return members;
    // Sous-chaîne exacte d'abord (« dup » → Dupont, Dupuis), puis les noms approchants.
    const exact = members.filter((m) => normalizeName(m.name).includes(normalizeName(q)));
    const close = rankByName(q, members, (m) => m.name, 0.6)
      .map((r) => r.item)
      .filter((m) => !exact.includes(m));
    return [...exact, ...close];
  }, [members, query]);

  // Regroupement par initiale tant qu'on ne filtre pas, pour se repérer dans une longue liste.
  const groups = useMemo(() => {
    if (query.trim()) return [{ letter: '', list: shown }];
    const map = new Map<string, MemberMatch[]>();
    for (const m of shown) {
      const letter = normalizeName(m.name).charAt(0).toUpperCase() || '#';
      (map.get(letter) ?? map.set(letter, []).get(letter)!).push(m);
    }
    return [...map].map(([letter, list]) => ({ letter, list }));
  }, [shown, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-black/55 backdrop-blur-[3px] animate-fade"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="members-title"
        className="relative bg-surface w-full sm:max-w-2xl h-dvh sm:h-[88vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        <div className="bg-band text-white px-5 sm:px-6 pt-4 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-pink block mb-1">Admin</span>
              <h2 id="members-title" className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
                <Users className="w-6 h-6 text-pink" /> Membres du club
              </h2>
              {members && <p className="text-sm text-white/75 mt-0.5">{members.length} membres sur VPDive</p>}
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
        </div>

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
          {groups.map(({ letter, list }) => (
            <section key={letter || 'results'}>
              {letter && <h3 className="sticky top-0 z-10 bg-surface/95 backdrop-blur px-3 pt-3 pb-1 text-xs font-bold text-muted">{letter}</h3>}
              <ul>
                {list.map((m) => (
                  <MemberRow key={m.id} member={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} onSessionLost={onSessionLost} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Un membre ; ouvert, ses niveaux et qualifications lus dans son profil VPDive. */
function MemberRow({ member, open, onToggle, onSessionLost }: { member: MemberMatch; open: boolean; onToggle: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || profile) return;
    vpdive.memberProfile(member.id).then(setProfile, (e) => {
      if (!onSessionLost(e)) setError(e instanceof Error ? e.message : String(e));
    });
  }, [open, profile, member.id, onSessionLost]);

  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left ${open ? 'bg-tint' : 'hover:bg-raised'}`}>
        <Avatar member={member} />
        <span className="flex-1 text-ink font-medium truncate">{member.name}</span>
        <ChevronDown className={`w-4 h-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
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
