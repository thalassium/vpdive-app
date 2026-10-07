/**
 * Fond « carte marine » de l'application, derrière tout le contenu.
 *
 * Trois couches, toutes en traits fins et couleurs de la charte très atténuées :
 *   - isobathes : courbes de niveau d'une carte marine, en haut de page ;
 *   - rose des vents : celle du logo, en filigrane dans un coin ;
 *   - horizon : les îles du Frioul et le relief des calanques vus depuis la
 *     Pointe Rouge, posés sur une houle légère en bas de l'écran ;
 * plus quelques bulles qui remontent lentement (désactivées si l'appareil
 * demande moins d'animations, cf. index.css).
 *
 * Purement décoratif : aria-hidden, aucun événement, position fixe.
 */
export function SeaBackdrop({ rose = 'right' }: { rose?: 'right' | 'center' | 'none' }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas print:hidden">
      {/* Profondeur : l'eau fonce doucement vers le bas */}
      <div className="absolute inset-0 bg-gradient-to-b from-canvas via-canvas to-deep" />

      {/* Isobathes */}
      <svg className="absolute inset-x-0 top-0 w-full h-[70vh] text-chart" viewBox="0 0 1440 640" preserveAspectRatio="xMidYMin slice" fill="none">
        <g stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
          {ISOBATHS.map((d, i) => (
            <path key={i} d={d} opacity={0.55 - i * 0.07} />
          ))}
        </g>
        <g fill="currentColor" opacity="0.5" fontFamily="Georgia, serif" fontSize="11" fontStyle="italic">
          <text x="1088" y="122">10</text>
          <text x="1176" y="208">20</text>
          <text x="1262" y="300">40</text>
        </g>
      </svg>

      {/* Rose des vents (reprend celle du logo) */}
      {rose !== 'none' && (
        <svg
          className={`absolute text-chart opacity-60 ${
            rose === 'center'
              ? 'left-1/2 top-[34vh] -translate-x-1/2 w-[min(150vw,58rem)]'
              : '-right-24 top-24 w-[28rem] max-sm:hidden'
          }`}
          viewBox="-100 -100 200 200"
          fill="none"
        >
          <CompassRose />
        </svg>
      )}

      {/* Bulles */}
      <div className="absolute inset-0">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="absolute bottom-[-2rem] rounded-full border border-bubble bg-bubble/10 animate-bubble"
            style={{
              left: `${b.x}%`,
              width: b.size,
              height: b.size,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Horizon : Frioul et calanques, puis la houle */}
      <svg className="absolute inset-x-0 bottom-0 w-full h-32 sm:h-44" viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">
        <path className="fill-coast-far" d={COAST_FAR} />
        <path className="fill-coast-near" d={COAST_NEAR} />
        <path className="fill-swell" d="M0 176 C 120 166 240 186 360 176 S 600 166 720 176 S 960 186 1080 176 S 1320 166 1440 176 V220 H0 Z" />
        <path
          className="stroke-chart"
          fill="none"
          strokeWidth="1"
          opacity="0.6"
          d="M0 192 C 160 184 320 200 480 192 S 800 184 960 192 S 1280 200 1440 192"
        />
      </svg>
    </div>
  );
}

/** Rose des vents à 16 aires, comme celle du logo Septentrion : cercles, aires et nord marqué. */
export function CompassRose() {
  const rays = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <g stroke="currentColor" vectorEffect="non-scaling-stroke">
      <circle r="92" strokeWidth="0.6" opacity="0.7" />
      <circle r="86" strokeWidth="0.3" opacity="0.6" />
      <circle r="58" strokeWidth="0.3" opacity="0.5" />
      {rays.map((a) => {
        const major = a % 90 === 0;
        const mid = a % 45 === 0;
        const r = major ? 98 : mid ? 80 : 66;
        return (
          <line
            key={a}
            x1="0"
            y1="0"
            x2="0"
            y2={-r}
            strokeWidth={major ? 0.7 : 0.35}
            opacity={major ? 0.8 : 0.55}
            transform={`rotate(${a})`}
          />
        );
      })}
      {/* Graduations du cercle extérieur, tous les 5° */}
      {Array.from({ length: 72 }, (_, i) => (
        <line key={i} x1="0" y1="-86" x2="0" y2={i % 2 ? -89 : -92} strokeWidth="0.3" opacity="0.6" transform={`rotate(${i * 5})`} />
      ))}
      <path d="M0 -98 L5 -60 L0 -66 L-5 -60 Z" fill="currentColor" stroke="none" opacity="0.7" />
      <text y="-104" textAnchor="middle" fontSize="9" fontFamily="Georgia, serif" fill="currentColor" stroke="none" opacity="0.8">
        N
      </text>
    </g>
  );
}

// Courbes de niveau dessinées à la main : elles suivent grossièrement la côte
// de la rade sud de Marseille (la côte est en haut à droite, le large en bas à gauche).
const ISOBATHS = [
  'M1440 40 C 1330 70 1250 40 1170 90 S 1040 170 960 150 S 820 90 700 130 S 520 240 380 220 S 140 160 0 210',
  'M1440 120 C 1340 140 1290 120 1210 170 S 1080 250 990 240 S 850 190 730 230 S 540 330 400 320 S 160 270 0 320',
  'M1440 210 C 1350 220 1310 210 1240 260 S 1110 340 1020 330 S 880 290 760 330 S 570 420 420 420 S 180 380 0 430',
  'M1440 300 C 1360 310 1320 300 1270 350 S 1150 430 1060 430 S 920 390 800 430 S 600 510 450 515 S 200 490 0 540',
  'M1440 390 C 1370 400 1340 400 1300 440 S 1190 520 1100 520 S 960 490 840 525 S 640 600 480 610 S 220 600 0 640',
];

// Silhouettes : au loin le chapelet du Frioul (Pomègues, Ratonneau, If), plus près
// les crêtes calcaires de Marseilleveyre qui plongent vers Maïre.
const COAST_FAR =
  'M0 170 L 70 168 C 110 160 130 150 160 152 C 190 154 205 146 230 148 L 262 160 L 300 162 C 330 150 352 142 380 146 C 404 150 418 158 440 160 L 520 164 C 548 158 560 156 578 160 L 600 166 L 1440 166 V 220 H 0 Z';
const COAST_NEAR =
  'M900 176 L 934 168 L 952 150 L 968 152 L 990 128 L 1004 132 L 1026 108 L 1040 114 L 1062 96 L 1078 100 L 1096 88 L 1112 98 L 1128 92 L 1150 110 L 1166 104 L 1190 122 L 1204 118 L 1228 136 L 1250 132 L 1276 148 L 1300 146 L 1330 158 L 1362 160 L 1400 166 L 1440 168 V 220 H 900 Z';

// Positions fixes (pas d'aléatoire : même rendu à chaque visite, pas de saut au rechargement).
const BUBBLES = [
  { x: 6, size: 6, duration: 26, delay: 0 },
  { x: 11, size: 10, duration: 34, delay: 9 },
  { x: 18, size: 4, duration: 22, delay: 15 },
  { x: 31, size: 7, duration: 30, delay: 4 },
  { x: 47, size: 5, duration: 28, delay: 19 },
  { x: 63, size: 8, duration: 36, delay: 2 },
  { x: 72, size: 4, duration: 24, delay: 12 },
  { x: 84, size: 9, duration: 32, delay: 7 },
  { x: 91, size: 5, duration: 27, delay: 21 },
];
