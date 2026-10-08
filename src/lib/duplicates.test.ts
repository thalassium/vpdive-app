import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates } from './duplicates';

const m = (id: string, name: string) => ({ id, name });
const ids = (groups: ReturnType<typeof findDuplicates>) => groups.map((g) => ({ reason: g.reason, ids: g.members.map((x) => x.id) }));

test('même nom quel que soit l’ordre, la casse et les accents', () => {
  const groups = findDuplicates([m('1', 'DUPONT Jean'), m('2', 'Martin Paul'), m('3', 'jean dupont'), m('4', 'LÉVÊQUE Hélène'), m('5', 'Helene Leveque')]);
  assert.deepEqual(ids(groups), [
    { reason: 'same', ids: ['1', '3'] },
    { reason: 'same', ids: ['4', '5'] },
  ]);
});

test('nom proche : une faute de frappe', () => {
  assert.deepEqual(ids(findDuplicates([m('1', 'DUPONT Jean'), m('2', 'DUPOND Jean'), m('3', 'Durand Marie')])), [{ reason: 'close', ids: ['1', '2'] }]);
});

test('noms courts : pas de rapprochement approximatif', () => {
  assert.deepEqual(findDuplicates([m('1', 'Li Wu'), m('2', 'Li Xu'), m('3', 'Bo Ann'), m('4', 'Bob Ann')]), []);
});

test('regroupement transitif, chaque membre une seule fois', () => {
  // A ≈ B ≈ C ≈ D, mais A et D sont à trois lettres d'écart.
  const groups = findDuplicates([m('a', 'Lambert Sophie'), m('x', 'Petit Louis'), m('b', 'Lambert Sophi'), m('c', 'Lambrt Sophi'), m('d', 'Lambrt Soph')]);
  assert.deepEqual(ids(groups), [{ reason: 'close', ids: ['a', 'b', 'c', 'd'] }]);
});

test('groupe mixte : même nom et nom proche → nom proche', () => {
  const groups = findDuplicates([m('1', 'Moreau Claude'), m('2', 'Claude MOREAU'), m('3', 'Moreau Claud')]);
  assert.deepEqual(ids(groups), [{ reason: 'close', ids: ['1', '2', '3'] }]);
});

test('aucun doublon, noms vides ignorés', () => {
  assert.deepEqual(findDuplicates([m('1', 'Dupont Jean'), m('2', 'Martin Paul'), m('3', ''), m('4', '  ')]), []);
  assert.deepEqual(findDuplicates([]), []);
});
