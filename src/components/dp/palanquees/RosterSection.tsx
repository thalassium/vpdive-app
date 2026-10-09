import { useContext, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, RotateCcw, Trash2, UserMinus } from 'lucide-react';
import type { RosterEntry } from '../../../services/vpdive';
import { aptitudesFromLabels, isInstructor, prerogativeCode, type Diver } from '../../../lib/palanquees';
import { PREROGATIVE_OPTIONS, TRAINING_MENU, NO_TRAINING, setDiverChoice, trainingMenuFor } from '../../../lib/palanqueeEdit';
import { stillUnregistered, toggleCompanion, toggleDiving, type AddedMember, type Guest, type GuideNote, type OutingDoc, type Unregistered } from '../../../lib/outing';
import { message } from '../../../lib/errors';
import { useConfirm } from '../../../hooks/useConfirm';
import { Menu } from '../../Menu';
import { Spinner } from '../../Spinner';
import { GuestForm } from './GuestForm';
import { RoleBadges } from './RoleBadges';
import { ActionButton } from './ActionButton';
import { SectionTitle } from '../../SectionTitle';
import { APT_COL, FN_COL, RolesContext, byName, byRank, hasRows } from './format';
import { OutingMemberAvatar, OutingMemberButton } from '../../member/MemberLink';
import { GuideNoteRow } from './GuideNoteRow';

interface Props {
  roster: RosterEntry[];
  doc: OutingDoc;
  /** Tous les inscrits, en plongeurs (rosterToDivers). */
  divers: Diver[];
  /** Ceux qui plongent. */
  diving: Diver[];
  /** Décochés, et liste d'attente VPDive que le DP n'a pas prise. */
  excluded: Set<string>;
  readOnly: boolean;
  onSettings: (settings: OutingDoc['settings']) => void;
  onGuests: (guests: Guest[]) => void;
  onMembers: (members: AddedMember[]) => void;
  onUnregister?: (person: { id: string; name: string; instructor: boolean }) => Promise<void>;
  onPromote?: (person: { id: string; name: string }) => Promise<void>;
  /** « Valider les plongeurs » : la liste est arrêtée, on passe aux palanquées. */
  onConfirm: () => void;
  /** Commentaires sur les encadrants de la plongée (par encadrant), et de quoi les écrire (absent : lecture seule). */
  notes?: Record<string, GuideNote>;
  onNote?: (guideId: string, text: string) => void;
}

/**
 * 1. Qui plonge : encadrants du plus haut au plus bas, puis plongeurs, puis la
 * liste d'attente ; validé par le DP avant les palanquées.
 */
export function RosterSection({ roster, doc, divers, diving, excluded, readOnly, onSettings, onGuests, onMembers, onUnregister, onPromote, onConfirm, notes, onNote }: Props) {
  const [promoting, setPromoting] = useState<Record<string, string>>({});
  const { confirm, confirmDialog } = useConfirm();
  const settings = doc.settings;
  const roleMap = useContext(RolesContext);
  const unknownLevels = diving.filter((d) => !d.pe && !d.beginner && !isInstructor(d) && !d.training);

  /**
   * Une ligne par inscrit : plonge ou pas, nom, rôles, et à droite sa
   * prérogative. Celle de VPDive fait foi ; elle ne se choisit que si elle
   * manque (brevet étranger). Les plongeurs ont en plus le bouton Formation.
   */
  const rosterRow = (d: Diver) => {
    const r = roster.find((x) => x.id === d.id)!;
    const out = excluded.has(d.id);
    const fromVpdive = prerogativeCode(aptitudesFromLabels(r.levels));
    const forcedRaw = settings.levels?.[d.id];
    const forced = forcedRaw ? prerogativeCode(aptitudesFromLabels([forcedRaw])) || forcedRaw : undefined;
    const prerogative = forced ?? fromVpdive;
    const fnChoice = settings.training?.[d.id];
    const fn = fnChoice === NO_TRAINING ? undefined : fnChoice;
    const prepa = aptitudesFromLabels(r.training).training;
    const current = fn ?? (prepa && fnChoice !== NO_TRAINING ? `FN${prepa}` : '');
    // Formations au-dessus du niveau retenu (VPDive ou choisi à la main) ; la formation en cours reste proposée.
    const offered = trainingMenuFor(aptitudesFromLabels(forcedRaw ? [forcedRaw] : r.levels));
    const trainingGroups = TRAINING_MENU.map((g) => ({
      title: g.title,
      options: g.options.filter((o) => o.value === current || offered.some((og) => og.options.some((x) => x.value === o.value))),
    })).filter((g) => g.options.length > 0);
    const instructor = isInstructor(d);
    const setLevel = (v: string) => onSettings({ ...settings, ...setDiverChoice(settings, 'levels', d.id, v) });
    const setTraining = (v: string) => onSettings({ ...settings, ...setDiverChoice(settings, 'training', d.id, v) });
    const companion = !!settings.companions?.includes(d.id);
    // Sous le nom : accompagnant, mineur, liste d'attente, hors VPDive et son commentaire, et le niveau tel que VPDive l'écrit (P2, PADI - AOW…).
    const below = [companion && 'accompagnant (ne plonge pas)', d.minor && 'mineur', r.added && 'non inscrit, ajouté par le DP', r.outside && 'hors VPDive', r.display.join(', '), r.outside && r.comment]
      .filter(Boolean)
      .join(' · ');
    const hasRoles = (roleMap.get(d.id)?.length ?? 0) > 0;
    return (
      <li key={d.id} className="flex flex-wrap items-center gap-x-1.5 px-3 sm:px-3.5 py-2">
        {/* La case « plonge » est hors de l'étiquette : la photo, entre les deux, porte l'icône « fiche » (un bouton ne va pas dans un label). */}
        <div className={`flex items-center gap-x-1.5 w-full ${out ? 'opacity-50' : ''}`}>
          <input
            id={`plonge-${d.id}`}
            type="checkbox"
            checked={!out}
            disabled={r.waitingList && (!onPromote || promoting[d.id] === 'busy')}
            title={r.waitingList ? (onPromote ? 'Cocher l’inscrit sur VPDive' : 'Seul un admin peut inscrire depuis la liste d’attente') : undefined}
            onChange={() => (r.waitingList ? void promote(d) : onSettings(toggleDiving(settings, d.id, out)))}
            className="w-5 h-5 mr-1 accent-[var(--fill)] shrink-0 disabled:cursor-not-allowed"
          />
          <OutingMemberAvatar id={d.id} name={d.name} picture={d.picture} size="md" mobile="none" />
          <div className="min-w-0 flex-1 ml-1">
            <label htmlFor={`plonge-${d.id}`} className="block font-medium text-ink leading-snug break-words line-clamp-2 sm:line-clamp-none sm:truncate cursor-pointer">
              {d.name}
            </label>
            {/* Sous le nom : rôles, niveau ; sur téléphone, l'icône « fiche » au bout (la photo y est cachée). */}
            <span className="flex items-start gap-1.5 mt-0.5 empty:hidden">
              {hasRoles && <RoleBadges id={d.id} />}
              {below && (
                <label htmlFor={`plonge-${d.id}`} className="min-w-0 text-sm text-muted leading-snug line-clamp-2 sm:truncate cursor-pointer">
                  {below}
                </label>
              )}
              <OutingMemberButton id={d.id} size="sm" className="sm:hidden -my-1 shrink-0" />
            </span>
          </div>
        {/* Apt. : la prérogative VPDive, ou celle retenue par le DP (brevet étranger, N1 porté à PE40…). */}
        <Menu
          ariaLabel={`Aptitude de ${d.name}`}
          triggerClassName={`btn sm:h-9 px-1.5 gap-0.5 text-sm ${APT_COL} ${
            !prerogative ? (out ? 'btn-quiet text-muted' : 'border border-warn bg-warn-soft text-warn') : forced ? 'border border-brand bg-tint text-brand' : 'btn-quiet'
          }`}
          trigger={
            <>
              <span className={`truncate ${prerogative ? 'font-bold tabular-nums' : ''}`}>{prerogative ? prerogative.replace(' · ', '/') : 'Apt. ?'}</span>
              <ChevronDown className="hidden sm:block w-3.5 h-3.5 shrink-0 opacity-60" />
            </>
          }
          sections={[
            // Revenir à VPDive : retire l'aptitude retenue à la main (sans aptitude VPDive, le plongeur redevient « Apt. ? »).
            {
              selected: forcedRaw ? undefined : '',
              onSelect: setLevel,
              options: [{ value: '', label: fromVpdive ? `${fromVpdive.replace(' · ', '/')} (VPDive)` : 'Aucune (retirer)', hint: forcedRaw ? 'annule le choix' : undefined }],
            },
            { title: 'Plongeur', selected: forcedRaw, onSelect: setLevel, options: PREROGATIVE_OPTIONS.divers.map((v) => ({ value: v, label: v })) },
            { title: 'Encadrant', selected: forcedRaw, onSelect: setLevel, options: PREROGATIVE_OPTIONS.instructors.map((v) => ({ value: v, label: v })) },
          ]}
        />
        {/* F# : formation du jour, vers un niveau (FN2) ou une aptitude (FPA20), au-dessus du niveau du plongeur. Pas pour un encadrant. */}
        {!instructor && (
        <Menu
          ariaLabel={`Formation de ${d.name}`}
          triggerClassName={`btn sm:h-9 px-1.5 gap-0.5 text-sm ${FN_COL} ${current ? 'border border-brand bg-tint text-brand' : 'btn-quiet text-muted'}`}
          trigger={
            <>
              <span className={`truncate ${current ? 'font-bold tabular-nums' : ''}`}>{current || '—'}</span>
              <ChevronDown className="hidden sm:block w-3.5 h-3.5 shrink-0 opacity-60" />
            </>
          }
          sections={[
            {
              selected: current ? undefined : fnChoice === NO_TRAINING ? NO_TRAINING : '',
              onSelect: setTraining,
              options: prepa ? [{ value: NO_TRAINING, label: 'Pas en formation' }, { value: '', label: `Prépa N${prepa}`, hint: 'VPDive' }] : [{ value: '', label: 'Pas en formation' }],
            },
            ...trainingGroups.map((group) => ({
              title: group.title,
              selected: current,
              onSelect: setTraining,
              options: group.options.filter((o) => o.value !== `FN${prepa}`).map((o) => ({ value: o.value, label: o.label })),
            })),
          ]}
        />
        )}
        </div>
        {/* Décoché : on peut le désinscrire de VPDive. Hors VPDive : on peut le retirer. */}
        {promoting[d.id] && promoting[d.id] !== 'busy' && (
          <p role="alert" className="basis-full pl-[1.875rem] pt-1 text-sm text-danger">
            {promoting[d.id]}
          </p>
        )}
        {/* Décoché : accompagnant ou non (à bord sans plonger), et pour un inscrit, le désinscrire de VPDive (admin). */}
        {out && !r.waitingList && (
          <div className="basis-full pl-[1.875rem] pt-1">
            <button
              type="button"
              aria-pressed={companion}
              onClick={() => onSettings(toggleCompanion(settings, d.id, !companion))}
              title="À bord sans plonger : n’a pas à être placé dans une palanquée"
              className={`btn sm:h-8 px-2.5 text-sm ${companion ? 'border border-brand bg-tint text-brand' : 'btn-quiet'}`}
            >
              {companion && <Check className="w-4 h-4" />} Accompagnant
            </button>
          </div>
        )}
        {r.outside || r.added ? (
          <div className="basis-full pl-[1.875rem] pt-1">
            <button
              type="button"
              onClick={async () => {
                if (!(await confirm({ title: `Retirer ${d.name} de la sortie ?`, confirmLabel: 'Retirer', danger: true }))) return;
                if (r.outside) onGuests((doc.guests ?? []).filter((g) => g.id !== d.id));
                else onMembers((doc.members ?? []).filter((m) => m.id !== d.id));
              }}
              className="btn btn-quiet sm:h-8 px-2.5 text-sm hover:text-danger"
            >
              <Trash2 className="w-4 h-4" /> Retirer
            </button>
          </div>
        ) : (
          out && onUnregister && <UnregisterAction name={d.name} onConfirm={() => onUnregister({ id: d.id, name: d.name, instructor: isInstructor(d) })} />
        )}
        {/* Encadrant : un commentaire libre (stagiaire, consigne…), qui et quand ; repris sur la fiche de sécurité. */}
        {instructor && !out && (notes?.[d.id] || onNote) && (
          <div className="w-full pl-8 sm:pl-[4.5rem] pt-1">
            <GuideNoteRow note={notes?.[d.id]} onNote={onNote ? (text) => onNote(d.id, text) : undefined} />
          </div>
        )}
      </li>
    );
  };

  /** Liste d'attente → inscrit sur VPDive, après confirmation. */
  const promote = async (d: Diver) => {
    if (
      !onPromote ||
      !(await confirm({
        title: `Inscrire ${d.name} sur VPDive ?`,
        message: `${d.name} passe de la liste d’attente aux inscrits, même si la sortie est complète.`,
        confirmLabel: 'Inscrire',
      }))
    )
      return;
    setPromoting((p) => ({ ...p, [d.id]: 'busy' }));
    try {
      await onPromote({ id: d.id, name: d.name });
      setPromoting(({ [d.id]: _, ...rest }) => rest);
    } catch (e) {
      setPromoting((p) => ({ ...p, [d.id]: message(e) }));
    }
  };
  const waiting = new Set(roster.filter((r) => r.waitingList).map((r) => r.id));
  const listed = divers.filter((d) => !waiting.has(d.id));

  // Désinscrits depuis cet écran : barrés, à leur place (encadrants ou plongeurs).
  const gone = stillUnregistered(doc, roster);
  const goneRows = (instructor: boolean) => gone.filter((u) => u.instructor === instructor).map((u) => <UnregisteredRow key={u.id} u={u} />);
  const hasChoices = Object.keys(settings.levels ?? {}).length + Object.keys(settings.training ?? {}).length > 0;
  const reset = async () => {
    if (!(await confirm({ title: 'Réinitialiser les aptitudes et formations choisies ?', message: 'Chacun revient à ce que dit VPDive.', confirmLabel: 'Réinitialiser' }))) return;
    onSettings({ ...settings, levels: {}, training: {} });
  };

  return (
    <>
      <fieldset disabled={readOnly} className="min-w-0">
      <section>
        <SectionTitle
          bleed
          className="mb-4"
          n={1}
          hint={`${diving.length} à l’eau sur ${roster.length}`}
          actions={
            hasChoices && (
              <ActionButton onClick={reset} icon={<RotateCcw className="w-4 h-4" />} title="Aptitudes et formations reviennent à celles de VPDive">
                Réinitialiser
              </ActionButton>
            )
          }
        >
          Qui plonge ?
        </SectionTitle>
        {roster.length === 0 && gone.length === 0 ? (
          <p className="text-muted">Personne n’est encore inscrit à cette sortie.</p>
        ) : (
          <div className="space-y-4">
            <RosterGroup title="Encadrants" count={listed.filter(isInstructor).length} training={false}>
              {listed.filter(isInstructor).sort(byRank).map(rosterRow)}
              {goneRows(true)}
            </RosterGroup>
            <RosterGroup title="Plongeurs" count={listed.filter((d) => !isInstructor(d)).length}>
              {listed.filter((d) => !isInstructor(d)).sort(byName).map(rosterRow)}
              {goneRows(false)}
            </RosterGroup>
            {waiting.size > 0 && (
              <RosterGroup title="Liste d’attente" count={waiting.size}>
                {divers.filter((d) => waiting.has(d.id)).sort(byName).map(rosterRow)}
              </RosterGroup>
            )}
          </div>
        )}
        <GuestForm onAdd={(g) => onGuests([...(doc.guests ?? []), g])} />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={diving.length === 0 || unknownLevels.length > 0}
            className="btn btn-primary h-11"
          >
            <Check className="w-4 h-4" /> Valider les plongeurs
          </button>
          {unknownLevels.length > 0 && (
            <span className="text-sm text-warn inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Prérogative à choisir : {unknownLevels.map((d) => d.name).join(', ')}
            </span>
          )}
        </div>
      </section>
      </fieldset>
      {confirmDialog}
    </>
  );
}

function RosterGroup({ title, count, training = true, children }: { title: string; count: number; training?: boolean; children: ReactNode }) {
  return (
    <div>
      {/* Titres de colonne alignés sur les menus (même largeur, même retrait que les lignes) ; la barre reste visible pendant le défilement. */}
      <div className="sticky top-0 z-10 bg-canvas flex items-end gap-1.5 pt-2 pb-1.5 mb-1 pr-[calc(0.75rem+1px)] sm:pr-[calc(0.875rem+1px)] print:static">
        <h4 className="label flex-1">
          {title} <span className="font-normal">· {count}</span>
        </h4>
        {count > 0 && (
          <>
            <span className={`label text-center ${APT_COL}`}>Apt.</span>
            {training && <span className={`label text-center ${FN_COL}`}>F#</span>}
          </>
        )}
      </div>
      {count || hasRows(children) ? <ul className="card border-l-4 border-l-brand divide-y divide-line">{children}</ul> : <p className="text-sm text-muted">Aucun.</p>}
    </div>
  );
}

/** Désinscrit de VPDive depuis cet écran : barré, avec qui l'a fait et quand. */
function UnregisteredRow({ u }: { u: Unregistered }) {
  return (
    <li className="px-3 sm:px-3.5 py-2.5 text-muted">
      <s className="font-medium">{u.name}</s>
      <span className="block text-sm">
        désinscrit de VPDive par {u.by} le {new Date(u.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
      </span>
    </li>
  );
}

/** Désinscrire de VPDive, après confirmation ; un refus de VPDive s'affiche sur la ligne. */
function UnregisterAction({ name, onConfirm }: { name: string; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const run = async () => {
    if (
      !(await confirm({
        title: `Désinscrire ${name} de la sortie sur VPDive ?`,
        message: `${name} sera retiré de la liste des inscrits.`,
        confirmLabel: 'Désinscrire',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <div className="basis-full pl-[1.875rem] pt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className="btn btn-quiet sm:h-8 px-2.5 text-sm hover:text-danger hover:border-danger/40">
        {busy ? <Spinner /> : <UserMinus className="w-4 h-4" />} Désinscrire
      </button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
      {confirmDialog}
    </div>
  );
}
