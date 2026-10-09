import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentsOf, infoOf, profileOf } from './members';
import { mapDetail, mapEvent, myRegistration, rosterFrom, type MaterialOption } from './calendar';

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
    waitingList: false,
  });
});

test('inscription en cours : sur liste d’attente', () => {
  const r = myRegistration({ roles_token: [], tariff_plan_token: 'tar-1', material: [], waitingList: true }, roles, tariffs, materials);
  assert.equal(r?.waitingList, true);
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

// Exemples synthétiques, de la forme des réponses relevées par `npm run probe` (aucune donnée réelle).

test('sortie de l’agenda : jeton sous `id`, libellés remis en français, jauge et liste d’attente', () => {
  const e = mapEvent({
    id: 'ev-1',
    title: 'Sortie épave',
    fromDate: '2026-10-10 08:15:00',
    toDate: '2026-10-10T12:00:00+02:00',
    location: 'Port',
    activity: { token: 'a1', name: 'diving leisure' },
    type: { token: 't1', name: 'outing' },
    registered: true,
    registration: true,
    can_registered: { allow: true },
    nbr_registered: { all: 12, has_limit: true, max_participants: 14, available_spots: 2, has_waiting_list: true, waiting_list_count: 3 },
  });
  assert.ok(e);
  assert.equal(e.token, 'ev-1');
  assert.equal(e.start, '2026-10-10T08:15:00');
  assert.equal(e.activity?.name, 'Plongée loisir');
  assert.equal(e.type?.name, 'Sortie');
  assert.equal(e.registrationOpen, true);
  assert.equal(e.maxParticipants, 14);
  assert.equal(e.availableSpots, 2);
  assert.equal(e.waitingListCount, 3);
  assert.equal(e.cancelled, false);
  assert.equal(e.color, '#0a2747');
});

test('sortie de l’agenda : annulée d’après le titre ; sans jeton, ignorée', () => {
  assert.equal(mapEvent({ id: 'ev-2', title: '[ANNULÉE] Sortie', fromDate: '', toDate: '' })?.cancelled, true);
  assert.equal(mapEvent({ title: 'Sans jeton' }), null);
  assert.equal(mapEvent(null), null);
});

test('détail d’une sortie : formules, rôles, matériel (tailles), refus et mon panier', () => {
  const d = mapDetail(
    'ev-1',
    {
      tariff_plans: { 'tar-1': 'Membre' },
      price: { 'tar-1': '32.00' },
      available_roles: { diver: 'Plongeur', 'tok-dp': 'Directeur de plongée' },
      list_material: [
        { '10': { obj: { id: 10, name: 'Gilet' }, tariff: '3.00', max_selectable_quantity: 1 } },
        { '11': { obj: { id: 11, name: 'Combinaison' }, tariff: '3.00', choices: [{ c1: { obj: { name: 'M' }, tariff: '3.00' } }] } },
        { '12': { obj: { id: 12, name: 'Épuisé' }, tariff: '3.00', max_selectable_quantity: 0 } },
      ],
      can_register: { allow: false, reason: 'registration too late' },
      already_registered: false,
      can_unregister: false,
      can_modification: true,
      forms: [],
      carts: { '7': { amount: '32', payed: true } },
      user_registered: {},
    },
    { place: 'Sortie épave', city: 'Marseille', fromDate: '2026-10-10 08:15:00', toDate: '2026-10-10 12:00:00', comment: '', multiple_booking: false },
    7,
  );
  assert.deepEqual(d.tariffs, [{ token: 'tar-1', label: 'Membre', price: 32 }]);
  assert.deepEqual(
    d.roles.map((r) => r.key),
    ['diver', 'tok-dp'],
  );
  assert.deepEqual(
    d.materials.map((m) => [m.id, m.maxQuantity, m.choices.length]),
    [
      [10, 1, 0],
      [11, 1, 1],
    ],
  );
  assert.deepEqual(d.refusalReasons, ['Les inscriptions sont closes.']);
  assert.equal(d.canRegister, false);
  assert.equal(d.canModify, true);
  assert.equal(d.requiresExtraForm, false);
  assert.deepEqual(d.myCart, { amount: 32, paid: true });
  assert.equal(d.myRegistration, null);
  assert.equal(d.title, 'Sortie épave');
  assert.equal(d.location, 'Marseille');
});

test('fiche membre : niveaux pour le moteur des palanquées, sans les autres activités', () => {
  const p = profileOf({
    user_level: [{ level: { name: 'P - Plongeur Niveau 4 (P4-N4 - Guide de palanquée)', abbreviation: 'P4' } }],
    user_teaching: [{ teaching: { name: 'P - Enseignant 3 - Moniteur Fédéral - 1 er degré', abbreviation: 'E3' } }],
    user_qualification: [{ qualification: { name: 'A - Initiateur apnée' } }, { qualification: { name: 'RIFAP' } }],
    email: 'a@example.org',
    phone: '0600000000',
    birthday: '1990-01-01',
    medical_examination: '2027-01-31T00:00:00+01:00',
  });
  assert.ok(p.labels.includes('P4'));
  assert.ok(p.labels.includes('E3'));
  assert.ok(!p.labels.some((l) => /apn/i.test(l)));
  assert.deepEqual(p.levels, ['P - Plongeur Niveau 4 (P4-N4 - Guide de palanquée)']);
  assert.deepEqual(p.qualifications, ['A - Initiateur apnée', 'RIFAP']);
  assert.equal(p.medicalUntil, '2027-01-31');
});

test('liste des inscrits : noms, rôles, niveaux, certificat, identifiant d’admin (membre ou invité)', () => {
  const roster = rosterFrom({
    data: {
      user_registered: {
        '7': {
          id: 7,
          firstname: 'Jean',
          lastname: 'Martin',
          level: [{ abbreviation: 'P2', name: 'P - Plongeur Niveau 2' }],
          roles: [{ role: 'Directeur de plongée' }],
          prepa: [{ name: 'Prépa N3' }],
          age: '17',
          waitingList: false,
          medical_examination: { until: { date: '2027-01-31 00:00:00.000000' }, status: true },
          uct_token: 'uct-7',
          uct_socket: 'sock-7',
          material: ['1 Gilet '],
          licences: [{ licence: 'A-26-1', until: { date: '2026-12-31 00:00:00' }, status: true }],
        },
        '9': { id: 9, firstname: 'Anne', lastname: 'Durand', is_guest: true, socket: 'guest-9', uct_socket: 'x', waitingList: true },
      },
    },
  });
  assert.deepEqual(
    roster.map((r) => r.name),
    ['DURAND Anne', 'MARTIN Jean'],
  );
  const jean = roster.find((r) => r.id === '7')!;
  assert.deepEqual(jean.levels, ['P2']);
  assert.deepEqual(jean.roles, ['Directeur de plongée']);
  assert.deepEqual(jean.training, ['Prépa N3']);
  assert.equal(jean.age, 17);
  assert.deepEqual(jean.medical, { until: '2027-01-31', valid: true });
  assert.equal(jean.socket, 'sock-7');
  assert.deepEqual(jean.material, ['1 Gilet']);
  assert.deepEqual(jean.licences, [{ number: 'A-26-1', until: '2026-12-31', valid: true }]);
  const anne = roster.find((r) => r.id === '9')!;
  assert.equal(anne.socket, 'guest-9');
  assert.equal(anne.waitingList, true);
  assert.deepEqual(anne.medical, { until: null, valid: false });
});

test('liste des inscrits absente de la réponse : erreur, pas une liste vide', () => {
  assert.throws(() => rosterFrom({ data: {} }), /Liste des inscrits introuvable/);
});
