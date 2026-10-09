/*
 * Fiches VPDive gardées dans la session par la gestion des adhésions
 * (MembershipTab, DocsPanel), oubliées par les onglets « à traiter » (PendingTabs)
 * après une validation. À part pour que les .tsx n'exportent que des composants
 * (rechargement à chaud de Vite).
 */
import { isRecord, sessionCache } from '../../lib/cache';
import type { VpRecord } from '../../lib/membership';
import type { DocsStatus } from '../../lib/docsCheck';

const TTL = 6 * 3600_000;

// v4 : l’assurance est lue dans le choix de la liste (insurance_choice), comme sur le site VPDive.
export const recordCache = sessionCache('member-record:v4:', TTL, (v): v is VpRecord => isRecord(v) && Array.isArray(v.seasons), { field: 'record' });

/** Saisons et licences d'un membre, pour la relance des inscrits (DocsPanel). */
export const docsStatusCache = sessionCache('docs-status:', TTL, (v): v is DocsStatus => isRecord(v) && Array.isArray(v.seasons) && Array.isArray(v.licences), {
  field: 'status',
});
