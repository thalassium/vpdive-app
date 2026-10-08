import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forget, identify } from './auth.js';

/** VPDive simulé : répond à /user/me et /user/traceability, compte les appels. */
function fakeVpdive() {
  const calls: string[] = [];
  const fetchFake = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = url.endsWith('/user/me')
      ? { id: 7, email: 'Ann@Club.fr', first_name: 'Ann', last_name: 'Onyme' }
      : { userClubTraceability: 'uct-'.padEnd(24, 'x'), club: { id: 12 }, permissions: { member_view: true } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetch: fetchFake as unknown as typeof fetch };
}

const request = (token: string) => new Request('http://localhost/api/app?action=me', { headers: { authorization: `Bearer ${token}` } });

test('identify : mis en cache 5 min ; forget() force une nouvelle vérification auprès de VPDive', async () => {
  const original = globalThis.fetch;
  const fake = fakeVpdive();
  globalThis.fetch = fake.fetch;
  try {
    const first = await identify(request('tok-1'));
    assert.equal(first.id, 7);
    assert.equal(first.email, 'ann@club.fr');
    assert.equal(first.clubId, '12');
    assert.equal(first.vpdiveAdmin, true);
    assert.equal(fake.calls.length, 2, 'me + traceability');

    await identify(request('tok-1'));
    assert.equal(fake.calls.length, 2, 'servi depuis le cache');

    forget('Bearer tok-1');
    await identify(request('tok-1'));
    assert.equal(fake.calls.length, 4, 'revérifié après forget');

    forget('Bearer inconnu'); // sans effet, sans erreur
    await identify(request('tok-1'));
    assert.equal(fake.calls.length, 4);
  } finally {
    globalThis.fetch = original;
    forget('Bearer tok-1');
  }
});
