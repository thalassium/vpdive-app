import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, globToRegExp, memoryStore } from './store.js';

test('globToRegExp : motif à étoiles, le reste pris à la lettre', () => {
  const re = globToRegExp('club:*:chat*');
  for (const k of ['club:12:chat:abc', 'club:12:chat-inbox:u', 'club:12:chat-read:u', 'club:12:chat-direct:a|b']) assert.ok(re.test(k), k);
  for (const k of ['club:12:roles', 'club:12:outing:ev', 'club:12:docs-ignored', 'app:chat-purged-v1', 'club:12:outing:ev:lock']) assert.ok(!re.test(k), k);
  assert.ok(globToRegExp('a.b*').test('a.bc'));
  assert.ok(!globToRegExp('a.b*').test('axbc'));
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('fileStore.lock : pris une fois, refusé ensuite, libre après unlock', async () => {
  const store = fileStore(join(tmpdir(), 'never-written.json'));
  assert.equal(await store.lock('k', 1000), true);
  assert.equal(await store.lock('k', 1000), false, 'tenu par le premier');
  assert.equal(await store.lock('autre', 1000), true, 'un autre verrou est indépendant');
  await store.unlock('k');
  assert.equal(await store.lock('k', 1000), true, 'libre après unlock');
});

test('fileStore.lock : expire de lui-même après la durée de vie', async () => {
  const store = fileStore(join(tmpdir(), 'never-written.json'));
  assert.equal(await store.lock('k', 20), true);
  assert.equal(await store.lock('k', 20), false);
  await sleep(35);
  assert.equal(await store.lock('k', 20), true, 'repris après expiration');
});

test('fileStore : get/set/deleteMatching dans un fichier temporaire', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vpdive-store-'));
  try {
    const store = fileStore(join(dir, 'sub', 'store.json'));
    assert.equal(await store.get('absent'), null);
    await store.set('club:1:roles', { version: 2 });
    await store.set('club:1:chat:x', 1);
    assert.deepEqual(await store.get('club:1:roles'), { version: 2 });
    assert.equal(await store.deleteMatching('club:*:chat*'), 1);
    assert.equal(await store.get('club:1:chat:x'), null);
    assert.deepEqual(await store.get('club:1:roles'), { version: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('expiration : la clé disparaît après EX ; un SET sans EX lève l’expiration', async () => {
  const store = memoryStore();
  await store.set('a', 1, { ex: 0.02 });
  await store.set('b', 2, { ex: 0.02 });
  await store.set('b', 3);
  assert.equal(await store.get('a'), 1);
  await sleep(35);
  assert.equal(await store.get('a'), null, 'expirée');
  assert.equal(await store.get('b'), 3, 'réécrite sans EX : gardée');
  assert.deepEqual(await store.keys('*'), ['b']);
});

test('listes : LPUSH + LTRIM, LRANGE avec indices négatifs, LTRIM depuis la fin', async () => {
  const store = memoryStore();
  for (let i = 1; i <= 5; i++) await store.listPush('l', i, { max: 4, ex: 60 });
  assert.deepEqual(await store.listRange('l', 0, -1), [5, 4, 3, 2], 'plus récent en tête, 4 au plus');
  assert.deepEqual(await store.listRange('l', -2, -1), [3, 2], 'les plus anciens');
  assert.deepEqual(await store.listRange('l', 0, 99), [5, 4, 3, 2]);
  await store.listTrim('l', 0, -2);
  assert.deepEqual(await store.listRange('l', 0, -1), [5, 4, 3]);
  await store.listTrim('l', 0, -4);
  assert.deepEqual(await store.listRange('l', 0, -1), []);
  assert.deepEqual(await store.keys('*'), [], 'liste vidée : clé retirée');
});

test('export / import : valeurs, listes et durée de vie restante ; fichier relu à l’identique', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vpdive-store-'));
  try {
    const store = fileStore(join(dir, 'store.json'));
    await store.set('club:1:roles', { version: 2 });
    await store.set('club:1:outing:e', { rev: 1 }, { ex: 3600 });
    await store.listPush('club:1:log', { n: 1 }, { max: 10 });
    await store.listPush('club:1:log', { n: 2 }, { max: 10 });
    await store.set('app:helloasso-token', { access: 'x' });
    const dump = await store.exportEntries('club:*');
    assert.deepEqual(Object.keys(dump).sort(), ['club:1:log', 'club:1:outing:e', 'club:1:roles']);
    assert.deepEqual(dump['club:1:log'], { type: 'list', items: [{ n: 2 }, { n: 1 }] });
    assert.equal(dump['club:1:outing:e']?.type, 'value');
    assert.ok((dump['club:1:outing:e']?.ttl ?? 0) > 3590);

    const copy = memoryStore();
    for (const [k, e] of Object.entries(dump)) await copy.importEntry(k, e);
    assert.deepEqual(await copy.listRange('club:1:log', 0, -1), [{ n: 2 }, { n: 1 }]);
    assert.deepEqual(await copy.get('club:1:roles'), { version: 2 });
    assert.ok(copy.state.expires['club:1:outing:e']! > Date.now() + 3_500_000);

    // Le fichier garde ses valeurs à plat (compatible avec l'ancien format).
    const again = fileStore(join(dir, 'store.json'));
    assert.deepEqual(await again.listRange('club:1:log', 0, 0), [{ n: 2 }]);
    await again.del('club:1:log');
    assert.deepEqual((await again.keys('club:*')).sort(), ['club:1:outing:e', 'club:1:roles']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
