import { Suspense, lazy, useEffect, useState } from 'react';
import App from './App';
import { santaRoute } from './lib/santaRoute';

// Secret Santa : pages publiques, sans connexion (/#santa=…, /#santa-admin), hors du paquet principal.
const Santa = lazy(() => import('./components/santa/Santa'));

/** L'appli du club, ou une page du Secret Santa quand l'adresse en désigne une. */
export function Root() {
  const [route, setRoute] = useState(() => santaRoute(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(santaRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (!route) return <App />;
  return (
    <Suspense fallback={null}>
      <Santa key={route.page === 'reveal' ? route.token : `admin:${route.key}`} route={route} />
    </Suspense>
  );
}
