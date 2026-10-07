/**
 * API de l'appli (/api/app), au-dessus de VPDive :
 *
 *   GET  ?action=me                       qui je suis, mon rôle dans l'appli
 *   GET  ?action=roles                    admin : les membres qui ont un rôle dans l'appli
 *   POST ?action=role     {uct, admin?, superAdmin?}   super-admin : donner ou retirer un rôle
 *   GET  ?action=outing&event=<token>     admin ou DP de la sortie : plongées et fiches
 *   POST ?action=outing&event=<token>     {doc, baseRev}  enregistrer (refusé si quelqu'un a enregistré entre-temps)
 *
 * Les rôles sont rattachés au jeton d'adhésion du membre (uct), le même que
 * l'`id` de la liste des membres : on peut nommer admin quelqu'un qui ne s'est
 * encore jamais connecté à l'appli.
 *   super-admin  nommé par un super-admin, ou e-mail dans SUPER_ADMIN_EMAILS
 *                (variable Vercel : ne peut pas être retiré depuis l'appli)
 *   admin        nommé par un super-admin, ou admin VPDive (member_view) à qui
 *                ce rôle n'a pas été retiré ; un super-admin est toujours admin
 *   DP           inscrit « Directeur de plongée » sur la sortie dans VPDive : accès à cette sortie seulement
 *
 * Retirer le rôle admin ici ne change rien dans VPDive : la personne garde ses
 * droits sur vpdive.com, elle perd seulement les écrans admin de l'appli.
 */
import { HttpError, identify, isDpOf, type Caller } from './auth.js';
import { getStore } from './store.js';

export type AppRole = 'superadmin' | 'admin' | 'member';

/** Ce que l'appli sait d'un membre qui s'est connecté (pour les admins VPDive et les super-admins par e-mail). */
interface KnownMember {
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  lastSeen: string;
}

interface RolesDoc {
  version: 2;
  superAdmins: string[];
  /** Nommés admin dans l'appli. */
  admins: string[];
  /** Admins VPDive à qui le rôle admin de l'appli a été retiré. */
  revoked: string[];
  known: Record<string, KnownMember>;
}

const emptyRoles = (): RolesDoc => ({ version: 2, superAdmins: [], admins: [], revoked: [], known: {} });
const rolesKey = (c: Caller) => `club:${c.clubId}:roles`;
const outingKey = (c: Caller, event: string) => `club:${c.clubId}:outing:${event}`;

const envSuperAdmins = () =>
  (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const lockedSuper = (uct: string, roles: RolesDoc) => {
  const email = roles.known[uct]?.email;
  return !!email && envSuperAdmins().includes(email);
};

function roleOf(uct: string, roles: RolesDoc): AppRole {
  if (roles.superAdmins.includes(uct) || lockedSuper(uct, roles)) return 'superadmin';
  if (roles.admins.includes(uct) || (roles.known[uct]?.vpdiveAdmin && !roles.revoked.includes(uct))) return 'admin';
  return 'member';
}

/** Les membres qui ont un rôle (et les admins VPDive à qui on l'a retiré), pour la liste des membres. */
function roleEntries(roles: RolesDoc) {
  const ucts = new Set([...roles.superAdmins, ...roles.admins, ...roles.revoked, ...Object.keys(roles.known).filter((u) => roles.known[u]!.vpdiveAdmin || lockedSuper(u, roles))]);
  return [...ucts].map((uct) => ({
    uct,
    role: roleOf(uct, roles),
    vpdiveAdmin: !!roles.known[uct]?.vpdiveAdmin,
    lockedSuperAdmin: lockedSuper(uct, roles),
    revoked: roles.revoked.includes(uct),
  }));
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const MAX_DOC_BYTES = 400_000;

export async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const caller = await identify(request);
    const store = getStore();
    const saved = await store.get<RolesDoc | { version?: number }>(rolesKey(caller));
    // Première version (rôles par identifiant de compte, avant octobre 2026) : on repart de zéro.
    const roles: RolesDoc = saved && saved.version === 2 ? (saved as RolesDoc) : emptyRoles();

    // Chaque passage met à jour ce que l'appli sait de la personne (admin VPDive, e-mail).
    const known = roles.known[caller.uct];
    if (!known || known.vpdiveAdmin !== caller.vpdiveAdmin || known.email !== caller.email || Date.now() - Date.parse(known.lastSeen) > 3_600_000) {
      roles.known[caller.uct] = { email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, lastSeen: new Date().toISOString() };
      await store.set(rolesKey(caller), roles);
    }
    const role = roleOf(caller.uct, roles);

    if (action === 'me' && request.method === 'GET') {
      return json({ id: caller.id, uct: caller.uct, email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, role });
    }

    if (action === 'roles' && request.method === 'GET') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      return json({ roles: roleEntries(roles) });
    }

    if (action === 'role' && request.method === 'POST') {
      if (role !== 'superadmin') throw new HttpError(403, 'Réservé aux super-admins.');
      const body = (await request.json().catch(() => null)) as { uct?: string; admin?: boolean; superAdmin?: boolean } | null;
      const uct = body?.uct ?? '';
      if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
      const removing = body?.superAdmin === false || body?.admin === false;
      if (removing && uct === caller.uct) throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres rôles.');
      if (removing && lockedSuper(uct, roles)) throw new HttpError(400, 'Super-admin défini dans les réglages Vercel (SUPER_ADMIN_EMAILS) : à retirer là-bas.');
      const add = (list: string[]) => [...new Set([...list, uct])];
      const drop = (list: string[]) => list.filter((x) => x !== uct);
      if (body?.superAdmin === true) {
        roles.superAdmins = add(roles.superAdmins);
        roles.revoked = drop(roles.revoked);
      }
      if (body?.superAdmin === false) roles.superAdmins = drop(roles.superAdmins);
      if (body?.admin === true) {
        roles.admins = add(roles.admins);
        roles.revoked = drop(roles.revoked);
      }
      if (body?.admin === false) {
        // Plus admin du tout : ni nommé, ni super-admin, ni admin VPDive par défaut.
        roles.admins = drop(roles.admins);
        roles.superAdmins = drop(roles.superAdmins);
        roles.revoked = add(roles.revoked);
      }
      await store.set(rolesKey(caller), roles);
      return json({ roles: roleEntries(roles) });
    }

    if (action === 'outing') {
      const event = url.searchParams.get('event') ?? '';
      if (!/^[\w-]{10,80}$/.test(event)) throw new HttpError(400, 'Sortie inconnue.');
      if (role === 'member' && !(await isDpOf(caller, event))) {
        throw new HttpError(403, 'Réservé aux admins et au directeur de plongée de la sortie.');
      }
      const key = outingKey(caller, event);
      const current = await store.get<{ rev: number }>(key);

      if (request.method === 'GET') return json({ doc: current });

      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_DOC_BYTES) throw new HttpError(413, 'Fiche trop volumineuse.');
        const body = JSON.parse(text) as { doc?: Record<string, unknown>; baseRev?: number };
        if (!body.doc || typeof body.doc !== 'object') throw new HttpError(400, 'Contenu manquant.');
        const rev = current?.rev ?? 0;
        if ((body.baseRev ?? 0) !== rev) {
          return json({ error: 'Quelqu’un a modifié cette sortie entre-temps. Rechargez pour voir sa version.', doc: current }, 409);
        }
        const doc = { ...body.doc, rev: rev + 1, updatedAt: new Date().toISOString(), updatedBy: caller.name || caller.email };
        await store.set(key, doc);
        return json({ doc });
      }
    }

    throw new HttpError(404, 'Action inconnue.');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Erreur serveur.' }, 500);
  }
}
