import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from './auth.js';
import { decideRegistration, legacyTiming, registrationRequests } from './legacy.js';

const ORIGIN = 'https://septentrion-env.vpdive.com';
const TOKEN = 'tok'.padEnd(40, 'x');
const OTHER_TOKEN = 'autre'.padEnd(40, 'y');

const caller: Caller = { id: 1, uct: 'uct'.padEnd(24, 'x'), email: 'a@x.fr', name: 'A', clubId: '12', vpdiveAdmin: true, headers: { Authorization: 'Bearer jwt' } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (status = 200, headers: Record<string, string> = {}) => new Response('<html></html>', { status, headers: { 'content-type': 'text/html', ...headers } });
const row = (token: string) => ({
  actions: `<a href="/f/user/accept/${token}/1">Accepter</a> <a href="/f/user/refuse/${token}">Refuser</a>`,
  name: '<b>MARTIN</b> L&#039;éa',
  infos: 'lea@x.fr<br/>06 00 00 00 00',
  picture: '<img src="/uploads/lea.jpg">',
  status: '<i title="Le membre est en attente de votre réponse"></i>',
});

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** VPDive (interface historique) simulé : les routes par défaut ouvrent une session et listent `pending`. */
async function withVpdive(over: Record<string, Route>, run: (calls: { url: URL; init?: RequestInit; at: number }[], pending: Set<string>) => Promise<void>, gapMs = 0) {
  const pending = new Set([TOKEN, OTHER_TOKEN]);
  const routes: Record<string, Route> = {
    '/api/jwt-to-connect-token': () => json({ connect_url: '/connect/abc' }),
    '/connect/abc': () => html(302, { location: '/f/user/index/3', 'set-cookie': 'PHPSESSID=s1; Path=/; HttpOnly' }),
    '/f/user/index/3': () => html(200, { 'set-cookie': 'REMEMBER=r1; Path=/' }),
    '/f/user/datatable': () => json({ data: [...pending].map(row) }),
    ...over,
  };
  const calls: { url: URL; init?: RequestInit; at: number }[] = [];
  const original = globalThis.fetch;
  const gap = legacyTiming.gapMs;
  legacyTiming.gapMs = gapMs;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init, at: Date.now() });
    if (url.origin !== ORIGIN) throw new Error(`site inattendu : ${url.origin}`);
    const accept = /^\/f\/user\/(accept|refuse)\/([\w-]+)/.exec(url.pathname);
    if (accept && !over[url.pathname]) {
      pending.delete(accept[2]!);
      return html(302, { location: '/f/user/index/3' });
    }
    const route = over[url.pathname] ?? routes[url.pathname];
    if (!route) throw new Error(`route inattendue : ${url.pathname}`);
    return route(url, init);
  }) as typeof fetch;
  try {
    await run(calls, pending);
  } finally {
    globalThis.fetch = original;
    legacyTiming.gapMs = gap;
  }
}

const status = (code: number, re?: RegExp) => (e: unknown) => (e as { status?: number }).status === code && (!re || re.test((e as Error).message));

test('demandes d’inscription : session ouverte (redirections, cookies), tableau lu et nettoyé', async () => {
  await withVpdive({}, async (calls) => {
    const list = await registrationRequests(caller);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], {
      token: TOKEN,
      name: 'MARTIN L’éa',
      contact: 'lea@x.fr · 06 00 00 00 00',
      picture: `${ORIGIN}/uploads/lea.jpg`,
      status: 'Le membre est en attente de votre réponse',
    });
    const first = calls[0]!;
    assert.equal(first.url.pathname, '/api/jwt-to-connect-token');
    assert.equal((first.init?.headers as Record<string, string>).Authorization, 'Bearer jwt', 'jeton de l’admin');
    const table = calls.find((c) => c.url.pathname === '/f/user/datatable')!;
    assert.equal((table.init?.headers as Record<string, string>).Cookie, 'PHPSESSID=s1; REMEMBER=r1');
    assert.equal(table.url.searchParams.get('enabled'), '3');
  });
});

test('redirection vers un autre site : refusée, jamais suivie', async () => {
  await withVpdive({ '/connect/abc': () => html(302, { location: 'https://evil.example/steal', 'set-cookie': 'PHPSESSID=s1' }) }, async (calls) => {
    await assert.rejects(registrationRequests(caller), status(502, /autre site/));
    assert.ok(!calls.some((c) => c.url.hostname === 'evil.example'));
  });
  await withVpdive({ '/api/jwt-to-connect-token': () => json({ data: { connect_url: 'https://septentrion-env.vpdive.com.evil.example/connect' } }) }, async (calls) => {
    await assert.rejects(registrationRequests(caller), status(502, /autre site/));
    assert.equal(calls.length, 1);
  });
});

test('erreurs : session expirée 401, pare-feu 429, délai dépassé 504, droits manquants 403, pas de session 502', async () => {
  await withVpdive({ '/api/jwt-to-connect-token': () => json({ code: 401 }, 401) }, async () => {
    await assert.rejects(registrationRequests(caller), status(401));
  });
  await withVpdive({ '/api/jwt-to-connect-token': () => html(403) }, async () => {
    await assert.rejects(registrationRequests(caller), status(429, /pare-feu/));
  });
  await withVpdive({ '/api/jwt-to-connect-token': () => html(200) }, async () => {
    await assert.rejects(registrationRequests(caller), status(429), 'page HTML à la place du JSON');
  });
  await withVpdive({ '/f/user/datatable': () => json({ message: 'Too Many Requests' }, 429) }, async () => {
    await assert.rejects(registrationRequests(caller), status(429));
  });
  await withVpdive({ '/f/user/datatable': () => html(302, { location: '/login' }) }, async () => {
    await assert.rejects(registrationRequests(caller), status(403, /member_edit/));
  });
  await withVpdive({ '/api/jwt-to-connect-token': () => json({}) }, async () => {
    await assert.rejects(registrationRequests(caller), status(502));
  });
  await withVpdive(
    {
      '/f/user/datatable': () => {
        throw new DOMException('timeout', 'TimeoutError');
      },
    },
    async () => {
      await assert.rejects(registrationRequests(caller), status(504, /VPDive ne répond pas/));
    },
  );
  await withVpdive(
    {
      '/api/jwt-to-connect-token': () => {
        throw new TypeError('fetch failed');
      },
    },
    async () => {
      await assert.rejects(registrationRequests(caller), status(502, /injoignable/));
    },
  );
});

test('décision : accepter comme membre, relire ; demande déjà traitée 409 ; décision ignorée 502', async () => {
  await withVpdive({}, async (calls, pending) => {
    const after = await decideRegistration(caller, TOKEN, 'member');
    assert.deepEqual(after.map((r) => r.token), [OTHER_TOKEN]);
    assert.ok(calls.some((c) => c.url.pathname === `/f/user/accept/${TOKEN}/1`));
    assert.ok(!pending.has(TOKEN));
    await assert.rejects(decideRegistration(caller, TOKEN, 'refuse'), status(409));
    await decideRegistration(caller, OTHER_TOKEN, 'guest');
    assert.ok(calls.some((c) => c.url.pathname === `/f/user/accept/${OTHER_TOKEN}/0`));
  });
  await withVpdive({ [`/f/user/refuse/${TOKEN}`]: () => html(302, { location: '/f/user/index/3' }) }, async () => {
    await assert.rejects(decideRegistration(caller, TOKEN, 'refuse'), status(502, /toujours en attente/));
  });
  await assert.rejects(decideRegistration(caller, '../../x', 'member'), status(400));
});

test('appels enchaînés espacés (pare-feu)', async () => {
  await withVpdive(
    {},
    async (calls) => {
      await registrationRequests(caller);
      assert.equal(calls.length, 4);
      for (let i = 1; i < calls.length; i++) assert.ok(calls[i]!.at - calls[i - 1]!.at >= 45, `pause avant l’appel ${i}`);
    },
    50,
  );
});
