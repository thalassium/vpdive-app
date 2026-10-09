/**
 * API de l'appli (/api/app), au-dessus de VPDive :
 *
 *   GET  ?action=me                       qui je suis, mon rôle dans l'appli
 *   POST ?action=logout                   déconnexion : le serveur oublie la session mise en cache
 *   GET  ?action=roles                    admin : les membres qui ont un rôle dans l'appli
 *   POST ?action=role     {uct, admin?, superAdmin?}   super-admin : donner ou retirer un rôle
 *   GET  ?action=outing&event=<token>[&client=<id>]   admin ou DP de la sortie : plongées et fiches, et qui la modifie
 *                                         ({doc, lock}, lock.mine si c'est ce client-là)
 *   POST ?action=outing&event=<token>     {doc, baseRev, client}  enregistrer : 409 si quelqu'un a enregistré
 *                                         entre-temps, 423 si un autre détient le bail d'édition, 503 si un autre
 *                                         enregistrement de la sortie est en cours (réessayer). Le serveur pose
 *                                         lui-même qui a validé les palanquées, désinscrit, commenté, et quand.
 *   GET  ?action=outing_lock&event=<token>[&client=<id>]   bail d'édition : qui modifie la fiche ({lock})
 *   POST ?action=outing_lock&event=<token> {op: acquire|renew|release, client, force?}  prendre, garder ou rendre
 *                                         la main (2 min, renouvelée par l'éditeur ouvert) ; 423 si un autre la tient.
 *                                         force : reprendre la main laissée sur un autre appareil (même membre seulement)
 *   GET  ?action=outing_roles&events=a,b  admin : rôles de plusieurs sorties, et les membres ajoutés sans inscription
 *   GET  ?action=docs_ignored             admin : membres ignorés du suivi des documents
 *   POST ?action=docs_ignored {uct, name, ignore}  admin : ignorer / ne plus ignorer
 *   GET  ?action=helloasso&season=2027    admin : adhésions HelloAsso de la saison (server/helloasso.ts)
 *   GET  ?action=ffessm&kind=licences|brevets         admin : dernier export FFESSM déposé
 *   POST ?action=ffessm&kind=licences|brevets {rows, period}  admin : déposer un export de Mon Club (lu dans l'appli)
 *   GET  ?action=registration_requests    admin : demandes d'inscription au club en attente (server/legacy.ts)
 *   POST ?action=registration_requests {token, decision: member|guest|refuse}  admin : y répondre
 *   GET  ?action=brevet_map               admin : correspondance brevets FFESSM → niveaux VPDive
 *   POST ?action=brevet_map {brevet, levels}  admin : la fixer pour un brevet ([] : revenir à la règle automatique)
 *   GET  ?action=member_links             admin : rapprochements choisis à la main (personne → membre VPDive)
 *   POST ?action=member_links {key, uct, relation?}  admin : choisir (uct, ou 'none' : pas dans VPDive ; relation 'parent' :
 *                                         mineur rattaché au compte d'un parent) ; uct null pour oublier
 *   GET  ?action=arbitrage_checks         admin : cas d'arbitrage vérifiés à la main
 *   POST ?action=arbitrage_checks {key, checked, comment}  admin : cocher / décocher, commenter
 *   GET  ?action=member_writes            admin : journal des écritures de fiches VPDive (corrections rapides)
 *   POST ?action=member_writes {uct, name, kinds, ok, message, before}  admin : une fiche écrite (ou refusée),
 *                                         avec ce qu'elle contenait avant (pour revenir en arrière à la main)
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
 *   club:<id>:outing:<event>:lease   bail d'édition : qui modifie la fiche, jusqu'à quand
 *   club:<id>:docs-ignored           suivi des documents
 *   club:<id>:ffessm                 export FFESSM des licences déposé (gestion des adhésions)
 *   club:<id>:ffessm-brevets         export FFESSM des brevets déposé
 *   club:<id>:member-links           rapprochements choisis à la main
 *   club:<id>:arbitrage-checks       cas d'arbitrage vérifiés (qui, quand, commentaire)
 *   club:<id>:member-writes          journal des écritures de fiches VPDive (les 300 dernières)
 *   club:<id>:brevet-map             correspondance des brevets
 *   app:helloasso-token              jeton HelloAsso en cours
 */
import { HttpError, forget, identify, isDpOf, type Caller } from './auth.js';
import { getStore, type Store } from './store.js';
import { helloassoConfigured, membershipItems } from './helloasso.js';
import { decideRegistration, registrationRequests, type Decision } from './legacy.js';

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
const ffessmKey = (c: Caller, kind: string) => `club:${c.clubId}:ffessm${kind === 'brevets' ? '-brevets' : ''}`;
const linksKey = (c: Caller) => `club:${c.clubId}:member-links`;
const brevetMapKey = (c: Caller) => `club:${c.clubId}:brevet-map`;
const checksKey = (c: Caller) => `club:${c.clubId}:arbitrage-checks`;
const writesKey = (c: Caller) => `club:${c.clubId}:member-writes`;
export interface MemberWrite {
  uct: string;
  name: string;
  kinds: string[];
  ok: boolean;
  message: string;
  /** Les blocs de la fiche avant l'écriture (licences, niveaux, saisons, assurance, statut). */
  before: unknown;
  by: string;
  at: string;
}
export type ArbitrageChecks = Record<string, { by: string; at: string; comment: string }>;
export type MemberLinks = Record<string, { uct: string; by: string; at: string; relation?: 'parent' }>;

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

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

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

// ── Fiche de sortie : bail d'édition et marques posées par le serveur ──

/** Durée du bail d'édition ; l'éditeur ouvert et visible le renouvelle toutes les 30 s. */
export const LEASE_TTL_MS = 120_000;

/** Qui modifie la fiche : le membre (uct, nom) et l'onglet ou l'appareil (client), jusqu'à expiresAt. */
export interface OutingLease {
  uct: string;
  name: string;
  client: string;
  since: string;
  expiresAt: string;
}

/** Le bail tel que le client le voit : sans l'identifiant d'onglet, avec « c'est moi ». */
export const leaseView = (l: OutingLease | null, caller: Caller, client: string) =>
  l ? { uct: l.uct, name: l.name, since: l.since, expiresAt: l.expiresAt, mine: isMine(l, caller, client) } : null;

const isMine = (l: OutingLease, caller: Caller, client: string) => l.uct === caller.uct && !!client && l.client === client;
/** Bail encore valable, ou null. */
const active = (l: OutingLease | null, now = Date.now()) => (l && Date.parse(l.expiresAt) > now ? l : null);
const clientOf = (v: unknown) => (typeof v === 'string' && /^[\w-]{8,80}$/.test(v) ? v : '');

type Stamp = { by: string; at: string };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Qui a validé les palanquées, désinscrit quelqu'un ou commenté un encadrant,
 * et quand : posés par le serveur (l'appelant, maintenant) quand la valeur
 * apparaît ou change ; repris de la version enregistrée sinon. Ce que le
 * client envoie pour ces champs est ignoré.
 */
export function stampOuting(current: Record<string, unknown> | null, incoming: Record<string, unknown>, who: string, now: string): Record<string, unknown> {
  const stamp: Stamp = { by: who, at: now };
  const before = new Map(list(current?.dives).filter(isObj).map((d) => [d.id, d]));
  const dives = Array.isArray(incoming.dives)
    ? incoming.dives.map((d) => {
        if (!isObj(d)) return d;
        const prev = before.get(d.id);
        const validated = d.validated ? (isObj(prev?.validated) ? prev.validated : stamp) : null;
        if (!isObj(d.notes)) return { ...d, validated };
        const prevNotes = isObj(prev?.notes) ? prev.notes : {};
        const notes = Object.fromEntries(
          Object.entries(d.notes)
            .filter(([, n]) => isObj(n) && typeof n.text === 'string' && n.text.trim())
            .map(([id, n]) => {
              const text = String((n as Record<string, unknown>).text).trim().slice(0, 500);
              const old = prevNotes[id];
              return [id, isObj(old) && old.text === text ? { text, by: old.by, at: old.at } : { text, ...stamp }];
            }),
        );
        return { ...d, validated, notes };
      })
    : incoming.dives;
  const prevGone = new Map(list(current?.unregistered).filter(isObj).map((u) => [u.id, u]));
  const unregistered = Array.isArray(incoming.unregistered)
    ? incoming.unregistered.map((u) => {
        if (!isObj(u)) return u;
        const prev = prevGone.get(u.id);
        return { ...u, ...(prev ? { by: prev.by, at: prev.at } : stamp) };
      })
    : incoming.unregistered;
  return { ...incoming, dives, ...(unregistered !== undefined ? { unregistered } : {}) };
}

/**
 * Être DP d'une sortie se vérifie auprès de VPDive : la réponse positive est
 * gardée 5 minutes (l'éditeur ouvert interroge le serveur toutes les 30 s, le
 * pare-feu VPDive n'aime pas les rafales). Une par jeu de dépendances (tests).
 */
const dpCache = new WeakMap<Deps['isDpOf'], Map<string, number>>();
async function isDpCached(deps: Deps, caller: Caller, event: string): Promise<boolean> {
  const cache = dpCache.get(deps.isDpOf) ?? dpCache.set(deps.isDpOf, new Map()).get(deps.isDpOf)!;
  const key = `${caller.clubId}:${caller.uct}:${event}`;
  if ((cache.get(key) ?? 0) > Date.now()) return true;
  const ok = await deps.isDpOf(caller, event);
  if (ok) cache.set(key, Date.now() + 300_000);
  return ok;
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
      const kind = url.searchParams.get('kind') === 'brevets' ? 'brevets' : 'licences';
      if (request.method === 'GET') return json({ import: await store.get(ffessmKey(caller, kind)) });
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_DOC_BYTES) throw new HttpError(413, 'Export trop volumineux.');
        const body = parseBody(text) as { rows?: unknown; period?: unknown } | null;
        if (!Array.isArray(body?.rows) || body.rows.length > 3000) throw new HttpError(400, 'Export illisible.');
        const doc = { rows: body.rows, period: String(body.period ?? '').slice(0, 80), by: caller.name || caller.email, at: new Date().toISOString() };
        await store.set(ffessmKey(caller, kind), doc);
        return json({ import: doc });
      }
    }

    // Demandes d'inscription : seulement dans l'ancienne interface de VPDive, lue avec la session de l'admin.
    if (action === 'registration_requests') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (request.method === 'GET') return json({ requests: await registrationRequests(caller) });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { token?: unknown; decision?: unknown } | null;
        const decision = String(body?.decision ?? '') as Decision;
        if (!['member', 'guest', 'refuse'].includes(decision)) throw new HttpError(400, 'Décision inconnue.');
        return json({ requests: await decideRegistration(caller, String(body?.token ?? ''), decision) });
      }
    }

    if (action === 'brevet_map') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const map = (await store.get<Record<string, string[]>>(brevetMapKey(caller))) ?? {};
      if (request.method === 'GET') return json({ map });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { brevet?: unknown; levels?: unknown } | null;
        const brevet = String(body?.brevet ?? '').trim().slice(0, 160);
        const levels = Array.isArray(body?.levels) ? body.levels.map((l) => String(l).trim().slice(0, 200)).filter(Boolean).slice(0, 20) : null;
        if (!brevet || !levels) throw new HttpError(400, 'Correspondance illisible.');
        if (levels.length) map[brevet] = levels;
        else delete map[brevet];
        if (Object.keys(map).length > 300) throw new HttpError(413, 'Trop de correspondances.');
        await store.set(brevetMapKey(caller), map);
        return json({ map });
      }
    }

    // Arbitrage : un admin coche un cas vérifié à la main (qui, quand, commentaire), au lieu d'une liste d'ignorés.
    if (action === 'arbitrage_checks') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const checks = (await store.get<ArbitrageChecks>(checksKey(caller))) ?? {};
      if (request.method === 'GET') return json({ checks });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { key?: unknown; checked?: unknown; comment?: unknown } | null;
        const key = String(body?.key ?? '');
        if (!/^(lic|ha):.{1,200}\|[a-z-]{2,20}$/.test(key)) throw new HttpError(400, 'Cas inconnu.');
        const comment = String(body?.comment ?? '').trim().slice(0, 500);
        if (body?.checked === false) delete checks[key];
        else if (checks[key] && body?.checked === undefined) checks[key] = { ...checks[key]!, comment };
        else checks[key] = { by: caller.name || caller.email, at: new Date().toISOString(), comment };
        if (Object.keys(checks).length > 2000) throw new HttpError(413, 'Trop de cas vérifiés.');
        await store.set(checksKey(caller), checks);
        return json({ checks });
      }
    }

    // Corrections rapides écrites dans VPDive : qui, quand, quoi, et la fiche d'avant.
    if (action === 'member_writes') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const writes = (await store.get<MemberWrite[]>(writesKey(caller))) ?? [];
      if (request.method === 'GET') return json({ writes });
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > 60_000) throw new HttpError(413, 'Fiche trop grosse pour le journal.');
        const body = parseBody(text) as Partial<Record<keyof MemberWrite, unknown>> | null;
        const uct = String(body?.uct ?? '');
        if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
        const kinds = Array.isArray(body?.kinds) ? body.kinds.map(String).filter((k) => /^[a-z-]{2,20}$/.test(k)).slice(0, 10) : [];
        writes.push({
          uct,
          name: String(body?.name ?? '').slice(0, 120),
          kinds,
          ok: body?.ok === true,
          message: String(body?.message ?? '').slice(0, 500),
          before: body?.before ?? null,
          by: caller.name || caller.email,
          at: new Date().toISOString(),
        });
        await store.set(writesKey(caller), writes.slice(-300));
        return json({ ok: true });
      }
    }

    if (action === 'member_links') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      const links = (await store.get<MemberLinks>(linksKey(caller))) ?? {};
      if (request.method === 'GET') return json({ links });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { key?: string; uct?: string | null; relation?: unknown } | null;
        const key = String(body?.key ?? '');
        if (!/^(lic|ha):.{1,200}$/.test(key)) throw new HttpError(400, 'Personne inconnue.');
        const parent = body?.relation === 'parent';
        if (body?.uct == null) delete links[key];
        else if (body.uct === 'none' && !parent) links[key] = { uct: 'none', by: caller.name || caller.email, at: new Date().toISOString() };
        else if (/^[\w-]{20,80}$/.test(body.uct)) links[key] = { uct: body.uct, by: caller.name || caller.email, at: new Date().toISOString(), ...(parent ? { relation: 'parent' as const } : {}) };
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
      type RolesOnly = { roles?: Record<string, string[]>; members?: { id: string; name: string; picture?: string }[] };
      const docs = await Promise.all(events.map((e) => store.get<RolesOnly>(outingKey(caller, e))));
      // Membres ajoutés sans inscription qui tiennent un rôle (DP désigné…) : leur nom, que la liste VPDive n'a pas.
      const members = Object.fromEntries(
        events.map((e, i) => {
          const held = new Set(Object.values(docs[i]?.roles ?? {}).flat());
          return [e, (docs[i]?.members ?? []).filter((m) => held.has(m.id)).map((m) => ({ id: m.id, name: m.name, ...(m.picture ? { picture: m.picture } : {}) }))];
        }),
      );
      return json({ roles: Object.fromEntries(events.map((e, i) => [e, docs[i]?.roles ?? null])), members });
    }

    if (action === 'outing' || action === 'outing_lock') {
      const event = url.searchParams.get('event') ?? '';
      if (!/^[\w-]{10,80}$/.test(event)) throw new HttpError(400, 'Sortie inconnue.');
      if (role === 'member' && !(await isDpCached(deps, caller, event))) {
        throw new HttpError(403, 'Réservé aux admins et au directeur de plongée de la sortie.');
      }
      const key = outingKey(caller, event);
      const leaseKey = `${key}:lease`;
      const lockKey = `${key}:lock`;
      const who = caller.name || caller.email;
      const readLease = async () => active(await store.get<OutingLease>(leaseKey));
      const busy = () => json({ error: 'Un autre enregistrement de cette sortie est en cours : réessayez.', retry: true }, 503, { 'Retry-After': '1' });
      const lockedBy = (l: OutingLease, client: string) =>
        json({ error: `${l.name} modifie cette fiche : seule cette personne peut l’enregistrer pour l’instant.`, lock: leaseView(l, caller, client) }, 423);
      /** Lecture, comparaison et écriture sous le verrou court : deux écritures simultanées ne se croisent pas. */
      const underLock = async (run: () => Promise<Response>) => {
        if (!(await acquireLock(store, lockKey))) return busy();
        try {
          return await run();
        } finally {
          // Si le relâchement échoue, le verrou expire de lui-même (LOCK_TTL_MS).
          await store.unlock(lockKey).catch((e) => console.error('[api/app] unlock', e));
        }
      };

      if (request.method === 'GET') {
        const client = clientOf(url.searchParams.get('client'));
        const lock = leaseView(await readLease(), caller, client);
        if (action === 'outing_lock') return json({ lock });
        return json({ doc: await store.get<{ rev: number }>(key), lock });
      }

      if (request.method === 'POST' && action === 'outing_lock') {
        const body = parseBody(await request.text()) as { op?: unknown; client?: unknown; force?: unknown } | null;
        const client = clientOf(body?.client);
        if (!client) throw new HttpError(400, 'Éditeur inconnu.');
        const op = body?.op;
        if (op !== 'acquire' && op !== 'renew' && op !== 'release') throw new HttpError(400, 'Opération inconnue.');
        return underLock(async () => {
          const lease = await readLease();
          if (op === 'release') {
            if (lease && isMine(lease, caller, client)) await store.set(leaseKey, null);
            return json({ lock: lease && !isMine(lease, caller, client) ? leaseView(lease, caller, client) : null });
          }
          // Un autre tient la main ; le même membre peut la reprendre (force) s'il l'a laissée sur un autre appareil.
          if (lease && !isMine(lease, caller, client) && !(body?.force === true && lease.uct === caller.uct)) return lockedBy(lease, client);
          const now = new Date();
          const next: OutingLease = {
            uct: caller.uct,
            name: who,
            client,
            since: lease && isMine(lease, caller, client) ? lease.since : now.toISOString(),
            expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
          };
          await store.set(leaseKey, next);
          // La révision enregistrée : le client voit si la fiche a changé pendant qu'il ne tenait pas la main.
          const current = await store.get<{ rev?: number }>(key);
          return json({ lock: leaseView(next, caller, client), rev: current?.rev ?? 0 });
        });
      }

      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_DOC_BYTES) throw new HttpError(413, 'Fiche trop volumineuse.');
        const body = parseBody(text) as { doc?: Record<string, unknown>; baseRev?: number; client?: unknown } | null;
        if (!body?.doc || typeof body.doc !== 'object') throw new HttpError(400, 'Contenu manquant.');
        const client = clientOf(body.client);
        return underLock(async () => {
          const lease = await readLease();
          if (lease && !isMine(lease, caller, client)) return lockedBy(lease, client);
          const current = await store.get<Record<string, unknown> & { rev?: number }>(key);
          const rev = current?.rev ?? 0;
          if ((body.baseRev ?? 0) !== rev) {
            return json({ error: 'Quelqu’un a modifié cette sortie entre-temps.', doc: current, conflict: true }, 409);
          }
          const now = new Date().toISOString();
          const doc = { ...stampOuting(current, body.doc!, who, now), rev: rev + 1, updatedAt: now, updatedBy: who };
          await store.set(key, doc);
          return json({ doc });
        });
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
