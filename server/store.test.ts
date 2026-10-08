import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp } from './store.js';

test('globToRegExp : motif à étoiles, le reste pris à la lettre', () => {
  const re = globToRegExp('club:*:chat*');
  for (const k of ['club:12:chat:abc', 'club:12:chat-inbox:u', 'club:12:chat-read:u', 'club:12:chat-direct:a|b']) assert.ok(re.test(k), k);
  for (const k of ['club:12:roles', 'club:12:outing:ev', 'club:12:docs-ignored', 'app:chat-purged-v1']) assert.ok(!re.test(k), k);
  assert.ok(globToRegExp('a.b*').test('a.bc'));
  assert.ok(!globToRegExp('a.b*').test('axbc'));
});
