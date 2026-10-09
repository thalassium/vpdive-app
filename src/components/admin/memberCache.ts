/*
 * Fiche VPDive d'un membre gardée dans la session par la gestion des adhésions
 * (MembershipTab), oubliée par les onglets « à traiter » (PendingTabs) après une
 * validation. À part pour que MembershipTab.tsx n'exporte que des composants
 * (rechargement à chaud de Vite).
 */

// v4 : l’assurance est lue dans le choix de la liste (insurance_choice), comme sur le site VPDive.
export const cacheKey = (uct: string) => `member-record:v4:${uct}`;
