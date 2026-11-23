import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { AppCrash, ErrorBoundary } from './components/ErrorBoundary';
import { installErrorHandlers } from './lib/clientErrors';
import { watchNewVersion } from './lib/newVersion';
import { santaRoute } from './lib/santaRoute';
import './index.css';

// Erreurs non rattrapées remontées au serveur, rechargement unique après une mise en ligne.
installErrorHandlers();
// Nouvelle version en ligne : rechargement quand le membre revient dans l'appli.
// Pas sur un lien du Secret Santa : un rechargement ferait perdre le prénom, montré une seule fois.
if (import.meta.env.PROD && !santaRoute(location.hash)) watchNewVersion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="racine" fallback={(error) => <AppCrash error={error} />}>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
