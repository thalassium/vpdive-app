import { useEffect, useRef, useState } from 'react';
import { Check, UserRound, X } from 'lucide-react';
import { vpdive, type MemberMatch } from '../services/vpdiveApi';
import { rankByName, searchFragments } from '../lib/fuzzy';

interface Props {
  /** Name as it will be sent: a member's exact name once one is picked, else what was typed. */
  value: string;
  onChange: (name: string) => void;
  onSessionLost: (e: unknown) => boolean;
}

type Search = { state: 'idle' } | { state: 'busy' } | { state: 'done'; matches: MemberMatch[] } | { state: 'unavailable' };

/**
 * « Je souhaite plonger avec… » : le plongeur tape un prénom et un nom comme il
 * les connaît, l'appli propose les membres du club dont le nom s'en approche le
 * plus (fautes, accents, ordre prénom/nom). Choisir une suggestion n'est pas
 * obligatoire : si la recherche VPDive n'est pas accessible, le nom tapé part tel quel.
 */
export function BuddyField({ value, onChange, onSessionLost }: Props) {
  const [typed, setTyped] = useState(value);
  const [picked, setPicked] = useState<MemberMatch | null>(null);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    if (picked) return;
    const q = typed.trim();
    if (q.replace(/\s/g, '').length < 3) {
      setSearch({ state: 'idle' });
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setSearch({ state: 'busy' });
      try {
        // Plusieurs fragments, car VPDive ne trouve que des sous-chaînes exactes.
        const lists = await Promise.all(searchFragments(q).map((f) => vpdive.searchMembers(f)));
        const unique = [...new Map(lists.flat().map((m) => [m.id, m])).values()];
        if (id !== requestId.current) return;
        setSearch({ state: 'done', matches: rankByName(q, unique, (m) => m.name).slice(0, 4).map((r) => r.item) });
      } catch (e) {
        if (id !== requestId.current || onSessionLost(e)) return;
        setSearch({ state: 'unavailable' });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [typed, picked, onSessionLost]);

  const type = (text: string) => {
    setTyped(text);
    setPicked(null);
    onChange(text);
  };
  const pick = (m: MemberMatch) => {
    setPicked(m);
    setTyped(m.name);
    onChange(m.name);
    setSearch({ state: 'idle' });
  };

  return (
    <div>
      <label htmlFor="buddy" className="label block mb-1.5">
        Plonger avec un binôme <span className="font-normal text-muted">(facultatif)</span>
      </label>
      <div className="relative">
        <UserRound className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id="buddy"
          type="text"
          autoComplete="off"
          value={typed}
          onChange={(e) => type(e.target.value)}
          placeholder="Prénom et nom"
          aria-describedby="buddy-help"
          className={`field w-full pl-10 pr-10 text-base ${picked ? 'border-green text-ok font-medium' : ''}`}
        />
        {typed && (
          <button
            type="button"
            onClick={() => type('')}
            aria-label="Effacer le binôme"
            className="icon-btn absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8"
          >
            {picked ? <Check className="w-4 h-4 text-ok" strokeWidth={3} /> : <X className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div id="buddy-help" aria-live="polite" className="mt-1.5 text-sm">
        {search.state === 'busy' && <p className="text-muted">Recherche parmi les membres…</p>}
        {search.state === 'unavailable' && <p className="text-muted">Recherche des membres indisponible : le nom sera transmis tel quel.</p>}
        {search.state === 'done' && search.matches.length === 0 && (
          <p className="text-muted">Aucun membre ne ressemble à ce nom : il sera transmis tel quel.</p>
        )}
        {search.state === 'done' && search.matches.length > 0 && (
          <div>
            <p className="text-muted mb-1.5">{search.matches.length > 1 ? 'Vouliez-vous dire :' : 'Vouliez-vous dire'}</p>
            <div className="flex flex-wrap gap-1.5">
              {search.matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pick(m)}
                  className="btn btn-quiet h-9 px-3 font-medium text-ink hover:text-brand"
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
