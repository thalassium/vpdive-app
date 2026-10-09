import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { vpdive, isAborted, type MemberMatch } from '../../services/vpdiveApi';
import { rankByName } from '../../lib/fuzzy';
import { Avatar } from '../Avatar';

type State = { state: 'idle' } | { state: 'busy' } | { state: 'done'; matches: MemberMatch[] } | { state: 'unavailable' };
/** Trop court pour chercher (moins de trois lettres). */
const tooShort = (text: string) => text.trim().replace(/\s/g, '').length < 3;

/**
 * Chercher un membre du club par son nom, comme le champ binôme (BuddyField) :
 * fautes, accents et ordre prénom/nom tolérés. `onPick` reçoit le membre choisi.
 */
export function MemberSearch({ onPick, exclude = [] }: { onPick: (m: MemberMatch) => void; exclude?: string[] }) {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState<State>({ state: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    // Trop court : la recherche a été remise au repos à la frappe (onChange).
    if (tooShort(typed)) return;
    const q = typed.trim();
    const id = ++requestId.current;
    // Frappe suivante : les recherches pas encore parties sont retirées de la file.
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setSearch({ state: 'busy' });
      try {
        // Plusieurs fragments, car VPDive ne trouve que des sous-chaînes exactes : l'un après l'autre.
        const unique = await vpdive.searchByName(q, { priority: 'high', signal: abort.signal });
        if (id !== requestId.current) return;
        setSearch({ state: 'done', matches: rankByName(q, unique, (m) => m.name).slice(0, 5).map((r) => r.item) });
      } catch (e) {
        if (!isAborted(e) && id === requestId.current) setSearch({ state: 'unavailable' });
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [typed]);

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          autoComplete="off"
          autoFocus
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (tooShort(e.target.value)) setSearch({ state: 'idle' });
          }}
          placeholder="Prénom et nom du membre"
          aria-label="Chercher un membre VPDive"
          className="field w-full pl-10"
        />
      </div>
      {search.state === 'busy' && <p className="mt-2 text-sm text-muted">Recherche…</p>}
      {search.state === 'unavailable' && <p className="mt-2 text-sm text-danger">Recherche VPDive indisponible, réessayez.</p>}
      {search.state === 'done' &&
        (search.matches.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Aucun membre trouvé.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {search.matches.map((m) => {
              const already = exclude.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => onPick(m)}
                    className="w-full flex items-center gap-2.5 px-2 py-2 sm:py-1.5 rounded-lg text-left hover:bg-tint disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
                    <span className="flex-1 min-w-0 truncate text-ink">{m.name}</span>
                    {already && <span className="text-sm text-muted">déjà sur la sortie</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
