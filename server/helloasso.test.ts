import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipItems, seasonOfForm, token } from './helloasso.js';
import { memoryStore } from './store.js';

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** HelloAsso simulé : `fetch` remplacé le temps de `run`, chaque appel noté. */
async function withHelloAsso(handler: Handler, run: (calls: { url: URL; body: string }[]) => Promise<void>) {
  const original = globalThis.fetch;
  const env = { ...process.env };
  process.env.HELLOASSO_CLIENT_ID = 'id';
  process.env.HELLOASSO_CLIENT_SECRET = 'secret';
  process.env.HELLOASSO_ORG_SLUG = 'septentrion';
  const calls: { url: URL; body: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, body: init?.body ? String(init.body) : '' });
    return handler(url, init);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    process.env = env;
  }
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenRes = (n: number) => jsonRes({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 1800 });
const tokenCalls = (calls: { url: URL; body: string }[]) => calls.filter((c) => c.url.pathname === '/oauth2/token');

test('jeton : demandé une fois, gardé le temps de sa validité (EX), puis renouvelé par le refresh token', async () => {
  let n = 0;
  await withHelloAsso(
    () => tokenRes(++n),
    async (calls) => {
      const store = memoryStore();
      assert.equal(await token(store), 'access-1');
      assert.match(tokenCalls(calls)[0]!.body, /grant_type=client_credentials/);
      const ttl = (store.state.expires['app:helloasso-token']! - Date.now()) / 1000;
      assert.ok(ttl > 1790 && ttl <= 1800, 'EX = expires_in');
      assert.equal(await token(store), 'access-1', 'servi depuis le stockage');
      assert.equal(tokenCalls(calls).length, 1);

      // Presque expiré : renouvelé avec le refresh token.
      store.state.values['app:helloasso-token'] = { access: 'access-1', refresh: 'refresh-1', expires: Date.now() + 30_000 };
      assert.equal(await token(store), 'access-2');
      assert.match(tokenCalls(calls)[1]!.body, /grant_type=refresh_token&refresh_token=refresh-1/);
      assert.equal(store.state.expires['app:helloasso-token'] !== undefined, true);
    },
  );
});

test('jeton : refresh refusé → nouvelle demande avec la clé de l’association', async () => {
  await withHelloAsso(
    (_url, init) => (String(init?.body).includes('refresh_token=') ? jsonRes({ error: 'invalid_grant' }, 400) : tokenRes(9)),
    async (calls) => {
      const store = memoryStore({ 'app:helloasso-token': { access: 'old', refresh: 'used', expires: Date.now() - 1 } });
      assert.equal(await token(store), 'access-9');
      assert.equal(tokenCalls(calls).length, 2);
    },
  );
});

test('jeton : renouvellements simultanés sérialisés, un seul appel à HelloAsso', async () => {
  let n = 0;
  await withHelloAsso(
    async () => {
      await new Promise((r) => setTimeout(r, 30));
      return tokenRes(++n);
    },
    async (calls) => {
      const store = memoryStore({ 'app:helloasso-token': { access: 'old', refresh: 'refresh-0', expires: Date.now() - 1 } });
      const got = await Promise.all([token(store), token(store), token(store)]);
      assert.deepEqual(got, ['access-1', 'access-1', 'access-1']);
      assert.equal(tokenCalls(calls).length, 1, 'le refresh token n’est consommé qu’une fois');
    },
  );
});

test('HelloAsso muet : 504 clair', async () => {
  await withHelloAsso(
    () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
    async () => {
      await assert.rejects(token(memoryStore()), (e: { status?: number; message: string }) => e.status === 504 && /ne répond pas/.test(e.message));
    },
  );
});

test('seasonOfForm : date de fin, sinon titre ou adresse, sinon date d’ouverture', () => {
  assert.equal(seasonOfForm({ endDate: '2027-08-31T00:00:00+02:00', title: 'Adhésion 2020-2021' }), 2027);
  assert.equal(seasonOfForm({ title: 'Adhésion saison 2026-2027' }), 2027);
  assert.equal(seasonOfForm({ title: 'Adhésion 2026/27' }), 2027);
  assert.equal(seasonOfForm({ title: 'Adhésion', formSlug: 'adhesion-2025-2026' }), 2026);
  assert.equal(seasonOfForm({ title: 'Adhésion 2026 - 2030' }), null, 'années non consécutives : pas une saison');
  assert.equal(seasonOfForm({ title: 'Adhésion', startDate: '2026-09-01T00:00:00' }), 2027);
  assert.equal(seasonOfForm({ title: 'Adhésion', startDate: '2027-01-15T00:00:00' }), 2027);
  assert.equal(seasonOfForm({ title: 'Adhésion' }), null);
});

test('membershipItems : pagination par continuationToken, formulaires sans date de fin, états et règle d’août', async () => {
  const item = (id: number, state: string, date: string) => ({
    id,
    name: 'Adulte',
    type: 'Membership',
    amount: 9000,
    state,
    order: { date },
    user: { firstName: ` P${id} `, lastName: 'Nom' },
    payer: { email: 'payeur@x.fr', firstName: 'Pay', lastName: 'Eur' },
    customFields: [
      { name: 'Date de naissance', answer: '05/04/1990' },
      { name: 'E-mail', answer: `p${id}@x.fr` },
    ],
  });
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line: unknown) => void lines.push(String(line));
  await withHelloAsso(
    (url) => {
      if (url.pathname === '/oauth2/token') return tokenRes(1);
      if (url.pathname.endsWith('/forms')) {
        return jsonRes({
          data: [
            { formSlug: 'adhesion-2026-2027', title: 'Adhésion 2026-2027' }, // sans endDate : titre
            { formSlug: 'adhesion-ancienne', title: 'Adhésion', endDate: '2026-08-31T00:00:00' },
            { formSlug: 'vieux', title: 'Adhésion', endDate: '2024-08-31T00:00:00' },
            { formSlug: 'mystere', title: 'Adhésion' },
          ],
          pagination: {},
        });
      }
      const page = url.searchParams.get('continuationToken');
      if (url.pathname.includes('/adhesion-2026-2027/')) {
        if (!page) return jsonRes({ data: [item(1, 'Processed', '2026-09-10T10:00:00'), item(2, 'Refunded', '2026-09-11T10:00:00')], pagination: { continuationToken: 'p2' } });
        if (page === 'p2') return jsonRes({ data: [item(3, 'Registered', '2026-10-01T10:00:00')], pagination: { continuationToken: 'p3' } });
        return jsonRes({ data: [], pagination: {} });
      }
      if (url.pathname.includes('/adhesion-ancienne/')) return jsonRes({ data: [item(4, 'Processed', '2026-08-20T10:00:00'), item(5, 'Processed', '2026-07-01T10:00:00')], pagination: {} });
      throw new Error(`appel inattendu ${url}`);
    },
    async (calls) => {
      const items = await membershipItems(memoryStore(), 2027);
      assert.deepEqual(items.map((i) => [i.id, i.formSeason, i.state]), [
        [1, 2027, 'Processed'],
        [2, 2027, 'Refunded'],
        [3, 2027, 'Registered'],
        [4, 2026, 'Processed'],
      ]);
      assert.deepEqual(
        { firstName: items[0]!.firstName, birthDate: items[0]!.birthDate, email: items[0]!.email, payerName: items[0]!.payerName },
        { firstName: 'P1', birthDate: '1990-04-05', email: 'p1@x.fr', payerName: 'Pay Eur' },
      );
      assert.ok(calls.some((c) => c.url.searchParams.get('continuationToken') === 'p2'));
      assert.ok(!calls.some((c) => c.url.pathname.includes('/vieux/')), 'formulaire d’une autre saison non lu');
    },
  );
  console.warn = warn;
  assert.ok(lines.some((l) => /mystere/.test(l) && /sans saison/.test(l)), 'formulaire sans saison signalé');
});
