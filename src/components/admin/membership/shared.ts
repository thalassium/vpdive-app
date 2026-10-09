import type { ReactNode } from 'react';
import { federationIssue, needsVpdiveFix, type Case, type Fix, type Match, type Person, type PersonView, type VpMember, type VpRecord } from '../../../lib/membership';
import type { MembershipData } from './useMembershipData';

export type Filter = 'gaps' | 'ok' | 'all';
export interface Row {
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

export { VPDIVE_MEMBER } from '../../../lib/memberSheet';

/** Une personne avec au moins un écart (fiche VPDive, fédération) ou un rapprochement incertain. */
export const hasGap = (r: Row) => needsVpdiveFix(r.view) || federationIssue(r.view) || (r.match.status !== 'sure' && !r.match.parent);

/** Ce que chaque étape reçoit : les données, et de la coquille les filtres et les morceaux d'écran communs. */
export type StepProps = MembershipData & {
  filter: Filter;
  setFilter: (f: Filter) => void;
  matches: (r: Row) => boolean;
  errors: ReactNode;
  progressBar: ReactNode;
  refreshButton: ReactNode;
  search: ReactNode;
  setConfigOpen: (open: boolean) => void;
  setLogOpen: (open: boolean) => void;
  onSessionLost: (e: unknown) => boolean;
};
