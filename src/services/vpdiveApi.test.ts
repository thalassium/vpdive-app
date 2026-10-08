import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentsOf, myRegistration, type MaterialOption } from './vpdiveApi';

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

test('documents de la fiche membre : certificat, licences, documents par type et partagés ; pas les icônes génériques', () => {
  const docs = documentsOf({
    medical_examination: '2026-11-24T00:00:00+01:00',
    file_medical_examination: { link: '/uploads/documents/med', name: 'certif.pdf', type: 'application', path: '/files/images/file_formats/pdf.png' },
    user_licence: [{ id: 7, licence: 'A-19-1', organization: { name: 'FFESSM' } }],
    file_licence: { 7: { link: '/uploads/documents/lic', name: 'licence.jpg', type: 'image' } },
    type_document: { 1: { name: 'adhésion payée', fileName: 'fiche.pdf', filePath: '/uploads/documents/adh', fileType: 'application/pdf' }, 2: { name: 'vide', filePath: null } },
    document_shared: [{ comment: 'Nitrox confirmé', document_file: 'n.pdf', document_link: '/uploads/documents/nx', userClubDocuments: { name: 'carte niveau' } }],
  });
  assert.deepEqual(
    docs.map((d) => [d.label, d.detail, d.kind]),
    [
      ['Certificat médical', 'valable jusqu’au 24/11/2026', 'pdf'],
      ['Licence FFESSM', 'A-19-1', 'image'],
      ['Adhésion payée', 'fiche.pdf', 'pdf'],
      ['Carte niveau', 'Nitrox confirmé', 'pdf'],
    ],
  );
  assert.ok(docs.every((d) => d.url.startsWith('https://septentrion-env.vpdive.com/uploads/documents/')));
});
