import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP_MS, Transport, isAborted, isNetwork, isRateLimited, isSessionLost, isUnavailable, type Auth } from './transport';

/**
 * Banc d'essai : horloge simulée (les pauses avancent l'horloge sans attendre),
 * fetch simulé qui répond d'après une file de réponses et note chaque appel.
 */
function bench(opts: { auth?: Auth | null; latency?: number; storage?: Storage } = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const calls: { path: string; method: string; at: number; end: number }[] = [];
  const answers: (() => Response)[] = [];
  let active = 0;
  let maxActive = 0;
  let unauthorized = 0;
  const latency = opts.latency ?? 100;
  const transport = new Transport(
    { auth: () => (opts.auth === undefined ? { token: 'jwt', traceability: 'uct' } : opts.auth), onUnauthorized: () => unauthorized++ },
    {
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      fetch: async (input, init) => {
        const call = { path: input.replace('/api/vpdive', ''), method: String(init.method), at: now, end: 0 };
        calls.push(call);
        maxActive = Math.max(maxActive, ++active);
        await Promise.resolve();
        now += latency;
        call.end = now;
        active--;
        const next = answers.shift();
        return next ? next() : json({ ok: true, n: calls.length });
      },
      storage: () => opts.storage ?? null,
    },
  );
  return {
    transport,
    calls,
    sleeps,
    answers,
    get maxActive() {
      return maxActive;
    },
    get unauthorized() {
      return unauthorized;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (status: number) => new Response('<html>Access denied</html>', { status });

/** Stockage d'onglet en mémoire, pour les lectures gardées (`persist`). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

test('un appel à la fois, et une pause entre la fin de l’un et le début du suivant', async () => {
  const b = bench();
  await Promise.all([b.transport.call('/a'), b.transport.call('/b'), b.transport.call('/c')]);
  assert.equal(b.maxActive, 1);
  assert.deepEqual(
    b.calls.map((c) => c.path),
    ['/a', '/b', '/c'],
  );
  assert.ok(b.calls[1]!.at - b.calls[0]!.end >= GAP_MS);
  assert.ok(b.calls[2]!.at - b.calls[1]!.end >= GAP_MS);
});

test('pause réglable par appel : une écriture peut attendre plus longtemps', async () => {
  const b = bench();
  await b.transport.call('/a');
  await b.transport.call('/w', { method: 'POST', body: {}, gap: 800 });
  assert.ok(b.calls[1]!.at - b.calls[0]!.end >= 800);
});

test('premier appel sans attente, et pas d’attente si la pause est déjà passée', async () => {
  const b = bench();
  await b.transport.call('/a');
  assert.deepEqual(b.sleeps, []);
  b.advance(5000);
  await b.transport.call('/b');
  assert.deepEqual(b.sleeps, []);
});

test('les lectures identiques en cours partent une seule fois', async () => {
  const b = bench();
  const [x, y] = await Promise.all([b.transport.call('/user?uct_token=u1'), b.transport.call('/user?uct_token=u1')]);
  assert.equal(b.calls.length, 1);
  assert.deepEqual(x, y);
});

test('cache court : gardé pendant sa durée, relu après, ignoré si « fresh »', async () => {
  const b = bench();
  await b.transport.call('/e', { ttl: 30_000 });
  await b.transport.call('/e', { ttl: 30_000 });
  assert.equal(b.calls.length, 1);
  await b.transport.call('/e', { ttl: 30_000, fresh: true });
  assert.equal(b.calls.length, 2);
  b.advance(30_001);
  await b.transport.call('/e', { ttl: 30_000 });
  assert.equal(b.calls.length, 3);
  // Sans durée : pas de cache, seulement le partage en cours.
  await b.transport.call('/e');
  assert.equal(b.calls.length, 4);
});

test('une erreur n’est pas gardée en cache', async () => {
  const b = bench();
  b.answers.push(() => json({ message: 'Introuvable' }, 404));
  await assert.rejects(b.transport.call('/e', { ttl: 30_000 }));
  await b.transport.call('/e', { ttl: 30_000 });
  assert.equal(b.calls.length, 2);
});

test('les écritures ne sont jamais partagées ni gardées, et oublient les lectures qu’elles touchent', async () => {
  const b = bench();
  await Promise.all([b.transport.call('/w', { method: 'POST', body: { a: 1 } }), b.transport.call('/w', { method: 'POST', body: { a: 1 } })]);
  assert.equal(b.calls.length, 2);

  await b.transport.call('/user?uct_token=u1', { ttl: 60_000 });
  await b.transport.call('/calendar/t1/event', { ttl: 60_000 });
  await b.transport.call('/user/member/u1/update', { method: 'POST', body: {}, invalidates: ['/user?uct_token=u1'] });
  await b.transport.call('/user?uct_token=u1', { ttl: 60_000 });
  await b.transport.call('/calendar/t1/event', { ttl: 60_000 });
  assert.deepEqual(
    b.calls.slice(2).map((c) => c.path),
    ['/user?uct_token=u1', '/calendar/t1/event', '/user/member/u1/update', '/user?uct_token=u1'],
  );
});

test('une écriture refusée oublie quand même les lectures concernées', async () => {
  const b = bench();
  await b.transport.call('/calendar/t1/event', { ttl: 60_000 });
  b.answers.push(() => json({ message: 'Refusé' }, 400));
  await assert.rejects(b.transport.call('/calendar/registration', { method: 'POST', body: {}, invalidates: ['/calendar/'] }));
  await b.transport.call('/calendar/t1/event', { ttl: 60_000 });
  assert.equal(b.calls.length, 3);
});

test('un GET qui écrit (read: false) n’est ni partagé ni gardé ; un POST qui lit (read: true) l’est', async () => {
  const b = bench();
  await Promise.all([b.transport.call('/calendar/unregistered/t1', { read: false }), b.transport.call('/calendar/unregistered/t1', { read: false })]);
  assert.equal(b.calls.length, 2);
  const search = { method: 'POST', read: true, body: { query: 'dup' }, ttl: 60_000 } as const;
  await Promise.all([b.transport.call('/search/user', search), b.transport.call('/search/user', search)]);
  await b.transport.call('/search/user', search);
  assert.equal(b.calls.length, 3);
  // Autre corps, autre lecture.
  await b.transport.call('/search/user', { ...search, body: { query: 'mar' } });
  assert.equal(b.calls.length, 4);
});

test('refus du pare-feu : deux nouvelles tentatives, de plus en plus espacées', async () => {
  const b = bench();
  b.answers.push(
    () => html(429),
    () => html(403),
    () => json({ ok: true }),
  );
  assert.deepEqual(await b.transport.call('/e'), { ok: true });
  assert.equal(b.calls.length, 3);
  assert.deepEqual(
    b.sleeps.filter((ms) => ms >= 2000),
    [2000, 4000],
  );
});

test('refus du pare-feu qui dure : l’erreur dit « pare-feu » après trois essais', async () => {
  const b = bench();
  b.answers.push(
    () => html(429),
    () => html(429),
    () => html(429),
  );
  const e = await b.transport.call('/e').catch((x: unknown) => x);
  assert.equal(b.calls.length, 3);
  assert.ok(isRateLimited(e));
  assert.ok(isUnavailable(e));
  assert.ok(!isNetwork(e));
});

test('5xx sans JSON : indisponible, sans nouvelle tentative ; 403 en JSON : une vraie réponse de VPDive', async () => {
  const b = bench();
  b.answers.push(() => html(502));
  const e = await b.transport.call('/e').catch((x: unknown) => x);
  assert.ok(isUnavailable(e) && !isRateLimited(e));
  assert.equal(b.calls.length, 1);

  b.answers.push(() => json({ message: 'Accès refusé' }, 403));
  const f = await b.transport.call('/f').catch((x: unknown) => x);
  assert.ok(f instanceof Error && f.message === 'Accès refusé');
  assert.ok(!isRateLimited(f) && !isUnavailable(f));
  assert.equal(b.calls.length, 2);
});

test('réseau coupé : isNetwork', async () => {
  const t = new Transport(
    { auth: () => ({ token: 'jwt', traceability: 'uct' }), onUnauthorized: () => {} },
    { fetch: () => Promise.reject(new TypeError('Failed to fetch')), sleep: async () => {}, storage: () => null },
  );
  const e = await t.call('/e').catch((x: unknown) => x);
  assert.ok(isNetwork(e));
  assert.ok(isUnavailable(e));
});

test('session : 401 la perd (isSessionLost) ; sans session, rien ne part', async () => {
  const b = bench();
  b.answers.push(() => json({ code: 401, message: 'Expired JWT' }));
  const e = await b.transport.call('/e').catch((x: unknown) => x);
  assert.ok(isSessionLost(e));
  assert.equal(b.unauthorized, 1);

  const c = bench({ auth: null });
  assert.ok(isSessionLost(await c.transport.call('/e').catch((x: unknown) => x)));
  assert.equal(c.calls.length, 0);
});

test('priorité : un appel pressé passe devant les lectures en lot', async () => {
  const b = bench();
  const first = b.transport.call('/en-cours');
  const all = Promise.all([
    b.transport.call('/lot-1', { priority: 'low' }),
    b.transport.call('/lot-2', { priority: 'low' }),
    b.transport.call('/normal'),
    b.transport.call('/ecran', { priority: 'high' }),
  ]);
  await first;
  await all;
  assert.deepEqual(
    b.calls.map((c) => c.path),
    ['/en-cours', '/ecran', '/normal', '/lot-1', '/lot-2'],
  );
});

test('annulation : un appel encore dans la file ne part pas', async () => {
  const b = bench();
  const abort = new AbortController();
  const first = b.transport.call('/a');
  const second = b.transport.call('/b', { signal: abort.signal });
  abort.abort();
  await first;
  const e = await second.catch((x: unknown) => x);
  assert.ok(isAborted(e));
  assert.deepEqual(
    b.calls.map((c) => c.path),
    ['/a'],
  );
});

test('lecture gardée dans l’onglet (persist) : relue par une autre instance du même compte, pas d’un autre', async () => {
  const storage = memoryStorage();
  const a = bench({ storage });
  await a.transport.call('/user/settings/capacities', { ttl: 60_000, persist: true });
  assert.equal(a.calls.length, 1);

  const b = bench({ storage });
  await b.transport.call('/user/settings/capacities', { ttl: 60_000, persist: true });
  assert.equal(b.calls.length, 0);

  const other = bench({ storage, auth: { token: 'autre', traceability: 'autre-club' } });
  await other.transport.call('/user/settings/capacities', { ttl: 60_000, persist: true });
  assert.equal(other.calls.length, 1);

  // Tout oublier (déconnexion) vide aussi l'onglet.
  b.transport.clear();
  assert.equal(storage.length, 0);
});
