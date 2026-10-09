import { useId } from 'react';
import { LogOut } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { LoginForm } from './LoginPage';
import type { Session } from '../services/vpdive';

interface Props {
  /** Pourquoi on redemande le mot de passe (« Votre session VPDive a expiré… »). */
  notice: string;
  /** Adresse du compte qui était connecté, déjà remplie. */
  email: string;
  onReconnected: (session: Session) => void;
  /** Changer de compte : retour à la page de connexion (l'écran en cours est alors perdu). */
  onLogout: () => void;
}

/**
 * Session VPDive expirée en cours d'usage : la connexion est redemandée par-dessus
 * l'écran, sans le démonter. Une fiche en cours de saisie, un message pas encore
 * envoyé, un panneau ouvert : tout est encore là après la reconnexion.
 *
 * Ni Échap, ni le bouton Retour, ni un clic à côté ne la ferment : sans session,
 * rien derrière ne marcherait. « Se déconnecter » mène à la page de connexion.
 */
export function ReconnectDialog({ notice, email, onReconnected, onLogout }: Props) {
  const { ref } = useDialog({ onClose: () => {}, canClose: () => false, label: 'reconnexion' });
  const titleId = useId();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-scrim p-4 animate-fade">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="panel w-full max-w-sm border-t-[3px] border-t-pink p-6 animate-pop outline-none">
        <h2 id={titleId} className="text-xl font-semibold text-brand">
          Reconnexion
        </h2>
        <p className="text-muted mt-1 mb-5">Votre écran reste tel quel : reconnectez-vous pour continuer.</p>
        <LoginForm notice={notice} initialEmail={email} onLoginSuccess={onReconnected} />
        <button type="button" onClick={onLogout} className="btn btn-quiet w-full mt-3">
          <LogOut aria-hidden className="w-4 h-4" /> Se connecter avec un autre compte
        </button>
      </div>
    </div>
  );
}
