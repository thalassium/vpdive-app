/**
 * Le gabian (goéland leucophée, Larus michahellis), l'oiseau du port de la
 * Pointe Rouge et l'emblème de gabian.app. Dessiné à la main, en deux couleurs
 * du thème :
 *   marine (currentColor : text-brand, bleu clair en thème sombre)  le trait,
 *     les pointes d'ailes, l'œil, et une teinte du même pour le dos (bec sans tache)
 *   rose (l'accent du site)  le bec, les pattes, le cercle de l'œil
 * Le corps prend le fond (var(--surface)) : le gabian suit le thème clair ou sombre.
 *
 * La mandibule inférieure est à part : `open` ouvre le bec, `animate` le fait
 * crier en boucle (animation de chargement ; immobile si l'appareil demande
 * moins d'animations).
 */
const PINK = 'var(--color-pink)';
const BODY = 'var(--surface)';

export function Gabian({
  className = '',
  title,
  open = false,
  animate = false,
  crop,
}: {
  className?: string;
  title?: string;
  open?: boolean;
  animate?: boolean;
  /** « head » : la tête et le bec seulement (icône d'onglet, trop petite pour l'oiseau entier). */
  crop?: 'head';
}) {
  return (
    <svg viewBox={crop === 'head' ? '16 14 108 108' : '0 0 220 200'} className={`text-brand ${className}`} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g stroke="currentColor" strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round">
        {/* Pattes, derrière le corps */}
        <path d="M108 146 L104 182 M104 182 L92 188 M104 182 L106 190 M104 182 L114 188" fill="none" stroke={PINK} strokeWidth={4.5} />
        <path d="M126 144 L127 180 M127 180 L116 187 M127 180 L130 189 M127 180 L138 186" fill="none" stroke={PINK} strokeWidth={4.5} />

        {/* Pointes des ailes, pleines, avec les miroirs */}
        <path d="M150 104 L212 118 L204 124 L210 129 L170 132 L150 126 Z" fill="currentColor" />
        <ellipse cx="196" cy="121" rx="4" ry="2.2" fill={BODY} stroke="none" />
        <ellipse cx="184" cy="126" rx="3.4" ry="1.9" fill={BODY} stroke="none" />

        {/* Tête, cou, poitrine, ventre, queue */}
        <path
          d="M60 62 C56 40 72 26 90 28 C106 30 114 44 112 60 C110 74 114 84 128 90 L176 108 C182 112 180 120 172 122 L146 130 C132 148 106 156 90 146 C74 136 70 112 76 96 C80 84 64 78 60 62 Z"
          fill={BODY}
        />
        <path d="M84 132 C96 146 120 146 138 130 C124 138 104 140 84 132 Z" fill="currentColor" fillOpacity={0.08} stroke="none" />

        {/* Aile repliée : une teinte du marine, liseré du fond, plume dessinée */}
        <path d="M110 86 C134 82 162 92 182 108 C176 120 160 128 138 130 C118 132 104 124 100 110 C98 100 102 90 110 86 Z" fill={BODY} />
        <path d="M110 86 C134 82 162 92 182 108 C176 120 160 128 138 130 C118 132 104 124 100 110 C98 100 102 90 110 86 Z" fill="currentColor" fillOpacity={0.28} />
        <path d="M118 124 C138 128 160 124 176 114" fill="none" stroke={BODY} strokeWidth={2.4} />
        <path d="M120 98 C136 98 152 104 164 112" fill="none" strokeWidth={1.6} opacity={0.45} />

        {/* Œil : cercle rose, pupille marine */}
        <circle cx="84" cy="50" r="5.6" fill={BODY} stroke={PINK} strokeWidth={2.4} />
        <circle cx="83" cy="50" r="2.4" fill="currentColor" stroke="none" />
        <circle cx="82.2" cy="49.2" r="0.8" fill={BODY} stroke="none" />

        {/* Bec : mandibule supérieure fixe, crochet au bout */}
        <path d="M62 52 L34 56 C27 57 24 61 27 65 L30 63 L62 62 Z" fill={PINK} />
        {/* Intérieur du bec : caché bec fermé, visible quand la mandibule s'abaisse */}
        <path d="M62 61 L33 62 L62 67 Z" fill="currentColor" fillOpacity={0.55} stroke="none" />
        {/* Mandibule inférieure, pivot à la commissure : c'est elle qui s'ouvre */}
        <g
          className={animate ? 'gabian-cry' : undefined}
          style={{ transformOrigin: '62px 62px', transform: open && !animate ? 'rotate(-22deg)' : undefined }}
        >
          <path d="M62 62 L31 63 C28 65 29 69 34 69 L62 66 Z" fill={PINK} />
        </g>
      </g>
    </svg>
  );
}

/** Chargement : le gabian qui crie, et ce qui se charge. */
export function GabianLoader({ label = 'Chargement…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-2 py-10 text-muted ${className}`}>
      <Gabian animate className="w-24 h-auto" />
      <span>{label}</span>
    </div>
  );
}
