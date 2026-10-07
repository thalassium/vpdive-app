import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeComment, sizedKinds } from './gear';

test('combinaisons, gilets et packs reconnus à leur nom', () => {
  // Matériel de location du club, relevé dans VPDive (octobre 2026)
  assert.deepEqual(sizedKinds('Gilet stabilisateur'), ['bcd']);
  assert.deepEqual(sizedKinds('Combinaison'), ['wetsuit']);
  assert.deepEqual(sizedKinds('Pack complet (hors ordinateur)'), ['wetsuit', 'bcd']);
  assert.deepEqual(sizedKinds('Détendeur'), []);
  assert.deepEqual(sizedKinds('Palme, masque, tuba'), []);
  assert.deepEqual(sizedKinds('Ordinateur de plongée'), []);
  // Autres noms possibles
  assert.deepEqual(sizedKinds('Combi 7mm'), ['wetsuit']);
  assert.deepEqual(sizedKinds('Shorty'), ['wetsuit']);
  assert.deepEqual(sizedKinds('Stab'), ['bcd']);
  assert.deepEqual(sizedKinds('BCD'), ['bcd']);
  assert.deepEqual(sizedKinds('Bloc 12L'), []);
});

test('message au club : commentaire, tailles, binôme', () => {
  assert.equal(
    composeComment('Je ramène les croissants', [{ label: 'Combinaison', size: 'M' }, { label: 'Gilet stabilisateur', size: 'L' }], 'Jean DUPONT'),
    'Je ramène les croissants\nTaille combinaison : M · Taille gilet stabilisateur : L\nBinôme souhaité : Jean DUPONT',
  );
  assert.equal(composeComment('  ', [], null), '');
  assert.equal(composeComment('', [], '  Marie '), 'Binôme souhaité : Marie');
});
