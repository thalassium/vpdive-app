/**
 * Petits caches dans le stockage du navigateur (l'onglet par défaut), avec une
 * durée de vie et un contrôle de forme : une entrée périmée, illisible ou d'une
 * autre forme (ancienne version de l'appli) vaut absente, et sera relue.
 * Stockage interdit ou plein (navigation privée) : rien n'est gardé, rien ne casse.
 *
 * Une entrée est rangée sous `préfixe + id`, en `{ at, <champ>: valeur }`. Les
 * préfixes sont effacés à la déconnexion (App.tsx, SESSION_CACHE_PREFIXES).
 */

export interface StoredCache<T> {
  read(id: string): T | null;
  write(id: string, value: T): void;
  forget(id: string): void;
}

interface Options {
  /** Nom du champ qui porte la valeur (celui des entrées déjà écrites) ; '' : la valeur seule, sans date ni durée. */
  field?: string;
  /** sessionStorage par défaut. */
  storage?: () => Storage;
}

export function sessionCache<T>(prefix: string, ttl: number, guard: (v: unknown) => v is T, opts: Options = {}): StoredCache<T> {
  const field = opts.field ?? 'value';
  const storage = opts.storage ?? (() => sessionStorage);
  return {
    read(id) {
      try {
        const raw = storage().getItem(prefix + id);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!field) return guard(parsed) ? parsed : null;
        const entry = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        const at = typeof entry?.at === 'number' ? entry.at : Number.NaN;
        const value = entry?.[field];
        return Date.now() - at < ttl && guard(value) ? value : null;
      } catch {
        return null;
      }
    },
    write(id, value) {
      try {
        storage().setItem(prefix + id, JSON.stringify(field ? { at: Date.now(), [field]: value } : value));
      } catch {
        // Stockage plein ou interdit : la valeur sera relue la prochaine fois.
      }
    },
    forget(id) {
      try {
        storage().removeItem(prefix + id);
      } catch {
        // Stockage indisponible : rien à oublier.
      }
    },
  };
}

/** Gardes de forme courantes. */
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
