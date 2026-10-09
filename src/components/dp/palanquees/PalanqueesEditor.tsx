import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Lock, Pencil, Plus, Share2, ShieldCheck, Sparkles } from 'lucide-react';
import type { MemberMatch, RosterEntry } from '../../../services/vpdive';
import { acceptsExtra, isInstructor, proposePalanquees, studentsOf, validate, type Diver, type Plan } from '../../../lib/palanquees';
import { addPalanquee, assignGuide, deletePalanquee, buddyPairs, moveDiver, planToText, refreshDivers, rosterToDivers, setExtra, removeGuide, setType } from '../../../lib/palanqueeEdit';
import { defaultRoles, mustBePlaced, outOfWater, rolesOf, type AddedMember, type Dive, type DiveRole, type Guest, type OutingDoc, type Roles } from '../../../lib/outing';
import { useConfirm } from '../../../hooks/useConfirm';
import { FreeList } from './FreeList';
import { PalanqueeCard } from './PalanqueeCard';
import { RolesSection } from './RolesSection';
import { RosterSection } from './RosterSection';
import { ActionButton } from './ActionButton';
import { SectionTitle } from '../../SectionTitle';
import { RolesContext, type Target } from './format';

interface Props {
  title: string;
  roster: RosterEntry[];
  doc: OutingDoc;
  dive: Dive;
  /** Un autre modifie la fiche : tout se lit, rien ne se change. */
  readOnly?: boolean;
  onSettings: (settings: OutingDoc['settings']) => void;
  /** Rôles de la sortie, et celui qui vient de changer (pour l'en-tête de la fiche). */
  onRoles: (roles: Roles, role: DiveRole) => void;
  onPlan: (plan: Plan) => void;
  onValidate: () => void;
  onReopen: () => void;
  /** Commentaire libre sur l'encadrant d'une palanquée (texte vide : effacé). */
  onNote: (palanqueeId: string, text: string) => void;
  /** Plongeurs hors VPDive de la sortie. */
  onGuests: (guests: Guest[]) => void;
  /** Membres VPDive ajoutés sans inscription. */
  onMembers: (members: AddedMember[]) => void;
  /** Désinscrit de VPDive (admin seulement : route d'admin de VPDive ; absent sinon) ; rejette avec le message à afficher. */
  onUnregister?: (person: { id: string; name: string; instructor: boolean }) => Promise<void>;
  /** Liste d'attente → inscrit sur VPDive (admin seulement ; absent sinon). */
  onPromote?: (person: { id: string; name: string }) => Promise<void>;
  /** Ajoute un membre VPDive non inscrit, avec des rôles. */
  onAddMember: (m: MemberMatch, roles: DiveRole[]) => Promise<void>;
}

/**
 * Palanquées d'une plongée, en deux temps. 1. Qui plonge : les inscrits avec
 * leur prérogative VPDive (à choisir seulement si elle manque, brevet étranger)
 * et, pour chacun, s'il est en formation ; le DP valide cette liste. 2. Les
 * palanquées : générées ou composées à la main, puis validées, ce qui fige la
 * composition et débloque la fiche de sécurité, où se fixent les profondeurs.
 */
export function PalanqueesEditor({ title, roster, doc, dive, readOnly = false, onSettings, onRoles, onPlan, onValidate, onReopen, onNote, onGuests, onMembers, onUnregister, onPromote, onAddMember }: Props) {
  const [copied, setCopied] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const settings = doc.settings;
  // Décochés, et liste d'attente VPDive que le DP n'a pas prise.
  const excluded = useMemo(() => outOfWater(roster, settings), [roster, settings]);
  const divers = useMemo(() => rosterToDivers(roster, settings), [roster, settings]);
  const diving = useMemo(() => divers.filter((d) => !excluded.has(d.id)), [divers, excluded]);
  const locked = !!dive.validated;
  /** Composition figée à l'écran : validée, ou un autre modifie la fiche. */
  const frozen = locked || readOnly;
  // Tant que ce n'est pas validé, chaque plongeur apparaît avec ses réglages actuels.
  const plan = useMemo(() => (dive.plan && !locked ? refreshDivers(dive.plan, divers) : dive.plan), [dive.plan, locked, divers]);
  const roles = useMemo(() => doc.roles ?? defaultRoles(roster), [doc.roles, roster]);
  const roleMap = useMemo(() => new Map(roster.map((r) => [r.id, rolesOf(roles, r.id)])), [roster, roles]);

  const generate = async () => {
    if (plan && !(await confirm({ title: 'Refaire les palanquées ?', message: 'La composition actuelle sera remplacée.', confirmLabel: 'Refaire' }))) return;
    const ids = new Set(diving.map((d) => d.id));
    const buddies = buddyPairs(roster).filter(([a, b]) => ids.has(a) && ids.has(b));
    // Le DP (rôle de la sortie) reste sur le bateau, sauf si sans lui des plongeurs restaient à terre.
    onPlan(proposePalanquees(diving, { buddies, lastResort: roles.dp ?? [] }));
  };

  // Qui est où dans le plan ; ceux qui plongent sans y figurer sont « disponibles ». Recalculé quand le plan ou la liste change seulement.
  const { free, instructors } = useMemo(() => {
    const placed = new Map<string, Diver>();
    for (const p of plan?.palanquees ?? []) for (const d of [p.guide, p.extra, ...p.members]) if (d) placed.set(d.id, d);
    return {
      free: plan
        ? [
            ...plan.unassigned.filter((u) => !excluded.has(u.diver.id)),
            ...diving.filter((d) => !placed.has(d.id) && !plan.unassigned.some((u) => u.diver.id === d.id)).map((diver) => ({ diver, reason: 'Ajouté après la génération.' })),
          ]
        : [],
      /** Tous ceux qui peuvent encadrer, où qu'ils soient. */
      instructors: diving.filter(isInstructor).map((d) => placed.get(d.id) ?? d),
    };
  }, [plan, excluded, diving]);

  const issues = useMemo(() => (plan ? plan.palanquees.flatMap((p) => validate(p)) : []), [plan]);
  // Cochés « plonge » mais dans aucune palanquée : à placer avant de valider (sauf rôle de la sortie ou accompagnant).
  const toPlace = useMemo(() => mustBePlaced(free.map((u) => u.diver), roles, settings), [free, roles, settings]);
  // Les sorties enregistrées avant cette étape, avec une composition : la liste est tenue pour validée.
  const rosterOk = settings.confirmed ?? !!dive.plan;
  const setConfirmed = (confirmed: boolean) => onSettings({ ...settings, confirmed });

  /**
   * Partager la composition en texte, dans l'appli que la personne choisit
   * (WhatsApp, Messages, e-mail…) via la feuille de partage du téléphone.
   * Sans feuille de partage (la plupart des ordinateurs) : copiée dans le presse-papier.
   */
  const share = async () => {
    if (!plan) return;
    const heading = `${title} · ${dive.label}`;
    const text = planToText(heading, plan);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Palanquées — ${heading}`, text });
        return;
      } catch (e) {
        // Partage annulé : rien à faire. Autre échec : on copie à la place.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé : la composition est affichée, sélectionnée, à copier à la main.
      await confirm({ title: 'Copiez la composition', text, confirmLabel: 'Fermer', cancelLabel: null });
    }
  };

  const moveTo = (d: Diver, target: string) => {
    if (!plan) return;
    if (target.startsWith('guide:')) onPlan(assignGuide(plan, target.slice(6), d));
    else if (target.startsWith('extra:')) onPlan(setExtra(plan, target.slice(6), d));
    else onPlan(moveDiver(plan, d, target));
  };
  const targetsFor = (exclude?: string): Target[] =>
    (plan?.palanquees ?? [])
      .map((p, i) => ({ id: p.id, label: `P${i + 1}`, kind: p.kind, students: studentsOf(p), extraOk: acceptsExtra(p) }))
      .filter((t) => t.id !== exclude);

  return (
    <RolesContext.Provider value={roleMap}>
    <div className="space-y-6">
      {locked && (
        <div className="p-4 rounded-xl bg-ok-soft text-ok flex flex-wrap items-center gap-3">
          <ShieldCheck className="w-5 h-5 shrink-0" />
          <p className="flex-1 min-w-0 text-sm">
            <strong className="font-semibold">Palanquées validées</strong> par {dive.validated!.by} le{' '}
            {new Date(dive.validated!.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}. La fiche de sécurité est débloquée.
          </p>
          {!readOnly && (
            <button type="button" onClick={onReopen} className="btn btn-quiet sm:h-9 text-sm border-ok/50 text-ok">
              <Pencil className="w-4 h-4" /> Modifier les palanquées
            </button>
          )}
        </div>
      )}

      <fieldset disabled={readOnly} className="min-w-0">
        <RolesSection roster={roster} roles={roles} excluded={excluded} onRoles={onRoles} onAddMember={onAddMember} />
      </fieldset>

      {/* 1. Qui plonge : encadrants du plus haut au plus bas, puis plongeurs ; validé par le DP avant les palanquées */}
      {!locked && !rosterOk && (
        <RosterSection
          roster={roster}
          doc={doc}
          divers={divers}
          diving={diving}
          excluded={excluded}
          readOnly={readOnly}
          onSettings={onSettings}
          onGuests={onGuests}
          onMembers={onMembers}
          onUnregister={onUnregister}
          onPromote={onPromote}
          onConfirm={() => setConfirmed(true)}
        />
      )}

      {!locked && rosterOk && (
        <section>
          <SectionTitle
            bleed
            className="mb-4"
            n={1}
            hint={`${diving.filter((d) => isInstructor(d) && !d.training).length} encadrant${diving.filter((d) => isInstructor(d) && !d.training).length > 1 ? 's' : ''} · ${diving.filter((d) => d.training).length} en formation`}
            actions={
              !readOnly && (
                <ActionButton onClick={() => setConfirmed(false)} icon={<Pencil className="w-4 h-4" />}>
                  Modifier les plongeurs
                </ActionButton>
              )
            }
          >
            {diving.length} à l’eau
          </SectionTitle>
        </section>
      )}

      {/* 2. Palanquées : générées ou composées, puis validées */}
      {!frozen && rosterOk && !plan && (
        <section>
          <SectionTitle bleed className="mb-4" n={2}>
            Palanquées
          </SectionTitle>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={generate}
              className="btn btn-primary h-11"
            >
              <Sparkles className="w-4 h-4" /> Générer les palanquées
            </button>
            <button
              type="button"
              onClick={() => onPlan(addPalanquee(null, diving))}
              className="btn btn-quiet sm:h-9 text-sm"
            >
              <Plus className="w-4 h-4" /> Composer à la main
            </button>
          </div>
        </section>
      )}

      {plan && (
        <section>
          <SectionTitle
            bleed
            className="mb-4"
            n={locked ? undefined : 2}
            hint={locked ? undefined : `${plan.palanquees.length} palanquée${plan.palanquees.length > 1 ? 's' : ''}`}
            actions={
              <>
                {!frozen && (
                  <ActionButton onClick={generate} icon={<Sparkles className="w-4 h-4" />}>
                    Refaire
                  </ActionButton>
                )}
                {!frozen && (
                  <ActionButton onClick={() => onPlan(addPalanquee(plan, diving))} icon={<Plus className="w-4 h-4" />} title="Nouvelle palanquée">
                    Palanquée
                  </ActionButton>
                )}
                <ActionButton onClick={share} icon={copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}>
                  {copied ? 'Texte copié' : 'Partager'}
                </ActionButton>
              </>
            }
          >
            {locked ? `${plan.palanquees.length} palanquée${plan.palanquees.length > 1 ? 's' : ''}` : 'Palanquées'}
          </SectionTitle>

          <div className="grid md:grid-cols-2 gap-3">
            {plan.palanquees.map((p, i) => (
              <PalanqueeCard
                key={p.id}
                index={i + 1}
                p={p}
                locked={frozen}
                note={dive.notes?.[p.id]}
                onNote={readOnly ? undefined : (text) => onNote(p.id, text)}
                instructors={instructors}
                targets={targetsFor(p.id)}
                onMove={moveTo}
                onGuide={(d) => onPlan(assignGuide(plan, p.id, d))}
                onType={(t) => onPlan(setType(plan, p.id, t))}
                onRemoveGuide={() => onPlan(removeGuide(plan, p.id))}
                onDelete={async () => {
                  const people = [p.guide, p.extra, ...p.members].filter(Boolean).length;
                  if (
                    people &&
                    !(await confirm({
                      title: `Supprimer P${i + 1} ?`,
                      message: `${people > 1 ? `Ses ${people} participants redeviendront disponibles` : 'Son participant redeviendra disponible'}.`,
                      confirmLabel: 'Supprimer',
                      danger: true,
                    }))
                  )
                    return;
                  onPlan(deletePalanquee(plan, p.id));
                }}
              />
            ))}
          </div>

          {free.length > 0 && !frozen && (
            <div className="mt-4 grid md:grid-cols-2 gap-3">
              <FreeList title="Encadrants disponibles" items={free.filter((u) => isInstructor(u.diver))} targets={targetsFor()} onMove={moveTo} instructor />
              <FreeList title="Plongeurs non placés" items={free.filter((u) => !isInstructor(u.diver))} targets={targetsFor()} onMove={moveTo} />
            </div>
          )}

          {!frozen && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  // On fige la composition telle qu’elle s’affiche (réglages à jour), pour la fiche de sécurité.
                  onPlan(plan);
                  onValidate();
                }}
                disabled={issues.length > 0 || toPlace.length > 0 || plan.palanquees.length === 0}
                className="btn btn-primary h-11"
              >
                <Lock className="w-4 h-4" /> Valider les palanquées
              </button>
              <span className="text-sm text-muted">
                {issues.length > 0
                  ? `${issues.length} point${issues.length > 1 ? 's' : ''} à corriger avant de valider.`
                  : toPlace.length === 0 && 'La validation débloque la fiche de sécurité.'}
              </span>
              {toPlace.length > 0 && (
                <p role="alert" className="basis-full text-sm text-warn flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {toPlace.length > 1 ? 'Ils plongent' : 'Plonge'} sans palanquée, à placer avant de valider : {toPlace.map((d) => d.name).join(', ')}. Ou, s’{toPlace.length > 1 ? 'ils ne plongent' : 'il ne plonge'} pas,
                    décochez-{toPlace.length > 1 ? 'les' : 'le'} dans « Qui plonge ? » (Modifier les plongeurs).
                  </span>
                </p>
              )}
            </div>
          )}

        </section>
      )}
      {confirmDialog}
    </div>
    </RolesContext.Provider>
  );
}
