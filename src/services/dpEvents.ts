/**
 * Sorties où quelqu'un est directeur de plongée. VPDive ne le dit que dans la
 * liste des inscrits de chaque sortie : elles sont lues une à une (la file du
 * transport les espace), en priorité basse pour que l'écran passe devant.
 *
 * Une liste illisible n'est jamais prise pour « pas DP » : la recherche est alors
 * incomplète (`complete: false`), l'écran le dit et rien n'est gardé en cache.
 * VPDive indisponible (pare-feu, réseau) : on s'arrête là, sans insister.
 */
import { vpdive, ymd, isSessionLost, isUnavailable, DP_ROLE, type CalendarEvent, type RosterEntry } from './vpdiveApi';

/** Message affiché là où le menu DP apparaît quand une liste n'a pas pu être lue. */
export const DP_SCAN_FAILED = 'Vérification des sorties DP impossible';

/** Fenêtre du menu DP : 14 jours en arrière, 60 en avant (AAAA-MM-JJ). */
export function dpWindow(today = new Date()): [string, string] {
  const from = new Date(today);
  from.setDate(from.getDate() - 14);
  const to = new Date(today);
  to.setDate(to.getDate() + 60);
  return [ymd(from), ymd(to)];
}

export interface DpScan {
  /** Jetons des sorties où la personne est DP, parmi les listes lues. */
  tokens: string[];
  /** Toutes les listes ont été lues : le résultat peut être gardé. */
  complete: boolean;
}

/**
 * Lit la liste des inscrits de chaque sortie et garde celles où `isPerson` a le
 * rôle de DP. null si `cancelled` dit stop en cours de route. Une session perdue
 * remonte telle quelle (reconnexion).
 */
export async function findDpEvents(
  events: CalendarEvent[],
  isPerson: (r: RosterEntry) => boolean,
  opts: { onProgress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<DpScan | null> {
  const tokens: string[] = [];
  let complete = true;
  for (const [i, e] of events.entries()) {
    if (opts.cancelled?.()) return null;
    opts.onProgress?.(i + 1, events.length);
    try {
      const roster = await vpdive.fetchRoster(e.token, { priority: 'low' });
      if (roster.some((r) => isPerson(r) && r.roles.some((x) => DP_ROLE.test(x)))) tokens.push(e.token);
    } catch (err) {
      if (isSessionLost(err)) throw err;
      complete = false;
      if (isUnavailable(err)) break;
    }
  }
  return opts.cancelled?.() ? null : { tokens, complete };
}
