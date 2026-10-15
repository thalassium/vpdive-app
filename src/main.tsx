import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppCrash, ErrorBoundary } from './components/ErrorBoundary';
import { installErrorHandlers } from './lib/clientErrors';
import { watchNewVersion } from './lib/newVersion';
import './index.css';

// Erreurs non rattrapées remontées au serveur, rechargement unique après une mise en ligne.
installErrorHandlers();
// Nouvelle version en ligne : rechargement quand le membre revient dans l'appli.
if (import.meta.env.PROD) watchNewVersion();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="racine" fallback={(error) => <AppCrash error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
