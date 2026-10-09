import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, RotateCcw, X } from 'lucide-react';
import { vpdive } from '../../services/vpdive';
import { automaticLevels, type BrevetMap } from '../../lib/membership';
import { message } from '../../lib/errors';
import { SectionTitle } from '../SectionTitle';


/**
 * Correspondance des brevets (roue crantée de l'onglet Adhésions) : pour chaque
 * brevet de l'export FFESSM, les niveaux VPDive qui le valent. Sans choix, la
 * règle automatique s'applique (codes P2/N2, PNC, PA40…) : on la montre pour
 * qu'un admin la confirme ou la remplace. Partagé entre admins.
 */
export function BrevetMapView({
  brevets,
  map,
  onSave,
  onClose,
  onSessionLost,
}: {
  /** Brevets présents dans l'export FFESSM déposé. */
  brevets: string[];
  map: BrevetMap;
  onSave: (brevet: string, levels: string[]) => Promise<void>;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Référentiel des niveaux VPDive : FFESSM d'abord, puis les autres fédérations.
  useEffect(() => {
    vpdive.capacityNames().then(
      (groups) => setNames([...groups.filter((g) => /F\.F\.E\.S\.S\.M\./.test(g.group)), ...groups.filter((g) => !/F\.F\.E\.S\.S\.M\./.test(g.group))].flatMap((g) => g.names)),
      (e) => onSessionLost(e) || setError(message(e)),
    );
  }, [onSessionLost]);

  const all = [...new Set([...brevets, ...Object.keys(map)])].sort((a, b) => a.localeCompare(b, 'fr'));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={onClose} className="btn btn-quiet sm:h-9 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <SectionTitle>Correspondance des brevets</SectionTitle>
          <p className="text-sm text-muted max-w-3xl">
            Pour chaque brevet de l’export FFESSM, les niveaux VPDive qui le valent. Sans choix, la règle automatique s’applique (par code : Niveau 2 → P2/N2, Nitrox confirmé →
            PNC…). Les choix sont partagés entre les admins.
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-danger">Niveaux VPDive non lus : {error}</p>}
      {all.length === 0 ? (
        <p className="py-8 text-center text-muted">Déposez d’abord l’export des brevets.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {all.map((b) => (
            <BrevetRow key={b} brevet={b} chosen={map[b] ?? []} names={names} inExport={brevets.includes(b)} onSave={(levels) => onSave(b, levels)} />
          ))}
        </ul>
      )}
      {names && (
        <datalist id="vpdive-levels">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
    </div>
  );
}

function BrevetRow({ brevet, chosen, names, inExport, onSave }: { brevet: string; chosen: string[]; names: string[] | null; inExport: boolean; onSave: (levels: string[]) => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auto = names ? automaticLevels(brevet, names) : [];
  const custom = chosen.length > 0;
  const shown = custom ? chosen : auto;
  const save = async (levels: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(levels);
      setTyped('');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const valid = !!names?.includes(typed) && !chosen.includes(typed);
  return (
    <li className="p-4 grid gap-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] items-start">
      <div>
        <p className="font-semibold text-ink">{brevet}</p>
        <p className="text-sm text-muted">{custom ? 'choisi par un admin' : auto.length ? 'règle automatique' : ''}{!inExport && ' · absent du dernier export'}</p>
      </div>
      <div className="space-y-2 min-w-0">
        {shown.length === 0 ? (
          <p className="text-sm text-warn font-medium">{names ? 'Aucun niveau VPDive reconnu : à choisir.' : 'Lecture des niveaux VPDive…'}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((n) => (
              <li key={n} className={`inline-flex items-center gap-1 max-w-full rounded-md px-2 text-sm leading-7 ${custom ? 'bg-tint text-brand font-medium' : 'border border-line text-muted'}`}>
                <span className="truncate">{n}</span>
                {custom && (
                  <button type="button" disabled={busy} onClick={() => void save(chosen.filter((x) => x !== n))} aria-label={`Retirer ${n}`} className="icon-btn relative w-6 h-6 -mr-1 hover:text-danger max-sm:before:absolute max-sm:before:-inset-2.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            list="vpdive-levels"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Chercher un niveau VPDive…"
            aria-label={`Niveau VPDive pour ${brevet}`}
            className="field sm:h-9 flex-1 min-w-[14rem]"
          />
          <button type="button" disabled={!valid || busy} onClick={() => void save([...chosen, typed])} className="btn btn-quiet sm:h-9 text-sm">
            <Plus className="w-4 h-4" /> Ajouter
          </button>
          {custom && (
            <button type="button" disabled={busy} onClick={() => void save([])} className="btn btn-quiet sm:h-9 text-sm" title="Revenir à la règle automatique">
              <RotateCcw className="w-4 h-4" /> Automatique
            </button>
          )}
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </li>
  );
}
