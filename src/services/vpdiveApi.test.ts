import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentsOf, infoOf, myRegistration, type MaterialOption } from './vpdiveApi';

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

test('mes infos : contact, naissance, adhésion et licences lus sur la fiche membre', () => {
  const info = infoOf({
    civility: 'mr', first_name: 'Jean', last_name: 'Dupont', name_of_birth: 'Dupont', email: 'jean@example.org', phone: '0601020304',
    address: '1 quai du Port', zip_code: '13008', city: 'Marseille', country: 'FR',
    birthday: '1985-04-12T00:00:00+02:00', city_of_birth: 'Lyon', zip_code_of_birth: '69001', country_of_birth: 'FR',
    insurance: 'Loisir 1', insurance_year: 2026, honorability_authorized_at: '2025-09-01T00:00:00+02:00',
    user_club_traceability: { dateConfirmation: '2024-09-10T10:00:00+02:00', yearsConfirmation: ['2025', '2026'], phone_show: true, birthday_show: false },
    licenses: [{ number: 'A-19-1', organization: { name: 'FFESSM' }, expiration_date: null, is_expired: false, status: 'validated' }],
  });
  assert.equal(info.civility, 'M.');
  assert.equal(info.country, 'France');
  assert.equal(info.birthday, '1985-04-12');
  assert.equal(info.birthPlace, 'Lyon (69001), France');
  assert.equal(info.memberSince, '2024-09-10');
  assert.deepEqual(info.seasons, ['2026', '2025']);
  assert.deepEqual(info.licences, [{ number: 'A-19-1', organization: 'FFESSM', expires: '', expired: false, validated: true }]);
  assert.deepEqual(info.shows, { phone: true, birthday: false });
});
