import { useCallback, useEffect, useRef, useState } from 'react';
import { vpdive } from '../services/vpdive';
import { dpWindow, findDpEvents } from '../services/dpEvents';
import { sameName } from '../lib/fuzzy';
import type { ViewAsPick } from '../components/AccountMenu';

/**
 * « Voir en tant que » (super-admin) : les droits d'un autre membre, simulés
 * dans le navigateur. Son rôle dans l'appli, et les sorties où il est DP
 * (null tant qu'on les cherche, avec l'avancement de la recherche). Le serveur, lui, voit toujours le compte connecté.
 */
export type ViewAs = ViewAsPick & { dpEvents: string[] | null; progress: { done: number; total: number } | null; failed: boolean };

/** `onSwitch` : appelé en entrant et en sortant (l'écran ferme ce qui était ouvert). */
export function useViewAs(onSessionLost: (e: unknown) => boolean, onSwitch: () => void) {
  const [viewAs, setViewAs] = useState<ViewAs | null>(null);
  const viewAsId = useRef(0);
  const switched = useRef(onSwitch);
  useEffect(() => {
    switched.current = onSwitch;
  });

  /** Voir le site avec les droits d'un membre : son rôle, puis les sorties où VPDive l'inscrit DP (même fenêtre que le menu DP). */
  const start = useCallback(
    async (pick: ViewAsPick) => {
      const id = ++viewAsId.current;
      switched.current();
      // Admin simulé : le menu DP lui est acquis, inutile de lire une seule liste d'inscrits.
      if (pick.role !== 'member') return setViewAs({ ...pick, dpEvents: [], progress: null, failed: false });
      setViewAs({ ...pick, dpEvents: null, progress: null, failed: false });
      const update = (patch: Partial<ViewAs>) => {
        if (id === viewAsId.current) setViewAs((v) => (v && v.uct === pick.uct ? { ...v, ...patch } : v));
      };
      try {
        const [from, to] = dpWindow();
        // Seulement les sorties qui ont des inscrits, une liste à la fois : le pare-feu VPDive bloque les rafales.
        const list = (await vpdive.fetchEvents(from, to)).filter((e) => e.registeredCount > 0);
        const scan = await findDpEvents(list, (r) => sameName(r.name, pick.name), {
          onProgress: (done, total) => update({ progress: { done, total } }),
          cancelled: () => id !== viewAsId.current,
        });
        if (scan) update({ dpEvents: scan.tokens, progress: null, failed: !scan.complete });
      } catch (e) {
        if (onSessionLost(e)) return;
        update({ dpEvents: [], progress: null, failed: true });
      }
    },
    [onSessionLost],
  );

  const stop = () => {
    viewAsId.current++;
    setViewAs(null);
    switched.current();
  };

  /** « Réessayer » la recherche des sorties DP du membre vu « en tant que ». */
  const retry = () => {
    if (!viewAs) return;
    const { dpEvents: _, progress: __, failed: ___, ...pick } = viewAs;
    void start(pick);
  };

  return { viewAs, start, stop, retry };
}
