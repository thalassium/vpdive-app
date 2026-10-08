/**
 * Le gabian (goéland leucophée, Larus michahellis), l'oiseau du port de la
 * Pointe Rouge et l'emblème de gabian.app. Dessiné à la main, en aplats cernés
 * de marine : dos gris, pointes d'ailes noires aux miroirs blancs, bec jaune à
 * tache rouge, cercle oculaire rouge, pattes jaunes.
 *
 * La mandibule inférieure est à part : `open` ouvre le bec, `animate` le fait
 * crier en boucle (animation de chargement ; immobile si l'appareil demande
 * moins d'animations).
 */
const INK = '#14264d';

export function Gabian({ className = '', title, open = false, animate = false }: { className?: string; title?: string; open?: boolean; animate?: boolean }) {
  return (
    <svg viewBox="0 0 220 200" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <g stroke={INK} strokeWidth={3.2} strokeLinejoin="round" strokeLinecap="round">
        {/* Pattes, derrière le corps */}
        <path d="M108 146 L104 182 M104 182 L92 188 M104 182 L106 190 M104 182 L114 188" fill="none" stroke="#e0a91c" strokeWidth={4.5} />
        <path d="M126 144 L127 180 M127 180 L116 187 M127 180 L130 189 M127 180 L138 186" fill="none" stroke="#e0a91c" strokeWidth={4.5} />
        <path d="M108 146 L104 182 M126 144 L127 180" fill="none" stroke={INK} strokeWidth={1.4} opacity={0.35} />

        {/* Pointes des ailes : noires, avec les miroirs blancs */}
        <path d="M150 104 L212 118 L204 124 L210 129 L170 132 L150 126 Z" fill="#1b1f2a" />
        <ellipse cx="196" cy="121" rx="4" ry="2.2" fill="#fff" stroke="none" />
        <ellipse cx="184" cy="126" rx="3.4" ry="1.9" fill="#fff" stroke="none" />

        {/* Tête, cou, poitrine, ventre, queue blanche */}
        <path
          d="M60 62 C56 40 72 26 90 28 C106 30 114 44 112 60 C110 74 114 84 128 90 L176 108 C182 112 180 120 172 122 L146 130 C132 148 106 156 90 146 C74 136 70 112 76 96 C80 84 64 78 60 62 Z"
          fill="#fdfdfb"
        />
        {/* Joue et dessous, un peu d'ombre pour le relief */}
        <path d="M84 132 C96 146 120 146 138 130 C124 138 104 140 84 132 Z" fill="#e6e9ef" stroke="none" />

        {/* Aile repliée, gris perle, bord de rémiges blanc */}
        <path d="M110 86 C134 82 162 92 182 108 C176 120 160 128 138 130 C118 132 104 124 100 110 C98 100 102 90 110 86 Z" fill="#9aa4b6" />
        <path d="M118 124 C138 128 160 124 176 114" fill="none" stroke="#fff" strokeWidth={2.4} />
        <path d="M120 98 C136 98 152 104 164 112" fill="none" stroke={INK} strokeWidth={1.6} opacity={0.35} />

        {/* Œil : iris clair, pupille, cercle oculaire rouge */}
        <circle cx="84" cy="50" r="5.6" fill="#f6e7a6" stroke="#d6362a" strokeWidth={2.2} />
        <circle cx="83" cy="50" r="2.3" fill={INK} stroke="none" />
        <circle cx="82" cy="49" r="0.8" fill="#fff" stroke="none" />

        {/* Bec : mandibule supérieure fixe, crochet au bout */}
        <path d="M62 52 L34 56 C27 57 24 61 27 65 L30 63 L62 62 Z" fill="#f4c430" />
        {/* Intérieur du bec : caché bec fermé, visible quand la mandibule s'abaisse */}
        <path d="M62 61 L33 62 L62 67 Z" fill="#9b2f2b" stroke="none" />
        {/* Mandibule inférieure, pivot à la commissure : c'est elle qui s'ouvre */}
        <g
          className={animate ? 'gabian-cry' : undefined}
          style={{ transformOrigin: '62px 62px', transform: open && !animate ? 'rotate(-22deg)' : undefined }}
        >
          <path d="M62 62 L31 63 C28 65 29 69 34 69 L62 66 Z" fill="#f4c430" />
          <ellipse cx="37" cy="66.5" rx="3.6" ry="2.4" fill="#e1362d" stroke="none" />
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
