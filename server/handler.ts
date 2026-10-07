/**
 * API de l'appli (/api/app), au-dessus de VPDive :
 *
 *   GET  ?action=me                       qui je suis, mon rôle dans l'appli
 *   GET  ?action=users                    super-admin : personnes connues et leurs rôles
 *   POST ?action=role     {userId, admin?, superAdmin?}   super-admin : changer un rôle
 *   GET  ?action=outing&event=<token>     admin ou DP de la sortie : plongées et fiches
 *   POST ?action=outing&event=<token>     {doc, baseRev}  enregistrer (refusé si quelqu'un a enregistré entre-temps)
 *
 * Rôles :
 *   super-admin  e-mail dans SUPER_ADMIN_EMAILS (variable Vercel, ne peut pas être retiré
 *                depuis l'appli) ou nommé par un super-admin
 *   admin        super-admin, ou admin VPDive (member_view) dont le rôle n'a pas été retiré
 *   DP           inscrit « Directeur de plongée » sur la sortie dans VPDive : accès à cette sortie seulement
 *
 * Retirer le rôle admin ici ne change rien dans VPDive : la personne garde ses
 * droits sur vpdive.com, elle perd seulement les écrans admin de l'appli.
 */
import { HttpError, identify, isDpOf, type Caller } from './auth.js';
import { getStore } from './store.js';

export type AppRole = 'superadmin' | 'admin' | 'member';

interface KnownUser {
  id: number;
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  lastSeen: string;
}

interface RolesDoc {
  superAdmins: number[];
  revokedAdmins: number[];
  users: Record<string, KnownUser>;
}

const emptyRoles = (): RolesDoc => ({ superAdmins: [], revokedAdmins: [], users: {} });
const rolesKey = (c: Caller) => `club:${c.clubId}:roles`;
const outingKey = (c: Caller, event: string) => `club:${c.clubId}:outing:${event}`;

const envSuperAdmins = () =>
  (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

function roleOf(user: { id: number; email: string; vpdiveAdmin: boolean }, roles: RolesDoc): AppRole {
  if (envSuperAdmins().includes(user.email) || roles.superAdmins.includes(user.id)) return 'superadmin';
  if (user.vpdiveAdmin && !roles.revokedAdmins.includes(user.id)) return 'admin';
  return 'member';
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
    const roles = (await store.get<RolesDoc>(rolesKey(caller))) ?? emptyRoles();

    // Chaque passage met à jour l'annuaire des personnes connues de l'appli :
    // c'est la liste où le super-admin choisit les rôles.
    const known = roles.users[caller.id];
    if (!known || known.vpdiveAdmin !== caller.vpdiveAdmin || known.email !== caller.email || Date.now() - Date.parse(known.lastSeen) > 3_600_000) {
      roles.users[caller.id] = { id: caller.id, email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, lastSeen: new Date().toISOString() };
      await store.set(rolesKey(caller), roles);
    }
    const role = roleOf(caller, roles);

    if (action === 'me' && request.method === 'GET') {
      return json({ id: caller.id, email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, role });
    }

    if (action === 'users' && request.method === 'GET') {
      if (role !== 'superadmin') throw new HttpError(403, 'Réservé aux super-admins.');
      const env = envSuperAdmins();
      const users = Object.values(roles.users)
        .map((u) => ({ ...u, role: roleOf(u, roles), lockedSuperAdmin: env.includes(u.email), revoked: roles.revokedAdmins.includes(u.id) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      return json({ users });
    }

    if (action === 'role' && request.method === 'POST') {
      if (role !== 'superadmin') throw new HttpError(403, 'Réservé aux super-admins.');
      const body = (await request.json().catch(() => null)) as { userId?: number; admin?: boolean; superAdmin?: boolean } | null;
      const target = body?.userId !== undefined ? roles.users[body.userId] : undefined;
      if (!target) throw new HttpError(404, 'Personne inconnue de l’appli (elle doit s’être connectée au moins une fois).');
      if (target.id === caller.id && body?.superAdmin === false) throw new HttpError(400, 'Vous ne pouvez pas retirer votre propre rôle de super-admin.');
      const toggle = (list: number[], on: boolean) => (on ? [...new Set([...list, target.id])] : list.filter((x) => x !== target.id));
      if (typeof body?.superAdmin === 'boolean') roles.superAdmins = toggle(roles.superAdmins, body.superAdmin);
      if (typeof body?.admin === 'boolean') roles.revokedAdmins = toggle(roles.revokedAdmins, !body.admin);
      await store.set(rolesKey(caller), roles);
      return json({ ok: true, role: roleOf(target, roles) });
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
