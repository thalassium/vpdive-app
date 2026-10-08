import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { vpdive, type Session } from '../services/vpdiveApi';
import { Logo } from './Brand';
import { Cromagnon } from './Cromagnon';
import { ThemeToggle } from './ThemeToggle';
import { SeaBackdrop } from './SeaBackdrop';

interface LoginPageProps {
  onLoginSuccess: (session: Session) => void;
  /** Shown when the previous session expired, so the member knows why they are here. */
  notice?: string | null;
}

const inputCls = 'field w-full';

export function LoginPage({ onLoginSuccess, notice }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="relative min-h-dvh flex flex-col">
      <SeaBackdrop rose="center" />

      <div className="relative flex justify-end p-3">
        <ThemeToggle />
      </div>

      <main className="relative flex-1 flex items-center justify-center px-4 pb-10">
        <div className="w-full max-w-sm">
          <Logo className="h-16 mx-auto mb-6" />

          {/* Le Cromagnon, posé sur la carte de connexion comme sur l'eau */}
          <Cromagnon title="Le Cromagnon, bateau du club" className="block w-56 mx-auto -mb-px text-brand" />
          <div className="card p-6 sm:p-8">
            <h1 className="text-xl font-semibold text-brand">Agenda des sorties</h1>
            <p className="text-muted mt-1 mb-6">Connectez-vous avec votre compte VPDive</p>

            {notice && !error && (
              <div className="mb-4 p-3.5 rounded-xl bg-warn-soft text-warn text-base flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div role="alert" className="mb-4 p-3.5 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Connexion impossible</strong>
                  <span>{error}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="label block mb-1.5">
                  Adresse e-mail
                </label>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@exemple.fr"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="password" className="label block mb-1.5">
                  Mot de passe
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Votre mot de passe VPDive"
                  className={inputCls}
                />
                <span className="text-sm text-muted block mt-1.5">Envoyé uniquement à VPDive, jamais conservé dans le navigateur.</span>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary w-full h-12"
              >
                {isLoading ? (
                  'Connexion en cours…'
                ) : (
                  <>
                    Se connecter <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-muted">
            Pas de compte ou mot de passe oublié ?{' '}
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
