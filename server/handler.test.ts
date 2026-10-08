import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from './auth.js';
import type { Store } from './store.js';
import { acquireLock, handleWith, parseBody, roleEntries, roleOf, type Deps, type KnownMap, type RolesDoc } from './handler.js';

// ── Faux stockage en mémoire (journal des écritures, verrous comme le fileStore) ──

interface MemStore extends Store {
  data: Map<string, unknown>;
  writes: string[];
  locks: Map<string, number>;
}

function memStore(initial: Record<string, unknown> = {}, over: Partial<Store> = {}): MemStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  const locks = new Map<string, number>();
  const writes: string[] = [];
  return {
    data,
    writes,
    locks,
    get: async <T,>(key: string) => (structuredClone(data.get(key)) as T) ?? null,
    set: async (key, value) => {
      writes.push(key);
      data.set(key, structuredClone(value));
    },
    deleteMatching: async () => 0,
    lock: async (key, ttlMs) => {
      const until = locks.get(key);
      if (until !== undefined && until > Date.now()) return false;
      locks.set(key, Date.now() + ttlMs);
      return true;
    },
    unlock: async (key) => {
      locks.delete(key);
    },
    ...over,
  };
}

const uct = (tag: string) => `${tag}-`.padEnd(24, 'x');
const SUPER = uct('super');
const OLD = uct('old-vpdive-admin');
const OTHER = uct('other');
const LOCKED = uct('locked');
const PLAIN = uct('plain');

const caller = (over: Partial<Caller> = {}): Caller => ({
  id: 1,
  uct: SUPER,
  email: 'super@club.fr',
  name: 'Sue Per',
  clubId: '12',
  vpdiveAdmin: false,
  headers: {},
  ...over,
});

const deps = (store: Store, who: Caller = caller(), dp = false): Deps => ({
  identify: async () => who,
  isDpOf: async () => dp,
  store: () => store,
});

const req = (method: 'GET' | 'POST', query: string, body?: string) =>
  new Request(`http://localhost/api/app?${query}`, {
    method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: method === 'POST' ? body : undefined,
  });

const known = (map: Record<string, { email?: string; vpdiveAdmin?: boolean }>): KnownMap =>
  Object.fromEntries(Object.entries(map).map(([u, k]) => [u, { email: k.email ?? `${u}@x.fr`, name: u, vpdiveAdmin: k.vpdiveAdmin ?? false, lastSeen: new Date().toISOString() }]));

const rolesDoc = (over: Partial<RolesDoc> = {}): RolesDoc => ({ version: 2, superAdmins: [], admins: [], revoked: [], ...over });

const withEnv = async (emails: string | undefined, run: () => Promise<void> | void) => {
  const before = process.env.SUPER_ADMIN_EMAILS;
  if (emails === undefined) delete process.env.SUPER_ADMIN_EMAILS;
  else process.env.SUPER_ADMIN_EMAILS = emails;
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env.SUPER_ADMIN_EMAILS;
    else process.env.SUPER_ADMIN_EMAILS = before;
  }
};

// ── Résolution des rôles ──

test('roleOf : nommés, admins VPDive, révoqués, super-admins verrouillés par e-mail', async () => {
  await withEnv('Boss@Club.fr', () => {
    const roles = rolesDoc({ superAdmins: [SUPER], admins: [OTHER], revoked: [uct('revoked')] });
    const k = known({ [OLD]: { vpdiveAdmin: true }, [uct('revoked')]: { vpdiveAdmin: true }, [LOCKED]: { email: 'boss@club.fr' }, [PLAIN]: {} });
    assert.equal(roleOf(SUPER, roles, k), 'superadmin');
    assert.equal(roleOf(LOCKED, roles, k), 'superadmin', 'e-mail dans SUPER_ADMIN_EMAILS');
    assert.equal(roleOf(OTHER, roles, k), 'admin', 'nommé admin');
    assert.equal(roleOf(OLD, roles, k), 'admin', 'admin VPDive non révoqué');
    assert.equal(roleOf(uct('revoked'), roles, k), 'member', 'admin VPDive révoqué');
    assert.equal(roleOf(PLAIN, roles, k), 'member');
    assert.equal(roleOf(uct('unknown'), roles, k), 'member');

    const entries = roleEntries(roles, k);
    const by = Object.fromEntries(entries.map((e) => [e.uct, e]));
    assert.deepEqual(Object.keys(by).sort(), [SUPER, OTHER, uct('revoked'), OLD, LOCKED].sort(), 'le simple membre connu est absent');
    assert.deepEqual(by[LOCKED], { uct: LOCKED, role: 'superadmin', vpdiveAdmin: false, lockedSuperAdmin: true, revoked: false });
    assert.deepEqual(by[uct('revoked')], { uct: uct('revoked'), role: 'member', vpdiveAdmin: true, lockedSuperAdmin: false, revoked: true });
    assert.deepEqual(by[OLD], { uct: OLD, role: 'admin', vpdiveAdmin: true, lockedSuperAdmin: false, revoked: false });
  });
});

test('roleOf : sans SUPER_ADMIN_EMAILS, personne n’est verrouillé', async () => {
  await withEnv(undefined, () => {
    const k = known({ [LOCKED]: { email: 'boss@club.fr' } });
    assert.equal(roleOf(LOCKED, rolesDoc(), k), 'member');
    assert.deepEqual(roleEntries(rolesDoc(), k), []);
  });
});

// ── Migration des membres connus vers club:<id>:known ──

test('migration : l’ancien « known » du doc des rôles passe dans club:12:known, le doc n’est réécrit que par action=role', async () => {
  const store = memStore({ 'club:12:roles': rolesDoc({ superAdmins: [SUPER], known: known({ [OLD]: { vpdiveAdmin: true } }) }) });
  const me = await handleWith(req('GET', 'action=me'), deps(store));
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { role: string }).role, 'superadmin');

  const migrated = store.data.get('club:12:known') as KnownMap;
  assert.ok(migrated[OLD], 'ancien membre connu repris');
  assert.ok(migrated[SUPER], 'appelant ajouté');
  assert.ok(!store.writes.includes('club:12:roles'), 'le doc des rôles n’est pas touché par action=me');
  assert.ok((store.data.get('club:12:roles') as RolesDoc).known, 'l’ancien champ reste jusqu’au prochain changement de rôle');

  // Deuxième passage : la nouvelle clé existe, plus de fusion.
  store.writes.length = 0;
  await handleWith(req('GET', 'action=me'), deps(store));
  assert.deepEqual(store.writes, [], 'appelant déjà à jour : aucune écriture');

  const seen = await handleWith(req('GET', 'action=roles'), deps(store));
  const body = (await seen.json()) as { roles: { uct: string; role: string }[]; seen: Record<string, string> };
  assert.deepEqual(Object.keys(body.seen).sort(), [OLD, SUPER].sort(), '« seen » vient de la nouvelle clé');
  assert.ok(body.roles.some((r) => r.uct === OLD && r.role === 'admin'));

  const change = await handleWith(req('POST', 'action=role', JSON.stringify({ uct: OTHER, admin: true })), deps(store));
  assert.equal(change.status, 200);
  const after = store.data.get('club:12:roles') as RolesDoc;
  assert.equal(after.known, undefined, 'le champ « known » est retiré du doc des rôles');
  assert.deepEqual(after.admins, [OTHER]);
  assert.ok((store.data.get('club:12:known') as KnownMap)[OLD], 'les membres connus restent dans leur clé');
  const list = ((await change.json()) as { roles: { uct: string; role: string }[] }).roles;
  assert.ok(list.some((r) => r.uct === OTHER && r.role === 'admin'));
  assert.ok(list.some((r) => r.uct === OLD && r.role === 'admin'));
});

test('action=me : seule la clé des membres connus est écrite', async () => {
  const store = memStore();
  const res = await handleWith(req('GET', 'action=me'), deps(store, caller({ vpdiveAdmin: true })));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 1, uct: SUPER, email: 'super@club.fr', name: 'Sue Per', vpdiveAdmin: true, role: 'admin' });
  assert.ok(store.writes.includes('club:12:known'));
  assert.ok(!store.writes.includes('club:12:roles'));
});

// ── Hygiène des erreurs ──

test('parseBody : vide ou non-objet → null, JSON cassé → 400', () => {
  assert.equal(parseBody(''), null);
  assert.equal(parseBody('  '), null);
  assert.equal(parseBody('null'), null);
  assert.equal(parseBody('[1]'), null);
  assert.deepEqual(parseBody('{"a":1}'), { a: 1 });
  assert.throws(() => parseBody('{oops'), (e: unknown) => (e as { status: number; message: string }).status === 400 && (e as Error).message === 'Contenu illisible.');
});

test('corps JSON illisible → 400 « Contenu illisible. » ; corps null → 400 « Contenu manquant. »', async () => {
  const store = memStore({ 'club:12:roles': rolesDoc({ superAdmins: [SUPER] }) });
  const d = deps(store);
  const role = await handleWith(req('POST', 'action=role', '{bad'), d);
  assert.equal(role.status, 400);
  assert.deepEqual(await role.json(), { error: 'Contenu illisible.' });

  const outing = await handleWith(req('POST', `action=outing&event=${uct('ev')}`, '{bad'), d);
  assert.equal(outing.status, 400);
  assert.deepEqual(await outing.json(), { error: 'Contenu illisible.' });

  const nul = await handleWith(req('POST', `action=outing&event=${uct('ev')}`, 'null'), d);
  assert.equal(nul.status, 400);
  assert.deepEqual(await nul.json(), { error: 'Contenu manquant.' });
});

test('erreur inattendue → 500 générique, détail dans console.error', async () => {
  const store = memStore({}, { get: async () => { throw new Error('secret interne'); } });
  const original = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const res = await handleWith(req('GET', 'action=me'), deps(store));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Erreur serveur.' });
    assert.ok(logged.some((args) => (args as unknown[]).some((a) => a instanceof Error && a.message === 'secret interne')));
  } finally {
    console.error = original;
  }
});

// ── Déconnexion ──

test('POST action=logout → { ok: true } sans toucher au stockage', async () => {
  const store = memStore();
  const res = await handleWith(req('POST', 'action=logout'), deps(store));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(store.writes, []);
});

// ── Sortie : enregistrement sous verrou ──

const EV = uct('event');
const outingPost = (doc: unknown, baseRev: number) => req('POST', `action=outing&event=${EV}`, JSON.stringify({ doc, baseRev }));

test('outing : enregistrement puis conflit de révision, verrou relâché à chaque fois', async () => {
  const store = memStore();
  const d = deps(store, caller({ vpdiveAdmin: true }));
  const first = await handleWith(outingPost({ dives: [] }, 0), d);
  assert.equal(first.status, 200);
  const saved = ((await first.json()) as { doc: { rev: number; updatedBy: string } }).doc;
  assert.equal(saved.rev, 1);
  assert.equal(saved.updatedBy, 'Sue Per');
  assert.equal(store.locks.size, 0, 'verrou relâché');

  const stale = await handleWith(outingPost({ dives: [1] }, 0), d);
  assert.equal(stale.status, 409);
  const body = (await stale.json()) as { error: string; doc: { rev: number } };
  assert.equal(body.doc.rev, 1, 'le doc courant accompagne le conflit');
  assert.match(body.error, /modifié cette sortie/);
  assert.equal(store.locks.size, 0, 'verrou relâché après conflit');
  assert.equal((store.data.get(`club:12:outing:${EV}`) as { rev: number }).rev, 1, 'rien d’écrasé');

  const next = await handleWith(outingPost({ dives: [1] }, 1), d);
  assert.equal(next.status, 200);
  assert.equal(((await next.json()) as { doc: { rev: number } }).doc.rev, 2);
});

test('outing : verrou tenu par quelqu’un d’autre → 409 avec le doc courant', async () => {
  const store = memStore({ [`club:12:outing:${EV}`]: { rev: 3 } }, { lock: async () => false });
  const d = deps(store, caller({ vpdiveAdmin: true }));
  const started = Date.now();
  const res = await handleWith(outingPost({ dives: [] }, 3), d);
  assert.equal(res.status, 409);
  assert.deepEqual(((await res.json()) as { doc: unknown }).doc, { rev: 3 });
  assert.ok(Date.now() - started >= 1400, 'a réessayé pendant ~1,5 s');
  assert.ok(!store.writes.includes(`club:12:outing:${EV}`));
});

test('acquireLock : succès immédiat, refus après le délai, retente quand le verrou se libère', async () => {
  const busy = memStore({}, { lock: async () => false });
  assert.equal(await acquireLock(busy, 'k', 0), false);

  const free = memStore();
  assert.equal(await acquireLock(free, 'k'), true);
  assert.equal(await acquireLock(free, 'k', 0), false, 'déjà pris');
  setTimeout(() => void free.unlock('k'), 30);
  assert.equal(await acquireLock(free, 'k', 300, 10), true, 'repris dès que libéré');
});

test('outing : un simple membre qui n’est pas DP est refusé', async () => {
  const store = memStore();
  const res = await handleWith(req('GET', `action=outing&event=${EV}`), deps(store, caller({ uct: PLAIN })));
  assert.equal(res.status, 403);
  const dp = await handleWith(req('GET', `action=outing&event=${EV}`), deps(store, caller({ uct: PLAIN }), true));
  assert.equal(dp.status, 200);
  assert.deepEqual(await dp.json(), { doc: null });
});

// ── Gestion des adhésions ──

test('adhésions : réservé aux admins ; rapprochements mémorisés et validés ; export FFESSM partagé', async () => {
  const store = memStore();
  const member = caller({ uct: PLAIN, email: 'plain@club.fr' });
  for (const q of ['action=helloasso&season=2027', 'action=ffessm', 'action=member_links']) {
    assert.equal((await handleWith(req('GET', q), deps(store, member))).status, 403, q);
  }
  const admin = caller({ vpdiveAdmin: true });
  const set = await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'lic:A-16-733717', uct: OTHER })), deps(store, admin));
  assert.equal(set.status, 200);
  assert.equal(((await set.json()) as { links: Record<string, { uct: string }> }).links['lic:A-16-733717']?.uct, OTHER);
  assert.equal((await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'nimporte', uct: OTHER })), deps(store, admin))).status, 400);
  assert.equal((await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'lic:x', uct: 'pas un uct' })), deps(store, admin))).status, 400);
  const none = await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'lic:A-16-733717', uct: null })), deps(store, admin));
  assert.deepEqual(((await none.json()) as { links: object }).links, {});
  const saved = await handleWith(req('POST', 'action=ffessm', JSON.stringify({ rows: [{ licence: 'A-16-733717' }], period: 'Du 08/10/2025 au 08/10/2026' })), deps(store, admin));
  assert.equal(saved.status, 200);
  const read = (await (await handleWith(req('GET', 'action=ffessm'), deps(store, admin))).json()) as { import: { rows: unknown[]; by: string } };
  assert.equal(read.import.rows.length, 1);
  assert.equal(read.import.by, 'Sue Per');
});

test('demandes d’inscription : réservé aux admins ; décision inconnue refusée avant tout appel à VPDive', async () => {
  const store = memStore();
  const member = caller({ uct: PLAIN, email: 'plain@club.fr' });
  assert.equal((await handleWith(req('GET', 'action=registration_requests'), deps(store, member))).status, 403);
  const admin = caller({ vpdiveAdmin: true });
  const bad = await handleWith(req('POST', 'action=registration_requests', JSON.stringify({ token: 'x'.repeat(43), decision: 'supprimer' })), deps(store, admin));
  assert.equal(bad.status, 400);
});

test('arbitrage : case cochée par un admin (qui, quand, commentaire), commentaire modifiable, décochée ; lien parent', async () => {
  const store = memStore();
  const admin = caller({ vpdiveAdmin: true });
  const post = (body: object) => handleWith(req('POST', 'action=arbitrage_checks', JSON.stringify(body)), deps(store, admin));
  const key = 'lic:A-16-733717|unpaid';
  let res = (await (await post({ key, checked: true, comment: 'payée en espèces' })).json()) as { checks: Record<string, { by: string; comment: string }> };
  assert.equal(res.checks[key]?.by, 'Sue Per');
  assert.equal(res.checks[key]?.comment, 'payée en espèces');
  res = (await (await post({ key, comment: 'payée en espèces le 12/09' })).json()) as typeof res;
  assert.equal(res.checks[key]?.comment, 'payée en espèces le 12/09');
  res = (await (await post({ key, checked: false })).json()) as typeof res;
  assert.deepEqual(res.checks, {});
  assert.equal((await post({ key: 'nimporte', checked: true })).status, 400);
  const member = caller({ uct: PLAIN, email: 'plain@club.fr' });
  assert.equal((await handleWith(req('GET', 'action=arbitrage_checks'), deps(store, member))).status, 403);
  const link = await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'ha:petit tom|2012-05-05', uct: OTHER, relation: 'parent' })), deps(store, admin));
  assert.equal(((await link.json()) as { links: Record<string, { relation?: string }> }).links['ha:petit tom|2012-05-05']?.relation, 'parent');
  // Journal des écritures VPDive.
  const write = (body: object) => handleWith(req('POST', 'action=member_writes', JSON.stringify(body)), deps(store, admin));
  assert.equal((await write({ uct: OTHER, name: 'MARTIN Léa', kinds: ['season', 'DROP TABLE'], ok: true, message: 'écrit', before: { seasons: [2026] } })).status, 200);
  assert.equal((await write({ uct: 'x', kinds: [] })).status, 400);
  const log = (await (await handleWith(req('GET', 'action=member_writes'), deps(store, admin))).json()) as { writes: { kinds: string[]; by: string; before: unknown }[] };
  assert.deepEqual(log.writes[0]?.kinds, ['season']);
  assert.equal(log.writes[0]?.by, 'Sue Per');
  assert.deepEqual(log.writes[0]?.before, { seasons: [2026] });
  assert.equal((await handleWith(req('GET', 'action=member_writes'), deps(store, member))).status, 403);
});
