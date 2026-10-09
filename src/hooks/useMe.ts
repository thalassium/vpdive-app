import { useCallback, useEffect, useState } from 'react';
import { appApi, type Me } from '../services/appApi';
import { message } from '../lib/errors';

/**
 * Qui je suis dans l'appli (rôle décidé par le serveur, server/handler.ts) : relu à
 * chaque visite, la session VPDive dure 30 jours et les rôles peuvent changer entre-temps.
 */
export function useMe(onSessionLost: (e: unknown) => boolean) {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const fetchMe = useCallback(() => {
    appApi.me().then(
      (m) => {
        setMe(m);
        setMeError(null);
      },
      (e) => {
        if (onSessionLost(e)) return;
        console.warn('Rôle dans l’appli non lu :', e);
        // Autre erreur qu'une session perdue : la messagerie propose de réessayer au lieu de charger sans fin.
        setMeError(message(e));
      },
    );
  }, [onSessionLost]);
  useEffect(() => {
    fetchMe();
  }, [fetchMe]);
  const retryMe = () => {
    setMeError(null);
    fetchMe();
  };

  return { me, meError, fetchMe, retryMe };
}
