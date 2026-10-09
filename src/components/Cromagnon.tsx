/**
 * Le Cromagnon, le bateau du club : dessin au trait fourni par le club (hachures
 * comprises), vectorisé avec potrace à 1024 px de large, coordonnées arrondies.
 *
 * Le dessin (60 Ko de chemins) est dans public/cromagnon.svg, téléchargé à part et
 * gardé en cache, au lieu de peser dans le paquet JavaScript principal. Il sert de
 * masque plutôt que d'<img> : il garde ainsi la couleur du texte (currentColor),
 * marine sur fond clair, blanc sur le pied de page, bleu clair en thème sombre,
 * ce qu'une image ne peut pas suivre quand le thème est choisi dans l'appli.
 * Décoratif par défaut (caché aux lecteurs d'écran) ; `title` en fait une image nommée.
 */
const MASK = 'url(/cromagnon.svg) center / contain no-repeat';

export function Cromagnon({ className = '', title }: { className?: string; title?: string }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={`block aspect-[1024/414] bg-current ${className}`}
      style={{ mask: MASK, WebkitMask: MASK }}
    />
  );
}
