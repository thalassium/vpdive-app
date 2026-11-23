import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from './auth.js';
import { memoryStore } from './store.js';
import { handleWith } from './handler.js';
import { MAX_DRAWS_PER_DAY, drawPairs, parseDrawInput, santa, type SantaDraw, type SantaStatus } from './santa.js';

const NAMES = ['Lucas', 'Anna', 'Bob', 'Chloé', 'David', 'Emma'];

const status = async (store: ReturnType<typeof memoryStore>, body: Record<string, unknown>) => (await santa(store, body)) as SantaStatus;
const fails = (status: number) => (e: unknown) => e instanceof HttpError && e.status === status;
/** Les paires, lues dans le stockage (aucune réponse de l'API ne les donne en bloc). */
const pairsOf = (store: ReturnType<typeof memoryStore>, key: string) => {
  const d = store.state.values[`santa:draw:${key}`] as SantaDraw;
  return d.people.map((p) => [p.name, d.people[p.to]!.name] as const);
};

test('drawPairs : personne ne se tire soi-même, chacun reçoit une fois, les interdits sont respectés', () => {
  const n = 8;
  // 0-1, 2-3 et 4-5 en couple.
  const couple = (i: number, j: number) => Math.floor(i / 2) === Math.floor(j / 2) && Math.max(i, j) < 6;
  const allowed = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i !== j && !couple(i, j)));
  for (let run = 0; run < 200; run++) {
    const to = drawPairs(allowed)!;
    assert.deepEqual([...to].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    to.forEach((j, i) => assert.ok(allowed[i]![j], `${i} → ${j}`));
  }
});

test('drawPairs : une seule solution possible est trouvée, aucune solution rend null', () => {
  // Seul le cycle 0 → 1 → 2 → 3 → 4 → 5 → 0 est permis : introuvable au hasard, trouvé par couplage.
  const n = 6;
  const cycle = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => j === (i + 1) % n));
  assert.deepEqual(drawPairs(cycle), [1, 2, 3, 4, 5, 0]);
  // 0 et 1 ne peuvent offrir qu'à 2.
  const stuck = [
    [false, false, true],
    [false, false, true],
    [true, true, false],
  ];
  assert.equal(drawPairs(stuck), null);
});

test('parseDrawInput : noms nettoyés, doublons refusés, paires dédoublonnées', () => {
  const ok = parseDrawInput({ title: ' Noël ', names: [' Lucas ', 'Anna', '', 'Bob  Marley'], exclusions: [['lucas', 'ANNA'], ['Anna', 'Lucas'], ['Anna', 'Anna']] });
  assert.deepEqual(ok, { title: 'Noël', names: ['Lucas', 'Anna', 'Bob Marley'], exclusions: [['Lucas', 'Anna']] });
  assert.throws(() => parseDrawInput({ names: ['A', 'B'] }), fails(400), 'moins de 3');
  assert.throws(() => parseDrawInput({ names: ['Anna', 'anna', 'Bob'] }), fails(400), 'doublon');
  assert.throws(() => parseDrawInput({ names: NAMES, exclusions: [['Lucas', 'Zoé']] }), fails(400), 'inconnu');
});

test('tirage : la page de suivi ne reçoit pas les paires, et les interdits sont respectés', async () => {
  const store = memoryStore();
  const s = await status(store, { op: 'draw', title: 'Noël', names: NAMES, exclusions: [['Lucas', 'Anna'], ['Bob', 'Chloé']] });
  assert.equal(s.people.length, 6);
  assert.ok(s.people.every((p) => Object.keys(p).sort().join() === 'name,openedAt,token' && p.openedAt === null));
  for (const [from, to] of pairsOf(store, s.key)) {
    assert.notEqual(from, to);
    assert.ok(![['Lucas', 'Anna'], ['Anna', 'Lucas'], ['Bob', 'Chloé'], ['Chloé', 'Bob']].some(([a, b]) => a === from && b === to), `${from} → ${to}`);
  }
  assert.deepEqual(await santa(store, { op: 'status', key: s.key }), s);
  await assert.rejects(santa(store, { op: 'status', key: 'x'.repeat(22) }), fails(404));
  await assert.rejects(santa(store, { op: 'status', key: '../roles' }), fails(404));
});

test('lien : s’ouvre une seule fois, puis 410 ; le suivi montre qui a ouvert', async () => {
  const store = memoryStore();
  const s = await status(store, { op: 'draw', names: NAMES });
  const lucas = s.people[0]!;
  assert.deepEqual(await santa(store, { op: 'peek', token: lucas.token }), { name: 'Lucas', title: '', opened: false });
  // Regarder le lien ne l'ouvre pas (aperçu WhatsApp, page chargée sans appuyer).
  assert.deepEqual(await santa(store, { op: 'peek', token: lucas.token }), { name: 'Lucas', title: '', opened: false });

  const expected = pairsOf(store, s.key).find(([from]) => from === 'Lucas')![1];
  assert.deepEqual(await santa(store, { op: 'reveal', token: lucas.token }), { name: 'Lucas', title: '', to: expected });
  await assert.rejects(santa(store, { op: 'reveal', token: lucas.token }), fails(410));
  assert.deepEqual(await santa(store, { op: 'peek', token: lucas.token }), { name: 'Lucas', title: '', opened: true });

  const after = await status(store, { op: 'status', key: s.key });
  assert.deepEqual(after.people.map((p) => !!p.openedAt), [true, false, false, false, false, false]);
  await assert.rejects(santa(store, { op: 'reveal', token: 'y'.repeat(22) }), fails(404));
});

test('lien : deux ouvertures en même temps, une seule passe', async () => {
  const store = memoryStore();
  const s = await status(store, { op: 'draw', names: NAMES });
  const token = s.people[2]!.token;
  const results = await Promise.allSettled([santa(store, { op: 'reveal', token }), santa(store, { op: 'reveal', token })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(fails(410)((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason));
});

test('nouveau lien : l’ancien meurt, le nouveau montre la même personne', async () => {
  const store = memoryStore();
  const s = await status(store, { op: 'draw', names: NAMES });
  const old = s.people[1]!.token;
  const first = (await santa(store, { op: 'reveal', token: old })) as { to: string };
  const renewed = await status(store, { op: 'renew', key: s.key, name: 'Anna' });
  const token = renewed.people[1]!.token;
  assert.notEqual(token, old);
  assert.equal(renewed.people[1]!.openedAt, null);
  assert.deepEqual(renewed.people.filter((_, i) => i !== 1), s.people.filter((_, i) => i !== 1), 'les autres liens ne bougent pas');
  await assert.rejects(santa(store, { op: 'peek', token: old }), fails(404));
  assert.equal(((await santa(store, { op: 'reveal', token })) as { to: string }).to, first.to);
});

test('nouveau tirage avec la même clé : les anciens liens meurent ; clé inconnue refusée', async () => {
  const store = memoryStore();
  const s = await status(store, { op: 'draw', names: NAMES });
  const again = await status(store, { op: 'draw', key: s.key, names: ['Lucas', 'Anna', 'Bob'] });
  assert.equal(again.key, s.key);
  assert.equal(again.people.length, 3);
  for (const p of s.people) await assert.rejects(santa(store, { op: 'peek', token: p.token }), fails(404));
  assert.equal(Object.keys(store.state.values).filter((k) => k.startsWith('santa:link:')).length, 3);
  await assert.rejects(santa(store, { op: 'draw', key: 'z'.repeat(22), names: NAMES }), fails(404));
});

test('tirage impossible : 422, rien n’est écrit', async () => {
  const store = memoryStore();
  await assert.rejects(santa(store, { op: 'draw', names: ['A', 'B', 'C'], exclusions: [['A', 'B'], ['A', 'C']] }), fails(422));
  assert.deepEqual(Object.keys(store.state.values), []);
});

test('plafond de tirages créés par jour', async () => {
  const store = memoryStore();
  const now = new Date('2026-12-01T10:00:00Z');
  for (let i = 0; i < MAX_DRAWS_PER_DAY; i++) await santa(store, { op: 'draw', names: NAMES }, now);
  await assert.rejects(santa(store, { op: 'draw', names: NAMES }, now), fails(429));
  await santa(store, { op: 'draw', names: NAMES }, new Date('2026-12-02T10:00:00Z'));
});

test('action=santa : publique, sans identification VPDive', async () => {
  const store = memoryStore();
  const deps = {
    identify: async () => {
      throw new HttpError(401, 'Session expirée.');
    },
    isDpOf: async () => false,
    store: () => store,
  };
  const post = (body: unknown) => handleWith(new Request('http://localhost/api/app?action=santa', { method: 'POST', body: JSON.stringify(body) }), deps);
  const res = await post({ op: 'draw', names: NAMES });
  assert.equal(res.status, 200);
  const s = (await res.json()) as SantaStatus;
  assert.equal((await post({ op: 'reveal', token: s.people[0]!.token })).status, 200);
  assert.equal((await post({ op: 'reveal', token: s.people[0]!.token })).status, 410);
  assert.equal((await handleWith(new Request('http://localhost/api/app?action=santa'), deps)).status, 405);
  assert.equal((await handleWith(new Request('http://localhost/api/app?action=me'), deps)).status, 401, 'le reste demande toujours une session');
});
