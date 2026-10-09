import { useCallback, useEffect, useState } from 'react';
import { vpdive } from '../services/vpdive';
import { messaging } from '../services/messaging';

/**
 * Pastille de la messagerie (celle de VPDive) : conversations non lues, relues
 * toutes les minutes, et pas quand l'onglet est caché (pare-feu VPDive) : relue
 * dès le retour au premier plan.
 */
export function useUnread(onSessionLost: (e: unknown) => boolean) {
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    if (!vpdive.getSession()) return;
    // Session perdue pendant la relecture : retour à la connexion, pas une pastille à zéro en silence.
    messaging.unread().then(setUnread, (e) => {
      if (!onSessionLost(e)) setUnread(0);
    });
  }, [onSessionLost]);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) refreshUnread();
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshUnread]);

  return { unread, refreshUnread };
}
