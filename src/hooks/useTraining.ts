import { useCallback, useEffect, useState } from 'react';
import { appApi } from '../services/appApi';
import { todoCount } from '../lib/training';
import { ymd } from '../lib/dates';

/**
 * Ce que les menus savent des fiches de suivi de formation : la personne
 * encadre-t-elle des élèves (un encadrant voit alors « Formations »), et
 * combien de séances restent à remplir (les siennes ; toutes pour un admin).
 * Lu une fois le compte connu (`ready`), relu par `refreshTraining` à la
 * fermeture de l'écran. Sans réponse du serveur : rien à montrer, sans bruit.
 */
export function useTraining(ready: boolean, onSessionLost: (e: unknown) => boolean) {
  const [training, setTraining] = useState({ teaches: false, todo: 0 });

  const refreshTraining = useCallback(() => {
    appApi.fiches().then(
      (r) => {
        const today = ymd(new Date());
        setTraining({
          teaches: r.fiches.some((f) => f.teachers.some((t) => r.me.includes(t))),
          todo: r.fiches.reduce((n, f) => n + todoCount(f, today, r.admin ? undefined : r.me), 0),
        });
      },
      (e: unknown) => void onSessionLost(e),
    );
  }, [onSessionLost]);

  useEffect(() => {
    if (ready) refreshTraining();
  }, [ready, refreshTraining]);

  return { ...training, refreshTraining };
}
