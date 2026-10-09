import { useEffect, useId, useState, type ReactNode } from 'react';
import { Award, ExternalLink, FolderOpen, IdCard, Lock, UserRound } from 'lucide-react';
import { vpdive, type MemberSheet as Sheet, type RosterEntry } from '../../services/vpdive';
import { frDate } from '../../lib/dates';
import { message } from '../../lib/errors';
import { sheetFallback, VPDIVE_MEMBER } from '../../lib/memberSheet';
import { Avatar } from '../Avatar';
import { Dialog, DialogHeader } from '../Dialog';
import { Failure } from '../Feedback';
import { SectionTitle } from '../SectionTitle';
import { DocumentList, InfoGroups, InfoList, QualsList, Skeleton, type InfoGroup } from './MemberBlocks';
import { fromProfile, fromRoster } from './quals';
import type { MemberRef } from './sheetContext';

/** Ce que la fenêtre montre : la fiche complète lue sur VPDive, ou à défaut la fiche « plongée ». */
type State =
  | { kind: 'loading' }
  | { kind: 'ok'; sheet: Sheet }
  /** Fiche « plongée » : la ligne de la liste des inscrits de la sortie (DP non admin, ou refus de VPDive). */
  | { kind: 'dive' }
  | { kind: 'forbidden' }
  | { kind: 'missing' }
  | { kind: 'error'; text: string };

/**
 * Fiche d'un membre, ouverte par l'icône posée à côté de son nom (MemberLink),
 * par-dessus l'écran courant qu'on retrouve en la fermant (Échap, Retour, croix).
 * Posée sur <body> par MemberSheetProvider, à l'étage z-[75] : au-dessus des
 * panneaux (z-50) et des menus (z-70), sous les confirmations (z-80) et la
 * reconnexion (z-90). Rien à l'impression.
 *
 * `full` (admins) : la fiche complète, lue sur VPDive (GET /user?uct_token=) ;
 * refusée (403), elle retombe sur la fiche « plongée » si l'écran a fourni la
 * ligne d'inscrit. Sinon (DP non admin) : directement la fiche « plongée ».
 */
export function MemberSheet({ member, full, onClose, onSessionLost }: { member: MemberRef; full: boolean; onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const titleId = useId();
  const [state, setState] = useState<State>(full ? { kind: 'loading' } : member.roster ? { kind: 'dive' } : { kind: 'forbidden' });
  const [attempt, setAttempt] = useState(0);
  const { uct, roster } = member;

  useEffect(() => {
    if (!full) return;
    let live = true;
    vpdive.memberSheet(uct).then(
      (sheet) => live && setState({ kind: 'ok', sheet }),
      (e) => {
        if (!live) return;
        // Session perdue : la reconnexion s'ouvre par-dessus ; « Réessayer » relira ensuite.
        if (onSessionLost(e)) return setState({ kind: 'error', text: message(e) });
        const fallback = sheetFallback(e, !!roster);
        setState(fallback === 'error' ? { kind: 'error', text: message(e) } : { kind: fallback });
      },
    );
    return () => {
      live = false;
    };
  }, [full, uct, roster, onSessionLost, attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };
  const sheet = state.kind === 'ok' ? state.sheet : null;
  const picture = sheet?.picture || member.picture;

  return (
    <Dialog label="member-sheet" onClose={onClose} titleId={titleId} layer="z-[75]" backdropClassName="print:hidden" className="sm:max-w-2xl h-dvh sm:h-auto sm:max-h-[90vh]">
      <DialogHeader titleId={titleId} kicker="Fiche membre" title={member.name} onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 space-y-5">
        {/* En-tête : la photo en grand, le statut, les saisons, le lien vers VPDive (admins). */}
        <div className="flex items-center gap-4">
          <Avatar name={member.name} picture={picture} size="md" className="w-16! h-16! text-lg!" />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {sheet ? (
                <Pill tone={sheet.member ? 'ok' : 'warn'}>{sheet.member ? 'Membre' : 'Invité'}</Pill>
              ) : (
                state.kind === 'dive' && roster && <Pill tone="brand">{roster.waitingList ? 'Liste d’attente de la sortie' : 'Inscrit à la sortie'}</Pill>
              )}
              {state.kind === 'loading' && <span aria-hidden className="w-20 h-6 rounded-md animate-pulse bg-raised" />}
            </div>
            {sheet && <p className="text-sm text-muted">{sheet.info.seasons.length ? `Saisons ${sheet.info.seasons.join(', ')}` : 'Aucune saison d’adhésion'}</p>}
            {full && state.kind !== 'forbidden' && state.kind !== 'dive' && (
              <a href={VPDIVE_MEMBER(uct)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 max-sm:min-h-11 text-sm font-semibold text-brand underline underline-offset-2">
                Ouvrir dans VPDive <ExternalLink aria-hidden className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {state.kind === 'loading' && (
          <div className="card overflow-hidden" aria-busy="true">
            <span className="sr-only">Lecture de la fiche sur VPDive…</span>
            <Skeleton rows={4} />
          </div>
        )}
        {state.kind === 'error' && <Failure look="soft" text={`Fiche illisible : ${state.text}`} onRetry={retry} />}
        {state.kind === 'missing' && <Notice icon={<UserRound className="w-5 h-5" />}>Membre introuvable sur VPDive : son adhésion a peut-être été supprimée.</Notice>}
        {state.kind === 'forbidden' && <Notice icon={<Lock className="w-5 h-5" />}>La fiche complète est réservée aux admins.</Notice>}
        {sheet && <FullSheet sheet={sheet} />}
        {state.kind === 'dive' && roster && <DiveSheet r={roster} />}
      </div>
    </Dialog>
  );
}

/** Fiche complète (admins) : coordonnées et adhésion, niveaux et certificat, documents. */
function FullSheet({ sheet }: { sheet: Sheet }) {
  return (
    <>
      <Section title="Coordonnées et adhésion" icon={<IdCard className="w-5 h-5" />}>
        <InfoList info={sheet.info} />
      </Section>
      <Section title="Niveaux et certificat" icon={<Award className="w-5 h-5" />}>
        <div className="p-4">
          <QualsList quals={fromProfile(sheet.profile)} />
        </div>
      </Section>
      <Section title="Documents" icon={<FolderOpen className="w-5 h-5" />} count={sheet.documents.length}>
        {sheet.documents.length ? <DocumentList documents={sheet.documents} /> : <p className="p-4 text-muted">Aucun document déposé sur VPDive.</p>}
      </Section>
    </>
  );
}

/**
 * Fiche « plongée » (DP non admin, inscrits de SA sortie) : ce que la liste des
 * inscrits de la sortie dit de lui, rien de plus.
 */
function DiveSheet({ r }: { r: RosterEntry }) {
  const licences = r.licences ?? [];
  const groupes: InfoGroup[] = [
    { titre: 'Contact', lignes: [['E-mail', r.email && <a href={`mailto:${r.email}`} className="text-brand underline underline-offset-2 break-all">{r.email}</a>]] },
    {
      titre: 'Plongeur',
      lignes: [
        ['Âge', r.age !== null && r.age > 0 ? `${r.age} ans` : ''],
        ...licences.map((l, i): [string, ReactNode] => [
          licences.length > 1 ? `Licence ${i + 1}` : 'Licence',
          <span>
            <span className="tabular-nums">{l.number}</span>
            {l.until && <span className="text-muted"> · jusqu’au {frDate(l.until)}</span>}
            {l.valid ? <span className="text-ok"> · validée</span> : <span className="text-muted"> · non validée</span>}
          </span>,
        ]),
      ],
    },
    {
      titre: 'Sortie',
      lignes: [
        ['Rôles', r.roles.join(', ')],
        ['Commentaire', r.comment],
      ],
    },
  ];
  const hasInfo = groupes.some((g) => g.lignes.some(([, v]) => !!v));
  return (
    <>
      <p className="text-sm text-muted flex items-start gap-1.5">
        <Lock aria-hidden className="w-4 h-4 shrink-0 mt-0.5" />
        Fiche complète réservée aux admins : voici ce que dit la liste des inscrits de la sortie.
      </p>
      <Section title="Niveaux et formation" icon={<Award className="w-5 h-5" />}>
        <div className="p-4">
          <QualsList quals={fromRoster(r)} />
        </div>
      </Section>
      <Section title="Pour cette sortie" icon={<IdCard className="w-5 h-5" />}>
        {hasInfo ? <InfoGroups groupes={groupes} /> : <p className="p-4 text-muted">Rien d’autre sur la liste des inscrits.</p>}
      </Section>
    </>
  );
}

/** Un bloc de la fiche : le bandeau rose du thème, puis son contenu dans une carte. */
function Section({ title, icon, count, children }: { title: string; icon: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <SectionTitle flush count={count}>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="shrink-0">
            {icon}
          </span>
          {title}
        </span>
      </SectionTitle>
      {children}
    </section>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'brand'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'bg-ok-soft text-ok' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-tint text-brand';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-sm font-semibold ${cls}`}>{children}</span>;
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div role="status" className="p-4 rounded-xl bg-tint text-brand flex items-start gap-3">
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
