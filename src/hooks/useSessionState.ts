import { useCallback, useState } from 'react';
import { vpdive, isSessionLost, type Session } from '../services/vpdive';
import { PERSIST_PREFIX } from '../services/vpdive/transport';
import { appApi } from '../services/appApi';

/** Caches de session de l'appli (documents, adhésions, libellés, météo, sorties DP, lectures VPDive) : effacés à la déconnexion, le téléphone peut être partagé. */
const SESSION_CACHE_PREFIXES = ['docs-status:', 'member-record:', 'club-member-v2:', 'my-labels:', 'meteo:', 'dp-events:', PERSIST_PREFIX];
function clearSessionCaches() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && SESSION_CACHE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
    // Listes d'inscrits gardées pour les statistiques (sur l'appareil, d'une session à l'autre).
    const kept: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('stats-roster:')) kept.push(k);
    }
    kept.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Stockage interdit (navigation privée) : rien à effacer.
  }
}

/**
 * La session VPDive de l'appli : connexion, perte en cours d'usage (fenêtre de
 * reconnexion, l'écran reste monté dessous), reconnexion et déconnexion.
 */
export function useSessionState() {
  const [session, setSession] = useState<Session | null>(() => vpdive.getSession());
  /**
   * Session VPDive perdue en cours d'usage (expirée, révoquée) : le message de la fenêtre
   * de reconnexion. L'écran reste monté dessous, rien de ce qui était saisi n'est perdu.
   */
  const [lost, setLost] = useState<string | null>(null);

  /** À appeler sur toute erreur : true si c'était une session perdue (la reconnexion s'ouvre). */
  const onSessionLost = useCallback((e: unknown) => {
    if (isSessionLost(e)) {
      setLost(e.message);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    // D'abord le serveur de l'appli (il lui faut encore la session VPDive), puis VPDive, puis le local.
    await appApi.logout();
    vpdive.logout();
    clearSessionCaches();
    setLost(null);
    setSession(null);
  }, []);

  /** Reconnecté : même membre, l'écran continue avec la nouvelle session ; autre membre, tout repart de zéro. */
  const reconnected = (s: Session) => {
    if (session && session.userId !== s.userId) clearSessionCaches();
    setLost(null);
    setSession(s);
  };

  return { session, setSession, lost, onSessionLost, logout, reconnected };
}
