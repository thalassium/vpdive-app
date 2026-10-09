import { useState } from 'react';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { BrevetMapView } from './BrevetMapView';
import { appApi } from '../../services/appApi';
import { normalizeName } from '../../lib/fuzzy';
import { Arbitrage } from './membership/Arbitrage';
import { Diagnostic } from './membership/Diagnostic';
import { Journal } from './membership/Journal';
import { QuickFixes } from './membership/QuickFixes';
import { useMembershipData } from './membership/useMembershipData';
import type { Filter, Row, StepProps } from './membership/shared';

/**
 * Gestion des adhésions, étapes 2 à 4 : chaque personne de la saison vue par
 * HelloAsso (ce qui est payé), la FFESSM (la licence prise, export Mon Club
 * déposé ici) et VPDive (la fiche). Données et lectures : membership/useMembershipData ;
 * une étape par composant (Diagnostic, QuickFixes, Arbitrage), et le journal des écritures.
 */

export type MembershipStep = 'diagnostic' | 'quickfix' | 'arbitrage';

/**
 * Étapes 2 à 4 de la gestion des adhésions, sur les mêmes données (lues une
 * fois, gardées tant que la fenêtre est ouverte) :
 *   diagnostic  chaque personne vue par HelloAsso, la FFESSM et VPDive (✅ ❌ ⚠️)
 *   quickfix    les corrections sans risque, par type, à pousser dans VPDive
 *   arbitrage   le cas par cas, à décider à la main
 * Les fiches VPDive sont lues une à une (la file du transport les espace), et gardées
 * 6 h dans la session ; « Relire les fiches » les relit après des corrections.
 */
export function MembershipTab({
  step,
  onCounts,
  onSessionLost,
  onWriting,
  forgetRef,
}: {
  step: MembershipStep;
  onCounts?: (c: { fixes: number; cases: number }) => void;
  onSessionLost: (e: unknown) => boolean;
  /** Écriture dans VPDive en cours ou finie : le panneau ne se ferme pas pendant. */
  onWriting?: (busy: boolean) => void;
  /** Rempli ici : à appeler après une validation (étape 1), la fiche de ce membre est relue. */
  forgetRef?: { current: ((uct: string) => void) | null };
}) {
  const data = useMembershipData({ onCounts, onSessionLost, onWriting, forgetRef });
  const { brevetsImport, brevetMap, setBrevetMap, catalog, progress, readError, loading, haError, loadError, loadHelloasso, refresh, stopReading, resumeReading, busy } = data;
  const [configOpen, setConfigOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('gaps');
  const [query, setQuery] = useState('');
  /** Journal des écritures (étape 3) ouvert. */
  const [logOpen, setLogOpen] = useState(false);
  const q = normalizeName(query);
  const matches = (r: Row) => !q || normalizeName(`${r.p.name} ${r.match.member?.name ?? ''} ${r.p.ffessm?.licence ?? ''}`).includes(q);

  if (logOpen) return <Journal catalog={catalog} onClose={() => setLogOpen(false)} onSessionLost={onSessionLost} />;

  if (configOpen) {
    return (
      <BrevetMapView
        brevets={[...new Set((brevetsImport?.rows ?? []).map((r) => r.brevet))]}
        map={brevetMap}
        onSave={async (brevet, levels) => setBrevetMap(await appApi.setBrevetMap(brevet, levels))}
        onClose={() => setConfigOpen(false)}
        onSessionLost={onSessionLost}
      />
    );
  }
  const progressBar = (progress || readError) && (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted" aria-live="polite">
      {progress ? (
        <>
          <span className="tabular-nums">
            Lecture des fiches VPDive… {progress.done}/{progress.total}
          </span>
          <span aria-hidden className="h-1 w-32 rounded-full bg-line overflow-hidden">
            <span className="block h-full bg-fill transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </span>
          <button
            type="button"
            onClick={stopReading}
            className="btn btn-quiet sm:h-8 text-sm"
          >
            Arrêter
          </button>
        </>
      ) : (
        <>
          <span className="text-danger">{readError}</span>
          <button type="button" onClick={resumeReading} className="btn btn-quiet sm:h-8 text-sm">
            <RefreshCw className="w-4 h-4" /> Reprendre
          </button>
        </>
      )}
    </div>
  );

  const errors = (loadError || haError) && (
    <div role="alert" className="p-3 rounded-xl bg-danger-soft text-danger text-sm flex flex-wrap items-center gap-3">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0">{haError ? `HelloAsso : ${haError}` : loadError}</span>
      {haError && (
        <button type="button" onClick={loadHelloasso} className="btn btn-quiet sm:h-8 text-sm">
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      )}
    </div>
  );

  const refreshButton = (
    <button type="button" onClick={refresh} disabled={!!progress || loading || busy} className="btn btn-quiet sm:h-9 text-sm" title="Relit les fiches VPDive, sans le cache de la session">
      <RefreshCw className="w-4 h-4" /> Relire les fiches VPDive
    </button>
  );

  const search = (
    <label className="relative flex-1 min-w-[12rem] max-w-xs ml-auto">
      <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou n° de licence" aria-label="Chercher" className="field w-full sm:h-9 pl-9" />
    </label>
  );

  const props: StepProps = { ...data, filter, setFilter, matches, errors, progressBar, refreshButton, search, setConfigOpen, setLogOpen, onSessionLost };
  if (step === 'diagnostic') return <Diagnostic {...props} />;
  if (step === 'quickfix') return <QuickFixes {...props} />;
  return <Arbitrage {...props} />;
}
