import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, FileUp, Loader2, RefreshCw, Search, Settings, UserX, X } from 'lucide-react';
import { BrevetMapView } from './BrevetMapView';
import { Avatar } from '../Avatar';
import { MemberSearch } from '../dp/MemberSearch';
import { vpdive } from '../../services/vpdiveApi';
import { appApi, type FfessmImport } from '../../services/appApi';
import {
  brevetsByLicence,
  buildPeople,
  candidatesFor,
  federationIssue,
  matchPerson,
  needsVpdiveFix,
  parseFfessmBrevets,
  parseFfessmCsv,
  seasonLabel,
  seasonOf,
  viewOf,
  type BrevetMap,
  type Cell,
  type FfessmBrevet,
  type HaItem,
  type ItemView,
  type PersonView,
  type LinkChoice,
  type Match,
  type Person,
  type VpMember,
  type VpRecord,
} from '../../lib/membership';
import { normalizeName } from '../../lib/fuzzy';

/**
 * Onglet « Adhésions » : chaque personne de la saison vue par HelloAsso (ce qui
 * est payé), la FFESSM (la licence prise, export Mon Club déposé ici) et VPDive
 * (la fiche), avec ce qu'il reste à corriger. Rien n'est écrit dans VPDive :
 * c'est l'étape suivante. Les fiches VPDive sont lues une à une, avec une pause
 * (pare-feu), et gardées 6 h dans la session.
 */

const READ_GAP_MS = 500;
const MAX_FAILURES = 3;
const CACHE_TTL_MS = 6 * 3600_000;
// v2 : la fiche garde aussi les niveaux (comparés aux brevets FFESSM).
const cacheKey = (uct: string) => `member-record:v2:${uct}`;
function readCache(uct: string): VpRecord | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(cacheKey(uct)) ?? 'null') as { at: number; record: VpRecord } | null;
    return v && Date.now() - v.at < CACHE_TTL_MS && Array.isArray(v.record?.seasons) ? v.record : null;
  } catch {
    return null;
  }
}
function writeCache(uct: string, record: VpRecord) {
  try {
    sessionStorage.setItem(cacheKey(uct), JSON.stringify({ at: Date.now(), record }));
  } catch {
    // Stockage plein ou interdit : la fiche sera relue.
  }
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const frDay = (ymd: string) => (ymd ? ymd.slice(0, 10).split('-').reverse().join('/') : '');

type Filter = 'todo' | 'confirm' | 'federation' | 'missing' | 'all';
interface Row {
  p: Person;
  match: Match;
  record: VpRecord | null;
  view: PersonView;
  /** Fiches des candidats pas encore lues : le rapprochement peut encore changer. */
  pending: boolean;
}

export function MembershipTab({ onSessionLost }: { onSessionLost: (e: unknown) => boolean }) {
  // Une seule saison : celle en cours (l'export FFESSM déposé est celui de la saison).
  const season = useMemo(() => seasonOf(new Date().toISOString().slice(0, 10)), []);
  const [items, setItems] = useState<HaItem[] | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const [ffessm, setFfessm] = useState<FfessmImport | null | undefined>(undefined);
  const [brevetsImport, setBrevetsImport] = useState<FfessmImport<FfessmBrevet> | null | undefined>(undefined);
  const brevets = useMemo(() => (brevetsImport ? brevetsByLicence(brevetsImport.rows) : null), [brevetsImport]);
  /** Correspondance des brevets choisie par les admins (roue crantée). */
  const [brevetMap, setBrevetMap] = useState<BrevetMap>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [directory, setDirectory] = useState<VpMember[] | null>(null);
  const [links, setLinks] = useState<Record<string, LinkChoice> | null>(null);
  const [records, setRecords] = useState<Record<string, VpRecord>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('todo');
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const lost = useRef(onSessionLost);
  lost.current = onSessionLost;

  // Une fois : export FFESSM, membres VPDive, rapprochements choisis.
  useEffect(() => {
    appApi.ffessmImport().then(setFfessm, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.ffessmBrevets().then(setBrevetsImport, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.brevetMap().then(setBrevetMap, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.memberLinks().then(setLinks, (e) => lost.current(e) || setLoadError(message(e)));
    vpdive.fetchMemberDirectory().then(setDirectory, (e) => lost.current(e) || setLoadError(message(e)));
  }, []);

  // HelloAsso, à chaque saison choisie.
  const loadHelloasso = useCallback(() => {
    setItems(null);
    setHaError(null);
    appApi.helloasso(season).then(setItems, (e) => lost.current(e) || setHaError(message(e)));
  }, [season]);
  useEffect(loadHelloasso, [loadHelloasso]);

  const people = useMemo(() => (items && ffessm !== undefined ? buildPeople(items, ffessm?.rows ?? [], season) : null), [items, ffessm, season]);

  // Fiches VPDive à lire : le membre choisi, sinon les homonymes possibles.
  const wanted = useMemo(() => {
    if (!people || !directory || !links) return [];
    const ids = new Set<string>();
    for (const p of people) {
      const link = links[p.key];
      if (link) {
        if (link.uct !== 'none') ids.add(link.uct);
      } else for (const m of candidatesFor(p, directory)) ids.add(m.id);
    }
    return [...ids];
  }, [people, directory, links]);

  const run = useRef(0);
  const readRecords = useCallback(async (ids: string[]) => {
    const id = ++run.current;
    setReadError(null);
    const cached: Record<string, VpRecord> = {};
    const todo: string[] = [];
    for (const u of ids) {
      const c = readCache(u);
      if (c) cached[u] = c;
      else todo.push(u);
    }
    setRecords((r) => ({ ...r, ...cached }));
    if (!todo.length) return setProgress(null);
    let failures = 0;
    for (const [i, u] of todo.entries()) {
      if (run.current !== id) return;
      setProgress({ done: i, total: todo.length });
      if (i > 0) await wait(READ_GAP_MS);
      try {
        const record = await vpdive.memberRecord(u);
        if (run.current !== id) return;
        writeCache(u, record);
        setRecords((r) => ({ ...r, [u]: record }));
        failures = 0;
      } catch (e) {
        if (lost.current(e)) return;
        if (++failures >= MAX_FAILURES) {
          setReadError(`VPDive ne répond plus aux lectures de fiches (${message(e)}).`);
          setProgress(null);
          return;
        }
      }
    }
    if (run.current === id) setProgress(null);
  }, []);
  useEffect(() => {
    const missing = wanted.filter((u) => !records[u]);
    if (missing.length && !progress && !readError) void readRecords(missing);
    // On relance seulement quand la liste à lire change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  const rows = useMemo<Row[]>(() => {
    if (!people || !directory || !links) return [];
    return people.map((p) => {
      const match = matchPerson(p, directory, records, links[p.key]);
      const record = match.member ? (records[match.member.id] ?? null) : null;
      const cands = links[p.key] ? [] : candidatesFor(p, directory);
      return { p, match, record, view: viewOf(p, record, season, brevets, brevetMap), pending: cands.some((m) => !records[m.id]) || (!!match.member && !record) };
    });
  }, [people, directory, links, records, season, brevets, brevetMap]);

  const counts = useMemo(
    () => ({
      todo: rows.filter((r) => needsVpdiveFix(r.view)).length,
      confirm: rows.filter((r) => r.match.status === 'confirm').length,
      federation: rows.filter((r) => federationIssue(r.view)).length,
      missing: rows.filter((r) => r.match.status === 'missing').length,
      all: rows.length,
    }),
    [rows],
  );
  const q = normalizeName(query);
  const shown = rows.filter((r) => {
    if (q && !normalizeName(`${r.p.name} ${r.match.member?.name ?? ''} ${r.p.ffessm?.licence ?? ''}`).includes(q)) return false;
    if (filter === 'todo') return needsVpdiveFix(r.view);
    if (filter === 'federation') return federationIssue(r.view);
    if (filter === 'confirm' || filter === 'missing') return r.match.status === filter;
    return true;
  });

  const choose = async (p: Person, uct: string | null) => {
    try {
      setLinks(await appApi.setMemberLink(p.key, uct));
    } catch (e) {
      if (!lost.current(e)) setLoadError(message(e));
    }
  };

  const loading = !people || !directory || !links;
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'todo', label: 'À corriger dans VPDive' },
    { key: 'confirm', label: 'À confirmer' },
    { key: 'federation', label: 'Licence non prise' },
    { key: 'missing', label: 'Absents de VPDive' },
    { key: 'all', label: 'Tous' },
  ];

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <p className="text-sm text-ink">
          Saison <strong className="font-semibold">{seasonLabel(season)}</strong>
          <span className="text-muted"> · ✅ conforme · ❌ absent · ⚠️ différent</span>
        </p>
        <div className="space-y-1.5">
          <FfessmImportBox
            what="licences"
            current={ffessm}
            parse={parseFfessmCsv}
            save={appApi.saveFfessmImport}
            onImported={setFfessm}
            onSessionLost={onSessionLost}
          />
          <FfessmImportBox
            what="brevets"
            current={brevetsImport}
            parse={parseFfessmBrevets}
            save={appApi.saveFfessmBrevets}
            onImported={setBrevetsImport}
            onSessionLost={onSessionLost}
          />
        </div>
        <button type="button" onClick={() => setConfigOpen(true)} className="icon-btn ml-auto" aria-label="Réglages : correspondance des brevets" title="Correspondance des brevets">
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {(loadError || haError) && (
        <div role="alert" className="p-3 rounded-xl bg-danger-soft text-danger text-sm flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{haError ? `HelloAsso : ${haError}` : loadError}</span>
          {haError && (
            <button type="button" onClick={loadHelloasso} className="btn btn-quiet h-8 text-sm">
              <RefreshCw className="w-4 h-4" /> Réessayer
            </button>
          )}
        </div>
      )}

      {loading ? (
        !haError && !loadError && <p className="py-12 text-center text-muted">Lecture de HelloAsso et des membres VPDive…</p>
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
                  className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                >
                  {f.label} <span className="tabular-nums">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="relative flex-1 min-w-[12rem] max-w-xs ml-auto">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou n° de licence" aria-label="Chercher" className="field w-full h-9 pl-9" />
            </label>
          </div>

          {(progress || readError) && (
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
                    onClick={() => {
                      run.current++;
                      setProgress(null);
                      setReadError('Lecture arrêtée.');
                    }}
                    className="btn btn-quiet h-8 text-sm"
                  >
                    Arrêter
                  </button>
                </>
              ) : (
                <>
                  <span className="text-danger">{readError}</span>
                  <button type="button" onClick={() => void readRecords(wanted.filter((u) => !records[u]))} className="btn btn-quiet h-8 text-sm">
                    <RefreshCw className="w-4 h-4" /> Reprendre
                  </button>
                </>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="py-10 text-center text-muted">{rows.length ? 'Personne dans ce filtre.' : 'Aucune adhésion ni licence pour cette saison.'}</p>
          ) : (
            // Pas d'overflow-hidden ici : la barre de titres reste collée en haut pendant le défilement.
            <div className="lg:rounded-xl lg:border lg:border-line lg:bg-surface">
              {/* -top-4 : la zone qui défile a 1 rem de marge interne, la barre doit coller à son bord. */}
      <div className={`hidden lg:grid ${GRID} gap-4 px-4 py-2.5 border-b border-line bg-raised lg:rounded-t-xl sticky -top-4 z-10`}>
                {['Personne', 'Fiche VPDive', 'Licence FFESSM', `Adhésion ${seasonLabel(season)}`, 'Brevets'].map((h) => (
                  <span key={h} className="label">
                    {h}
                  </span>
                ))}
              </div>
              <ul className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-line">
                {shown.map((r) => (
                  <PersonRow key={r.p.key} row={r} season={season} onChoose={(uct) => void choose(r.p, uct)} />
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
function PersonRow({ row, season, onChoose }: { row: Row; season: number; onChoose: (uct: string | null) => void }) {
  const { p, match, view, pending } = row;
  return (
    <li className={`card lg:rounded-none lg:last:rounded-b-xl lg:border-0 lg:shadow-none grid gap-3 lg:gap-4 p-4 lg:px-4 lg:py-3 ${GRID} items-start`}>
      <div className="min-w-0">
        <p className="font-semibold text-ink break-words">{p.name}</p>
        <p className="text-sm text-muted">
          {p.birthDate ? `né(e) le ${frDay(p.birthDate)}` : 'naissance inconnue'}
          {p.email && <span className="block truncate">{p.email}</span>}
        </p>
      </div>
      <Block title="Fiche VPDive">
        <VpdiveCell match={match} pending={pending} onChoose={onChoose} />
      </Block>
      <Block title="Licence FFESSM">
        <Item view={view.licence} pending={pending} />
        {p.ffessm && p.ffessm.insurance !== 'Aucune' && <p className="mt-0.5 text-sm text-muted">Assurance {p.ffessm.insurance}</p>}
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
          <span aria-label={EMOJI[c.mark].label} title={EMOJI[c.mark].label} className={`shrink-0 w-4 text-center ${c.mark === 'na' ? 'text-muted' : ''}`}>
            {source === 'VPDive' && pending && c.mark === 'na' ? '…' : EMOJI[c.mark].sign}
          </span>
          <span className={`min-w-0 break-words ${c.mark === 'missing' ? 'text-danger font-medium' : c.mark === 'diff' ? 'text-warn font-medium' : c.mark === 'ok' ? 'text-ink' : 'text-muted'}`}>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="label block mb-1 lg:hidden">{title}</span>
      {children}
    </div>
  );
}

/** Le membre VPDive : sûr (avec la preuve), à choisir parmi les homonymes, ou introuvable (recherche à la main). */
function VpdiveCell({ match, pending, onChoose }: { match: Match; pending: boolean; onChoose: (uct: string | null) => void }) {
  const [searching, setSearching] = useState(false);
  if (searching) {
    return (
      <div className="space-y-2">
        <MemberSearch onPick={(m) => onChoose(m.id)} />
        <button type="button" onClick={() => setSearching(false)} className="btn btn-quiet h-8 text-sm">
          Annuler
        </button>
      </div>
    );
  }
  if (match.status === 'sure' && match.member) {
    const m = match.member;
    const fromChoice = match.why.startsWith('choisi');
    return (
      <div className="flex items-start gap-2 min-w-0">
        <Avatar name={m.name} picture={m.picture} size="sm" initials={false} className="shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink truncate">{m.name}</p>
          <p className="text-muted">
            {match.why}
            {fromChoice && (
              <button type="button" onClick={() => onChoose(null)} className="ml-1.5 underline hover:text-brand">
                changer
              </button>
            )}
          </p>
        </div>
      </div>
    );
  }
  if (match.status === 'confirm') {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-warn font-medium">{pending ? 'Lecture des fiches…' : 'À confirmer'}</p>
        {match.candidates.map((m) => (
          <button key={m.id} type="button" onClick={() => onChoose(m.id)} className="w-full flex items-center gap-2 px-2 py-1 rounded-lg border border-field-border hover:bg-tint text-left">
            <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
            <span className="flex-1 min-w-0 truncate text-ink">{m.name}</span>
            <span className="text-brand font-medium shrink-0">C’est lui</span>
          </button>
        ))}
        <div className="flex flex-wrap gap-x-3">
          <button type="button" onClick={() => setSearching(true)} className="underline text-muted hover:text-brand">
            Autre membre
          </button>
          <button type="button" onClick={() => onChoose('none')} className="underline text-muted hover:text-brand">
            Pas dans VPDive
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-sm space-y-1">
      <p className="text-muted inline-flex items-center gap-1.5">
        <UserX className="w-4 h-4" /> {match.why || 'Aucun membre à ce nom'}
      </p>
      <div className="flex flex-wrap gap-x-3">
        <button type="button" onClick={() => setSearching(true)} className="underline text-muted hover:text-brand">
          Chercher dans VPDive
        </button>
        {match.why && (
          <button type="button" onClick={() => onChoose(null)} className="underline text-muted hover:text-brand">
            annuler
          </button>
        )}
      </div>
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
}: {
  what: 'licences' | 'brevets';
  current: FfessmImport<Row> | null | undefined;
  parse: (text: string) => { rows: Row[]; period: string };
  save: (rows: Row[], period: string) => Promise<FfessmImport<Row>>;
  onImported: (i: FfessmImport<Row>) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { rows, period } = parse(await file.text());
      if (!rows.length) throw new Error(`Rien trouvé : est-ce bien l’export « Liste des ${what} » de Mon Club (CSV) ?`);
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
            ? `FFESSM, ${what} : ${current.rows.length}${current.period ? `, ${current.period.toLowerCase()}` : ''} · déposé par ${current.by} le ${frDay(current.at)}`
            : `FFESSM, ${what} : aucun export déposé`}
      </span>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn btn-quiet h-9 text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {current ? 'Nouvel export' : `Déposer les ${what}`}
      </button>
      {error && (
        <span role="alert" className="basis-full text-danger inline-flex items-center gap-1.5">
          <X className="w-4 h-4" /> {error}
        </span>
      )}
    </div>
  );
}
