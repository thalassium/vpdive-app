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
 *                                         avec ce qu'elle contenait avant (pour revenir en arrière à la main ; 8 Ko au plus)
 *   POST ?action=client_error {message, stack?, url?, where?}  tout membre identifié : erreur de l'appli
 *                                         dans le navigateur, journalisée (ligne JSON) ; répond 204
 *
 * La sauvegarde quotidienne (Vercel Cron) passe par /api/backup (server/backup.ts).
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
 * Clés du stockage, par club (durée de conservation entre crochets ; sans, gardée indéfiniment) :
 *   club:<id>:roles                  rôles donnés / retirés (écrit seulement par ?action=role)
 *   club:<id>:known                  ce que l'appli sait de chaque membre connecté (écrit à chaque passage ;
 *                                    les membres pas revus depuis 18 mois en sont retirés à l'écriture)
 *   club:<id>:outing:<event>         fiche de la sortie [2 ans après le dernier enregistrement]
 *   club:<id>:outing:<event>:lock    verrou le temps d'un enregistrement
 *   club:<id>:docs-ignored           suivi des documents
 *   club:<id>:ffessm                 export FFESSM des licences déposé (gestion des adhésions) [13 mois]
 *   club:<id>:ffessm-brevets         export FFESSM des brevets déposé [13 mois]
 *   club:<id>:member-links           rapprochements choisis à la main [13 mois après le dernier choix]
 *   club:<id>:arbitrage-checks       cas d'arbitrage vérifiés (qui, quand, commentaire)
 *   club:<id>:member-writes-log      journal des écritures de fiches VPDive : liste Redis, la plus récente
 *                                    en tête, les 300 dernières [chaque entrée 1 an]
 *   club:<id>:member-writes          ancien journal (un tableau dans une clé), repris dans la liste puis effacé
 *   club:<id>:brevet-map             correspondance des brevets
 *   <clé>:lock                       verrou le temps d'une lecture-modification-écriture
 *   app:helloasso-token              jeton HelloAsso en cours [le temps de sa validité]
 */
import { HttpError, forget, identify, isDpOf, type Caller } from './auth.js';
import { acquireLock, getStore, type SetOptions, type Store } from './store.js';
import { helloassoConfigured, membershipItems } from './helloasso.js';
import { decideRegistration, registrationRequests, type Decision } from './legacy.js';
import { errorFields, log } from './log.js';

export { acquireLock };

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
/** Ancien journal : un tableau dans une seule clé (jusqu'à 18 Mo), repris dans la liste. */
const oldWritesKey = (c: Caller) => `club:${c.clubId}:member-writes`;
const writesKey = (c: Caller) => `club:${c.clubId}:member-writes-log`;
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

const DAY_S = 86_400;
const DAY_MS = DAY_S * 1000;

/**
 * Durées de conservation par clé, appliquées à chaque écriture qui n'en fixe
 * pas elle-même (l'expiration repart de zéro à chaque enregistrement). Les
 * rôles et la correspondance des brevets n'en ont pas.
 */
export const RETENTION: [RegExp, number][] = [
  [/^club:[^:]+:outing:[^:]+$/, 730 * DAY_S], // fiches de sortie : 2 ans
  [/^club:[^:]+:ffessm(-brevets)?$/, 395 * DAY_S], // exports FFESSM : remplacés à chaque saison, ~13 mois
  [/^club:[^:]+:member-links$/, 395 * DAY_S], // rapprochements : refaits à chaque saison, ~13 mois
];
export const WRITES_MAX = 300;
export const WRITES_TTL_S = 365 * DAY_S;
/** Membres connus : retirés s'ils n'ont pas ouvert l'appli depuis 18 mois. */
export const KNOWN_TTL_MS = 548 * DAY_MS;
/** Taille maximale de la fiche d'avant gardée dans le journal des écritures. */
export const MAX_BEFORE_BYTES = 8_192;

/** Le stockage, avec la durée de conservation de RETENTION posée sur chaque écriture. */
export function withRetention(store: Store): Store {
  return {
    ...store,
    set: (key, value, options?: SetOptions) => {
      const ex = options?.ex ?? RETENTION.find(([re]) => re.test(key))?.[1];
      return store.set(key, value, ex ? { ex } : options);
    },
  };
}

const BUSY = 'Quelqu’un d’autre enregistre en même temps : réessayez dans un instant.';

/**
 * Lecture-modification-écriture d'un document partagé, sous verrou : deux
 * admins qui enregistrent en même temps ne s'écrasent pas. `change` reçoit le
 * document courant (null s'il n'existe pas) et rend le nouveau ; s'il lève une
 * erreur, rien n'est écrit. Verrou introuvable : 409, jamais de perte silencieuse.
 */
export async function updateShared<T>(store: Store, key: string, change: (current: T | null) => T): Promise<T> {
  const lockKey = `${key}:lock`;
  if (!(await acquireLock(store, lockKey))) throw new HttpError(409, BUSY);
  try {
    const next = change(await store.get<T>(key));
    await store.set(key, next);
    return next;
  } finally {
    // Si le relâchement échoue, le verrou expire de lui-même.
    await store.unlock(lockKey).catch((e) => log('warn', { action: 'unlock', message: errorFields(e).message }));
  }
}

/** Retire les membres connus qui n'ont pas ouvert l'appli depuis KNOWN_TTL_MS. */
export function purgeKnown(known: KnownMap, now = Date.now()): KnownMap {
  return Object.fromEntries(Object.entries(known).filter(([, k]) => !(now - Date.parse(k.lastSeen) > KNOWN_TTL_MS)));
}

/** Erreurs du navigateur journalisées par instance et par minute, au plus (contre les rafales). */
const CLIENT_ERRORS_PER_MINUTE = 30;
const clientErrors = { windowStart: 0, count: 0, dropped: 0 };

/** Laisse passer une erreur du navigateur si le quota de la minute n'est pas atteint. */
function clientErrorAllowed(now = Date.now()): boolean {
  if (now - clientErrors.windowStart >= 60_000) {
    if (clientErrors.dropped) log('warn', { action: 'client_error', message: 'Erreurs du navigateur non journalisées (quota)', dropped: clientErrors.dropped });
    clientErrors.windowStart = now;
    clientErrors.count = 0;
    clientErrors.dropped = 0;
  }
  if (clientErrors.count >= CLIENT_ERRORS_PER_MINUTE) {
    clientErrors.dropped++;
    return false;
  }
  clientErrors.count++;
  return true;
}

/** Remise à zéro du quota (tests). */
export function resetClientErrorQuota(): void {
  Object.assign(clientErrors, { windowStart: 0, count: 0, dropped: 0 });
}

/** Adresse de la page, sans paramètres ni fragment qui pourrait porter un jeton. */
function safePageUrl(raw: unknown): string {
  try {
    const u = new URL(String(raw ?? ''));
    const hash = u.hash.includes('=') ? '' : u.hash.split('?')[0]!;
    return `${u.pathname}${hash}`.slice(0, 200);
  } catch {
    return '';
  }
}

/** Le journal des écritures quitte l'ancienne clé (un gros tableau) pour la liste, une seule fois. */
async function migrateWrites(store: Store, caller: Caller): Promise<void> {
  const old = await store.get<MemberWrite[]>(oldWritesKey(caller));
  if (old === null) return;
  const lockKey = `${writesKey(caller)}:lock`;
  if (!(await acquireLock(store, lockKey))) throw new HttpError(409, BUSY);
  try {
    const again = await store.get<MemberWrite[]>(oldWritesKey(caller));
    if (again === null) return;
    // Du plus ancien au plus récent : le plus récent finit en tête de liste.
    for (const w of (Array.isArray(again) ? again : []).slice(-WRITES_MAX)) await store.listPush(writesKey(caller), w, { max: WRITES_MAX, ex: WRITES_TTL_S });
    await store.del(oldWritesKey(caller));
    log('info', { action: 'member_writes', message: 'Ancien journal des écritures repris dans la liste', count: Array.isArray(again) ? again.length : 0 });
  } finally {
    await store.unlock(lockKey).catch(() => {});
  }
}

/** Retire de la fin de liste (les plus anciennes) les écritures de plus d'un an. */
async function dropOldWrites(store: Store, caller: Caller): Promise<void> {
  const tail = await store.listRange<MemberWrite>(writesKey(caller), -50, -1);
  const cutoff = Date.now() - WRITES_TTL_S * 1000;
  let old = 0;
  for (let i = tail.length - 1; i >= 0 && Date.parse(tail[i]!.at) < cutoff; i--) old++;
  // Indices depuis la fin : une écriture ajoutée en tête entre-temps n'est pas touchée.
  if (old) await store.listTrim(writesKey(caller), 0, -(old + 1));
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
  const started = Date.now();
  let action: string | null = null;
  try {
    const url = new URL(request.url);
    action = url.searchParams.get('action');
    const caller = await deps.identify(request);

    if (action === 'logout' && request.method === 'POST') {
      forget(request.headers.get('authorization') ?? '');
      return json({ ok: true });
    }

    // Erreur de l'appli dans le navigateur (ErrorBoundary) : journalisée, sans toucher au stockage.
    if (action === 'client_error' && request.method === 'POST') {
      const text = await request.text();
      if (text.length > 20_000) throw new HttpError(413, 'Rapport d’erreur trop gros.');
      const body = parseBody(text) as { message?: unknown; stack?: unknown; url?: unknown; where?: unknown } | null;
      if (clientErrorAllowed()) {
        log('error', {
          action: 'client_error',
          status: 0,
          message: String(body?.message ?? '').slice(0, 500),
          ...(body?.stack ? { stack: String(body.stack).slice(0, 4000) } : {}),
          url: safePageUrl(body?.url),
          where: String(body?.where ?? '').slice(0, 100),
          club: caller.clubId,
        });
      }
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }

    const store = withRetention(deps.store());
    await purgeOldChat(store);
    const loaded = await loadRoles(store, caller);
    const { roles } = loaded;
    let { known } = loaded;

    // Chaque passage met à jour ce que l'appli sait de la personne (admin VPDive, e-mail).
    const me = known[caller.uct];
    if (!me || me.vpdiveAdmin !== caller.vpdiveAdmin || me.email !== caller.email || Date.now() - Date.parse(me.lastSeen) > 600_000) {
      const entry: KnownMember = { email: caller.email, name: caller.name, vpdiveAdmin: caller.vpdiveAdmin, lastSeen: new Date().toISOString() };
      // Sous verrou, relu juste avant d'écrire : deux connexions simultanées ne s'effacent pas.
      // Verrou pris ailleurs : on n'écrit rien cette fois (ce sera fait au prochain passage).
      const lockKey = `${knownKey(caller)}:lock`;
      if (await acquireLock(store, lockKey, 500)) {
        try {
          const fresh = purgeKnown({ ...((await store.get<KnownMap>(knownKey(caller))) ?? known), [caller.uct]: entry });
          await store.set(knownKey(caller), fresh);
          known = fresh;
        } finally {
          await store.unlock(lockKey).catch(() => {});
        }
      } else known = { ...known, [caller.uct]: entry };
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
      // Relu sous verrou : deux super-admins qui changent des rôles en même temps ne s'écrasent pas.
      const saved = await updateShared<RolesDoc | { version?: number }>(store, rolesKey(caller), (current) => {
        const next: RolesDoc = current && current.version === 2 ? (current as RolesDoc) : emptyRoles();
        if (body?.superAdmin === true) {
          next.superAdmins = add(next.superAdmins);
          next.revoked = drop(next.revoked);
        }
        if (body?.superAdmin === false) next.superAdmins = drop(next.superAdmins);
        if (body?.admin === true) {
          next.admins = add(next.admins);
          next.revoked = drop(next.revoked);
        }
        if (body?.admin === false) {
          // Plus admin du tout : ni nommé, ni super-admin, ni admin VPDive par défaut.
          next.admins = drop(next.admins);
          next.superAdmins = drop(next.superAdmins);
          next.revoked = add(next.revoked);
        }
        // Les membres connus vivent désormais dans leur propre clé : on ne les réécrit plus ici.
        delete next.known;
        return next;
      });
      log('info', { action: 'role', status: 200, message: 'Rôle modifié', club: caller.clubId });
      return json({ roles: roleEntries(saved as RolesDoc, known) });
    }

    // Suivi des documents : liste partagée des membres ignorés (admins seulement).
    if (action === 'docs_ignored') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (request.method === 'GET') return json({ ignored: (await store.get<IgnoredDoc>(docsIgnoredKey(caller))) ?? {} });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { uct?: string; name?: string; ignore?: boolean } | null;
        const uct = body?.uct ?? '';
        if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
        const ignored = await updateShared<IgnoredDoc>(store, docsIgnoredKey(caller), (current) => {
          const next = current ?? {};
          if (body?.ignore) next[uct] = { name: String(body.name ?? '').slice(0, 120), by: caller.name || caller.email, at: new Date().toISOString() };
          else delete next[uct];
          return next;
        });
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
        if (e instanceof HttpError) throw e;
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
      if (request.method === 'GET') return json({ map: (await store.get<Record<string, string[]>>(brevetMapKey(caller))) ?? {} });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { brevet?: unknown; levels?: unknown } | null;
        const brevet = String(body?.brevet ?? '').trim().slice(0, 160);
        const levels = Array.isArray(body?.levels) ? body.levels.map((l) => String(l).trim().slice(0, 200)).filter(Boolean).slice(0, 20) : null;
        if (!brevet || !levels) throw new HttpError(400, 'Correspondance illisible.');
        const map = await updateShared<Record<string, string[]>>(store, brevetMapKey(caller), (current) => {
          const next = current ?? {};
          if (levels.length) next[brevet] = levels;
          else delete next[brevet];
          if (Object.keys(next).length > 300) throw new HttpError(413, 'Trop de correspondances.');
          return next;
        });
        return json({ map });
      }
    }

    // Arbitrage : un admin coche un cas vérifié à la main (qui, quand, commentaire), au lieu d'une liste d'ignorés.
    if (action === 'arbitrage_checks') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (request.method === 'GET') return json({ checks: (await store.get<ArbitrageChecks>(checksKey(caller))) ?? {} });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { key?: unknown; checked?: unknown; comment?: unknown } | null;
        const key = String(body?.key ?? '');
        if (!/^(lic|ha):.{1,200}\|[a-z-]{2,20}$/.test(key)) throw new HttpError(400, 'Cas inconnu.');
        const comment = String(body?.comment ?? '').trim().slice(0, 500);
        const checks = await updateShared<ArbitrageChecks>(store, checksKey(caller), (current) => {
          const next = current ?? {};
          if (body?.checked === false) delete next[key];
          else if (next[key] && body?.checked === undefined) next[key] = { ...next[key]!, comment };
          else next[key] = { by: caller.name || caller.email, at: new Date().toISOString(), comment };
          if (Object.keys(next).length > 2000) throw new HttpError(413, 'Trop de cas vérifiés.');
          return next;
        });
        return json({ checks });
      }
    }

    // Corrections rapides écrites dans VPDive : qui, quand, quoi, et la fiche d'avant.
    // Une liste Redis (la plus récente en tête, 300 au plus, chaque entrée gardée un an).
    if (action === 'member_writes') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      await migrateWrites(store, caller);
      if (request.method === 'GET') {
        const cutoff = Date.now() - WRITES_TTL_S * 1000;
        const recent = await store.listRange<MemberWrite>(writesKey(caller), 0, WRITES_MAX - 1);
        // Même forme qu'avant : du plus ancien au plus récent.
        return json({ writes: recent.filter((w) => !(Date.parse(w.at) < cutoff)).reverse() });
      }
      if (request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_BEFORE_BYTES + 8_000) throw new HttpError(413, 'Écriture trop grosse pour le journal.');
        const body = parseBody(text) as Partial<Record<keyof MemberWrite, unknown>> | null;
        const uct = String(body?.uct ?? '');
        if (!/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
        const before = body?.before ?? null;
        if (Buffer.byteLength(JSON.stringify(before)) > MAX_BEFORE_BYTES) {
          throw new HttpError(413, `Fiche d’avant trop grosse pour le journal (${Math.round(MAX_BEFORE_BYTES / 1024)} Ko au plus) : écriture non journalisée.`);
        }
        const kinds = Array.isArray(body?.kinds) ? body.kinds.map(String).filter((k) => /^[a-z-]{2,20}$/.test(k)).slice(0, 10) : [];
        const entry: MemberWrite = {
          uct,
          name: String(body?.name ?? '').slice(0, 120),
          kinds,
          ok: body?.ok === true,
          message: String(body?.message ?? '').slice(0, 500),
          before,
          by: caller.name || caller.email,
          at: new Date().toISOString(),
        };
        await store.listPush(writesKey(caller), entry, { max: WRITES_MAX, ex: WRITES_TTL_S });
        await dropOldWrites(store, caller);
        return json({ ok: true });
      }
    }

    if (action === 'member_links') {
      if (role === 'member') throw new HttpError(403, 'Réservé aux admins.');
      if (request.method === 'GET') return json({ links: (await store.get<MemberLinks>(linksKey(caller))) ?? {} });
      if (request.method === 'POST') {
        const body = parseBody(await request.text()) as { key?: string; uct?: string | null; relation?: unknown } | null;
        const key = String(body?.key ?? '');
        if (!/^(lic|ha):.{1,200}$/.test(key)) throw new HttpError(400, 'Personne inconnue.');
        const parent = body?.relation === 'parent';
        const uct = body?.uct;
        if (uct != null && !(uct === 'none' && !parent) && !/^[\w-]{20,80}$/.test(uct)) throw new HttpError(400, 'Membre inconnu.');
        const links = await updateShared<MemberLinks>(store, linksKey(caller), (current) => {
          const next = current ?? {};
          if (uct == null) delete next[key];
          else if (uct === 'none' && !parent) next[key] = { uct: 'none', by: caller.name || caller.email, at: new Date().toISOString() };
          else next[key] = { uct, by: caller.name || caller.email, at: new Date().toISOString(), ...(parent ? { relation: 'parent' as const } : {}) };
          return next;
        });
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
    if (e instanceof HttpError) {
      // Pannes de VPDive / HelloAsso, pare-feu, conflits de verrou : notables pour la supervision.
      if (e.status >= 500 || e.status === 429 || e.status === 409) log('warn', { action, status: e.status, message: e.message, ms: Date.now() - started });
      return json({ error: e.message }, e.status);
    }
    // Le détail reste dans les journaux ; le client n'en voit qu'un message générique.
    log('error', { action, status: 500, ...errorFields(e), ms: Date.now() - started });
    return json({ error: 'Erreur serveur.' }, 500);
  }
}
