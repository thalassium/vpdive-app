import { AlertTriangle, Check, ScrollText, X } from 'lucide-react';
import { GabianLoader } from '../../Gabian';
import { SectionTitle } from '../../SectionTitle';
import { Spinner } from '../../Spinner';
import type { WriteJob } from '../../../services/memberWriter';
import type { Fix, FixKind } from '../../../lib/membership';
import type { Row, StepProps } from './shared';
import { MemberSheetButton } from '../../member/MemberLink';

const FIX_ORDER: FixKind[] = ['season', 'licence', 'licence-add', 'insurance', 'brevets'];
const FIX_TITLE: Record<FixKind, { title: string; help: string }> = {
  season: { title: `Saison d’adhésion à ajouter`, help: 'Adhésion payée sur HelloAsso (geste d’août compris), saison absente de la fiche VPDive.' },
  licence: { title: 'Licence FFESSM : date de fin à mettre à jour', help: 'Même numéro, date ancienne. VPDive relit la FFESSM si la licence est vérifiée, sinon la date est saisie.' },
  'licence-add': { title: 'Licence FFESSM à ajouter', help: 'Licence prise par le club (export Mon Club), absente de la fiche VPDive.' },
  insurance: {
    title: 'Assurance à reporter',
    help: 'Assurance prise à la FFESSM (export Mon Club), sinon payée sur HelloAsso, écrite dans la liste VPDive avec la saison. Une autre assurance (DAN…) n’est pas remplacée.',
  },
  brevets: { title: 'Brevets à ajouter', help: 'Brevets délivrés par la FFESSM (export des brevets), absents des niveaux de la fiche VPDive.' },
};

/** Étape 3 : les corrections sans risque, par type, à pousser dans VPDive. */
export function QuickFixes(props: StepProps) {
  const { catalog, progress, rows, loading, haError, loadError, targets, blocked, picked, setPicked, writing, confirming, setConfirming, results, setResults, resultsRef, writeJobs, stopAfterCurrent, matches, errors, progressBar, refreshButton, search, setLogOpen } = props;
  const keyOf = (r: Row, f: Fix) => `${r.p.key}|${f.kind}`;
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
    if (f.kind === 'insurance' && f.insurance && f.insuranceYear) {
      job.insurance = f.insurance;
      job.insuranceYear = f.insuranceYear;
    }
    if (f.kind === 'brevets') for (const t of targets(f)) if (t.level) job.levels.push({ id: t.level.id, name: t.level.name });
  }
  const apply = () => writeJobs(jobs);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted max-w-2xl">
          Corrections sans risque : une valeur connue ajoutée à la fiche d’un membre reconnu avec certitude, sans rien retirer. Après les avoir écrites dans VPDive, relisez les
          fiches pour mettre le diagnostic à jour.
        </p>
        {search}
      </div>
      {errors}
      {progressBar}
      {results.length > 0 && (
        <section ref={resultsRef} className="card overflow-hidden scroll-mt-4" aria-live="polite">
          <SectionTitle
            flush
            count={
              <>
                {results.filter((x) => x.ok).length} fiche{results.filter((x) => x.ok).length > 1 ? 's' : ''}
                {results.some((x) => !x.ok) && ' · arrêté au premier problème'}
              </>
            }
            actions={
              // Croix en marine : le gris des icônes n'a que 2,7:1 sur le rose.
              <button type="button" onClick={() => setResults([])} className="icon-btn ml-auto -my-1 text-on-accent hover:text-on-accent hover:bg-surface/60" aria-label="Fermer le compte rendu">
                <X className="w-4 h-4" />
              </button>
            }
          >
            Écrit dans VPDive
          </SectionTitle>
          <ul className="zebra divide-y divide-line">
            {results.map((x) => (
              <li key={x.uct} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                {x.ok ? <Check className="w-4 h-4 mt-0.5 text-ok shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-danger shrink-0" />}
                <span className="flex-1 sm:flex-none sm:w-52 min-w-0 font-medium text-ink truncate">{x.name}</span>
                <span className={`flex-1 min-w-0 ${x.ok ? 'text-muted' : 'text-danger'}`}>
                  {x.message}
                  {x.warning && <span className="block text-warn">{x.warning}</span>}
                </span>
                {/* La fiche relue dans l'appli (le lien vers VPDive y est). */}
                <MemberSheetButton member={{ uct: x.uct, name: x.name }} className="-my-1.5" />
              </li>
            ))}
          </ul>
        </section>
      )}
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
              {/* Le titre du groupe porte la case « tout cocher » : un titre pour la navigation au clavier, une case pour le geste. */}
              <SectionTitle flush hint={FIX_TITLE[kind].help}>
                <label className="inline-flex items-center gap-2.5 max-sm:min-h-11 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={all}
                    disabled={!open.length || !!writing}
                    onChange={() => setPicked((s) => new Set(all ? [...s].filter((k) => !open.some(({ r, f }) => keyOf(r, f) === k)) : [...s, ...open.map(({ r, f }) => keyOf(r, f))]))}
                    className="w-5 h-5 shrink-0 accent-[var(--fill)] disabled:opacity-40"
                  />
                  <span>
                    {FIX_TITLE[kind].title}
                    <span className="font-normal tabular-nums text-on-accent/80"> · {list.length}</span>
                  </span>
                </label>
              </SectionTitle>
              {/* Lignes zébrées : une correction par ligne, sans perdre la ligne en lisant de gauche à droite. */}
              <ul className="zebra divide-y divide-line">
                {list.map(({ r, f }) => {
                  const why = blocked(f);
                  const unresolved = f.kind === 'brevets' && catalog ? targets(f).filter((t) => !t.level).map((t) => t.brevet) : [];
                  return (
                    <li key={keyOf(r, f)} className="flex items-center">
                      <label className={`flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 ${why ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-accent-soft'}`}>
                        <input
                          type="checkbox"
                          checked={!why && picked.has(keyOf(r, f))}
                          disabled={!!why || !!writing}
                          onChange={() => toggle(keyOf(r, f))}
                          className="w-5 h-5 accent-[var(--fill)] disabled:opacity-40"
                        />
                        <span className="flex-1 sm:flex-none sm:w-56 min-w-0 font-medium text-ink truncate">{r.match.member?.name ?? r.p.name}</span>
                        <span className="text-sm text-muted">{f.before}</span>
                        <span aria-hidden className="text-muted">→</span>
                        <span className="text-sm font-semibold text-ok">{f.after}</span>
                        {f.kind === 'licence' && <span className="text-xs text-muted">{f.refresh ? 'relue à la FFESSM' : 'date saisie'}</span>}
                        {f.kind === 'brevets' && !why && catalog && (
                          <span className="text-xs text-muted">
                            coche {targets(f).filter((t) => t.level).map((t) => t.level!.name).join(', ')}
                            {unresolved.length > 0 && ` · ${unresolved.join(', ')} : niveau à choisir`}
                          </span>
                        )}
                        {why && <span className="text-xs text-warn">{why}</span>}
                      </label>
                      {/* À côté de l'étiquette (qui coche la correction), pas dedans. */}
                      {r.match.member && <MemberSheetButton member={{ uct: r.match.member.id, name: r.match.member.name, picture: r.match.member.picture }} className="mr-2 shrink-0" />}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      <div className="sticky -bottom-4 z-10 -mx-3 sm:-mx-5 px-3 sm:px-5 py-3 bg-surface border-t border-line flex flex-wrap items-center gap-3">
        {writing ? (
          <>
            <Spinner className="text-brand" />
            <span className="text-sm text-ink tabular-nums">
              Écriture {writing.done + 1}/{writing.total} : {writing.name}…
            </span>
            <button type="button" onClick={stopAfterCurrent} className="btn btn-quiet sm:h-9 text-sm">
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
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-quiet sm:h-9 text-sm">
              Annuler
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={!selected.length || !!progress} onClick={() => setConfirming(true)} className="btn btn-primary">
              Écrire dans VPDive ({selected.length})
            </button>
            {refreshButton}
            <button type="button" onClick={() => setLogOpen(true)} className="btn btn-quiet sm:h-9 text-sm" title="Les fiches écrites par les corrections rapides, avec la fiche d’avant">
              <ScrollText className="w-4 h-4" /> Journal
            </button>
            <span className="text-sm text-muted">
              {progress
                ? 'Lecture des fiches VPDive en cours : le bouton s’active quand elle est finie.'
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
