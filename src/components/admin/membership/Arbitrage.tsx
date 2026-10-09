import { useState } from 'react';
import { ExternalLink, UserX } from 'lucide-react';
import { Avatar } from '../../Avatar';
import { GabianLoader } from '../../Gabian';
import { SectionTitle } from '../../SectionTitle';
import { MemberSearch } from '../../dp/MemberSearch';
import { frDate } from '../../../lib/dates';
import { checkFor, sameName, seasonLabel, type CaseCheck, type CaseKind, type Match, type VpMember } from '../../../lib/membership';
import { VPDIVE_MEMBER, type StepProps } from './shared';
import { MemberSheetButton } from '../../member/MemberLink';

const CASE_TITLE: Record<CaseKind, string> = {
  homonym: 'Homonymes : choisir le bon membre',
  family: 'Patronyme commun : parents',
  absent: 'Pas de fiche VPDive',
  guest: 'Statut Invité à passer en Membre',
  'licence-other': 'Autre numéro de licence dans VPDive',
  'not-taken': 'Licence FFESSM payée sur HelloAsso, à ajouter dans Mon Club / FFESSM',
  unpaid: 'Licence prise sans paiement HelloAsso',
  'season-unpaid': 'Saison sans adhésion HelloAsso',
  'no-licence': 'Ni licence ni Pass payés au club',
  'insurance-missing': 'Assurance payée sur HelloAsso, absente de VPDive',
};
const CASE_ORDER: CaseKind[] = ['homonym', 'family', 'absent', 'guest', 'licence-other', 'not-taken', 'unpaid', 'insurance-missing', 'season-unpaid', 'no-licence'];

/** Étape 4 : le cas par cas, à décider à la main. */
export function Arbitrage(props: StepProps) {
  const { season, checks, progress, rows, loading, haError, loadError, isChecked, choose, saveCheck, matches, errors, progressBar, refreshButton, search } = props;
  // Dans chaque groupe, ce qui reste à voir d'abord ; les cas validés à la main en bas, atténués.
  const caseGroups = CASE_ORDER.map((kind) => ({
    kind,
    list: rows.filter((r) => matches(r) && r.cases.some((c) => c.kind === kind)).sort((a, b) => Number(isChecked(a, kind)) - Number(isChecked(b, kind))),
  })).filter((g) => g.list.length > 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted max-w-2xl">
          Le cas par cas : ce qui demande une décision ou une saisie à la main, dans l’appli, sur la fiche VPDive ou sur Mon Club. Un cas réglé ou sans suite se coche
          «{' '}Validation manuelle{' '}» : il ne compte plus pour la saison {seasonLabel(season)}.
        </p>
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
          // Un bandeau rose par type de cas, puis une carte par personne : chaque cas se lit à part.
          <section key={kind}>
            <SectionTitle
              className="mb-2"
              count={
                <>
                  {list.filter((r) => !isChecked(r, kind)).length}
                  {list.some((r) => isChecked(r, kind)) && ` (+ ${list.filter((r) => isChecked(r, kind)).length} validé${list.filter((r) => isChecked(r, kind)).length > 1 ? 's' : ''} à la main)`}
                </>
              }
            >
              {CASE_TITLE[kind]}
            </SectionTitle>
            <ul className="space-y-2">
              {list.map((r) => {
                const c = r.cases.find((x) => x.kind === kind)!;
                const { key, check } = checkFor(r.p, kind, season, checks);
                return (
                  <li key={r.p.key} className={`item-card grid gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,16rem)_minmax(0,15rem)] items-start ${check ? 'border-dashed' : ''}`}>
                    <div className={`min-w-0 ${check ? 'opacity-60' : ''}`}>
                      <p className="font-semibold text-ink break-words">{r.p.name}</p>
                      <p className="text-sm text-muted">{r.p.birthDate ? `né le ${frDate(r.p.birthDate)}` : ''}</p>
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
                        <span className="inline-flex items-center gap-1">
                          <a href={VPDIVE_MEMBER(r.match.member.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand underline underline-offset-2">
                            Ouvrir la fiche VPDive <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <MemberSheetButton member={{ uct: r.match.member.id, name: r.match.member.name, picture: r.match.member.picture }} className="-my-1.5" />
                        </span>
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
        <button type="button" onClick={() => setSearching(false)} className="btn btn-quiet sm:h-8 text-sm">
          Annuler
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 text-sm">
      {family.map((m) => (
        // La fiche du candidat à côté du bouton « Associer », pas dedans.
        <div key={m.id} className="flex items-center gap-1">
          <button type="button" onClick={() => onPick(m.id)} className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 sm:py-1 rounded-lg border border-field-border hover:bg-tint text-left">
            <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
            <span className="flex-1 min-w-0 leading-tight">
              <span className="block text-ink break-words">{m.name}</span>
              {payer && sameName(payer, m.name) && <span className="block text-xs text-muted">a payé l’adhésion</span>}
            </span>
            <span className="text-brand font-medium shrink-0">Associer</span>
          </button>
          <MemberSheetButton member={{ uct: m.id, name: m.name, picture: m.picture }} />
        </div>
      ))}
      <button type="button" onClick={() => setSearching(true)} className="max-sm:min-h-11 underline text-muted hover:text-brand">
        Autre compte
      </button>
    </div>
  );
}

/**
 * « Validation manuelle » : l'admin a regardé le cas à la main et c'est bon,
 * pour cette saison. Qui, quand, et un commentaire facultatif ; partagé entre
 * admins. Remplace une liste d'ignorés.
 */
function CheckBox({ check, onSave }: { check?: CaseCheck; onSave: (checked: boolean | undefined, comment: string) => void }) {
  const [comment, setComment] = useState(check?.comment ?? '');
  // Commentaire changé ailleurs (autre admin, enregistrement) : le champ le reprend, pendant le rendu.
  const [shown, setShown] = useState(check?.comment);
  if (check?.comment !== shown) {
    setShown(check?.comment);
    setComment(check?.comment ?? '');
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="inline-flex items-center gap-2 max-sm:min-h-11 cursor-pointer text-sm font-medium text-ink">
        <input type="checkbox" checked={!!check} onChange={(e) => onSave(e.target.checked, comment)} className="w-5 h-5 accent-[var(--fill)]" />
        Validation manuelle
      </label>
      {check && (
        <>
          <p className="text-xs text-muted">
            par {check.by} le {frDate(check.at)}
          </p>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => comment !== check.comment && onSave(undefined, comment)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="Commentaire (facultatif)"
            aria-label="Commentaire de la validation manuelle"
            className="field sm:h-8 w-full text-sm"
          />
        </>
      )}
    </div>
  );
}

/** Arbitrage : le membre VPDive sûr, à choisir parmi les homonymes, ou introuvable (recherche à la main). */
function VpdiveCell({ match, pending, onChoose }: { match: Match; pending: boolean; onChoose: (uct: string | null) => void }) {
  const [searching, setSearching] = useState(false);
  if (searching) {
    return (
      <div className="space-y-2">
        <MemberSearch onPick={(m) => onChoose(m.id)} />
        <button type="button" onClick={() => setSearching(false)} className="btn btn-quiet sm:h-8 text-sm">
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
        <div className="min-w-0 flex-1 text-sm">
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
        <MemberSheetButton member={{ uct: m.id, name: m.name, picture: m.picture }} className="-mt-1" />
      </div>
    );
  }
  if (match.status === 'confirm') {
    return (
      <div className="space-y-1.5 text-sm">
        {match.obsolete && <p className="text-warn">{match.obsolete}</p>}
        <p className="text-warn font-medium">{pending ? 'Lecture des fiches…' : 'À confirmer'}</p>
        {match.candidates.map((m) => (
          // La fiche du candidat, pour trancher entre homonymes : à côté de « C'est lui », pas dedans.
          <div key={m.id} className="flex items-center gap-1">
            <button type="button" onClick={() => onChoose(m.id)} className="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 sm:py-1 rounded-lg border border-field-border hover:bg-tint text-left">
              <Avatar name={m.name} picture={m.picture} size="sm" initials={false} />
              <span className="flex-1 min-w-0 truncate text-ink">{m.name}</span>
              <span className="text-brand font-medium shrink-0">C’est lui</span>
            </button>
            <MemberSheetButton member={{ uct: m.id, name: m.name, picture: m.picture }} />
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3">
          <button type="button" onClick={() => setSearching(true)} className="max-sm:min-h-11 underline text-muted hover:text-brand">
            Autre membre
          </button>
          <button type="button" onClick={() => onChoose('none')} className="max-sm:min-h-11 underline text-muted hover:text-brand">
            Pas dans VPDive
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="text-sm space-y-1">
      {match.obsolete && <p className="text-warn">{match.obsolete}</p>}
      <p className="text-muted inline-flex items-center gap-1.5">
        <UserX className="w-4 h-4" /> {match.why || 'Aucun membre à ce nom'}
      </p>
      <div className="flex flex-wrap gap-x-3">
        <button type="button" onClick={() => setSearching(true)} className="max-sm:min-h-11 underline text-muted hover:text-brand">
          Chercher dans VPDive
        </button>
        {(match.why || match.obsolete) && (
          <button type="button" onClick={() => onChoose(null)} className="max-sm:min-h-11 underline text-muted hover:text-brand">
            annuler
          </button>
        )}
      </div>
    </div>
  );
}
