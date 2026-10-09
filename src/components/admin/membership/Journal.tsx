import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ExternalLink } from 'lucide-react';
import { appApi, type MemberWriteLog } from '../../../services/appApi';
import { GabianLoader } from '../../Gabian';
import { SectionTitle } from '../../SectionTitle';
import { describeSnapshot } from '../../../lib/memberWrite';
import type { Capacity } from '../../../lib/membership';
import { message } from '../../../lib/errors';
import { VPDIVE_MEMBER } from './shared';
import { MemberSheetButton } from '../../member/MemberLink';

const KIND_LABEL: Record<string, string> = { season: 'saison', licence: 'date de licence', 'licence-add': 'licence ajoutée', insurance: 'assurance', brevets: 'niveaux' };

/**
 * Journal des écritures (étape 3) : chaque fiche écrite par les corrections
 * rapides, la plus récente d'abord, avec la fiche d'avant (de quoi tout
 * remettre à la main dans VPDive). Partagé entre admins, lu sur le serveur.
 */
export function Journal({ catalog, onClose, onSessionLost }: { catalog: Capacity[] | null; onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [writes, setWrites] = useState<MemberWriteLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    appApi.memberWrites().then(
      (w) => live && setWrites([...w].reverse()),
      (e) => live && !onSessionLost(e) && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [onSessionLost]);
  const levelName = useMemo(() => {
    const names = new Map((catalog ?? []).map((c) => [c.id, c.name]));
    return (id: string) => names.get(id);
  }, [catalog]);
  const when = (at: string) => new Date(at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={onClose} className="btn btn-quiet sm:h-9 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <SectionTitle>Journal des écritures</SectionTitle>
          <p className="text-sm text-muted max-w-3xl">
            Les fiches VPDive écrites par les corrections rapides, les plus récentes d’abord. La fiche d’avant est gardée : de quoi remettre une valeur à la main si besoin.
          </p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          Journal illisible : {error}
        </p>
      ) : !writes ? (
        <GabianLoader label="Lecture du journal…" />
      ) : writes.length === 0 ? (
        <p className="py-10 text-center text-muted">Aucune écriture pour l’instant.</p>
      ) : (
        // Une carte par écriture : chaque fiche écrite se lit à part.
        <ul className="space-y-2">
          {writes.map((w, i) => (
            <li key={`${w.at}|${w.uct}|${i}`} className="item-card space-y-1.5">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
                {w.ok ? <Check className="w-4 h-4 mt-0.5 text-ok shrink-0" aria-label="réussie" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-danger shrink-0" aria-label="à vérifier" />}
                <span className="w-40 shrink-0 text-muted tabular-nums">{when(w.at)}</span>
                <span className="w-40 min-w-0 shrink-0 text-muted truncate">par {w.by}</span>
                <a href={VPDIVE_MEMBER(w.uct)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand underline underline-offset-2">
                  {w.name || 'Fiche'} <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <MemberSheetButton member={{ uct: w.uct, name: w.name || 'ce membre' }} className="-my-1.5 -ml-3" />
                <span className="text-ink">{w.kinds.map((k) => KIND_LABEL[k] ?? k).join(', ')}</span>
              </div>
              <p className={`text-sm ${w.ok ? 'text-muted' : 'text-danger'}`}>{w.message}</p>
              {w.before != null && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted hover:text-brand">Fiche d’avant</summary>
                  <dl className="mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
                    {describeSnapshot(w.before, levelName).map((l) => (
                      <div key={l.label} className="contents">
                        <dt className="text-muted">{l.label}</dt>
                        <dd className="text-ink break-words">{l.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
