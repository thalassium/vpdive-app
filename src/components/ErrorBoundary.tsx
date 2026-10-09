import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { isChunkLoadError, reloadOnce, reportError } from '../lib/clientErrors';
import { useDialog } from '../hooks/useDialog';

interface Props {
  /** Où l'erreur s'est produite, pour le serveur : « racine », « écran messages »… */
  where: string;
  /** Ce qui s'affiche à la place des enfants en panne (par défaut : ScreenError dans la page). */
  fallback?: (error: unknown, retry: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: unknown;
  failed: boolean;
}

/**
 * Frontière d'erreur : un écran qui plante au rendu (ou qui n'a pas pu être téléchargé)
 * affiche un message et un bouton pour recharger, au lieu d'une page blanche ; l'erreur
 * est remontée au serveur. Écran introuvable après une mise en ligne : la page se
 * recharge d'elle-même une fois (lib/clientErrors.ts).
 *
 * À remonter avec une `key` qui change (onglet, panneau) pour réessayer en changeant d'écran.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadOnce()) return;
    const withStack = error instanceof Error ? error : new Error(String(error));
    // Pile des composants en plus de celle du code : on sait quel écran a planté.
    if (info.componentStack && withStack.stack && !withStack.stack.includes('\n\nComposants :')) withStack.stack += `\n\nComposants :${info.componentStack}`;
    reportError(withStack, this.props.where);
  }

  retry = () => this.setState({ error: null, failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ? this.props.fallback(this.state.error, this.retry) : <ScreenError error={this.state.error} onRetry={this.retry} />;
  }
}

const reload = () => window.location.reload();

function explain(error: unknown): string {
  if (isChunkLoadError(error))
    return navigator.onLine === false
      ? 'Cet écran n’a pas pu être téléchargé : l’appareil semble hors ligne. Rechargez une fois la connexion revenue.'
      : 'Une nouvelle version de Gabian est en ligne. Rechargez l’appli pour la prendre.';
  return 'Cet écran a rencontré un problème. Le club en a été averti ; rechargez l’appli pour reprendre.';
}

/** Écran en panne, dans la page : le reste de l'appli (en-tête, onglets) reste utilisable. */
export function ScreenError({ error, onRetry, onClose }: { error: unknown; onRetry?: () => void; onClose?: () => void }) {
  return (
    <div role="alert" className="max-w-xl mx-auto px-4 py-12 text-center">
      <AlertTriangle aria-hidden className="w-8 h-8 mx-auto text-warn" />
      <p className="mt-3 text-lg font-semibold text-brand">Un problème est survenu</p>
      <p className="mt-1 text-muted">{explain(error)}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reload} className="btn btn-primary">
          <RefreshCw aria-hidden className="w-4 h-4" /> Recharger l’appli
        </button>
        {onRetry && !isChunkLoadError(error) && (
          <button type="button" onClick={onRetry} className="btn btn-quiet">
            Réessayer
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="btn btn-quiet">
            <X aria-hidden className="w-4 h-4" /> Fermer
          </button>
        )}
      </div>
    </div>
  );
}

/** Panneau (fenêtre) en panne : le même message dans une fenêtre, fermable (Échap, Retour, bouton). */
export function PanelError({ error, onClose }: { error: unknown; onClose: () => void }) {
  const { ref } = useDialog({ onClose, label: 'erreur' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Erreur" className="panel w-full max-w-md outline-none">
        <ScreenError error={error} onClose={onClose} />
      </div>
    </div>
  );
}

/** Toute l'appli en panne (frontière racine) : page autonome, sans rien de l'appli autour. */
export function AppCrash({ error }: { error: unknown }) {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-canvas text-ink">
      <ScreenError error={error} />
    </main>
  );
}
