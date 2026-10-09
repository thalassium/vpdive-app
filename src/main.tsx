import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppCrash, ErrorBoundary } from './components/ErrorBoundary';
import { installErrorHandlers } from './lib/clientErrors';
import './index.css';

// Erreurs non rattrapées remontées au serveur, rechargement unique après une mise en ligne.
installErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="racine" fallback={(error) => <AppCrash error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
