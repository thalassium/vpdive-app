import type { KeyboardEvent, ReactNode } from 'react';

/*
 * Onglets accessibles, selon le motif « Tabs » de l'ARIA APG : la liste
 * (role="tablist") n'est qu'un arrêt de la touche Tab, sur l'onglet choisi ;
 * les flèches ← → passent d'un onglet à l'autre (en boucle), Début et Fin
 * vont au premier et au dernier. Chaque onglet dit le panneau qu'il montre
 * (aria-controls) et le panneau dit son onglet (aria-labelledby).
 *
 * Sans style : chaque écran garde l'allure de ses onglets (className).
 *
 *   const id = useId();
 *   <TabList label="Fiche" activation="auto">
 *     <Tab id={`${id}-tab-a`} controls={`${id}-panel-a`} selected={tab === 'a'} onSelect={() => setTab('a')}>A</Tab>
 *     …
 *   </TabList>
 *   {tab === 'a' && <TabPanel id={`${id}-panel-a`} labelledBy={`${id}-tab-a`}>…</TabPanel>}
 */

/**
 * La liste des onglets. `activation` : 'auto' (défaut) choisit l'onglet dès que les flèches
 * y mènent ; 'manual' y met seulement le focus, Entrée ou Espace le choisit (onglets dont
 * l'ouverture lit beaucoup sur le réseau).
 */
export function TabList({ label, activation = 'auto', className, children }: { label: string; activation?: 'auto' | 'manual'; className?: string; children: ReactNode }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((t) => !t.disabled);
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1 || !tabs.length) return;
    const next =
      e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : undefined;
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (activation === 'auto') next.click();
  };
  return (
    <div role="tablist" aria-label={label} className={className} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/**
 * Un onglet : seul l'onglet choisi est atteignable par Tab (tabindex itinérant). Le panneau
 * d'un onglet non choisi n'est pas rendu : aria-controls n'est posé que sur l'onglet choisi.
 */
export function Tab({
  id,
  controls,
  selected,
  onSelect,
  disabled,
  title,
  className,
  children,
}: {
  id: string;
  controls: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={selected ? controls : undefined}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={className}
    >
      {children}
    </button>
  );
}

/** Le contenu de l'onglet choisi. */
export function TabPanel({ id, labelledBy, className, children }: { id: string; labelledBy: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={id} aria-labelledby={labelledBy} className={className}>
      {children}
    </div>
  );
}
