import { useEffect, useState } from 'react';

/**
 * Les quatre onglets ; l'onglet actif est dans l'adresse (#cours…), et chaque changement
 * d'onglet pose une entrée d'historique : le bouton Retour du téléphone revient à
 * l'onglet précédent au lieu de quitter l'appli.
 */
export type Tab = 'agenda' | 'cours' | 'messages' | 'profil';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'agenda', label: 'Agenda' },
  { id: 'cours', label: 'Cours' },
  { id: 'messages', label: 'Messagerie' },
  { id: 'profil', label: 'Profil' },
];
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'agenda';
};
/** Adresse d'un onglet : l'agenda sans rien (« / »), les autres en #onglet. */
const tabUrl = (t: Tab) => (t === 'agenda' ? `${location.pathname}${location.search}` : `#${t}`);

/**
 * Appli ouverte directement sur un autre onglet que l'agenda (lien, favori, raccourci
 * #messages) : l'agenda est glissé dessous dans l'historique, pour que Retour y mène
 * avant de quitter l'appli. Une fois par chargement de page, pas après un rechargement.
 */
let historySeeded = false;
function seedHistory() {
  if (historySeeded) return;
  historySeeded = true;
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== 'navigate' || history.state !== null) return;
  const tab = tabFromHash();
  if (tab === 'agenda') return;
  history.replaceState(null, '', tabUrl('agenda'));
  history.pushState(null, '', tabUrl(tab));
}

/** L'onglet affiché, qui suit l'adresse (Retour, Suivant, lien #onglet), et `goTo` pour en changer. */
export function useTab() {
  const [tab, setTab] = useState<Tab>(tabFromHash);

  // Retour / Suivant du téléphone ou du navigateur, lien #onglet : l'onglet suit l'adresse.
  useEffect(() => {
    seedHistory();
    const onNav = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onNav);
    window.addEventListener('popstate', onNav);
    return () => {
      window.removeEventListener('hashchange', onNav);
      window.removeEventListener('popstate', onNav);
    };
  }, []);

  /** Autre onglet : une entrée d'historique de plus, que Retour défera. */
  const goTo = (t: Tab) => {
    if (t !== tab) {
      history.pushState(null, '', tabUrl(t));
      setTab(t);
    }
    window.scrollTo({ top: 0 });
  };

  return { tab, goTo };
}
