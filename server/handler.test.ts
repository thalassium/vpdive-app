import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from './auth.js';
import { memoryStore, type Store, type StoreState } from './store.js';
import { acquireLock, handleWith, parseBody, resetClientErrorQuota, roleEntries, roleOf, type Deps, type KnownMap, type RolesDoc } from './handler.js';

// ── Faux stockage en mémoire (journal des écritures, verrous comme le fileStore) ──

interface MemStore extends Store {
  /** Contenu brut : valeurs et listes. */
  data: { get(key: string): unknown };
  state: StoreState;
  /** Clés écrites (set et listPush), dans l'ordre. */
  writes: string[];
  locks: Map<string, number>;
}

function memStore(initial: Record<string, unknown> = {}, over: Partial<Store> = {}): MemStore {
  const base = memoryStore(initial);
  const locks = new Map<string, number>();
  const writes: string[] = [];
  return {
    ...base,
    data: { get: (key) => base.state.values[key] ?? base.state.lists[key] },
    writes,
    locks,
    set: async (key, value, options) => {
      writes.push(key);
      await base.set(key, value, options);
    },
    listPush: async (key, value, options) => {
      writes.push(key);
      await base.listPush(key, value, options);
    },
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

/** Lignes JSON écrites par log() pendant `run`. */
async function captureLogs(run: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const lines: Record<string, unknown>[] = [];
  const saved = { error: console.error, warn: console.warn, log: console.log };
  const grab = (...args: unknown[]) => {
    try {
      lines.push(JSON.parse(String(args[0])));
    } catch {
      // pas une ligne JSON
    }
  };
  console.error = grab;
  console.warn = grab;
  console.log = grab;
  try {
    await run();
  } finally {
    Object.assign(console, saved);
  }
  return lines;
}

test('erreur inattendue → 500 générique, détail dans une ligne JSON des journaux', async () => {
  const store = memStore({}, { get: async () => { throw new Error('secret interne'); } });
  const lines = await captureLogs(async () => {
    const res = await handleWith(req('GET', 'action=me'), deps(store));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Erreur serveur.' });
  });
  const line = lines.find((l) => l.message === 'secret interne');
  assert.ok(line, 'erreur journalisée');
  assert.equal(line.level, 'error');
  assert.equal(line.action, 'me');
  assert.equal(line.status, 500);
  assert.match(String(line.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!JSON.stringify(lines).includes('super@club.fr'), 'pas d’e-mail dans les journaux');
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

// ── Durées de conservation ──

test('conservation : sorties 2 ans, exports FFESSM et rapprochements ~13 mois, rôles et brevets sans limite', async () => {
  const store = memStore({ 'club:12:roles': rolesDoc({ superAdmins: [SUPER] }) });
  const d = deps(store);
  const days = (key: string) => {
    const until = store.state.expires[key];
    return until === undefined ? null : Math.round((until - Date.now()) / 86_400_000);
  };
  assert.equal((await handleWith(outingPost({ dives: [] }, 0), d)).status, 200);
  assert.equal(days(`club:12:outing:${EV}`), 730);
  await handleWith(req('POST', 'action=ffessm&kind=brevets', JSON.stringify({ rows: [], period: 'x' })), d);
  await handleWith(req('POST', 'action=ffessm', JSON.stringify({ rows: [], period: 'x' })), d);
  assert.equal(days('club:12:ffessm'), 395);
  assert.equal(days('club:12:ffessm-brevets'), 395);
  await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'lic:A-1', uct: OTHER })), d);
  assert.equal(days('club:12:member-links'), 395);
  await handleWith(req('POST', 'action=role', JSON.stringify({ uct: OTHER, admin: true })), d);
  await handleWith(req('POST', 'action=brevet_map', JSON.stringify({ brevet: 'N2', levels: ['Niveau 2'] })), d);
  assert.equal(days('club:12:roles'), null, 'rôles : pas d’expiration');
  assert.equal(days('club:12:brevet-map'), null, 'brevets : pas d’expiration');
  assert.equal(days('club:12:known'), null);
  assert.equal(store.locks.size, 0, 'tous les verrous relâchés');
});

test('membres connus : ceux pas revus depuis 18 mois sont retirés à l’écriture', async () => {
  const old = new Date(Date.now() - 600 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 400 * 86_400_000).toISOString();
  const store = memStore({
    'club:12:known': {
      [OLD]: { email: 'old@x.fr', name: 'Old', vpdiveAdmin: true, lastSeen: old },
      [OTHER]: { email: 'o@x.fr', name: 'O', vpdiveAdmin: false, lastSeen: recent },
    },
  });
  await handleWith(req('GET', 'action=me'), deps(store));
  const k = store.data.get('club:12:known') as KnownMap;
  assert.deepEqual(Object.keys(k).sort(), [OTHER, SUPER].sort());
});

// ── Écritures concurrentes ──

test('documents partagés : deux enregistrements simultanés ne se perdent pas ; verrou tenu → 409', async () => {
  const store = memStore();
  const admin = deps(store, caller({ vpdiveAdmin: true }));
  await handleWith(req('GET', 'action=me'), admin);
  const post = (q: string, body: object) => handleWith(req('POST', q, JSON.stringify(body)), admin);
  const results = await Promise.all([
    post('action=member_links', { key: 'lic:A', uct: OTHER }),
    post('action=member_links', { key: 'lic:B', uct: PLAIN }),
    post('action=arbitrage_checks', { key: 'lic:A|unpaid', checked: true }),
    post('action=arbitrage_checks', { key: 'lic:B|unpaid', checked: true }),
    post('action=docs_ignored', { uct: OTHER, ignore: true }),
    post('action=docs_ignored', { uct: PLAIN, ignore: true }),
    post('action=brevet_map', { brevet: 'N1', levels: ['Niveau 1'] }),
    post('action=brevet_map', { brevet: 'N2', levels: ['Niveau 2'] }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200, 200, 200]);
  assert.deepEqual(Object.keys(store.data.get('club:12:member-links') as object).sort(), ['lic:A', 'lic:B']);
  assert.deepEqual(Object.keys(store.data.get('club:12:arbitrage-checks') as object).sort(), ['lic:A|unpaid', 'lic:B|unpaid']);
  assert.deepEqual(Object.keys(store.data.get('club:12:docs-ignored') as object).sort(), [OTHER, PLAIN].sort());
  assert.deepEqual(Object.keys(store.data.get('club:12:brevet-map') as object).sort(), ['N1', 'N2']);

  // Rôles : deux super-admins en même temps.
  const roles = memStore({ 'club:12:roles': rolesDoc({ superAdmins: [SUPER] }) });
  const both = await Promise.all([
    handleWith(req('POST', 'action=role', JSON.stringify({ uct: OTHER, admin: true })), deps(roles)),
    handleWith(req('POST', 'action=role', JSON.stringify({ uct: PLAIN, admin: true })), deps(roles)),
  ]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.deepEqual((roles.data.get('club:12:roles') as RolesDoc).admins.sort(), [OTHER, PLAIN].sort());

  // Verrou jamais libéré : 409 explicite, rien d'écrit.
  const busy = memStore({}, { lock: async (key) => !key.endsWith('member-links:lock') });
  const res = await handleWith(req('POST', 'action=member_links', JSON.stringify({ key: 'lic:A', uct: OTHER })), deps(busy, caller({ vpdiveAdmin: true })));
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /en même temps/);
  assert.equal(busy.data.get('club:12:member-links'), undefined);
});

// ── Journal des écritures ──

test('journal des écritures : liste, 300 dernières dans l’ordre chronologique, fiche d’avant ≤ 8 Ko', async () => {
  const store = memStore();
  const admin = deps(store, caller({ vpdiveAdmin: true }));
  const write = (n: number, before: unknown = { n }) =>
    handleWith(req('POST', 'action=member_writes', JSON.stringify({ uct: OTHER, name: `n${n}`, kinds: ['season'], ok: true, message: '', before })), admin);
  for (let n = 1; n <= 305; n++) assert.equal((await write(n)).status, 200);
  const log = (await (await handleWith(req('GET', 'action=member_writes'), admin)).json()) as { writes: { name: string }[] };
  assert.equal(log.writes.length, 300);
  assert.equal(log.writes[0]?.name, 'n6', 'le plus ancien gardé en premier');
  assert.equal(log.writes[299]?.name, 'n305', 'le plus récent en dernier');
  assert.equal((store.data.get('club:12:member-writes-log') as unknown[]).length, 300, 'la liste est plafonnée');
  assert.equal(Math.round((store.state.expires['club:12:member-writes-log']! - Date.now()) / 86_400_000), 365);

  const big = await write(1, { blob: 'x'.repeat(9_000) });
  assert.equal(big.status, 413);
  assert.match(((await big.json()) as { error: string }).error, /8 Ko/);
});

test('journal des écritures : l’ancien tableau est repris une fois ; les entrées de plus d’un an disparaissent', async () => {
  const old = (name: string, daysAgo: number) => ({ uct: OTHER, name, kinds: [], ok: true, message: '', before: null, by: 'X', at: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });
  const store = memStore({ 'club:12:member-writes': [old('vieux', 400), old('a', 30), old('b', 10)] });
  const admin = deps(store, caller({ vpdiveAdmin: true }));
  let log = (await (await handleWith(req('GET', 'action=member_writes'), admin)).json()) as { writes: { name: string }[] };
  assert.deepEqual(log.writes.map((w) => w.name), ['a', 'b'], 'plus d’un an : non rendu');
  assert.equal(store.data.get('club:12:member-writes'), undefined, 'ancienne clé effacée');
  await handleWith(req('POST', 'action=member_writes', JSON.stringify({ uct: OTHER, name: 'c', kinds: [], ok: true })), admin);
  assert.deepEqual((store.data.get('club:12:member-writes-log') as { name: string }[]).map((w) => w.name), ['c', 'b', 'a'], 'le vieux est retiré de la liste');
  log = (await (await handleWith(req('GET', 'action=member_writes'), admin)).json()) as typeof log;
  assert.deepEqual(log.writes.map((w) => w.name), ['a', 'b', 'c']);
});

// ── Erreurs du navigateur ──

test('client_error : 204, une ligne JSON sans paramètres d’adresse, accessible à un simple membre, quota par instance', async () => {
  resetClientErrorQuota();
  const store = memStore();
  const member = deps(store, caller({ uct: PLAIN, email: 'plain@club.fr' }));
  const send = (body: object) => handleWith(req('POST', 'action=client_error', JSON.stringify(body)), member);
  const lines = await captureLogs(async () => {
    const res = await send({ message: 'x is undefined', stack: 'at A\n'.repeat(2000), url: 'https://app.fr/sorties?token=abc#/admin', where: 'ErrorBoundary' });
    assert.equal(res.status, 204);
    for (let i = 0; i < 40; i++) assert.equal((await send({ message: `boom ${i}` })).status, 204);
  });
  const errors = lines.filter((l) => l.action === 'client_error' && l.level === 'error');
  assert.equal(errors.length, 30, 'quota : 30 par minute et par instance');
  const first = errors[0]!;
  assert.equal(first.message, 'x is undefined');
  assert.equal(first.url, '/sorties#/admin');
  assert.equal(first.where, 'ErrorBoundary');
  assert.ok(String(first.stack).length <= 4000);
  assert.deepEqual(store.writes, [], 'rien d’écrit dans le stockage');
  assert.equal((await handleWith(req('POST', 'action=client_error', 'x'.repeat(30_000)), member)).status, 413);
  resetClientErrorQuota();
});
