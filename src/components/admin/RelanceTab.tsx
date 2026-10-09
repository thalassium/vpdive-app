import { AlertTriangle, EyeOff, RefreshCw, Undo2 } from 'lucide-react';
import { Avatar } from '../Avatar';
import { shortDay } from '../../lib/dates';
import type { DocIssue } from '../../lib/docsCheck';
import { DAYS_AHEAD, plural, type Filter, type Row } from './relance';
import type { Relance } from './useRelance';
import { MemberSheetButton } from '../member/MemberLink';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'caci', label: 'CACI' },
  { key: 'licence', label: 'Licence' },
  { key: 'adhesion', label: 'Adhésion' },
  { key: 'ignored', label: 'Ignorés' },
];

/** Sous les onglets, dans l'en-tête : les compteurs par document et les filtres. */
export function RelanceSummary({ relance }: { relance: Relance }) {
  return (
    <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm text-ink flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-danger" /> {plural(relance.counts.caci, 'CACI manquant', 'CACI manquants')}
        </span>
        <span aria-hidden className="text-muted">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-warn" /> {plural(relance.counts.licence, 'licence FFESSM', 'licences FFESSM')}
        </span>
        <span aria-hidden className="text-muted">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 h-2.5 rounded-full bg-warn" /> {plural(relance.counts.adhesion, 'adhésion', 'adhésions')}
        </span>
      </p>
      <div role="radiogroup" aria-label="Filtrer" className="inline-flex rounded-lg border border-field-border bg-surface p-1 sm:ml-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={relance.filter === f.key}
            onClick={() => relance.setFilter(f.key)}
            className="tab-pill px-3 rounded-md"
          >
            {f.label}
            {f.key === 'ignored' && relance.ignoredList.length > 0 && <span className="ml-1 tabular-nums">{relance.ignoredList.length}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** L'onglet Relance : avancement de la lecture, erreurs, membres ignorés, puis un membre par carte. */
export function RelanceTab({ relance }: { relance: Relance }) {
  return (
    <>
      {(relance.loading || relance.verifying || relance.phase === 'stopped') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted px-1" aria-live="polite">
          {relance.phase === 'events' && <span>Lecture des sorties sur VPDive…</span>}
          {relance.phase === 'rosters' && (
            <span>
              Lecture des inscrits… {relance.progress.done}/{relance.progress.total}
            </span>
          )}
          {relance.verifying && (
            <>
              <span>
                Vérification des adhésions… {relance.progress.done}/{relance.progress.total}
              </span>
              <button type="button" onClick={relance.stop} className="btn btn-quiet sm:h-9 text-sm">
                Arrêter
              </button>
            </>
          )}
          {relance.phase === 'stopped' && (
            <>
              <span>
                Vérification arrêtée : {relance.progress.done}/{relance.progress.total} fiches lues.
              </span>
              <button type="button" onClick={relance.resume} className="btn btn-quiet sm:h-9 text-sm">
                <RefreshCw className="w-4 h-4" /> Reprendre
              </button>
            </>
          )}
        </div>
      )}

      {relance.error && (
        <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-1 px-1 text-base text-danger">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">{relance.error}</span>
          <button type="button" onClick={relance.phase === 'stopped' ? relance.resume : relance.load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
            <RefreshCw className="w-4 h-4" /> Réessayer
          </button>
        </div>
      )}
      {relance.rosterErrors.length > 0 && (
        <div role="alert" className="px-1 text-sm text-danger">
          <p className="flex flex-wrap items-center gap-x-3">
            <span className="font-semibold">Inscrits illisibles pour {plural(relance.rosterErrors.length, 'sortie', 'sorties')} :</span>
            {!relance.loading && (
              <button type="button" onClick={relance.load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
                <RefreshCw className="w-4 h-4" /> Réessayer
              </button>
            )}
          </p>
          <ul className="mt-1 space-y-0.5">
            {relance.rosterErrors.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {relance.ignoreError && (
        <p role="alert" className="px-1 text-sm text-danger">
          {relance.ignoreError}
        </p>
      )}
      {relance.statusFailures > 0 && relance.phase !== 'stopped' && (
        <p className="px-1 text-sm text-muted">{plural(relance.statusFailures, 'fiche membre illisible', 'fiches membres illisibles')} : adhésion non vérifiée.</p>
      )}

      {relance.filter !== 'ignored' && relance.outings && relance.phase === 'done' && relance.active.length === 0 && (
        <p className="py-10 text-center text-muted">
          {relance.outings.length === 0 ? `Aucune sortie avec des inscrits dans les ${DAYS_AHEAD} prochains jours.` : 'Tous les inscrits sont en règle.'}
        </p>
      )}
      {relance.filter !== 'ignored' && relance.outings && relance.active.length > 0 && relance.shown.length === 0 && <p className="py-10 text-center text-muted">Personne n’est concerné par ce document.</p>}

      {relance.filter === 'ignored' &&
        (relance.ignoredList.length === 0 ? (
          <p className="py-10 text-center text-muted">Aucun membre ignoré.</p>
        ) : (
          <ul className="space-y-2">
            {relance.ignoredList.map((i) => (
              <li key={i.uct} className="card px-3 py-2.5 flex items-center gap-3">
                <Avatar name={i.name} picture={i.row?.picture ?? ''} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink leading-snug break-words">{i.name}</span>
                  <span className="block text-sm text-muted">
                    Ignoré par {i.by} le {new Date(i.at).toLocaleDateString('fr-FR')}
                  </span>
                </span>
                <MemberSheetButton member={{ uct: i.uct, name: i.name, picture: i.row?.picture }} />
                <button type="button" onClick={() => void relance.setIgnore({ uct: i.uct, name: i.name }, false)} className="btn btn-quiet sm:h-9 text-sm shrink-0">
                  <Undo2 className="w-4 h-4" /> Ne plus ignorer
                </button>
              </li>
            ))}
          </ul>
        ))}

      {relance.shown.length > 0 && (
        <ul className="space-y-2">
          {relance.shown.map((r) => (
            <MemberCard
              key={r.key}
              row={r}
              checked={relance.selected.has(r.key)}
              onToggle={() => relance.toggle(r.key)}
              onRemind={() => relance.setReminder({ rows: [r], bulk: false })}
              onIgnore={r.uct ? () => void relance.setIgnore(r, true) : undefined}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** En bas de la fenêtre : la sélection et « Relancer la sélection ». */
export function RelanceBar({ relance }: { relance: Relance }) {
  return (
    <div className="sticky bottom-0 shrink-0 bg-surface border-t border-line px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-base text-ink font-medium">{plural(relance.picked.length, 'sélectionné', 'sélectionnés')}</span>
      <button type="button" onClick={relance.toggleAll} className="btn btn-quiet sm:h-9 text-sm">
        {relance.allShownPicked ? 'Tout désélectionner' : 'Tout sélectionner'}
      </button>
      <button type="button" disabled={relance.picked.length === 0} onClick={() => relance.setReminder({ rows: relance.picked, bulk: true })} className="btn btn-primary ml-auto">
        Relancer la sélection
      </button>
    </div>
  );
}

function IssueChip({ issue }: { issue: DocIssue }) {
  const tone = issue.level === 'red' ? 'bg-danger-soft text-danger font-semibold' : issue.level === 'yellow' ? 'bg-warn-soft text-warn font-semibold' : 'text-muted';
  return <span className={`rounded-md px-1.5 text-sm ${tone}`}>{issue.text}</span>;
}

function MemberCard({ row, checked, onToggle, onRemind, onIgnore }: { row: Row; checked: boolean; onToggle: () => void; onRemind: () => void; onIgnore?: () => void }) {
  const next = row.concerns[0];
  return (
    <li className={`card border-l-4 ${row.level === 'red' ? 'border-l-danger' : 'border-l-warn'} px-3 py-2.5 flex items-start gap-3`}>
      <label className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Sélectionner ${row.name}`} className="w-5 h-5 mt-0.5 accent-[var(--fill)] shrink-0" />
        <Avatar name={row.name} picture={row.picture} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink leading-snug break-words">{row.name}</span>
          <span className="mt-1 flex flex-wrap gap-1.5">
            {row.issues.map((i) => (
              <IssueChip key={i.kind} issue={i} />
            ))}
          </span>
          {next && <span className="mt-1 block text-sm text-muted">Prochaine sortie : {shortDay(next.outing.date)}</span>}
        </span>
      </label>
      {/* À côté de l'étiquette (qui coche la ligne), pas dedans. */}
      <MemberSheetButton member={{ uct: row.uct, name: row.name, picture: row.picture }} className="-mt-1" />
      <span className="flex flex-col sm:flex-row items-stretch gap-1.5 shrink-0">
        <button type="button" onClick={onRemind} className="btn btn-quiet sm:h-9 text-sm">
          Relancer
        </button>
        {onIgnore && (
          <button type="button" onClick={onIgnore} title="Ne plus afficher ce membre" className="btn btn-quiet sm:h-9 text-sm text-muted">
            <EyeOff className="w-4 h-4" /> Ignorer
          </button>
        )}
      </span>
    </li>
  );
}
