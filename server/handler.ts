/**
 * API de l'appli (/api/app), au-dessus de VPDive :
 *
 *   GET  ?action=me                       qui je suis, mon rôle dans l'appli
 *   POST ?action=logout                   déconnexion : le serveur oublie la session mise en cache
 *   GET  ?action=roles                    admin : les membres qui ont un rôle dans l'appli
 *   POST ?action=role     {uct, admin?, superAdmin?}   super-admin : donner ou retirer un rôle
 *   GET  ?action=outing&event=<token>     admin ou DP de la sortie : plongées et fiches
 *   POST ?action=outing&event=<token>     {doc, baseRev}  enregistrer (refusé si quelqu'un a enregistré entre-temps)
 *   GET  ?action=docs_ignored             admin : membres ignorés du suivi des documents
 *   POST ?action=docs_ignored {uct, name, ignore}  admin : ignorer / ne plus ignorer
 *   GET  ?action=helloasso&season=2027    admin : adhésions HelloAsso de la saison (server/helloasso.ts)
 *   GET  ?action=ffessm                   admin : dernier export FFESSM déposé
 *   POST ?action=ffessm  {rows, period}   admin : déposer l'export « Liste des licences » de Mon Club (lu dans l'appli)
 *   GET  ?action=member_links             admin : rapprochements choisis à la main (personne → membre VPDive)
 *   POST ?action=member_links {key, uct}  admin : choisir (uct, ou 'none' : pas dans VPDive) ; uct null pour oublier
 *
 * La messagerie n'est plus ici : l'appli lit et écrit directement celle de VPDive.
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
 *
 * Clés du stockage, par club :
 *   club:<id>:roles                  rôles donnés / retirés (écrit seulement par ?action=role)
 *   club:<id>:known                  ce que l'appli sait de chaque membre connecté (écrit à chaque passage)
 *   club:<id>:outing:<event>         fiche de la sortie
 *   club:<id>:outing:<event>:lock    verrou le temps d'un enregistrement
 *   club:<id>:docs-ignored           suivi des documents
 *   club:<id>:ffessm                 export FFESSM déposé (gestion des adhésions)
 *   club:<id>:member-links           rapprochements choisis à la main
 *   app:helloasso-token              jeton HelloAsso en cours
 */
import { HttpError, forget, identify, isDpOf, type Caller } from './auth.js';
import { getStore, type Store } from './store.js';
import { helloassoConfigured, membershipItems } from './helloasso.js';

export type AppRole = 'superadmin' | 'admin' | 'member';

/** Ce que l'appli sait d'un membre qui s'est connecté (pour les admins VPDive et les super-admins par e-mail). */
export interface KnownMember {
  email: string;
  name: string;
  vpdiveAdmin: boolean;
  lastSeen: string;
}
export type KnownMap = Record<string, KnownMember>;

export interface RolesDoc {
  version: 2;
  superAdmins: string[];
  /** Nommés admin dans l'appli. */
  admins: string[];
  /** Admins VPDive à qui le rôle admin de l'appli a été retiré. */
  revoked: string[];
  /**
   * Ancien emplacement des membres connus (avant la clé club:<id>:known) :
   * fusionné dans la nouvelle clé à la première lecture, retiré d'ici au
   * prochain enregistrement d'un rôle.
   */
  known?: KnownMap;
}

const emptyRoles = (): RolesDoc => ({ version: 2, superAdmins: [], admins: [], revoked: [] });
const rolesKey = (c: Caller) => `club:${c.clubId}:roles`;
const knownKey = (c: Caller) => `club:${c.clubId}:known`;
const outingKey = (c: Caller, event: string) => `club:${c.clubId}:outing:${event}`;
/** Membres que les admins ont choisi d'ignorer dans le suivi des documents. */
const docsIgnoredKey = (c: Caller) => `club:${c.clubId}:docs-ignored`;
export type IgnoredDoc = Record<string, { name: string; by: string; at: string }>;
const ffessmKey = (c: Caller) => `club:${c.clubId}:ffessm`;
const linksKey = (c: Caller) => `club:${c.clubId}:member-links`;
export type MemberLinks = Record<string, { uct: string; by: string; at: string }>;

const envSuperAdmins = () =>
  (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const lockedSuper = (uct: string, known: KnownMap) => {
  const email = known[uct]?.email;
  return !!email && envSuperAdmins().includes(email);
};

export function roleOf(uct: string, roles: RolesDoc, known: KnownMap): AppRole {
  if (roles.superAdmins.includes(uct) || lockedSuper(uct, known)) return 'superadmin';
  if (roles.admins.includes(uct) || (known[uct]?.vpdiveAdmin && !roles.revoked.includes(uct))) return 'admin';
  return 'member';
}

/** Les membres qui ont un rôle (et les admins VPDive à qui on l'a retiré), pour la liste des membres. */
export function roleEntries(roles: RolesDoc, known: KnownMap) {
  const ucts = new Set([...roles.superAdmins, ...roles.admins, ...roles.revoked, ...Object.keys(known).filter((u) => known[u]!.vpdiveAdmin || lockedSuper(u, known))]);
  return [...ucts].map((uct) => ({
    uct,
    role: roleOf(uct, roles, known),
    vpdiveAdmin: !!known[uct]?.vpdiveAdmin,
    lockedSuperAdmin: lockedSuper(uct, known),
    revoked: roles.revoked.includes(uct),
  }));
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const MAX_DOC_BYTES = 400_000;

/** Corps JSON d'une requête : null s'il est vide ou n'est pas un objet ; 400 s'il est illisible. */
export function parseBody(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Contenu illisible.');
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

const LOCK_TTL_MS = 3_000;
const LOCK_WAIT_MS = 1_500;
const LOCK_RETRY_MS = 100;

/** Essaie de prendre le verrou pendant `waitMs` au plus (un essai toutes les `retryMs`). */
export async function acquireLock(store: Store, key: string, waitMs = LOCK_WAIT_MS, retryMs = LOCK_RETRY_MS): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (await store.lock(key, LOCK_TTL_MS)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, retryMs));
  }
}

/**
 * La messagerie de l'appli est désormais celle de VPDive : les conversations de
 * l'ancienne messagerie maison (club:<id>:chat…) sont effacées une fois pour toutes,
 * au premier appel qui suit la mise en ligne. Une fois fait, on ne relit plus la
 * marque tant que l'instance reste chaude.
 */
const CHAT_PURGED = 'app:chat-purged-v1';
let purged = false;
async function purgeOldChat(store: Store): Promise<void> {
  if (purged) return;
  if (!(await store.get(CHAT_PURGED))) {
    const deleted = await store.deleteMatching('club:*:chat*');
    await store.set(CHAT_PURGED, { at: new Date().toISOString(), deleted });
  }
  purged = true;
}

/**
 * Rôles et membres connus du club. Les membres connus ont leur propre clé
 * (écrite à chaque passage) pour ne pas écraser un changement de rôle en cours.
 * Un ancien document qui les contient encore est fusionné une fois dans la nouvelle clé.
 */
async function loadRoles(store: Store, caller: Caller): Promise<{ roles: RolesDoc; known: KnownMap }> {
  const [savedRoles, savedKnown] = await Promise.all([store.get<RolesDoc | { version?: number }>(rolesKey(caller)), store.get<KnownMap>(knownKey(caller))]);
  // Première version (rôles par identifiant de compte, avant octobre 2026) : on repart de zéro.
  const roles: RolesDoc = savedRoles && savedRoles.version === 2 ? (savedRoles as RolesDoc) : emptyRoles();
  let known: KnownMap = savedKnown ?? {};
  if (savedKnown === null && roles.known) {
    known = { ...roles.known };
    await store.set(knownKey(caller), known);
  }
  return { roles, known };
}

/** Ce dont `handle` a besoin ; remplaçable dans les tests (pas de VPDive ni de base). */
export interface Deps {
  identify(request: Request): Promise<Caller>;
  isDpOf(caller: Caller, eventToken: string): Promise<boolean>;
  store(): Store;
}

export const handle = (request: Request): Promise<Response> => handleWith(request, { identify, isDpOf, store: getStore });

export async function handleWith(request: Request, deps: Deps): Promise<Response> {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const caller = await deps.identify(request);

    if (action === 'logout' && request.method === 'POST') {
      forget(request.headers.get('authorization') ?? '');
      return json({ ok: true });
    }

    const store = deps.store();
    await purgeOldChat(store);
    const { roles, known } = await loadRoles(store, caller);

    // Chaque passage met à jour ce que l'appli sait de la personne (admin VPDive, e-mail).
    const me = known[caller.uct];
    if (!me || me.vpdiveAdmin !== caller.vpdiveAdmin || me.email !== caller.email || Date.now() - Date.parse(me.lastSeen) > 600_000) {
      known[caller.uct] = { email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, lastSeen: new Date().toISOString() };
      await store.set(knownKey(caller), known);
    }
    const role = roleOf(caller.uct, roles, known);

    if (action === 'me' && request.method === 'GET') {
      return json({ id: caller.id, uct: caller.uct, email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, role });
    }

    if (action === 'roles' && request.method === 'GET') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      // Dernière connexion à l'appli (à 10 minutes près) de chaque membre qui l'a ouverte.
      const seen = Object.fromEntries(Object.entries(known).map(([u, k]) => [u, k.lastSeen]));
      return json({ roles: roleEntries(roles, known), seen });
    }

    if (action === 'role' && request.method === 'POST') {
      if (role !== 'superadmin') throw new HttpError(403, 'Réservé aux super-admins.');
      const body = parseBody(await request.text()) as { uct?: string; admin?: boolean; superAdmin?: boolean } | null;
      const uct = body?.uct ?? '';
      if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
      const removing = body?.superAdmin === false || body?.admin === false;
      if (removing && uct === caller.uct) throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres rôles.');
      if (removing && lockedSuper(uct, known)) throw new HttpError(400, 'Super-admin défini dans les réglages Vercel (SUPER_ADMIN_EMAILS) : à retirer là-bas.');
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
      // Les membres connus vivent désormais dans leur propre clé : on ne les réécrit plus ici.
      delete roles.known;
      await store.set(rolesKey(caller), roles);
      return json({ roles: roleEntries(roles, known) });
    }

    // Suivi des documents : liste partagée des membres ignorés (admins seulement).
    if (action === 'docs_ignored') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const ignored = (await store.get<IgnoredDoc>(docsIgnoredKey(caller))) ?? {};
      if (request.method === 'GET') return json({ ignored });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { uct?: string; name?: string; ignore?: boolean } | null;
        const uct = body?.uct ?? '';
        if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
        if (body?.ignore) ignored[uct] = { name: String(body.name ?? '').slice(0, 120), by: caller.name || caller.email, at: new Date().toISOString() };
        else delete ignored[uct];
        await store.set(docsIgnoredKey(caller), ignored);
        return json({ ignored });
      }
    }

    // Gestion des adhésions (admins seulement) : HelloAsso, export FFESSM, rapprochements choisis.
    if (action === 'helloasso' && request.method === 'GET') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (!helloassoConfigured()) throw new HttpError(503, 'HelloAsso n’est pas configuré (clé API de l’association).');
      const season = Number(url.searchParams.get('season'));
      if (!Number.isInteger(season) || season < 2020 || season > 2100) throw new HttpError(400, 'Saison inconnue.');
      try {
        return json({ items: await membershipItems(store, season) });
      } catch (e) {
        throw new HttpError(502, e instanceof Error ? e.message : 'HelloAsso ne répond pas.');
      }
    }

    if (action === 'ffessm') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (request.method === 'GET') return json({ import: await store.get(ffessmKey(caller)) });
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_DOC_BYTES) throw new HttpError(413, 'Export trop volumineux.');
        const body = parseBody(text) as { rows?: unknown; period?: unknown } | null;
        if (!Array.isArray(body?.rows) || body.rows.length > 3000) throw new HttpError(400, 'Export illisible.');
        const doc = { rows: body.rows, period: String(body.period ?? '').slice(0, 80), by: caller.name || caller.email, at: new Date().toISOString() };
        await store.set(ffessmKey(caller), doc);
        return json({ import: doc });
      }
    }

    if (action === 'member_links') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const links = (await store.get<MemberLinks>(linksKey(caller))) ?? {};
      if (request.method === 'GET') return json({ links });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { key?: string; uct?: string | null } | null;
        const key = String(body?.key ?? '');
        if (!/^(lic|ha):.{1,200}$/.test(key)) throw new HttpError(400, 'Personne inconnue.');
        if (body?.uct == null) delete links[key];
        else if (body.uct === 'none' || /^[\w-]{20,80}$/.test(body.uct)) links[key] = { uct: body.uct, by: caller.name || caller.email, at: new Date().toISOString() };
        else throw new HttpError(400, 'Membre inconnu.');
        await store.set(linksKey(caller), links);
        return json({ links });
      }
    }

    // Statistiques : rôles de la sortie (DP, pilote, sécurité) tels que l'appli les a enregistrés,
    // pour plusieurs sorties d'un coup (admins seulement). Sortie sans fiche : null.
    if (action === 'outing_roles' && request.method === 'GET') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const events = (url.searchParams.get('events') ?? '').split(',').filter((e) => /^[\w-]{10,80}$/.test(e)).slice(0, 300);
      const docs = await Promise.all(events.map((e) => store.get<{ roles?: Record<string, string[]> }>(outingKey(caller, e))));
      return json({ roles: Object.fromEntries(events.map((e, i) => [e, docs[i]?.roles ?? null])) });
    }

    if (action === 'outing') {
      const event = url.searchParams.get('event') ?? '';
      if (!/^[\w-]{10,80}$/.test(event)) throw new HttpError(400, 'Sortie inconnue.');
      if (role === 'member' && !(await deps.isDpOf(caller, event))) {
        throw new HttpError(403, 'Réservé aux admins et au directeur de plongée de la sortie.');
      }
      const key = outingKey(caller, event);

      if (request.method === 'GET') return json({ doc: await store.get<{ rev: number }>(key) });

      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_DOC_BYTES) throw new HttpError(413, 'Fiche trop volumineuse.');
        const body = parseBody(text) as { doc?: Record<string, unknown>; baseRev?: number } | null;
        if (!body?.doc || typeof body.doc !== 'object') throw new HttpError(400, 'Contenu manquant.');
        const conflict = (current: unknown) =>
          json({ error: 'Quelqu’un a modifié cette sortie entre-temps. Rechargez pour voir sa version.', doc: current }, 409);
        // Lecture, comparaison et écriture sous verrou : deux enregistrements simultanés ne peuvent pas se croiser.
        const lockKey = `${key}:lock`;
        if (!(await acquireLock(store, lockKey))) return conflict(await store.get<{ rev: number }>(key));
        try {
          const current = await store.get<{ rev: number }>(key);
          const rev = current?.rev ?? 0;
          if ((body.baseRev ?? 0) !== rev) return conflict(current);
          const doc = { ...body.doc, rev: rev + 1, updatedAt: new Date().toISOString(), updatedBy: caller.name || caller.email };
          await store.set(key, doc);
          return json({ doc });
        } finally {
          // Si le relâchement échoue, le verrou expire de lui-même (LOCK_TTL_MS).
          await store.unlock(lockKey).catch((e) => console.error('[api/app] unlock', e));
        }
      }
    }

    throw new HttpError(404, 'Action inconnue.');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    // Le détail reste dans les journaux ; le client n'en voit qu'un message générique.
    console.error('[api/app]', e);
    return json({ error: 'Erreur serveur.' }, 500);
  }
}
