import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ExternalLink, FileUp, Loader2, RefreshCw, Search, Settings, UserX, X } from 'lucide-react';
import { BrevetMapView } from './BrevetMapView';
import { Avatar } from '../Avatar';
import { GabianLoader } from '../Gabian';
import { MemberSearch } from '../dp/MemberSearch';
import { vpdive } from '../../services/vpdiveApi';
import { appApi, type FfessmImport } from '../../services/appApi';
import { applyJob, type WriteJob } from '../../services/memberWriter';
import {
  brevetTarget,
  caseKey,
  familyCandidates,
  lackingBrevets,
  arbitrageCases,
  quickFixes,
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
  type Case,
  type CaseCheck,
  type CaseKind,
  type Capacity,
  type Cell,
  type Fix,
  type FixKind,
  type FfessmBrevet,
  type HaItem,
  type ItemView,
  type PersonView,
  type LinkChoice,
  type Match,
  type Person,
  type VpMember,
  type VpRecord,
  sameName,
} from '../../lib/membership';
import { normalizeName } from '../../lib/fuzzy';

/**
 * Gestion des adhésions, étapes 2 à 4 : chaque personne de la saison vue par
 * HelloAsso (ce qui est payé), la FFESSM (la licence prise, export Mon Club
 * déposé ici) et VPDive (la fiche). Voir MembershipTab plus bas.
 */

const READ_GAP_MS = 500;
const MAX_FAILURES = 3;
const CACHE_TTL_MS = 6 * 3600_000;
// v4 : l’assurance est lue dans le choix de la liste (insurance_choice), comme sur le site VPDive.
export const cacheKey = (uct: string) => `member-record:v4:${uct}`;
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

export type MembershipStep = 'diagnostic' | 'quickfix' | 'arbitrage';
type Filter = 'gaps' | 'ok' | 'all';
interface Row {
  p: Person;
  match: Match;
  record: VpRecord | null;
  view: PersonView;
  fixes: Fix[];
  /** Pas de fiche à son nom : les comptes possibles d'un parent. */
  family: VpMember[];
  cases: Case[];
  /** Fiches des candidats pas encore lues : le rapprochement peut encore changer. */
  pending: boolean;
}

const VPDIVE_MEMBER = (uct: string) => `https://septentrion-env.vpdive.com/app/member/${encodeURIComponent(uct)}`;

const FIX_ORDER: FixKind[] = ['season', 'licence', 'licence-add', 'insurance', 'brevets'];
const FIX_TITLE: Record<FixKind, { title: string; help: string }> = {
  season: { title: `Saison d’adhésion à ajouter`, help: 'Adhésion payée sur HelloAsso (geste d’août compris), saison absente de la fiche VPDive.' },
  licence: { title: 'Licence FFESSM : date de fin à mettre à jour', help: 'Même numéro, date ancienne. VPDive relit la FFESSM si la licence est vérifiée, sinon la date est saisie.' },
  'licence-add': { title: 'Licence FFESSM à ajouter', help: 'Licence prise par le club (export Mon Club), absente de la fiche VPDive.' },
  insurance: { title: 'Assurance à reporter', help: 'Assurance prise à la FFESSM (export Mon Club), différente de celle de la fiche VPDive.' },
  brevets: { title: 'Brevets à ajouter', help: 'Brevets délivrés par la FFESSM (export des brevets), absents des niveaux de la fiche VPDive.' },
};
const CASE_TITLE: Record<CaseKind, string> = {
  homonym: 'Homonymes : choisir le bon membre',
  family: 'Patronyme commun : parents',
  absent: 'Pas de fiche VPDive',
  guest: 'Statut Invité à passer en Membre',
  'licence-other': 'Autre numéro de licence dans VPDive',
  'not-taken': 'Licence FFESSM payée sur HelloAsso, à ajouter dans Mon Club / FFESSM',
  unpaid: 'Licence prise sans paiement HelloAsso',
  'season-unpaid': 'Saison sans adhésion HelloAsso',
  'no-licence': 'Ni licence ni Pass payés au club',
};
const CASE_ORDER: CaseKind[] = ['homonym', 'family', 'absent', 'guest', 'licence-other', 'not-taken', 'unpaid', 'season-unpaid', 'no-licence'];

/**
 * Étapes 2 à 4 de la gestion des adhésions, sur les mêmes données (lues une
 * fois, gardées tant que la fenêtre est ouverte) :
 *   diagnostic  chaque personne vue par HelloAsso, la FFESSM et VPDive (✅ ❌ ⚠️)
 *   quickfix    les corrections sans risque, par type, à pousser dans VPDive
 *   arbitrage   le cas par cas, à décider à la main
 * Les fiches VPDive sont lues une à une, avec une pause (pare-feu), et gardées
 * 6 h dans la session ; « Relire les fiches » les relit après des corrections.
 */
export function MembershipTab({
  step,
  onCounts,
  onSessionLost,
}: {
  step: MembershipStep;
  onCounts?: (c: { fixes: number; cases: number }) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
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
  const [filter, setFilter] = useState<Filter>('gaps');
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Corrections cochées (clé : personne + type). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Cas d'arbitrage vérifiés à la main, partagés entre admins. */
  const [checks, setChecks] = useState<Record<string, CaseCheck>>({});
  /** Référentiel des niveaux VPDive (identifiants à écrire pour les brevets), lu à l'étape 3. */
  const [catalog, setCatalog] = useState<Capacity[] | null>(null);
  /** Écriture en cours dans VPDive, et ce qu'elle a donné fiche par fiche. */
  const [writing, setWriting] = useState<{ done: number; total: number; name: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<{ uct: string; name: string; ok: boolean; message: string; warning?: string }[]>([]);
  const stopWriting = useRef(false);
  const lost = useRef(onSessionLost);
  lost.current = onSessionLost;

  // Une fois : exports FFESSM, correspondance des brevets, membres VPDive, rapprochements choisis.
  useEffect(() => {
    appApi.ffessmImport().then(setFfessm, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.ffessmBrevets().then(setBrevetsImport, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.brevetMap().then(setBrevetMap, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.memberLinks().then(setLinks, (e) => lost.current(e) || setLoadError(message(e)));
    appApi.arbitrageChecks().then(setChecks, (e) => lost.current(e) || setLoadError(message(e)));
    vpdive.fetchMemberDirectory().then(setDirectory, (e) => lost.current(e) || setLoadError(message(e)));
  }, []);

  useEffect(() => {
    if (step === 'quickfix' && !catalog) vpdive.capacities().then(setCatalog, (e) => lost.current(e) || setLoadError(message(e)));
  }, [step, catalog]);

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
  /** Lit les fiches ; `fresh` : sans le cache (après des corrections ou des validations). */
  const readRecords = useCallback(async (ids: string[], fresh = false) => {
    const id = ++run.current;
    setReadError(null);
    const cached: Record<string, VpRecord> = {};
    const todo: string[] = [];
    for (const u of ids) {
      const c = fresh ? null : readCache(u);
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
      const view = viewOf(p, record, season, brevets, brevetMap);
      const fixes = quickFixes(p, match, record, season, lackingBrevets(p, record, brevets, brevetMap));
      const family = match.status === 'missing' && !match.why ? familyCandidates(p, directory) : [];
      return { p, match, record, view, fixes, family, cases: arbitrageCases(p, match, record, view, family), pending: cands.some((m) => !records[m.id]) || (!!match.member && !record) };
    });
  }, [people, directory, links, records, season, brevets, brevetMap]);

  const fixCount = rows.reduce((n, r) => n + r.fixes.length, 0);
  // Un cas coché « vérifié » ne compte plus.
  const caseCount = rows.reduce((n, r) => n + r.cases.filter((c) => !checks[caseKey(r.p, c.kind)]).length, 0);
  useEffect(() => {
    if (rows.length) onCounts?.({ fixes: fixCount, cases: caseCount });
  }, [rows.length, fixCount, caseCount, onCounts]);

  const hasGap = (r: Row) => needsVpdiveFix(r.view) || federationIssue(r.view) || r.match.status !== 'sure';
  const q = normalizeName(query);
  const matches = (r: Row) => !q || normalizeName(`${r.p.name} ${r.match.member?.name ?? ''} ${r.p.ffessm?.licence ?? ''}`).includes(q);

  const choose = async (p: Person, uct: string | null, relation?: 'parent') => {
    try {
      setLinks(await appApi.setMemberLink(p.key, uct, relation));
    } catch (e) {
      if (!lost.current(e)) setLoadError(message(e));
    }
  };
  /** Relit sans cache les fiches des membres reconnus (après corrections ou validations). */
  const refresh = () => void readRecords([...new Set(rows.map((r) => r.match.member?.id).filter((x): x is string => !!x))], true);

  const loading = !people || !directory || !links;

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
  );

  const errors = (loadError || haError) && (
    <div role="alert" className="p-3 rounded-xl bg-danger-soft text-danger text-sm flex flex-wrap items-center gap-3">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0">{haError ? `HelloAsso : ${haError}` : loadError}</span>
      {haError && (
        <button type="button" onClick={loadHelloasso} className="btn btn-quiet h-8 text-sm">
          <RefreshCw className="w-4 h-4" /> Réessayer
        </button>
      )}
    </div>
  );

  const search = (
    <label className="relative flex-1 min-w-[12rem] max-w-xs ml-auto">
      <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou n° de licence" aria-label="Chercher" className="field w-full h-9 pl-9" />
    </label>
  );

  // ── 2. Diagnostic ──
  if (step === 'diagnostic') {
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
            <span className="text-muted"> · ✅ conforme · ❌ absent · ⚠️ différent</span>
          </p>
          <div className="space-y-1.5">
            <FfessmImportBox what="licences" current={ffessm} parse={parseFfessmCsv} save={appApi.saveFfessmImport} onImported={setFfessm} onSessionLost={onSessionLost} />
            <FfessmImportBox what="brevets" current={brevetsImport} parse={parseFfessmBrevets} save={appApi.saveFfessmBrevets} onImported={setBrevetsImport} onSessionLost={onSessionLost} />
          </div>
          <button type="button" onClick={() => setConfigOpen(true)} className="icon-btn ml-auto" aria-label="Réglages : correspondance des brevets" title="Correspondance des brevets">
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
                    className={`h-9 px-3 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
                  >
                    {f.label} <span className="tabular-nums">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
              {search}
            </div>
            {progressBar}
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

  const refreshButton = (
    <button type="button" onClick={refresh} disabled={!!progress || loading} className="btn btn-quiet h-9 text-sm" title="Relit les fiches VPDive, sans le cache de la session">
      <RefreshCw className="w-4 h-4" /> Relire les fiches VPDive
    </button>
  );

  // ── 3. Corrections rapides ──
  if (step === 'quickfix') {
    const keyOf = (r: Row, f: Fix) => `${r.p.key}|${f.kind}`;
    // Brevets : le niveau VPDive à cocher, quand il n'y en a qu'un possible.
    const targets = (f: Fix) => (f.brevets ?? []).map((b) => ({ brevet: b, level: catalog ? brevetTarget(b, brevetMap, catalog) : null }));
    /** Pourquoi une correction ne peut pas s'écrire (case grisée), sinon null. */
    const blocked = (f: Fix): string | null => {
      if (f.kind === 'licence' && !f.licenceId) return 'licence sans identifiant VPDive : à faire à la main';
      if (f.kind !== 'brevets') return null;
      if (!catalog) return 'lecture du référentiel des niveaux…';
      return targets(f).some((t) => t.level) ? null : 'niveau VPDive à choisir dans la correspondance des brevets (roue crantée, étape 2)';
    };
    const groups = FIX_ORDER
      .map((kind) => ({ kind, list: rows.filter((r) => matches(r)).flatMap((r) => r.fixes.filter((f) => f.kind === kind).map((f) => ({ r, f }))) }))
      .filter((g) => g.list.length > 0);
    const toggle = (k: string) => setPicked((s) => new Set(s.has(k) ? [...s].filter((x) => x !== k) : [...s, k]));
    const selected = groups.flatMap((g) => g.list).filter(({ r, f }) => picked.has(keyOf(r, f)) && !blocked(f) && r.match.member);
    // Une écriture par fiche : toutes les corrections cochées du membre.
    const jobs: WriteJob[] = [];
    for (const { r, f } of selected) {
      const uct = r.match.member!.id;
      let job = jobs.find((j) => j.uct === uct);
      if (!job) jobs.push((job = { uct, name: r.match.member!.name, fixes: [], levels: [], ...(r.p.ffessm ? { licence: r.p.ffessm.licence } : {}) }));
      job.fixes.push(f);
      if (f.kind === 'insurance') job.insurance = f.after;
      if (f.kind === 'brevets') for (const t of targets(f)) if (t.level) job.levels.push({ id: t.level.id, name: t.level.name });
    }
    const apply = async () => {
      setConfirming(false);
      setResults([]);
      stopWriting.current = false;
      const ids = new Set((catalog ?? []).map((c) => c.id));
      for (const [i, job] of jobs.entries()) {
        if (stopWriting.current) break;
        setWriting({ done: i, total: jobs.length, name: job.name });
        try {
          const res = await applyJob(job, season, ids);
          if (res.after) {
            writeCache(job.uct, res.after);
            setRecords((rs) => ({ ...rs, [job.uct]: res.after! }));
          }
          setResults((rs) => [...rs, { uct: job.uct, name: job.name, ok: res.ok, message: res.message, ...(res.warning ? { warning: res.warning } : {}) }]);
          // Au premier problème, on s'arrête : à regarder avant de continuer.
          if (!res.ok) break;
        } catch (e) {
          if (lost.current(e)) break;
          setResults((rs) => [...rs, { uct: job.uct, name: job.name, ok: false, message: message(e) }]);
          break;
        }
      }
      setPicked(new Set());
      setWriting(null);
    };
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted max-w-2xl">
            Corrections sans risque : une valeur connue ajoutée à la fiche d’un membre reconnu avec certitude, sans rien retirer. Après les avoir appliquées, relisez les fiches pour
            mettre le diagnostic à jour.
          </p>
          {search}
        </div>
        {errors}
        {progressBar}
        {loading ? (
          !haError && !loadError && <GabianLoader label="Lecture de HelloAsso et des membres VPDive…" />
        ) : groups.length === 0 ? (
          <p className="py-10 text-center text-muted">{progress ? 'Lecture des fiches en cours…' : 'Aucune correction rapide à faire.'}</p>
        ) : (
          groups.map(({ kind, list }) => {
            const open = list.filter(({ f }) => !blocked(f));
            const all = open.length > 0 && open.every(({ r, f }) => picked.has(keyOf(r, f)));
            return (
              <section key={kind} className="card overflow-hidden">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 bg-raised border-b border-line">
                  <label className="inline-flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={all}
                      disabled={!open.length || !!writing}
                      onChange={() => setPicked((s) => new Set(all ? [...s].filter((k) => !open.some(({ r, f }) => keyOf(r, f) === k)) : [...s, ...open.map(({ r, f }) => keyOf(r, f))]))}
                      className="w-5 h-5 accent-[var(--fill)] disabled:opacity-40"
                    />
                    <span className="font-semibold text-brand">{FIX_TITLE[kind].title}</span>
                    <span className="text-sm text-muted tabular-nums">· {list.length}</span>
                  </label>
                  <span className="basis-full sm:basis-auto sm:ml-auto text-sm text-muted">{FIX_TITLE[kind].help}</span>
                </header>
                <ul className="divide-y divide-line">
                  {list.map(({ r, f }) => {
                    const why = blocked(f);
                    const unresolved = f.kind === 'brevets' && catalog ? targets(f).filter((t) => !t.level).map((t) => t.brevet) : [];
                    return (
                      <li key={keyOf(r, f)}>
                        <label className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${why ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-raised/60'}`}>
                          <input
                            type="checkbox"
                            checked={!why && picked.has(keyOf(r, f))}
                            disabled={!!why || !!writing}
                            onChange={() => toggle(keyOf(r, f))}
                            className="w-5 h-5 accent-[var(--fill)] disabled:opacity-40"
                          />
                          <span className="w-56 min-w-0 font-medium text-ink truncate">{r.match.member?.name ?? r.p.name}</span>
                          <span className="text-sm text-muted">{f.before}</span>
                          <span aria-hidden className="text-muted">→</span>
                          <span className="text-sm font-semibold text-ok">{f.after}</span>
                          {f.kind === 'licence' && <span className="text-xs text-muted">{f.refresh ? 'relue à la FFESSM' : 'date saisie'}</span>}
                          {f.kind === 'brevets' && !why && catalog && (
                            <span className="text-xs text-muted">
                              coche {targets(f).filter((t) => t.level).map((t) => t.level!.name).join(', ')}
                              {unresolved.length > 0 && ` · ${unresolved.join(', ')} : niveau à choisir`}
                            </span>
                          )}
                          {why && <span className="text-xs text-warn">{why}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
        {results.length > 0 && (
          <section className="card overflow-hidden" aria-live="polite">
            <header className="flex items-center gap-2 px-4 py-2.5 bg-raised border-b border-line">
              <span className="font-semibold text-brand">Écrit dans VPDive</span>
              <span className="text-sm text-muted tabular-nums">
                · {results.filter((x) => x.ok).length} fiche{results.filter((x) => x.ok).length > 1 ? 's' : ''}
                {results.some((x) => !x.ok) && ' · arrêté au premier problème'}
              </span>
              <button type="button" onClick={() => setResults([])} className="icon-btn ml-auto" aria-label="Fermer le compte rendu">
                <X className="w-4 h-4" />
              </button>
            </header>
            <ul className="divide-y divide-line">
              {results.map((x) => (
                <li key={x.uct} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  {x.ok ? <Check className="w-4 h-4 mt-0.5 text-ok shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-danger shrink-0" />}
                  <span className="w-52 min-w-0 font-medium text-ink truncate">{x.name}</span>
                  <span className={`flex-1 min-w-0 ${x.ok ? 'text-muted' : 'text-danger'}`}>
                    {x.message}
                    {x.warning && <span className="block text-warn">{x.warning}</span>}
                  </span>
                  <a href={VPDIVE_MEMBER(x.uct)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand underline underline-offset-2">
                    Fiche <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="sticky -bottom-4 z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 py-3 bg-surface border-t border-line flex flex-wrap items-center gap-3">
          {writing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-brand" />
              <span className="text-sm text-ink tabular-nums">
                Écriture {writing.done + 1}/{writing.total} : {writing.name}…
              </span>
              <button type="button" onClick={() => (stopWriting.current = true)} className="btn btn-quiet h-9 text-sm">
                Arrêter après cette fiche
              </button>
            </>
          ) : confirming ? (
            <>
              <span className="text-sm text-ink">
                Écrire {selected.length} correction{selected.length > 1 ? 's' : ''} sur {jobs.length} fiche{jobs.length > 1 ? 's' : ''} VPDive{'\u00a0'}?
              </span>
              <button type="button" onClick={() => void apply()} className="btn btn-primary">
                Écrire dans VPDive
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="btn btn-quiet h-9 text-sm">
                Annuler
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={!selected.length || !!progress} onClick={() => setConfirming(true)} className="btn btn-primary">
                Appliquer dans VPDive ({selected.length})
              </button>
              {refreshButton}
              <span className="text-sm text-muted">
                {progress
                  ? 'Lecture des fiches VPDive en cours : le bouton s’active quand elle est finie.'
                  : !selected.length
                    ? 'Cochez les corrections à écrire.'
                    : 'Chaque fiche est relue après l’écriture, et le lot s’arrête au premier problème. La fiche d’avant est gardée dans le journal.'}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 4. Arbitrage ──
  const isChecked = (r: Row, kind: CaseKind) => !!checks[caseKey(r.p, kind)];
  // Dans chaque groupe, ce qui reste à voir d'abord ; les cas vérifiés en bas, atténués.
  const caseGroups = CASE_ORDER.map((kind) => ({
    kind,
    list: rows.filter((r) => matches(r) && r.cases.some((c) => c.kind === kind)).sort((a, b) => Number(isChecked(a, kind)) - Number(isChecked(b, kind))),
  })).filter((g) => g.list.length > 0);
  const saveCheck = async (key: string, checked: boolean | undefined, comment: string) => {
    try {
      setChecks(await appApi.setArbitrageCheck(key, checked, comment));
    } catch (e) {
      if (!lost.current(e)) setLoadError(message(e));
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted max-w-2xl">Le cas par cas : ce qui demande une décision ou une saisie à la main, dans l’appli, sur la fiche VPDive ou sur Mon Club.</p>
        {search}
      </div>
      {errors}
      {progressBar}
      {loading ? (
        !haError && !loadError && <GabianLoader label="Lecture de HelloAsso et des membres VPDive…" />
      ) : caseGroups.length === 0 ? (
        <p className="py-10 text-center text-muted">{progress ? 'Lecture des fiches en cours…' : 'Rien à arbitrer.'}</p>
      ) : (
        caseGroups.map(({ kind, list }) => (
          <section key={kind} className="card overflow-hidden">
            <header className="flex items-center gap-2 px-4 py-2.5 bg-raised border-b border-line">
              <span className="font-semibold text-brand">{CASE_TITLE[kind]}</span>
              <span className="text-sm text-muted tabular-nums">
                · {list.filter((r) => !isChecked(r, kind)).length}
                {list.some((r) => isChecked(r, kind)) && ` (+ ${list.filter((r) => isChecked(r, kind)).length} vérifié${list.filter((r) => isChecked(r, kind)).length > 1 ? 's' : ''})`}
              </span>
            </header>
            <ul className="divide-y divide-line">
              {list.map((r) => {
                const c = r.cases.find((x) => x.kind === kind)!;
                const key = caseKey(r.p, kind);
                const check = checks[key];
                return (
                  <li key={r.p.key} className={`px-4 py-3 grid gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,16rem)_minmax(0,15rem)] items-start ${check ? 'bg-raised/50' : ''}`}>
                    <div className={`min-w-0 ${check ? 'opacity-60' : ''}`}>
                      <p className="font-semibold text-ink break-words">{r.p.name}</p>
                      <p className="text-sm text-muted">{r.p.birthDate ? `né(e) le ${frDay(r.p.birthDate)}` : ''}</p>
                    </div>
                    <p className={`text-sm text-ink ${check ? 'opacity-60' : ''}`}>{c.text}</p>
                    <div className={`min-w-0 ${check ? 'opacity-60' : ''}`}>
                      {kind === 'homonym' || kind === 'absent' ? (
                        <VpdiveCell match={r.match} pending={r.pending} onChoose={(uct) => void choose(r.p, uct)} />
                      ) : kind === 'family' ? (
                        <FamilyPicker family={r.family} payer={r.p.payerName} onPick={(uct) => void choose(r.p, uct, 'parent')} />
                      ) : kind === 'not-taken' || kind === 'unpaid' ? (
                        <a href="https://monclub.ffessm.fr" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand underline underline-offset-2">
                          Ouvrir Mon Club <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : r.match.member ? (
                        <a href={VPDIVE_MEMBER(r.match.member.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand underline underline-offset-2">
                          Ouvrir la fiche VPDive <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <CheckBox check={check} onSave={(checked, comment) => void saveCheck(key, checked, comment)} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <div className="flex flex-wrap items-center gap-3">{refreshButton}</div>
    </div>
  );
}

/** Mineur sans fiche : les comptes possibles d'un parent (payeur HelloAsso, même nom), ou un autre compte. */
function FamilyPicker({ family, payer, onPick }: { family: VpMember[]; payer?: string; onPick: (uct: string) => void }) {
  const [searching, setSearching] = useState(false);
  if (searching) {
    return (
      <div className="space-y-2">
        <MemberSearch onPick={(m) => onPick(m.id)} />
        <button type="button" onClick={() => setSearching(false)} className="btn btn-quiet h-8 text-sm">
          Annuler
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 text-sm">
      {family.map((m) => (
        <button key={m.id} type="button" onClick={() => onPick(m.id)} className="w-full flex items-center gap-2 px-2 py-1 rounded-lg border border-field-border hover:bg-tint text-left">
          <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
          <span className="flex-1 min-w-0 leading-tight">
            <span className="block text-ink break-words">{m.name}</span>
            {payer && sameName(payer, m.name) && <span className="block text-xs text-muted">a payé l’adhésion</span>}
          </span>
          <span className="text-brand font-medium shrink-0">Associer</span>
        </button>
      ))}
      <button type="button" onClick={() => setSearching(true)} className="underline text-muted hover:text-brand">
        Autre compte
      </button>
    </div>
  );
}

/**
 * « Vérifié » : l'admin a regardé le cas à la main et c'est bon. Qui, quand,
 * et un commentaire facultatif ; partagé entre admins. Remplace une liste d'ignorés.
 */
function CheckBox({ check, onSave }: { check?: CaseCheck; onSave: (checked: boolean | undefined, comment: string) => void }) {
  const [comment, setComment] = useState(check?.comment ?? '');
  useEffect(() => setComment(check?.comment ?? ''), [check?.comment]);
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium text-ink">
        <input type="checkbox" checked={!!check} onChange={(e) => onSave(e.target.checked, comment)} className="w-5 h-5 accent-[var(--fill)]" />
        Vérifié
      </label>
      {check && (
        <>
          <p className="text-xs text-muted">
            par {check.by} le {frDay(check.at)}
          </p>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => comment !== check.comment && onSave(undefined, comment)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="Commentaire (facultatif)"
            aria-label="Commentaire de vérification"
            className="field h-8 w-full text-sm"
          />
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
          {p.birthDate ? `né(e) le ${frDay(p.birthDate)}` : 'naissance inconnue'}
          {p.email && <span className="block truncate">{p.email}</span>}
        </p>
      </div>
      <Block title="Fiche VPDive">
        <VpdiveStatus match={match} pending={pending} />
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

/** Diagnostic : le membre VPDive retenu, ou ce qui reste à trancher (à l'étape Arbitrage). */
function VpdiveStatus({ match, pending }: { match: Match; pending: boolean }) {
  if (match.status === 'sure' && match.member) {
    return (
      <div className="flex items-start gap-2 min-w-0">
        <Avatar name={match.member.name} picture={match.member.picture} size="sm" initials={false} className="shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink truncate">{match.member.name}</p>
          <p className="text-muted">{match.why}</p>
        </div>
      </div>
    );
  }
  if (pending) return <p className="text-sm text-muted">Lecture des fiches…</p>;
  if (match.parent) return <p className="text-sm text-muted">{match.why}</p>;
  return (
    <p className="text-sm text-warn font-medium inline-flex items-center gap-1.5">
      <UserX className="w-4 h-4" /> {match.status === 'confirm' ? 'Homonymes : à trancher (étape 4)' : match.why || 'Pas de fiche VPDive (étape 4)'}
    </p>
  );
}

/** Arbitrage : le membre VPDive sûr, à choisir parmi les homonymes, ou introuvable (recherche à la main). */
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
      if (!rows.length) throw new Error(`Rien trouvé : est-ce bien l’export « Liste des ${what} » de Mon Club (CSV) ?`);
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
