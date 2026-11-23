/**
 * Adresses du Secret Santa (public, sans connexion ; server/santa.ts). Les secrets sont dans le
 * fragment, que le navigateur n'envoie jamais au serveur avec la page :
 *   /#santa=<jeton>        le lien d'un participant
 *   /#santa-admin          préparer un tirage
 *   /#santa-admin=<clé>    suivi d'un tirage
 */
export type SantaRoute = { page: 'reveal'; token: string } | { page: 'admin'; key: string | null };

export function santaRoute(hash: string): SantaRoute | null {
  const m = /^#santa(-admin)?(?:=([A-Za-z0-9_-]+))?$/.exec(hash);
  if (!m) return null;
  if (m[1]) return { page: 'admin', key: m[2] ?? null };
  return m[2] ? { page: 'reveal', token: m[2] } : null;
}

export const santaLink = (token: string, origin = location.origin) => `${origin}/#santa=${token}`;
export const santaAdminHash = (key: string) => `#santa-admin=${key}`;

/** Message WhatsApp prérempli (wa.me sans numéro : WhatsApp demande à qui l'envoyer). */
export function whatsappUrl(name: string, title: string, link: string): string {
  const text = `🎅 Secret Santa${title ? ` · ${title}` : ''}\n${name}, voici ton lien pour découvrir qui tu as tiré. Il ne s’ouvre qu’une seule fois :\n${link}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
