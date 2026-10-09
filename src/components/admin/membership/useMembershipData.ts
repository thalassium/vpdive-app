import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vpdive, isUnavailable } from '../../../services/vpdive';
import { ymd } from '../../../lib/dates';
import { appApi, type FfessmImport } from '../../../services/appApi';
import { applyJob, type WriteJob } from '../../../services/memberWriter';
import {
  brevetTarget,
  checkFor,
  linkFor,
  attachedView,
  familyCandidates,
  lackingBrevets,
  arbitrageCases,
  quickFixes,
  brevetsByLicence,
  buildPeople,
  candidatesFor,
  matchPerson,
  seasonOf,
  viewOf,
  type BrevetMap,
  type CaseCheck,
  type CaseKind,
  type Capacity,
  type Fix,
  type FfessmBrevet,
  type HaItem,
  type LinkChoice,
  type Person,
  type VpMember,
  type VpRecord,
} from '../../../lib/membership';
import { message } from '../../../lib/errors';
import { recordCache } from '../memberCache';
import type { Row } from './shared';

/** Erreurs d'affilée avant de s'arrêter ; VPDive indisponible (pare-feu, réseau) : tout de suite. */
const MAX_FAILURES = 3;

interface Options {
  onCounts?: (c: { fixes: number; cases: number }) => void;
  onSessionLost: (e: unknown) => boolean;
  /** Écriture dans VPDive en cours ou finie : le panneau ne se ferme pas pendant. */
  onWriting?: (busy: boolean) => void;
  /** Rempli ici : à appeler après une validation (étape 1), la fiche de ce membre est relue. */
  forgetRef?: { current: ((uct: string) => void) | null };
}

/**
 * Données des étapes 2 à 4 de la gestion des adhésions, lues une fois et gardées
 * tant que la fenêtre est ouverte : HelloAsso, exports FFESSM, annuaire et fiches
 * VPDive (une à une, gardées 6 h), rapprochements et validations manuelles. Et
 * l'écriture des corrections rapides, qui continue quand on change d'étape.
 */
export function useMembershipData({ onCounts, onSessionLost, onWriting, forgetRef }: Options) {
  // Une seule saison : celle en cours (l'export FFESSM déposé est celui de la saison), d'après la date locale.
  const season = useMemo(() => seasonOf(ymd(new Date())), []);
  const [items, setItems] = useState<HaItem[] | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const [ffessm, setFfessm] = useState<FfessmImport | null | undefined>(undefined);
  const [brevetsImport, setBrevetsImport] = useState<FfessmImport<FfessmBrevet> | null | undefined>(undefined);
  const brevets = useMemo(() => (brevetsImport ? brevetsByLicence(brevetsImport.rows) : null), [brevetsImport]);
  /** Correspondance des brevets choisie par les admins (roue crantée). */
  const [brevetMap, setBrevetMap] = useState<BrevetMap>({});
  const [directory, setDirectory] = useState<VpMember[] | null>(null);
  const [links, setLinks] = useState<Record<string, LinkChoice> | null>(null);
  const [records, setRecords] = useState<Record<string, VpRecord>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Corrections cochées (clé : personne + type). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Cas d'arbitrage vérifiés à la main, partagés entre admins. */
  const [checks, setChecks] = useState<Record<string, CaseCheck>>({});
  /** Référentiel des niveaux VPDive (identifiants à écrire pour les brevets) : dit aussi quelles corrections sont possibles. */
  const [catalog, setCatalog] = useState<Capacity[] | null>(null);
  /** Écriture en cours dans VPDive, et ce qu'elle a donné fiche par fiche. */
  const [writing, setWriting] = useState<{ done: number; total: number; name: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<{ uct: string; name: string; ok: boolean; message: string; warning?: string }[]>([]);
  const stopWriting = useRef(false);
  /** Compte rendu des écritures, ramené à l'écran à la fin du lot. */
  const resultsRef = useRef<HTMLElement>(null);
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

  // Une lecture : le compteur de l'onglet 3 en a besoin (une correction de brevets sans niveau à cocher ne compte pas).
  useEffect(() => {
    vpdive.capacities().then(setCatalog, (e) => lost.current(e) || setLoadError(message(e)));
  }, []);

  // Le panneau ne se ferme pas en pleine écriture ; fermé quand même (démontage), le lot s'arrête après la fiche en cours.
  const busy = !!writing;
  const writingCb = useRef(onWriting);
  writingCb.current = onWriting;
  useEffect(() => writingCb.current?.(busy), [busy]);
  useEffect(
    () => () => {
      stopWriting.current = true;
      writingCb.current?.(false);
    },
    [],
  );

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
    const known = new Set(directory.map((m) => m.id));
    for (const p of people) {
      const link = linkFor(p, links, season)?.link;
      // Un choix vers un membre sorti de l'annuaire (« choix obsolète ») : on relit les homonymes.
      if (link && (link.uct === 'none' || known.has(link.uct))) {
        if (link.uct !== 'none') ids.add(link.uct);
      } else for (const m of candidatesFor(p, directory)) ids.add(m.id);
    }
    return [...ids];
  }, [people, directory, links, season]);

  const run = useRef(0);
  /** Lit les fiches ; `fresh` : sans le cache (après des corrections ou des validations). */
  const readRecords = useCallback(async (ids: string[], fresh = false) => {
    const id = ++run.current;
    setReadError(null);
    const cached: Record<string, VpRecord> = {};
    const todo: string[] = [];
    for (const u of ids) {
      const c = fresh ? null : recordCache.read(u);
      if (c) cached[u] = c;
      else todo.push(u);
    }
    setRecords((r) => ({ ...r, ...cached }));
    if (!todo.length) return setProgress(null);
    let failures = 0;
    for (const [i, u] of todo.entries()) {
      if (run.current !== id) return;
      setProgress({ done: i, total: todo.length });
      try {
        const record = await vpdive.memberRecord(u, { fresh, priority: 'low' });
        if (run.current !== id) return;
        recordCache.write(u, record);
        setRecords((r) => ({ ...r, [u]: record }));
        failures = 0;
      } catch (e) {
        if (lost.current(e)) return;
        if (++failures >= MAX_FAILURES || isUnavailable(e)) {
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

  // Validation à l'étape 1 (document, saison, licence…) : la fiche gardée ici est périmée. Elle est
  // oubliée tout de suite et relue sans cache, dès que la lecture en cours (s'il y en a une) est finie.
  const stale = useRef(new Set<string>());
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    if (!forgetRef) return;
    forgetRef.current = (uct) => {
      stale.current.add(uct);
      setRecords(({ [uct]: _, ...rest }) => rest);
      setStaleTick((n) => n + 1);
    };
    return () => {
      forgetRef.current = null;
    };
  }, [forgetRef]);
  useEffect(() => {
    if (progress || !stale.current.size) return;
    const ids = [...stale.current].filter((u) => wanted.includes(u));
    stale.current.clear();
    if (ids.length) void readRecords(ids, true);
  }, [staleTick, progress, wanted, readRecords]);

  const rows = useMemo<Row[]>(() => {
    if (!people || !directory || !links) return [];
    return people.map((p) => {
      const link = linkFor(p, links, season)?.link;
      const match = matchPerson(p, directory, records, link);
      const record = match.member ? (records[match.member.id] ?? null) : null;
      const cands = link && !match.obsolete ? [] : candidatesFor(p, directory);
      // Mineur rattaché au compte d'un parent : pas de fiche à lire, ce n'est pas un écart.
      const base = viewOf(p, record, season, brevets, brevetMap);
      const view = match.parent ? attachedView(base, match.parent.name) : base;
      const fixes = quickFixes(p, match, record, season, lackingBrevets(p, record, brevets, brevetMap));
      const family = match.status === 'missing' && !match.why ? familyCandidates(p, directory) : [];
      return { p, match, record, view, fixes, family, cases: arbitrageCases(p, match, record, view, season, family), pending: cands.some((m) => !records[m.id]) || (!!match.member && !record) };
    });
  }, [people, directory, links, records, season, brevets, brevetMap]);

  // Brevets : le niveau VPDive à cocher, quand il n'y en a qu'un possible.
  const targets = (f: Fix) => (f.brevets ?? []).map((b) => ({ brevet: b, level: catalog ? brevetTarget(b, brevetMap, catalog) : null }));
  /** Pourquoi une correction ne peut pas s'écrire (case grisée), sinon null. */
  const blocked = (f: Fix): string | null => {
    if (f.kind === 'licence' && !f.licenceId) return 'licence sans identifiant VPDive : à faire à la main';
    if (f.kind !== 'brevets') return null;
    if (!catalog) return 'lecture du référentiel des niveaux…';
    return targets(f).some((t) => t.level) ? null : 'niveau VPDive à choisir dans la correspondance des brevets (roue crantée, étape 2)';
  };
  // Les corrections grisées ne comptent pas : il n'y a rien à cocher.
  const fixCount = rows.reduce((n, r) => n + r.fixes.filter((f) => !blocked(f)).length, 0);
  // Un cas validé à la main (pour la saison) ne compte plus.
  const isChecked = (r: Row, kind: CaseKind) => !!checkFor(r.p, kind, season, checks).check;
  const caseCount = rows.reduce((n, r) => n + r.cases.filter((c) => !isChecked(r, c.kind)).length, 0);
  useEffect(() => {
    if (rows.length) onCounts?.({ fixes: fixCount, cases: caseCount });
  }, [rows.length, fixCount, caseCount, onCounts]);


  const choose = async (p: Person, uct: string | null, relation?: 'parent') => {
    try {
      if (uct === null) {
        // Annuler : sous la clé `lic:` et sous l'ancienne clé HelloAsso, sinon l'ancien choix reviendrait.
        let next = links ?? {};
        for (const key of [p.key, p.haKey]) if (key && next[key]) next = await appApi.setMemberLink(key, null);
        setLinks(next);
        return;
      }
      setLinks(await appApi.setMemberLink(p.key, uct, relation));
    } catch (e) {
      if (!lost.current(e)) setLoadError(message(e));
    }
  };
  /** Relit sans cache les fiches des membres reconnus (après corrections ou validations). */
  const refresh = () => void readRecords([...new Set(rows.map((r) => r.match.member?.id).filter((x): x is string => !!x))], true);

  const loading = !people || !directory || !links;

  /** « Arrêter » la lecture des fiches. */
  const stopReading = () => {
    run.current++;
    setProgress(null);
    setReadError('Lecture arrêtée.');
  };
  /** « Reprendre » : les fiches pas encore lues. */
  const resumeReading = () => void readRecords(wanted.filter((u) => !records[u]));

  /** Écrit les corrections cochées, une fiche après l'autre ; s'arrête au premier problème. */
const writeJobs = async (jobs: WriteJob[]) => {
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
          recordCache.write(job.uct, res.after);
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
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  /** « Arrêter après cette fiche ». */
  const stopAfterCurrent = () => {
    stopWriting.current = true;
  };

const saveCheck = async (key: string, checked: boolean | undefined, comment: string) => {
  try {
    setChecks(await appApi.setArbitrageCheck(key, checked, comment));
  } catch (e) {
    if (!lost.current(e)) setLoadError(message(e));
  }
};

  return {
    season,
    ffessm,
    setFfessm,
    brevetsImport,
    setBrevetsImport,
    brevetMap,
    setBrevetMap,
    catalog,
    checks,
    records,
    progress,
    readError,
    rows,
    loading,
    haError,
    loadError,
    loadHelloasso,
    targets,
    blocked,
    isChecked,
    choose,
    refresh,
    saveCheck,
    stopReading,
    resumeReading,
    picked,
    setPicked,
    writing,
    busy,
    confirming,
    setConfirming,
    results,
    setResults,
    resultsRef,
    writeJobs,
    stopAfterCurrent,
  };
}

export type MembershipData = ReturnType<typeof useMembershipData>;
