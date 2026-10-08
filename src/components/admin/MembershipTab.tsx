import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, FileUp, Loader2, RefreshCw, Search, UserX, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { MemberSearch } from '../dp/MemberSearch';
import { vpdive } from '../../services/vpdiveApi';
import { appApi, type FfessmImport } from '../../services/appApi';
import {
  buildPeople,
  candidatesFor,
  gapsFor,
  haInsurance,
  matchPerson,
  parseFfessmCsv,
  seasonLabel,
  seasonOf,
  type Gap,
  type HaItem,
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
const cacheKey = (uct: string) => `member-record:${uct}`;
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

type Filter = 'todo' | 'confirm' | 'missing' | 'warn' | 'all';
interface Row {
  p: Person;
  match: Match;
  record: VpRecord | null;
  gaps: Gap[];
  /** Fiches des candidats pas encore lues : le rapprochement peut encore changer. */
  pending: boolean;
}

export function MembershipTab({ onSessionLost }: { onSessionLost: (e: unknown) => boolean }) {
  const [season, setSeason] = useState(() => seasonOf(new Date().toISOString().slice(0, 10)));
  const [items, setItems] = useState<HaItem[] | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const [ffessm, setFfessm] = useState<FfessmImport | null | undefined>(undefined);
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
      return { p, match, record, gaps: gapsFor(p, record, season), pending: cands.some((m) => !records[m.id]) || (!!match.member && !record) };
    });
  }, [people, directory, links, records, season]);

  const counts = useMemo(
    () => ({
      todo: rows.filter((r) => r.gaps.some((g) => g.level === 'todo')).length,
      confirm: rows.filter((r) => r.match.status === 'confirm').length,
      missing: rows.filter((r) => r.match.status === 'missing').length,
      warn: rows.filter((r) => r.gaps.some((g) => g.level === 'warn')).length,
      all: rows.length,
    }),
    [rows],
  );
  const q = normalizeName(query);
  const shown = rows.filter((r) => {
    if (q && !normalizeName(`${r.p.name} ${r.match.member?.name ?? ''} ${r.p.ffessm?.licence ?? ''}`).includes(q)) return false;
    if (filter === 'todo') return r.gaps.some((g) => g.level === 'todo');
    if (filter === 'warn') return r.gaps.some((g) => g.level === 'warn');
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
  const current = seasonOf(new Date().toISOString().slice(0, 10));
  const seasons = [current, current - 1, current - 2];
  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'todo', label: 'À corriger' },
    { key: 'confirm', label: 'À confirmer' },
    { key: 'warn', label: 'Oublis probables' },
    { key: 'missing', label: 'Absents de VPDive' },
    { key: 'all', label: 'Tous' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          Saison
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className="field h-9 py-0">
            {seasons.map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <FfessmImportBox current={ffessm} onImported={setFfessm} onSessionLost={onSessionLost} />
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
            <div className="lg:rounded-xl lg:border lg:border-line lg:bg-surface overflow-hidden">
              <div className="hidden lg:grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)] gap-4 px-4 py-2.5 border-b border-line bg-raised">
                {['Personne', 'HelloAsso', 'FFESSM', 'VPDive', 'À faire'].map((h) => (
                  <span key={h} className="label">
                    {h}
                  </span>
                ))}
              </div>
              <ul className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-line">
                {shown.map((r) => (
                  <PersonRow key={r.p.key} row={r} season={season} hasFfessm={!!ffessm} onChoose={(uct) => void choose(r.p, uct)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Une personne : bureau = une ligne de tableau ; téléphone = une carte, blocs empilés. */
function PersonRow({ row, season, hasFfessm, onChoose }: { row: Row; season: number; hasFfessm: boolean; onChoose: (uct: string | null) => void }) {
  const { p, match, record, gaps, pending } = row;
  const ha = p.ha;
  return (
    <li className="card lg:rounded-none lg:border-0 lg:shadow-none grid gap-3 lg:gap-4 p-4 lg:px-4 lg:py-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)] items-start">
      <div className="min-w-0">
        <p className="font-semibold text-ink break-words">{p.name}</p>
        <p className="text-sm text-muted">
          {p.birthDate ? `né(e) le ${frDay(p.birthDate)}` : 'naissance inconnue'}
          {p.email && <span className="block truncate">{p.email}</span>}
        </p>
      </div>

      <Block title="HelloAsso">
        {ha ? (
          <ul className="flex flex-wrap gap-1.5">
            {ha.adhesion && <Chip tone="ok">{ha.bonus ? 'Adhésion (août)' : 'Adhésion'}</Chip>}
            {ha.licence && <Chip tone="ok">{ha.licence.tier.replace(/\s*\(.*\)$/, '').replace('Licence FFESSM', 'Licence')}</Chip>}
            {ha.pass && <Chip tone="ok">Pass plongée</Chip>}
            {ha.insurance && <Chip tone="ok">{haInsurance(ha.insurance.tier) ?? 'Assurance'}</Chip>}
          </ul>
        ) : (
          <span className="text-sm text-muted">Aucun paiement</span>
        )}
      </Block>

      <Block title="FFESSM">
        {p.ffessm ? (
          <p className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{p.ffessm.licence}</span>
            <span className="block text-muted">
              {p.ffessm.insurance}
              {/pass/i.test(p.ffessm.pricing) && ' · réduction Pass'}
              {p.joinedByNameOnly && ' · réuni par le nom'}
            </span>
          </p>
        ) : (
          <span className="text-sm text-muted">{hasFfessm ? `Pas de licence ${seasonLabel(season)}` : 'Export à déposer'}</span>
        )}
      </Block>

      <Block title="VPDive">
        <VpdiveCell match={match} record={record} pending={pending} season={season} onChoose={onChoose} />
      </Block>

      <Block title="À faire">
        {match.status !== 'sure' && gaps.length === 0 ? (
          <span className="text-sm text-muted">{pending ? '…' : match.status === 'confirm' ? 'Membre VPDive à confirmer' : 'Pas de fiche VPDive : à créer ou inviter'}</span>
        ) : gaps.length === 0 ? (
          pending ? <span className="text-sm text-muted">…</span> : <span className="text-sm text-ok inline-flex items-center gap-1"><Check className="w-4 h-4" /> À jour</span>
        ) : (
          <ul className="space-y-1">
            {gaps.map((g) => (
              <li key={g.text} className={`text-sm ${g.level === 'todo' ? 'text-ink' : g.level === 'warn' ? 'text-warn font-medium' : 'text-muted'}`}>
                {g.level === 'todo' ? '• ' : g.level === 'warn' ? '⚠ ' : ''}
                {g.text}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </li>
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

function Chip({ tone, children }: { tone: 'ok' | 'muted'; children: ReactNode }) {
  return <li className={`rounded-md px-1.5 text-sm leading-6 ${tone === 'ok' ? 'bg-tint text-brand font-medium' : 'text-muted'}`}>{children}</li>;
}

/** Le membre VPDive : sûr (avec la preuve), à choisir parmi les homonymes, ou introuvable (recherche à la main). */
function VpdiveCell({ match, record, pending, season, onChoose }: { match: Match; record: VpRecord | null; pending: boolean; season: number; onChoose: (uct: string | null) => void }) {
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
          {record && (
            <p className="text-muted">
              {record.seasons.includes(String(season)) ? `Saison ${seasonLabel(season)}` : `Saisons : ${record.seasons.slice(0, 2).map((s) => seasonLabel(Number(s))).join(', ') || 'aucune'}`}
              {!record.member && ' · Invité'}
            </p>
          )}
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

/** Dépôt de l'export « Liste des licences » de Mon Club (CSV), lu ici puis partagé avec les autres admins. */
function FfessmImportBox({ current, onImported, onSessionLost }: { current: FfessmImport | null | undefined; onImported: (i: FfessmImport) => void; onSessionLost: (e: unknown) => boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { rows, period } = parseFfessmCsv(await file.text());
      if (!rows.length) throw new Error('Aucune licence trouvée : est-ce bien l’export « Liste des licences » de Mon Club (CSV) ?');
      onImported(await appApi.saveFfessmImport(rows, period));
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
          ? 'Export FFESSM…'
          : current
            ? `Export FFESSM : ${current.rows.length} licences${current.period ? `, ${current.period.toLowerCase()}` : ''} · déposé par ${current.by} le ${frDay(current.at)}`
            : 'Aucun export FFESSM déposé'}
      </span>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className="btn btn-quiet h-9 text-sm">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} {current ? 'Nouvel export' : 'Déposer l’export'}
      </button>
      {error && (
        <span role="alert" className="basis-full text-danger inline-flex items-center gap-1.5">
          <X className="w-4 h-4" /> {error}
        </span>
      )}
    </div>
  );
}
