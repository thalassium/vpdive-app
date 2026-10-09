import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Tab as TabItem, TabList, TabPanel } from '../Tabs';
import { useConfirm } from '../../hooks/useConfirm';
import { vpdive, type PendingValidation } from '../../services/vpdive';
import { appApi, type RegistrationRequest } from '../../services/appApi';
import { MembershipTab, type MembershipStep } from './MembershipTab';
import { PendingDocumentsTab, RegistrationRequestsTab } from './PendingTabs';
import { RelanceBar, RelanceSummary, RelanceTab } from './RelanceTab';
import { ReminderSheet } from './ReminderSheet';
import { useRelance } from './useRelance';
import { DAYS_AHEAD, type Me } from './relance';
import { message } from '../../lib/errors';
import { Dialog, DialogHeader } from '../Dialog';

/**
 * Le parcours, dans l'ordre : 1 à traiter (sinon VPDive ignore la personne ou
 * le document), 2 diagnostic, 3 corrections rapides (puis relire les fiches),
 * 4 arbitrage. La relance des inscrits aux prochaines sorties est à part.
 */
type Tab = 'todo' | MembershipStep | 'relance';
const SUBTITLE: Record<Exclude<Tab, 'relance'>, string> = {
  todo: 'À valider avant les vérifications : tant qu’elles ne sont pas traitées, VPDive ignore ces personnes et ces documents.',
  diagnostic: 'Chaque membre vu par HelloAsso (paiements), la FFESSM (licence) et VPDive (fiche).',
  quickfix: 'Les corrections sans risque à pousser dans VPDive, puis relire les fiches.',
  arbitrage: 'Le cas par cas, à décider à la main.',
};
const STEPS: [MembershipStep | 'todo', string][] = [
  ['todo', 'À traiter'],
  ['diagnostic', 'Diagnostic'],
  ['quickfix', 'Corrections rapides'],
  ['arbitrage', 'Arbitrage'],
];

interface Props {
  me: Me;
  onClose: () => void;
  onSessionLost: (e: unknown) => boolean;
}

/**
 * Documentation (admin) : chaque membre inscrit à une sortie des 60 prochains
 * jours dont le dossier VPDive n'est pas en règle à la date de la sortie
 * (règles dans lib/docsCheck.ts), avec relance par e-mail ou dans l'appli.
 *
 * VPDive a un pare-feu qui bloque les rafales : tout est lu l'un après l'autre
 * (la file du transport espace les appels), et les fiches membres sont gardées
 * 6 h dans la session.
 */
export function DocsPanel({ me, onClose, onSessionLost }: Props) {
  /**
   * À traiter d'abord : membres à valider, documents en attente (tant qu'ils ne
   * sont pas validés, les vérifications les voient manquants). Puis les
   * vérifications : Adhésions (HelloAsso × FFESSM × VPDive) et Relance.
   */
  /** L'onglet choisi par l'admin ; tant qu'il n'en a choisi aucun, celui de l'ouverture (plus bas). */
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  /** Compteurs des étapes 3 et 4, calculés par l'onglet des adhésions (une fois monté). */
  const [stepCounts, setStepCounts] = useState<{ fixes: number; cases: number } | null>(null);
  /** Écriture dans VPDive en cours (étape 3) : le panneau ne se ferme pas. */
  const membershipBusy = useRef(false);
  /** Rempli par l'onglet des adhésions : oublie la fiche d'un membre validé à l'étape 1. */
  const forgetMember = useRef<((uct: string) => void) | null>(null);
  const [requests, setRequests] = useState<RegistrationRequest[] | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<PendingValidation[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const fetchRequests = useCallback(() => {
    appApi.registrationRequests().then(setRequests, (e) => onSessionLost(e) || setRequestsError(message(e)));
  }, [onSessionLost]);
  const fetchPendingDocs = useCallback(() => {
    vpdive.pendingValidations().then(setPendingDocs, (e) => onSessionLost(e) || setDocsError(message(e)));
  }, [onSessionLost]);
  /** « Réessayer » : la liste repasse en lecture, puis est relue. */
  const loadRequests = () => {
    setRequestsError(null);
    setRequests(null);
    fetchRequests();
  };
  const loadPendingDocs = () => {
    setDocsError(null);
    setPendingDocs(null);
    fetchPendingDocs();
  };
  // À l'ouverture, les listes sont déjà en lecture (null) : il n'y a qu'à les lire.
  useEffect(() => {
    fetchRequests();
    fetchPendingDocs();
  }, [fetchRequests, fetchPendingDocs]);
  // Tant que l'admin n'a pas choisi d'onglet : le premier qui a quelque chose à traiter, sinon les adhésions
  // (« À traiter » pendant la lecture des deux listes).
  const tab: Tab = chosenTab ?? (requests !== null && pendingDocs !== null && !requests.length && !pendingDocs.length ? 'diagnostic' : 'todo');
  const isStep = tab === 'diagnostic' || tab === 'quickfix' || tab === 'arbitrage';
  /**
   * L'onglet des adhésions lit beaucoup (annuaire, HelloAsso, exports, une fiche par membre) :
   * monté à la première visite d'une étape 2 à 4, puis gardé (données lues une fois).
   * Retenu pendant le rendu (état dérivé d'un rendu précédent), pas dans un effet.
   */
  const [stepsOpened, setStepsOpened] = useState(false);
  if (isStep && !stepsOpened) setStepsOpened(true);
  const relance = useRelance(me, onSessionLost);

  // Échap et le bouton Retour (la fenêtre <Dialog>, plus bas) ferment la relance si elle est ouverte (jamais
  // en plein envoi), sinon le panneau (jamais en pleine écriture dans VPDive).
  // useDialog relit ses fonctions à chaque appel : `relance.reminder` y est toujours celui du dernier rendu.
  const { confirm, confirmDialog } = useConfirm();
  /** Identifiants des onglets et de leurs panneaux (les étapes 2 à 4 partagent un panneau). */
  const tabsId = useId();
  const tabId = (key: Tab) => `${tabsId}-tab-${key}`;
  const panelId = (key: Tab) => `${tabsId}-panel-${key === 'todo' || key === 'relance' ? key : 'steps'}`;
  /** Croix, clic à côté, Échap et Retour : pendant une écriture dans VPDive, on demande d'abord (le lot s'arrête après la fiche en cours). */
  const requestClose = async () => {
    if (
      membershipBusy.current &&
      !(await confirm({ title: 'Fermer quand même ?', message: 'Écriture dans VPDive en cours. Le lot s’arrêtera après la fiche en cours.', confirmLabel: 'Fermer', cancelLabel: 'Continuer' }))
    )
      return;
    onClose();
  };

  return (
    <>
      <Dialog
        label="docs"
        onClose={() => (relance.reminder !== null ? relance.setReminder(null) : onClose())}
        canClose={() => {
          if (relance.reminderSending()) return false;
          if (relance.reminder !== null || !membershipBusy.current) return true;
          // Écriture dans VPDive en cours : on ne ferme pas tout de suite, on pose la question (requestClose ferme si accepté).
          void requestClose();
          return false;
        }}
        onBackdrop={() => void requestClose()}
        titleId="docs-title"
        className={`${tab === 'relance' ? 'sm:max-w-5xl' : 'sm:max-w-7xl'} h-dvh sm:h-[92vh]`}
      >
        <DialogHeader
          titleId="docs-title"
          kicker="Admin"
          icon={<FileText className="w-6 h-6 text-brand" />}
          title="Gestion des adhésions"
          onClose={() => void requestClose()}
          subtitle={
            <p className="mt-1 text-sm text-muted">
              {tab === 'relance' ? `Inscrits des ${DAYS_AHEAD} prochains jours dont le dossier VPDive n’est pas en règle à la date de la sortie.` : SUBTITLE[tab]}
            </p>
          }
        >
          {/* Onglets : les quatre étapes dans l'ordre (la première, prioritaire, en teinte d'alerte), puis la relance. */}
          {/* Activation au clavier par Entrée : ouvrir une étape lit beaucoup sur VPDive, les flèches ne font que s'y déplacer. */}
          <TabList
            label="Gestion des adhésions"
            activation="manual"
            className="mt-3 flex items-end gap-1 border-b border-line -mb-4 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {STEPS.map(([key, text], i) => {
              const count = key === 'todo' ? (requests && pendingDocs ? requests.length + pendingDocs.length : undefined) : key === 'quickfix' ? stepCounts?.fixes : key === 'arbitrage' ? stepCounts?.cases : undefined;
              const first = key === 'todo';
              const on = tab === key;
              return (
                <TabItem
                  key={key}
                  id={tabId(key)}
                  controls={panelId(key)}
                  selected={on}
                  onSelect={() => setChosenTab(key)}
                  className={`h-10 px-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-2 rounded-t-md transition-colors ${
                    first ? (on ? 'border-warn text-warn bg-warn-soft' : 'border-transparent text-warn bg-warn-soft/60 hover:bg-warn-soft') : on ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-brand'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`w-5 h-5 rounded-full text-xs font-bold inline-flex items-center justify-center ${first ? 'bg-surface text-warn border border-warn/40' : on ? 'bg-fill text-on-fill' : 'bg-raised text-muted'}`}
                  >
                    {i + 1}
                  </span>
                  {text}
                  {count !== undefined && count > 0 && (
                    <span className={`min-w-5 h-5 px-1.5 rounded-full text-xs tabular-nums inline-flex items-center justify-center border ${first ? 'border-warn/40 bg-surface' : 'border-line bg-surface text-ink'}`}>{count}</span>
                  )}
                </TabItem>
              );
            })}
            <span aria-hidden className="self-center w-px h-6 bg-line mx-2 shrink-0" />
            <TabItem
              id={tabId('relance')}
              controls={panelId('relance')}
              selected={tab === 'relance'}
              onSelect={() => {
                setChosenTab('relance');
                relance.open();
              }}
              className={`h-10 px-3 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap shrink-0 transition-colors ${tab === 'relance' ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-brand'}`}
            >
              Relance
            </TabItem>
          </TabList>
          {tab === 'relance' && relance.outings && <RelanceSummary relance={relance} />}
        </DialogHeader>

        {tab === 'todo' && (
          <TabPanel id={panelId('todo')} labelledBy={tabId('todo')} className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-5 py-4 space-y-8">
            <section>
              <h3 className="text-lg font-semibold text-brand mb-2">
                Membres à valider {requests && requests.length > 0 && <span className="text-muted font-normal tabular-nums">· {requests.length}</span>}
              </h3>
              <RegistrationRequestsTab requests={requests} error={requestsError} onReload={loadRequests} onChange={setRequests} onSessionLost={onSessionLost} />
            </section>
            <section>
              <h3 className="text-lg font-semibold text-brand mb-2">
                Documents en attente {pendingDocs && pendingDocs.length > 0 && <span className="text-muted font-normal tabular-nums">· {pendingDocs.length}</span>}
              </h3>
              <PendingDocumentsTab
                items={pendingDocs}
                error={docsError}
                onReload={loadPendingDocs}
                onChange={setPendingDocs}
                onSessionLost={onSessionLost}
                onForget={(uct) => forgetMember.current?.(uct)}
              />
            </section>
          </TabPanel>
        )}
        {/* Étapes 2 à 4 : un seul onglet des adhésions, monté à la première visite puis gardé (données lues une fois, compteurs dans les onglets). */}
        {stepsOpened && (
          <TabPanel id={panelId('diagnostic')} labelledBy={tabId(isStep ? tab : 'diagnostic')} className={isStep ? 'flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-5 py-4' : 'hidden'}>
            <MembershipTab
              step={isStep ? (tab as MembershipStep) : 'diagnostic'}
              onCounts={setStepCounts}
              onSessionLost={onSessionLost}
              onWriting={(busy) => {
                membershipBusy.current = busy;
              }}
              forgetRef={forgetMember}
            />
          </TabPanel>
        )}
        {tab === 'relance' && (
          <TabPanel id={panelId('relance')} labelledBy={tabId('relance')} className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-3 sm:px-4 py-3 space-y-3">
            <RelanceTab relance={relance} />
          </TabPanel>
        )}
        {tab === 'relance' && relance.filter !== 'ignored' && relance.active.length > 0 && <RelanceBar relance={relance} />}

        {relance.reminder && (
          <ReminderSheet
            key={relance.reminder.rows.map((r) => r.key).join()}
            {...relance.reminder}
            me={me}
            onClose={() => relance.setReminder(null)}
            onBusy={relance.setReminderSending}
            onSessionLost={onSessionLost}
          />
        )}
      </Dialog>
      {confirmDialog}
    </>
  );
}
