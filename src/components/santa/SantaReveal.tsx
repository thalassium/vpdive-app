import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { santaApi } from '../../services/santaApi';
import { message } from '../../lib/errors';
import { Spinner } from '../Spinner';
import { SantaHeading } from './SantaHeading';

type State =
  | { step: 'loading' }
  | { step: 'ready'; name: string; title: string }
  | { step: 'opened'; name: string; title: string }
  | { step: 'revealed'; name: string; title: string; to: string }
  | { step: 'gone'; error: string };

/**
 * Le lien d'un participant. Charger la page ne l'ouvre pas (aperçu WhatsApp, appui par
 * erreur) : le prénom n'est demandé au serveur qu'à l'appui sur le bouton, une seule fois.
 * Il n'est gardé nulle part : la page rechargée ne le montre plus.
 */
export function SantaReveal({ token }: { token: string }) {
  const [state, setState] = useState<State>({ step: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    santaApi
      .peek(token)
      .then((p) => alive && setState({ step: p.opened ? 'opened' : 'ready', name: p.name, title: p.title }))
      .catch((e) => alive && setState({ step: 'gone', error: message(e, 'Ce lien n’existe plus.') }));
    return () => {
      alive = false;
    };
  }, [token]);

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      setState({ step: 'revealed', ...(await santaApi.reveal(token)) });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 410 && state.step === 'ready') setState({ ...state, step: 'opened' });
      else if (status === 404) setState({ step: 'gone', error: message(e) });
      else setError(message(e, 'Réessayez.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <SantaHeading title={'title' in state ? state.title : undefined} />
      <div className="card p-6 text-center" aria-live="polite">
        {state.step === 'loading' && <Spinner className="mx-auto text-muted" />}

        {state.step === 'gone' && <p className="text-danger">{state.error}</p>}

        {state.step === 'opened' && (
          <>
            <p className="font-semibold text-ink">Lien de {state.name}</p>
            <p className="text-danger mt-2">Ce lien a déjà été ouvert.</p>
          </>
        )}

        {state.step === 'ready' && (
          <>
            <p className="font-semibold text-ink">Lien de {state.name}</p>
            <p className="text-muted mt-1 mb-5">Il ne s’ouvre qu’une seule fois.</p>
            {error && (
              <p role="alert" className="mb-4 p-3 rounded-xl bg-danger-soft text-danger flex items-start gap-2 text-left">
                <AlertCircle aria-hidden className="w-4 h-4 shrink-0 mt-1" />
                <span>{error}</span>
              </p>
            )}
            <button type="button" className="btn btn-primary w-full" onClick={() => void reveal()} disabled={busy} aria-busy={busy}>
              {busy && <Spinner />}
              Voir qui j’ai tiré
            </button>
          </>
        )}

        {state.step === 'revealed' && (
          <>
            <p className="text-muted">{state.name}, tu offres un cadeau à</p>
            <p className="my-4 text-4xl font-bold text-brand break-words">{state.to}</p>
            <p className="text-muted">Ce lien ne s’ouvrira plus.</p>
          </>
        )}
      </div>
    </div>
  );
}
