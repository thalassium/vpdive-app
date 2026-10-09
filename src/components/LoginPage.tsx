import { useId, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { vpdive, type Session } from '../services/vpdiveApi';
import { Logo } from './Brand';
import { Gabian } from './Gabian';
import { ThemeToggle } from './ThemeToggle';
import { SeaBackdrop } from './SeaBackdrop';

interface LoginPageProps {
  onLoginSuccess: (session: Session) => void;
  /** Shown when the previous session expired, so the member knows why they are here. */
  notice?: string | null;
}

/** Page de connexion, au premier lancement (ou après « Se déconnecter »). */
export function LoginPage({ onLoginSuccess, notice }: LoginPageProps) {
  return (
    <div className="relative min-h-dvh flex flex-col">
      <SeaBackdrop rose="center" />

      <div className="relative flex justify-end p-3">
        <ThemeToggle />
      </div>

      <main className="relative flex-1 flex items-center justify-center px-4 pb-10">
        <div className="w-full max-w-sm">
          <Logo className="h-16 mx-auto mb-6" />

          {/* Le gabian, posé sur la carte de connexion comme sur un quai */}
          <Gabian title="Un gabian, le goéland de Marseille" className="block w-40 h-auto mx-auto -mb-[3px]" />
          <div className="card p-6 sm:p-8">
            <h1 className="text-xl font-semibold text-brand">Gabian</h1>
            <p className="text-muted mt-1 mb-6">Les sorties du club. Connectez-vous avec votre compte VPDive.</p>
            <LoginForm onLoginSuccess={onLoginSuccess} notice={notice} />
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Pas de compte ou mot de passe oublié ?{' '}
            <a href="https://septentrion-env.vpdive.com/" target="_blank" rel="noreferrer" className="text-brand font-semibold underline underline-offset-2">
              Rendez-vous sur VPDive
            </a>
          </p>
        </div>
      </main>

      <footer className="relative py-5 text-center text-sm text-muted">
        Septentrion Environnement · Association loi 1901 · Pointe Rouge, Marseille
      </footer>
    </div>
  );
}

interface LoginFormProps extends LoginPageProps {
  /** Adresse déjà remplie (reconnexion après une session expirée). */
  initialEmail?: string;
}

/**
 * Formulaire de connexion VPDive : celui de la page de connexion, et celui de la
 * fenêtre de reconnexion (ReconnectDialog) quand la session expire en cours d'usage.
 */
export function LoginForm({ onLoginSuccess, notice, initialEmail = '' }: LoginFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const errorId = `${ids}-error`;
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      onLoginSuccess(await vpdive.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  // Les deux champs sont mis en cause : VPDive ne dit pas lequel est faux.
  const invalid = error ? { 'aria-invalid': true as const, 'aria-describedby': errorId } : {};

  return (
    <>
      {notice && !error && (
        <div className="mb-4 p-3.5 rounded-xl bg-warn-soft text-warn text-base flex items-start gap-2">
          <AlertCircle aria-hidden className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div id={errorId} role="alert" className="mb-4 p-3.5 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2">
          <AlertCircle aria-hidden className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong className="block font-semibold">Connexion impossible</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor={emailId} className="label block mb-1.5">
            Adresse e-mail
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="prenom.nom@exemple.fr"
            className="field w-full"
            {...invalid}
          />
        </div>

        <div>
          <label htmlFor={passwordId} className="label block mb-1.5">
            Mot de passe
          </label>
          <input
            id={passwordId}
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Votre mot de passe VPDive"
            className="field w-full"
            data-autofocus={initialEmail ? '' : undefined}
            {...invalid}
          />
        </div>

        <button type="submit" disabled={isLoading} className="btn btn-primary w-full h-12">
          {isLoading ? (
            'Connexion en cours…'
          ) : (
            <>
              Se connecter <ArrowRight aria-hidden className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </>
  );
}
