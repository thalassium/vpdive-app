import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Eye, LogOut, UserRound } from 'lucide-react';
import { Avatar } from './Avatar';
import { vpdive, type MemberMatch } from '../services/vpdiveApi';
import { appApi, type AppRole } from '../services/appApi';
import { normalizeName, rankByName } from '../lib/fuzzy';
import { ROLE_LABEL } from '../lib/roleLabels';
import { MENU_ITEM_CLS, menuKeys } from './menuKeys';

/** Un membre choisi dans « Voir en tant que », avec son rôle dans l'appli. */
export interface ViewAsPick {
  uct: string;
  name: string;
  picture: string;
  role: AppRole;
}

interface Props {
  name: string;
  email: string;
  picture?: string;
  /** Rôle réel dans l'appli (pas celui qu'on simule). */
  role: AppRole;
  onProfile: () => void;
  onViewAs: (pick: ViewAsPick) => void;
  onLogout: () => void;
  onSessionLost: (e: unknown) => boolean;
}

/**
 * Le compte, en haut à droite : photo et nom ; au clic, qui l'on est, le
 * profil, « Voir en tant que » pour un super-admin, et la déconnexion. Les
 * écrans d'administration sont dans le menu « Admin » de l'en-tête.
 *
 * Clavier : le focus va au premier élément à l'ouverture, ↑ ↓ Début Fin pour se
 * déplacer, Échap pour refermer (le focus revient au bouton), Tab pour sortir.
 * L'en-tête (nom, adresse, rôle) est hors du role="menu", qui ne contient que ses éléments.
 */
export function AccountMenu({ name, email, picture, role, onProfile, onViewAs, onLogout, onSessionLost }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'main' | 'viewAs'>('main');
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
      setView('main');
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      setView('main');
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  // Menu principal affiché (ouverture, retour de « Voir en tant que ») : focus sur son premier élément.
  useEffect(() => {
    if (open && view === 'main') list.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
  }, [open, view]);

  /** Ferme le menu ; le focus revient d'abord au bouton du compte, point de retour de l'écran qui s'ouvre. */
  const close = () => {
    button.current?.focus({ preventScroll: true });
    setOpen(false);
    setView('main');
  };

  return (
    <div
      ref={box}
      className="relative"
      onBlur={(e) => {
        // Focus parti ailleurs au clavier (Tab) : le menu se referme. Un clic ailleurs est géré par pointerdown.
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setView('main');
        }
      }}
    >
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Compte de ${name}`}
        title={name}
        className="flex items-center gap-2 h-11 pl-1 pr-2 rounded-lg hover:bg-raised transition-colors min-w-0"
      >
        <Avatar name={name} picture={picture} />
        <span className="hidden sm:block text-sm font-medium text-ink truncate max-w-40">{name}</span>
        <ChevronDown aria-hidden className="w-4 h-4 text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] panel border border-field-border z-40 animate-fade overflow-hidden">
          {view === 'main' ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
                <Avatar name={name} picture={picture} />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink truncate">{name}</span>
                  <span className="block text-sm text-muted truncate">{email}</span>
                </span>
                <span className="ml-auto shrink-0 rounded-md bg-tint text-brand text-xs font-semibold px-1.5 py-0.5">{ROLE_LABEL[role]}</span>
              </div>
              <div ref={list} id={menuId} role="menu" aria-label={`Compte de ${name}`} onKeyDown={menuKeys} className="py-1">
                <MenuItem
                  icon={<UserRound className="w-4 h-4" />}
                  onClick={() => {
                    close();
                    onProfile();
                  }}
                >
                  Mon profil
                </MenuItem>
                {role === 'superadmin' && (
                  <MenuItem icon={<Eye className="w-4 h-4" />} onClick={() => setView('viewAs')}>
                    Voir en tant que…
                  </MenuItem>
                )}
                <div role="separator" className="my-1 border-t border-line" />
                <MenuItem
                  icon={<LogOut className="w-4 h-4" />}
                  danger
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                >
                  Se déconnecter
                </MenuItem>
              </div>
            </>
          ) : (
            <ViewAsPicker
              onBack={() => setView('main')}
              onPick={(pick) => {
                close();
                onViewAs(pick);
              }}
              onSessionLost={onSessionLost}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} onClick={onClick} className={`${MENU_ITEM_CLS} ${danger ? 'text-danger' : 'text-ink'}`}>
      <span aria-hidden className={danger ? '' : 'text-brand'}>
        {icon}
      </span>
      {children}
    </button>
  );
}

/** Choisir un membre de l'annuaire du club (filtre tolérant aux fautes, comme l'écran Membres). */
function ViewAsPicker({ onBack, onPick, onSessionLost }: { onBack: () => void; onPick: (p: ViewAsPick) => void; onSessionLost: (e: unknown) => boolean }) {
  const [members, setMembers] = useState<MemberMatch[] | null>(null);
  const [roles, setRoles] = useState<Map<string, AppRole>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([vpdive.fetchMemberDirectory(), appApi.roles()]).then(
      ([list, entries]) => {
        if (cancelled) return;
        setRoles(new Map(entries.map((e) => [e.uct, e.role])));
        setMembers(list);
      },
      (e) => !cancelled && !onSessionLost(e) && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [onSessionLost]);

  const shown = useMemo(() => {
    const q = query.trim();
    if (!members || q.length < 2) return [];
    const exact = members.filter((m) => normalizeName(m.name).includes(normalizeName(q)));
    const close = rankByName(q, members, (m) => m.name, 0.6)
      .map((r) => r.item)
      .filter((m) => !exact.includes(m));
    return [...exact, ...close].slice(0, 8);
  }, [members, query]);

  return (
    <div role="group" aria-labelledby={titleId}>
      <div className="flex items-center gap-1 px-2 py-2 border-b border-line">
        <button type="button" onClick={onBack} aria-label="Retour au menu du compte" className="icon-btn w-9 h-9">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span id={titleId} className="font-semibold text-brand">
          Voir en tant que
        </span>
      </div>
      <div className="p-3">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom d’un membre"
          aria-label="Rechercher un membre"
          className="field w-full"
        />
      </div>
      <div className="max-h-72 overflow-y-auto pb-1">
        {error ? (
          <p className="px-4 pb-3 text-sm text-danger">{error}</p>
        ) : !members ? (
          <p className="px-4 pb-3 text-sm text-muted">Chargement de l’annuaire…</p>
        ) : query.trim().length < 2 ? (
          <p className="px-4 pb-3 text-sm text-muted">Tapez au moins deux lettres du nom.</p>
        ) : shown.length === 0 ? (
          <p className="px-4 pb-3 text-sm text-muted">Aucun membre ne correspond.</p>
        ) : (
          shown.map((m) => {
            const role = roles.get(m.id) ?? 'member';
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick({ uct: m.id, name: m.name, picture: m.picture, role })}
                className={`${MENU_ITEM_CLS} py-2`}
              >
                <Avatar name={m.name} picture={m.picture} size="sm" />
                <span className="flex-1 min-w-0 truncate text-ink">{m.name}</span>
                <span className="text-sm text-muted shrink-0">{ROLE_LABEL[role]}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
