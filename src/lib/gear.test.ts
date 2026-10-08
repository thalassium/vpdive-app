import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeComment, parseComment, sizedKinds } from './gear';

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

test('modifier son inscription : le message enregistré redonne commentaire, tailles et binôme', () => {
  const sent = composeComment('Je ramène les croissants\net le café', [{ label: 'Combinaison', size: '2XL' }, { label: 'Gilet stabilisateur', size: 'S' }], 'Jean DUPONT');
  assert.deepEqual(parseComment(sent), { comment: 'Je ramène les croissants\net le café', sizes: { wetsuit: '2XL', bcd: 'S' }, buddy: 'Jean DUPONT', bottle: '12 L' });
  // Bouteille : rien d'écrit pour 12 L (défaut), une ligne sinon, relue à l'identique.
  const fifteen = composeComment('', [], null, '15 L');
  assert.equal(fifteen, 'Bouteille : 15 L');
  assert.equal(parseComment(fifteen).bottle, '15 L');
  assert.equal(parseComment(composeComment('', [], null, 'Enfant (8/10 L)')).bottle, 'Enfant (8/10 L)');
  assert.deepEqual(parseComment('Taille gilet stabilisateur : L'), { comment: '', sizes: { bcd: 'L' }, buddy: '', bottle: '12 L' });
  // Un message écrit sur VPDive, sans nos lignes, reste tel quel
  assert.deepEqual(parseComment('Taille : je verrai sur place'), { comment: 'Taille : je verrai sur place', sizes: {}, buddy: '', bottle: '12 L' });
});
