import { useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, FileUp, Settings, UserX, X } from 'lucide-react';
import { Avatar } from '../../Avatar';
import { appApi, type FfessmImport } from '../../../services/appApi';
import { GabianLoader } from '../../Gabian';
import { Spinner } from '../../Spinner';
import { frDate } from '../../../lib/dates';
import { message } from '../../../lib/errors';
import { decodeExport, parseFfessmBrevets, parseFfessmCsv, seasonLabel, type Cell, type ItemView, type Match } from '../../../lib/membership';
import { hasGap, type Filter, type Row, type StepProps } from './shared';
import { MemberSheetButton } from '../../member/MemberLink';

/** Étape 2 : chaque personne vue par HelloAsso, la FFESSM et VPDive (✅ ❌ ⚠️). */
export function Diagnostic(props: StepProps) {
  const { season, ffessm, setFfessm, brevetsImport, setBrevetsImport, rows, loading, haError, loadError, filter, setFilter, matches, errors, progressBar, refreshButton, search, setConfigOpen, onSessionLost } = props;
  const counts = { gaps: rows.filter(hasGap).length, ok: rows.filter((r) => !hasGap(r)).length, all: rows.length };
  const shown = rows.filter((r) => matches(r) && (filter === 'all' || (filter === 'gaps') === hasGap(r)));
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'gaps', label: 'Avec des écarts' },
    { key: 'ok', label: 'Conformes' },
    { key: 'all', label: 'Tous' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <p className="text-sm text-ink">
          Saison <strong className="font-semibold">{seasonLabel(season)}</strong>
          {/* Légende : les signes sont dits par le texte qui les suit. */}
          <span className="text-muted">
            {' '}
            · <span aria-hidden>✅</span> conforme · <span aria-hidden>❌</span> absent · <span aria-hidden>⚠️</span> différent
          </span>
        </p>
        <div className="space-y-1.5">
          <FfessmImportBox
            what="licences"
            current={ffessm}
            parse={parseFfessmCsv}
            save={appApi.saveFfessmImport}
            onImported={setFfessm}
            onSessionLost={onSessionLost}
            note={(rows) => {
              const n = rows.filter((r) => r.season === season).length;
              return n
                ? { text: `${n} licence${n > 1 ? 's' : ''} pour ${seasonLabel(season)}`, warn: false }
                : { text: `Aucune licence pour ${seasonLabel(season)} : export d’une autre saison ?`, warn: true };
            }}
          />
          <FfessmImportBox what="brevets" current={brevetsImport} parse={parseFfessmBrevets} save={appApi.saveFfessmBrevets} onImported={setBrevetsImport} onSessionLost={onSessionLost} />
        </div>
        <button type="button" onClick={() => setConfigOpen(true)} className="icon-btn ml-auto" aria-label="Réglages : correspondance des brevets" title="Correspondance des brevets">
          <Settings className="w-5 h-5" />
        </button>
      </div>
      {errors}
      {loading ? (
        !haError && !loadError && <GabianLoader label="Lecture de HelloAsso et des membres VPDive…" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Filtrer" className="inline-flex flex-wrap rounded-lg border border-field-border bg-surface p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className="tab-pill px-3 rounded-md"
                >
                  {f.label} <span className="tabular-nums">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            {refreshButton}
            {search}
          </div>
          {progressBar}
          {shown.length === 0 ? (
            <p className="py-10 text-center text-muted">{rows.length ? 'Personne dans ce filtre.' : 'Aucune adhésion ni licence pour cette saison.'}</p>
          ) : (
            // Pas d'overflow-hidden ici : la barre de titres reste collée en haut pendant le défilement.
            <div className="lg:rounded-xl lg:border lg:border-line lg:bg-surface">
              {/* -top-4 : la zone qui défile a 1 rem de marge interne, la barre doit coller à son bord.
                  Titres de colonne en bandeau rose (comme un titre de section), texte marine en gras. */}
              <div className={`hidden lg:grid ${GRID} gap-4 px-4 py-2.5 bg-accent text-on-accent lg:rounded-t-xl sticky -top-4 z-10`}>
                {['Personne', 'Fiche VPDive', 'Licence FFESSM', `Adhésion ${seasonLabel(season)}`, 'Brevets'].map((h) => (
                  <span key={h} className="text-sm font-bold">
                    {h}
                  </span>
                ))}
              </div>
              {/* Bureau : lignes zébrées et filets marqués, une personne par ligne sans la perdre de vue. Téléphone : une carte par personne. */}
              <ul className="space-y-3 lg:space-y-0 lg:zebra lg:divide-y lg:divide-field-border/40">
                {shown.map((r) => (
                  <PersonRow key={r.p.key} row={r} season={season} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const GRID = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.9fr)]';
const EMOJI: Record<Cell['mark'], { sign: string; label: string }> = {
  ok: { sign: '✅', label: 'conforme' },
  missing: { sign: '❌', label: 'absent' },
  diff: { sign: '⚠️', label: 'différent' },
  na: { sign: '·', label: 'sans objet' },
};

/** Une personne : bureau = une ligne de tableau ; téléphone = une carte, blocs empilés. */
function PersonRow({ row, season }: { row: Row; season: number }) {
  const { p, match, view, pending } = row;
  return (
    <li className={`card lg:rounded-none lg:last:rounded-b-xl lg:border-0 lg:shadow-none grid gap-3 lg:gap-4 p-4 lg:px-4 lg:py-3 ${GRID} items-start`}>
      <div className="min-w-0">
        <p className="font-semibold text-ink break-words">{p.name}</p>
        <p className="text-sm text-muted">
          {p.birthDate ? `né le ${frDate(p.birthDate)}` : 'naissance inconnue'}
          {p.email && <span className="block truncate">{p.email}</span>}
        </p>
      </div>
      <Block title="Fiche VPDive">
        <VpdiveStatus match={match} pending={pending} />
      </Block>
      <Block title="Licence FFESSM">
        <Item view={view.licence} pending={pending} />
        {[view.insurance.helloasso, view.insurance.ffessm, view.insurance.vpdive].some((c) => c.text !== '—') && (
          <>
            <h4 className="mt-1.5 mb-0.5 text-xs font-medium text-muted">Assurance</h4>
            <Item view={view.insurance} pending={pending} />
          </>
        )}
      </Block>
      <Block title={`Adhésion ${seasonLabel(season)}`}>
        <Item view={view.adhesion} pending={pending} />
      </Block>
      <Block title="Brevets">
        <Item view={view.brevets} pending={pending} />
      </Block>
    </li>
  );
}

/** Un élément : une ligne par source qui a quelque chose à dire, avec ✅ ❌ ⚠️. */
function Item({ view, pending }: { view: ItemView; pending: boolean }) {
  const lines = (
    [
      ['HelloAsso', view.helloasso],
      ['FFESSM', view.ffessm],
      ['VPDive', view.vpdive],
    ] as const
  ).filter(([, c]) => c.mark !== 'na' || c.text !== '—');
  if (!lines.length) return <span className="text-sm text-muted">—</span>;
  return (
    <ul className="space-y-0.5 text-sm">
      {lines.map(([source, c]) => (
        <li key={source} className="flex items-baseline gap-1.5 min-w-0">
          <span className="w-16 shrink-0 text-muted">{source}</span>
          {source === 'VPDive' && pending && c.mark === 'na' ? (
            <span role="img" aria-label="lecture en cours" title="lecture en cours" className="shrink-0 w-4 text-center text-muted">
              …
            </span>
          ) : (
            <span role="img" aria-label={EMOJI[c.mark].label} title={EMOJI[c.mark].label} className={`shrink-0 w-4 text-center ${c.mark === 'na' ? 'text-muted' : ''}`}>
              {EMOJI[c.mark].sign}
            </span>
          )}
          <span className={`min-w-0 break-words ${c.mark === 'missing' ? 'text-danger font-medium' : c.mark === 'diff' ? 'text-warn font-medium' : c.mark === 'ok' ? 'text-ink' : 'text-muted'}`}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="label mb-1 lg:hidden">{title}</h4>
      {children}
    </div>
  );
}

/** Diagnostic : le membre VPDive retenu, ou ce qui reste à trancher (à l'étape Arbitrage). */
function VpdiveStatus({ match, pending }: { match: Match; pending: boolean }) {
  if (match.status === 'sure' && match.member) {
    return (
      <div className="flex items-start gap-2 min-w-0">
        <Avatar name={match.member.name} picture={match.member.picture} size="sm" initials={false} className="shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-ink truncate">{match.member.name}</p>
          <p className="text-muted">{match.why}</p>
        </div>
        <MemberSheetButton member={{ uct: match.member.id, name: match.member.name, picture: match.member.picture }} className="-mt-1" />
      </div>
    );
  }
  if (pending) return <p className="text-sm text-muted">Lecture des fiches…</p>;
  if (match.parent) return <p className="text-sm text-muted">{match.why}</p>;
  return (
    <div className="text-sm">
      {match.obsolete && <p className="text-warn">{match.obsolete}</p>}
      <p className="text-warn font-medium inline-flex items-center gap-1.5">
        <UserX className="w-4 h-4" /> {match.status === 'confirm' ? 'Homonymes : à trancher (étape 4)' : match.why || 'Pas de fiche VPDive (étape 4)'}
      </p>
    </div>
  );
}

/** Dépôt d'un export de Mon Club (« Liste des licences » ou « Liste des brevets », CSV), lu ici puis partagé avec les autres admins. */
function FfessmImportBox<Row>({
  what,
  current,
  parse,
  save,
  onImported,
  onSessionLost,
  note,
}: {
  what: 'licences' | 'brevets';
  current: FfessmImport<Row> | null | undefined;
  parse: (text: string) => { rows: Row[]; period: string };
  save: (rows: Row[], period: string) => Promise<FfessmImport<Row>>;
  onImported: (i: FfessmImport<Row>) => void;
  onSessionLost: (e: unknown) => boolean;
  /** Ce que l'export apporte à la saison (« 42 licences pour 2026/2027 ») ; `warn` : rien pour elle. */
  note?: (rows: Row[]) => { text: string; warn: boolean };
}) {
  const input = useRef<HTMLInputElement>(null);
  const info = current && note ? note(current.rows) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // Mon Club exporte en windows-1252 : lu en UTF-8, les accents seraient perdus.
      const { rows, period } = parse(decodeExport(await file.arrayBuffer()));
      if (!rows.length) throw new Error(`Rien trouvé : est-ce bien l’export « Liste des ${what} » de Mon Club (CSV) ?`);
      onImported(await save(rows, period));
    } catch (e) {
      if (!onSessionLost(e)) setError(message(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted">
        {current === undefined
          ? `Export des ${what}…`
          : current
            ? `FFESSM, ${what} : ${current.rows.length}${current.period ? `, ${current.period.toLowerCase()}` : ''} · déposé par ${current.by} le ${frDate(current.at)}`
            : `FFESSM, ${what} : aucun export déposé`}
        {info && !info.warn && ` · ${info.text}`}
      </span>
      {info?.warn && (
        <span role="alert" className="text-warn font-medium inline-flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" /> {info.text}
        </span>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy} className="btn btn-quiet sm:h-9 text-sm">
        {busy ? <Spinner /> : <FileUp className="w-4 h-4" />} {current ? 'Nouvel export' : `Déposer les ${what}`}
      </button>
      {error && (
        <span role="alert" className="basis-full text-danger inline-flex items-center gap-1.5">
          <X className="w-4 h-4" /> {error}
        </span>
      )}
    </div>
  );
}
