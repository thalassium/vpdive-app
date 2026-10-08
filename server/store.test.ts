import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore, globToRegExp } from './store.js';

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
