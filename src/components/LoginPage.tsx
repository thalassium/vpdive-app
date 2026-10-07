import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { vpdive, type Session } from '../services/vpdiveApi';
import { Logo } from './Brand';
import { ThemeToggle } from './ThemeToggle';
import { SeaBackdrop } from './SeaBackdrop';

interface LoginPageProps {
  onLoginSuccess: (session: Session) => void;
  /** Shown when the previous session expired, so the member knows why they are here. */
  notice?: string | null;
}

const inputCls =
  'w-full bg-surface border border-line rounded-xl px-4 py-3 text-base text-ink placeholder-muted/60 focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition';

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
        <div className="w-full max-w-sm animate-rise">
          <Logo className="h-28 sm:h-32 mx-auto mb-7" />

          <div className="bg-surface rounded-3xl border border-line shadow-card p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-brand">Agenda des sorties</h1>
            <p className="font-serif italic text-muted mt-1 mb-6">Connectez-vous avec votre compte VPDive</p>

            {notice && !error && (
              <div className="mb-4 p-3.5 rounded-xl bg-warn-soft text-warn text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{notice}</span>
              </div>
            )}

            {error && (
              <div role="alert" className="mb-4 p-3.5 rounded-xl bg-danger-soft text-danger text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Connexion impossible</strong>
                  <span>{error}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-brand mb-1.5">
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
                <label htmlFor="password" className="block text-sm font-medium text-brand mb-1.5">
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
                <span className="text-xs text-muted block mt-1.5">Envoyé uniquement à VPDive, jamais conservé dans le navigateur.</span>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-fill hover:bg-fill-hover active:scale-[0.99] text-white font-semibold text-base transition disabled:opacity-50"
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

      <footer className="relative py-5 text-center text-xs text-muted">
        Septentrion Environnement · Association loi 1901 · Pointe Rouge, Marseille
      </footer>
    </div>
  );
}
