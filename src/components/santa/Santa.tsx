import { ThemeToggle } from '../ThemeToggle';
import { SeaBackdrop } from '../SeaBackdrop';
import type { SantaRoute } from '../../lib/santaRoute';
import { SantaReveal } from './SantaReveal';
import { SantaAdmin } from './SantaAdmin';

/** Secret Santa : pages publiques, hors de l'appli du club (pas de connexion, pas de menu). */
export default function Santa({ route }: { route: SantaRoute }) {
  return (
    <div className="relative min-h-dvh flex flex-col">
      <SeaBackdrop rose="none" />
      <div className="relative flex justify-end p-3">
        <ThemeToggle />
      </div>
      <main className={`relative flex-1 w-full mx-auto px-4 pb-10 ${route.page === 'admin' ? 'max-w-xl' : 'max-w-sm flex items-center'}`}>
        {route.page === 'admin' ? <SantaAdmin initialKey={route.key} /> : <SantaReveal token={route.token} />}
      </main>
    </div>
  );
}
