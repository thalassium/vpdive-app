import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myRegistration, type MaterialOption } from './vpdiveApi';

const roles = [
  { key: 'diver', label: 'Plongeur (dès 32€)' },
  { key: 'tok-dp', label: 'Directeur de plongée (0€)' },
];
const tariffs = [{ token: 'tar-1', label: 'Membre', price: 32 }];
const materials: MaterialOption[] = [
  { id: 3564, name: 'Gilet stabilisateur ', price: 3, maxQuantity: 1, choices: [] },
  { id: 3565, name: 'Combinaison', price: 3, maxQuantity: 1, choices: [{ id: 'c1', name: 'M', price: 3 }, { id: 'c2', name: 'XL', price: 3 }] },
  { id: 3569, name: 'Pack complet (hors ordinateur)', price: 10, maxQuantity: 1, choices: [] },
];

test('inscription en cours : rôle, formule et matériel tels que VPDive les liste', () => {
  // Forme relevée dans user_registered (octobre 2026)
  const r = myRegistration(
    {
      roles_token: [{ role_token: 'tok-dp', staff: true, authorized: true, token: 'x' }],
      tariff_plan_token: 'tar-1',
      people: 1,
      comment: 'Binôme souhaité : Marie',
      material: ['1 Gilet stabilisateur ', '1 Combinaison - XL', '1 Pack complet (hors ordinateur)', '1 Bloc 15L'],
    },
    roles,
    tariffs,
    materials,
  );
  assert.deepEqual(r, {
    roleKey: 'tok-dp',
    tariffToken: 'tar-1',
    people: 1,
    comment: 'Binôme souhaité : Marie',
    gear: [
      { id: 3564, choiceId: null },
      { id: 3565, choiceId: 'c2' },
      { id: 3569, choiceId: null },
    ],
  });
});

test('inscription en cours : sans rôle particulier, plongeur ; formule inconnue ignorée', () => {
  const r = myRegistration({ roles_token: [], tariff_plan_token: 'autre', material: [] }, roles, tariffs, materials);
  assert.equal(r?.roleKey, 'diver');
  assert.equal(r?.tariffToken, null);
  assert.equal(myRegistration(null, roles, tariffs, materials), null);
});
