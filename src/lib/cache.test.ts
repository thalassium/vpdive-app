import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStringArray, sessionCache } from './cache';
import { message } from './errors';
import { frDate, longDay, shortDay, weekdayShort, ymd } from './dates';

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

test('cache : relu tant qu’il est frais, sous la forme attendue ; oublié sur demande', () => {
  const storage = memoryStorage();
  const c = sessionCache('labels:', 60_000, isStringArray, { field: 'labels', storage: () => storage });
  assert.equal(c.read('u1'), null);
  c.write('u1', ['P4', 'E3']);
  assert.deepEqual(JSON.parse(storage.getItem('labels:u1')!).labels, ['P4', 'E3']);
  assert.deepEqual(c.read('u1'), ['P4', 'E3']);
  c.forget('u1');
  assert.equal(c.read('u1'), null);
});

test('cache : périmé, illisible ou d’une autre forme, il vaut absent', () => {
  const storage = memoryStorage();
  const c = sessionCache('labels:', 60_000, isStringArray, { field: 'labels', storage: () => storage });
  storage.setItem('labels:old', JSON.stringify({ at: Date.now() - 61_000, labels: ['P4'] }));
  storage.setItem('labels:bad', '{pas du json');
  storage.setItem('labels:shape', JSON.stringify({ at: Date.now(), labels: [1, 2] }));
  storage.setItem('labels:noat', JSON.stringify({ labels: ['P4'] }));
  for (const id of ['old', 'bad', 'shape', 'noat']) assert.equal(c.read(id), null, id);
});

test('cache sans date (field vide) : la valeur seule, sans limite de durée', () => {
  const storage = memoryStorage();
  const c = sessionCache('roster:', Infinity, isStringArray, { field: '', storage: () => storage });
  c.write('t1', ['a']);
  assert.equal(storage.getItem('roster:t1'), '["a"]');
  assert.deepEqual(c.read('t1'), ['a']);
});

test('cache : stockage interdit, rien ne casse', () => {
  const c = sessionCache('x:', 1000, isStringArray, {
    storage: () => {
      throw new Error('SecurityError');
    },
  });
  c.write('a', ['1']);
  assert.equal(c.read('a'), null);
  c.forget('a');
});

test('message d’erreur : le message, sinon le texte de repli, sinon l’erreur en texte', () => {
  assert.equal(message(new Error('VPDive injoignable')), 'VPDive injoignable');
  assert.equal(message('brut'), 'brut');
  assert.equal(message(new Error(''), 'Connexion impossible.'), 'Connexion impossible.');
  assert.equal(message(42, 'repli'), 'repli');
});

test('dates : jj/mm/aaaa, jour court et long, jour de la semaine', () => {
  assert.equal(frDate('2026-10-10'), '10/10/2026');
  assert.equal(frDate('2026-10-10T08:15:00+02:00'), '10/10/2026');
  assert.equal(frDate(''), '');
  assert.equal(ymd(new Date(2026, 9, 3)), '2026-10-03');
  assert.equal(weekdayShort(new Date(2026, 9, 11)), 'Dim.');
  assert.equal(weekdayShort(new Date(2026, 9, 12)), 'Lun.');
  assert.match(shortDay('2026-10-10'), /^sam\. 10 oct\.$/);
  assert.match(longDay('2026-10-10'), /^samedi 10 octobre$/);
});
