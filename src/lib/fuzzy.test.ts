import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editDistance, nameScore, rankByName, sameName, searchFragments } from './fuzzy';

const members = ['DUPONT Jean', 'Dupuis Jeanne', 'Martin Sébastien', 'Lefèvre Anne-Sophie', 'Duval Jean-Marc', 'Nguyen Thi'];

test('distance d’édition, inversion de lettres comprise', () => {
  assert.equal(editDistance('dupont', 'dupont'), 0);
  assert.equal(editDistance('dupond', 'dupont'), 1);
  assert.equal(editDistance('nugyen', 'nguyen'), 1);
});

test('le membre le plus proche de l’orthographe tapée arrive en premier', () => {
  const best = (typed: string) => rankByName(typed, members, (m) => m)[0]?.item;
  assert.equal(best('jean dupond'), 'DUPONT Jean');
  assert.equal(best('Dupont Jean'), 'DUPONT Jean');
  assert.equal(best('jeanne dupuy'), 'Dupuis Jeanne');
  assert.equal(best('sebastien martn'), 'Martin Sébastien');
  assert.equal(best('Seb Martin'), 'Martin Sébastien');
  assert.equal(best('anne sophie lefevre'), 'Lefèvre Anne-Sophie');
  assert.equal(best('thi nugyen'), 'Nguyen Thi');
});

test('rien ne ressort pour un nom sans rapport', () => {
  assert.deepEqual(rankByName('Zorglub Xavier', members, (m) => m), []);
  assert.ok(nameScore('', 'Dupont') === 0);
});

test('fragments de recherche envoyés à VPDive', () => {
  assert.deepEqual(searchFragments('Jean Dupond'), ['jean', 'dupond', 'dup']);
  assert.deepEqual(searchFragments('  Élodie  '), ['elodie', 'elo']);
});

test('même personne quel que soit l’ordre prénom/nom, la casse et les accents', () => {
  assert.ok(sameName('DUPONT Jean', 'Jean Dupont'));
  assert.ok(sameName('LÉVÊQUE Hélène', 'helene leveque'));
  assert.ok(!sameName('DUPONT Jean', 'DUPONT Jeanne'));
  assert.ok(!sameName('', ''));
});
