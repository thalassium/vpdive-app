/**
 * Rôles de sortie tels que VPDive les écrit (« Directeur de plongée »,
 * « Sécurité surface », « Pilote »…), lus par l'appli et le moteur des
 * palanquées. Ici et non dans le service VPDive : ce sont des règles du club.
 */

/** VPDive outing roles that keep someone out of the water by default. */
export const SURFACE_ROLES = /s[ée]curit[ée] surface|pilote/i;
/** « Directeur de plongée », ou « Directrice de plongée » comme VPDive l'écrit parfois. */
export const DP_ROLE = /direct(?:eur|rice) de plong/i;
