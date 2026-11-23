import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Copy, MessageCircle, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import { santaApi, type SantaStatus } from '../../services/santaApi';
import { santaAdminHash, santaLink, whatsappUrl } from '../../lib/santaRoute';
import { message } from '../../lib/errors';
import { useConfirm } from '../../hooks/useConfirm';
import { Spinner } from '../Spinner';
import { SantaHeading } from './SantaHeading';

const namesOf = (text: string) => [...new Set(text.split('\n').map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean))];
const openedLabel = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Page de l'organisateur : préparer le tirage (participants, paires interdites), puis
 * envoyer les liens et suivre qui a ouvert le sien. La clé du tirage est dans l'adresse
 * (#santa-admin=<clé>) : c'est elle qui donne accès au suivi. Les paires ne sont jamais
 * affichées ici, le serveur ne les envoie pas.
 */
export function SantaAdmin({ initialKey }: { initialKey: string | null }) {
  const [status, setStatus] = useState<SantaStatus | null>(null);
  const [loading, setLoading] = useState(!!initialKey);
  const [error, setError] = useState<string | null>(null);
  /** Formulaire ouvert sur un tirage existant (le refaire). */
  const [editing, setEditing] = useState(false);
  const key = status?.key ?? initialKey;

  /** Incrémenté par « Actualiser » : relance la lecture du suivi. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      santaApi
        .status(key)
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          setError(null);
        })
        .catch((e) => alive && setError(message(e, 'Tirage introuvable.')))
        .finally(() => alive && setLoading(false));
    void load();
    // Retour sur la page (après WhatsApp) : le suivi se remet à jour.
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, tick]);

  const drawn = (s: SantaStatus) => {
    history.replaceState(null, '', santaAdminHash(s.key));
    setStatus(s);
    setEditing(false);
    setError(null);
    window.scrollTo({ top: 0 });
  };

  if (!status && initialKey) {
    return (
      <div>
        <SantaHeading />
        <div className="card p-6 text-center">{loading ? <Spinner className="mx-auto text-muted" /> : <p className="text-danger">{error}</p>}</div>
      </div>
    );
  }

  if (!status || editing) return <DrawForm current={status} onDrawn={drawn} onCancel={status ? () => setEditing(false) : undefined} />;
  return <Follow status={status} loading={loading} error={error} onRefresh={() => {
        setLoading(true);
        setTick((t) => t + 1);
      }} onStatus={setStatus} onEdit={() => setEditing(true)} />;
}

function DrawForm({ current, onDrawn, onCancel }: { current: SantaStatus | null; onDrawn: (s: SantaStatus) => void; onCancel?: () => void }) {
  const [title, setTitle] = useState(current?.title ?? '');
  const [namesText, setNamesText] = useState(current?.people.map((p) => p.name).join('\n') ?? '');
  const [pairs, setPairs] = useState<[string, string][]>(current?.exclusions ?? []);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const ids = useId();

  const names = useMemo(() => namesOf(namesText), [namesText]);
  // Une paire dont un nom a été retiré de la liste ne compte plus.
  const livePairs = pairs.filter(([x, y]) => names.includes(x) && names.includes(y));
  const samePair = ([x, y]: [string, string], u: string, v: string) => (x === u && y === v) || (x === v && y === u);
  const canAdd = !!a && !!b && a !== b && names.includes(a) && names.includes(b) && !livePairs.some((p) => samePair(p, a, b));

  const addPair = () => {
    if (!canAdd) return;
    setPairs([...livePairs, [a, b]]);
    setB('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (current) {
      const opened = current.people.filter((p) => p.openedAt).length;
      const ok = await confirm({
        title: 'Refaire le tirage ?',
        message: `Les ${current.people.length} liens déjà créés ne marcheront plus${opened ? ` (${opened} déjà ouvert${opened > 1 ? 's' : ''})` : ''}.`,
        confirmLabel: 'Refaire le tirage',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      onDrawn(await santaApi.draw({ ...(current ? { key: current.key } : {}), title: title.trim(), names, exclusions: livePairs }));
    } catch (err) {
      setError(message(err, 'Tirage impossible.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <SantaHeading />
      <div className="card p-5 sm:p-6 space-y-5">
        <div>
          <label htmlFor={`${ids}-title`} className="label block mb-1.5">
            Nom du tirage
          </label>
          <input id={`${ids}-title`} className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Noël 2026 · 20 € max" />
        </div>

        <div>
          <label htmlFor={`${ids}-names`} className="label flex justify-between mb-1.5">
            <span>Participants, un par ligne</span>
            <span className="tabular-nums">{names.length}</span>
          </label>
          <textarea
            id={`${ids}-names`}
            className="field w-full h-auto py-2.5 leading-relaxed"
            rows={Math.max(6, names.length + 1)}
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
            autoCapitalize="words"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </div>

        <fieldset>
          <legend className="label mb-1.5">Paires interdites</legend>
          {livePairs.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {livePairs.map(([x, y]) => (
                <li key={`${x}\n${y}`} className="flex items-center gap-2 pl-3 rounded-lg bg-raised">
                  <span className="flex-1 min-w-0 truncate">
                    {x} <span className="text-muted">✕</span> {y}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Retirer la paire ${x} et ${y}`} onClick={() => setPairs(livePairs.filter((p) => !samePair(p, x, y)))}>
                    <X aria-hidden className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <select className="field flex-1 min-w-0" value={a} onChange={(e) => setA(e.target.value)} aria-label="Première personne" disabled={names.length < 2}>
              <option value="">Personne</option>
              {names.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <select className="field flex-1 min-w-0" value={b} onChange={(e) => setB(e.target.value)} aria-label="Seconde personne" disabled={names.length < 2}>
              <option value="">Personne</option>
              {names
                .filter((n) => n !== a)
                .map((n) => (
                  <option key={n}>{n}</option>
                ))}
            </select>
            <button type="button" className="btn btn-quiet px-3" onClick={addPair} disabled={!canAdd} aria-label="Ajouter la paire interdite">
              <Plus aria-hidden className="w-4 h-4" />
            </button>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="p-3 rounded-xl bg-danger-soft text-danger flex items-start gap-2">
            <AlertCircle aria-hidden className="w-4 h-4 shrink-0 mt-1" />
            <span>{error}</span>
          </p>
        )}

        <div className="flex gap-2">
          {onCancel && (
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Annuler
            </button>
          )}
          <button type="submit" className="btn btn-primary flex-1" disabled={busy || names.length < 3} aria-busy={busy}>
            {busy && <Spinner />}
            {current ? 'Refaire le tirage' : 'Tirer au sort'}
          </button>
        </div>
      </div>
      {confirmDialog}
    </form>
  );
}

function Follow({
  status,
  loading,
  error,
  onRefresh,
  onStatus,
  onEdit,
}: {
  status: SantaStatus;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStatus: (s: SantaStatus) => void;
  onEdit: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [copied, setCopied] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const opened = status.people.filter((p) => p.openedAt).length;

  const copy = async (id: string, text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      // Presse-papiers refusé : le texte est montré, sélectionné, à copier à la main.
      await confirm({ title: `Copier ${what}`, text, confirmLabel: 'Fermer', cancelLabel: null });
    }
  };

  const renew = async (name: string, wasOpened: boolean) => {
    const ok = await confirm({
      title: `Nouveau lien pour ${name} ?`,
      message: wasOpened ? 'Il montrera la même personne, une seule fois.' : 'Le lien actuel ne marchera plus.',
      confirmLabel: 'Nouveau lien',
    });
    if (!ok) return;
    setRenewing(name);
    setActionError(null);
    try {
      onStatus(await santaApi.renew(status.key, name));
    } catch (e) {
      setActionError(message(e, 'Réessayez.'));
    } finally {
      setRenewing(null);
    }
  };

  const shown = actionError ?? error;

  return (
    <div>
      <SantaHeading title={status.title} />

      <div className="card p-4 mb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink">Adresse de cette page</p>
          <p className="text-muted text-sm">À garder : seul accès au suivi.</p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => void copy('admin', location.href, 'l’adresse')}>
          {copied === 'admin' ? <Check aria-hidden className="w-4 h-4" /> : <Copy aria-hidden className="w-4 h-4" />}
          {copied === 'admin' ? 'Copiée' : 'Copier'}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="section-title">
          <span className="flex-1">
            Liens ouverts : <span className="tabular-nums">{opened} / {status.people.length}</span>
          </span>
          <button type="button" className="icon-btn text-on-accent hover:bg-transparent" onClick={onRefresh} aria-label="Actualiser" disabled={loading}>
            <RefreshCw aria-hidden className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {shown && (
          <p role="alert" className="m-3 p-3 rounded-xl bg-danger-soft text-danger">
            {shown}
          </p>
        )}

        <ul className="divide-y divide-line">
          {status.people.map((p) => {
            const link = santaLink(p.token);
            return (
              <li key={p.name} className="p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex-1 min-w-[9rem]">
                  <p className="font-semibold text-ink break-words">{p.name}</p>
                  {p.openedAt ? <p className="text-sm text-ok">Ouvert le {openedLabel(p.openedAt)}</p> : <p className="text-sm text-muted">Pas ouvert</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  {!p.openedAt && (
                    <>
                      <a className="btn btn-primary px-3" href={whatsappUrl(p.name, status.title, link)} target="_blank" rel="noreferrer">
                        <MessageCircle aria-hidden className="w-4 h-4" />
                        WhatsApp
                      </a>
                      <button type="button" className="btn btn-quiet px-3" onClick={() => void copy(p.token, link, 'le lien')} aria-label={`Copier le lien de ${p.name}`}>
                        {copied === p.token ? <Check aria-hidden className="w-4 h-4" /> : <Copy aria-hidden className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-quiet px-3" onClick={() => void renew(p.name, !!p.openedAt)} disabled={renewing !== null} aria-label={`Nouveau lien pour ${p.name}`} title="Nouveau lien">
                    {renewing === p.name ? <Spinner /> : <RotateCcw aria-hidden className="w-4 h-4" />}
                    {p.openedAt && 'Nouveau lien'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <button type="button" className="btn btn-quiet w-full mt-3" onClick={onEdit}>
        Modifier et refaire le tirage
      </button>
      {confirmDialog}
    </div>
  );
}
