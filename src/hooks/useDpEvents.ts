import { useEffect, useMemo, useState } from 'react';
import { vpdive, type Session } from '../services/vpdive';
import { dpWindow, findDpEvents } from '../services/dpEvents';
import { isStringArray, sessionCache } from '../lib/cache';

/**
 * Sorties où le membre est DP, gardées une heure dans l'onglet pour ne pas relire toutes les listes
 * d'inscrits à chaque visite. Seulement si toutes les listes ont été lues (services/dpEvents.ts).
 */
const DP_CACHE_TTL = 60 * 60 * 1000;
const dpCache = sessionCache('dp-events:', DP_CACHE_TTL, isStringArray, { field: 'tokens' });

/**
 * Un membre qui n'est pas admin a le menu DP s'il est directeur de plongée d'une
 * sortie où il est inscrit (même fenêtre que le menu DP : 14 jours en arrière, 60
 * en avant). `isMember` : simple membre (les admins ont le menu d'office).
 */
export function useDpEvents(session: Session, isMember: boolean, onSessionLost: (e: unknown) => boolean) {
  /** Sorties où le membre connecté est DP (jetons), trouvées en lisant les listes d'inscrits. */
  const [dpScan, setDpScan] = useState<string[] | null>(null);
  /** Une liste d'inscrits (ou l'agenda) n'a pas pu être lue : le menu DP propose de réessayer. */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = String(session.userId ?? '');
  const userId = session.userId;
  // Sorties DP gardées une heure dans l'onglet : pas de relecture des listes d'inscrits à chaque visite.
  const cached = useMemo(() => (isMember ? dpCache.read(key) : null), [isMember, key]);

  useEffect(() => {
    if (!isMember || cached) return;
    let cancelled = false;
    (async () => {
      const [from, to] = dpWindow();
      const mine = (await vpdive.fetchEvents(from, to)).filter((e) => e.registered);
      // Toutes ses sorties comme DP (le menu DP en a besoin), listes lues une à une.
      const scan = await findDpEvents(mine, (r) => r.id === String(userId), { cancelled: () => cancelled });
      if (!scan) return;
      // Gardé une heure seulement si toutes les listes ont été lues : un échec n'est pas un « pas DP ».
      if (scan.complete) dpCache.write(key, scan.tokens);
      setDpScan(scan.tokens);
      setFailed(!scan.complete);
    })().catch((e) => {
      if (onSessionLost(e) || cancelled) return;
      console.warn('Rôle DP non vérifié :', e);
      setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isMember, cached, key, userId, onSessionLost, attempt]);

  /** Sorties où le membre connecté est DP (jetons) ; null tant qu'on ne les connaît pas (ou pas membre simple). */
  const dpEvents = dpScan ?? cached;
  return {
    dpEvents,
    isDp: (dpEvents?.length ?? 0) > 0,
    /** Recherche incomplète : à réessayer (« Vérification des sorties DP impossible »). */
    failed: isMember && failed,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}
