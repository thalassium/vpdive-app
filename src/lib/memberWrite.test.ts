import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WriteError, capacityEntries, checkWrite, currentCapacities, frDate, generalEntries, insuranceEntries, licenceEntries, rawHasLicence, rawSeasons, snapshot, type RawMember } from './memberWrite';
import { brevetTarget, type Capacity, type VpRecord } from './membership';

const fiche = (over: Partial<RawMember> = {}): RawMember => ({
  first_name: 'Léa',
  last_name: 'MARTIN',
  birthday: '1990-04-02T00:00:00+02:00',
  email: 'lea@ex.org',
  civility: 'Mme',
  profession: { token: 'prof1' },
  username: 'lea',
  profile_picture: 'pic.jpg',
  is_admin_view: true,
  user_club_traceability: { birthday_show: true, comment: 'note', allMembers: true, dateConfirmation: '2025-09-10T10:00:00+02:00', yearsConfirmation: ['2026', '2025'] },
  user_licence: [
    { id: 3, licence: 'A-16-733717', organization: { id: 7, name: 'F.F.E.S.S.M.' }, expirationDate: '2026-12-31' },
    { id: 4, licence: 'X-1', organization: { id: 9, name: 'PADI' }, expirationDate: null },
  ],
  licenses: [
    { id: 3, expiration_date: '2026-12-31' },
    { id: 4, expiration_date: '2028-06-30' },
  ],
  file_licence: { '3': { uniq: 'f-3' } },
  organizations: [
    { id: 9, name: 'PADI' },
    { id: 7, name: 'F.F.E.S.S.M.' },
  ],
  user_level: [{ level: { id: 125 } }],
  user_teaching: [{ teaching: { id: 3 } }],
  ...over,
});
const get = (e: [string, string][], k: string) => e.filter(([x]) => x === k).map(([, v]) => v);

test('bloc général : tout recopié, saison ajoutée, statut Membre gardé', () => {
  const e = generalEntries(fiche(), 2027);
  assert.deepEqual(get(e, 'mobile_general_form[years][]'), ['2027', '2026', '2025']);
  assert.deepEqual(get(e, 'mobile_general_form[all_members]'), ['1']);
  assert.deepEqual(get(e, 'mobile_general_form[birthday]'), ['02/04/1990']);
  assert.deepEqual(get(e, 'mobile_general_form[civility]'), ['mrs']);
  assert.deepEqual(get(e, 'mobile_general_form[comment]'), ['note']);
  assert.deepEqual(get(e, 'mobile_general_form[created_at_user_update]'), ['10/09/2025']);
  // Un Invité reste Invité.
  const guest = generalEntries(fiche({ user_club_traceability: { allMembers: false, yearsConfirmation: [] } }), 2027);
  assert.deepEqual(get(guest, 'mobile_general_form[all_members]'), []);
  // Hors vue admin : refus, sinon le statut Membre serait perdu.
  assert.throws(() => generalEntries(fiche({ is_admin_view: false }), 2027), WriteError);
});

test('bloc licences : toutes renvoyées, date changée ou licence ajoutée', () => {
  const e = licenceEntries(fiche(), { extend: { id: 3, expires: '2027-12-31' } });
  assert.deepEqual(get(e, 'mobile_licence_form[user_licence][0][expiration_date]'), ['31/12/2027']);
  assert.deepEqual(get(e, 'mobile_licence_form[user_licence][0][licence_file]'), ['f-3']);
  // L'autre licence garde sa date (lue dans `licenses` quand expirationDate manque) et son organisation.
  assert.deepEqual(get(e, 'mobile_licence_form[user_licence][1][expiration_date]'), ['30/06/2028']);
  assert.deepEqual(get(e, 'mobile_licence_form[user_licence][1][organization]'), ['9']);
  const add = licenceEntries(fiche(), { add: { number: 'A-22-111111', expires: '2027-12-31' } });
  assert.deepEqual(get(add, 'mobile_licence_form[user_licence][2][organization]'), ['7']);
  assert.deepEqual(get(add, 'mobile_licence_form[user_licence][2][licence]'), ['A-22-111111']);
  assert.deepEqual(get(add, 'mobile_licence_form[user_licence][0][expiration_date]'), ['31/12/2026']);
  assert.throws(() => licenceEntries(fiche(), { extend: { id: 99, expires: '2027-12-31' } }), WriteError);
  assert.throws(() => licenceEntries(fiche({ user_licence: [{ id: 3, licence: 'A', organization: null }] }), { add: { number: 'B', expires: '2027-12-31' } }), WriteError);
  assert.throws(() => licenceEntries(fiche({ organizations: [] }), { add: { number: 'B', expires: '2027-12-31' } }), WriteError);
});

test('licence à ajouter déjà sur la fiche (même numéro aplati) : refus explicite, pas de doublon', () => {
  assert.throws(() => licenceEntries(fiche(), { add: { number: 'A16733717', expires: '2027-12-31' } }), /déjà présente/);
  assert.equal(rawHasLicence(fiche(), 'a-16-733717'), true);
  assert.equal(rawHasLicence(fiche(), 'A-22-111111'), false);
});

test('saisons : réunion de yearsUserConfirmation et yearsConfirmation, les deux gardées au journal', () => {
  const u = fiche({ user_club_traceability: { allMembers: true, yearsUserConfirmation: ['2027'], yearsConfirmation: ['2026', 2025] } });
  assert.deepEqual(rawSeasons(u), [2027, 2026, 2025]);
  assert.deepEqual(get(generalEntries(u, 2027), 'mobile_general_form[years][]'), ['2027', '2026', '2025']);
  const s = snapshot(u);
  assert.deepEqual([s.seasons, s.yearsUserConfirmation, s.yearsConfirmation], [[2027, 2026, 2025], [2027], [2026, 2025]]);
});

test('dates', () => {
  assert.equal(frDate('2027-12-31'), '31/12/2027');
  assert.equal(frDate('31/12/2027'), '31/12/2027');
  assert.equal(frDate(null), '');
});

test('bloc niveaux : ceux de la fiche plus les nouveaux, refus si un niveau est hors référentiel', () => {
  assert.deepEqual(currentCapacities(fiche()), ['l_125', 't_3']);
  const cat = new Set(['l_125', 't_3', 'l_130']);
  assert.deepEqual(
    capacityEntries(fiche(), ['l_130'], cat).map(([, v]) => v),
    ['l_125', 't_3', 'l_130'],
  );
  assert.throws(() => capacityEntries(fiche(), ['l_130'], new Set(['l_130'])), WriteError);
  assert.deepEqual(insuranceEntries('Assurance Loisir 1', 2027)[2], ['mobile_insurance_form[insurance]', 'Assurance Loisir 1']);
});

test('brevet FFESSM → niveau VPDive unique, FFESSM de préférence', () => {
  const cat: Capacity[] = [
    { group: 'PLONGEE SCAPHANDRE (F.F.E.S.S.M.) - Pratique', name: 'Niveau 2 (P2-N2)', id: 'l_130' },
    { group: 'PLONGEE SCAPHANDRE (PADI) - Pratique', name: 'Advanced (P2)', id: 'l_200' },
    { group: 'PLONGEE SCAPHANDRE (F.F.E.S.S.M.) - Pratique', name: 'Nitrox (PN)', id: 'l_140' },
    { group: 'PLONGEE SCAPHANDRE (F.F.E.S.S.M.) - Pratique', name: 'Nitrox confirmé (PNC)', id: 'l_141' },
  ];
  assert.equal(brevetTarget('Niveau 2', {}, cat)?.id, 'l_130');
  assert.equal(brevetTarget('Plongeur Nitrox', {}, cat)?.id, 'l_140');
  assert.equal(brevetTarget('Brevet inconnu', {}, cat), null);
  // Table des admins : la première équivalence qui désigne un seul niveau.
  assert.equal(brevetTarget('Niveau 2', { 'Niveau 2': ['Absent', 'Advanced (P2)'] }, cat)?.id, 'l_200');
});

test('relecture : perte ou écriture non prise = erreur', () => {
  const before: VpRecord = { email: '', birthday: '', seasons: ['2026'], licences: [{ number: 'A-16-733717', organization: 'F.F.E.S.S.M.', expires: '2026-12-31' }], insurance: '', insuranceYear: null, member: true, levels: ['Niveau 1'] };
  const ok: VpRecord = { ...before, seasons: ['2027', '2026'], licences: [{ ...before.licences[0]!, expires: '2027-12-31' }], insurance: 'Assurance Loisir 1', levels: ['Niveau 1', 'Niveau 2'] };
  assert.deepEqual(checkWrite(before, ok, { season: 2027, licence: 'A16733717', insurance: 'Assurance Loisir 1', levels: ['Niveau 2'] }, 2027), {});
  assert.match(checkWrite(before, { ...ok, member: false }, { season: 2027 }, 2027).error ?? '', /Invité/);
  assert.match(checkWrite(before, { ...ok, licences: [] }, {}, 2027).error ?? '', /licence a disparu/);
  assert.match(checkWrite(before, { ...ok, levels: ['Niveau 2'] }, {}, 2027).error ?? '', /niveau perdu/);
  assert.match(checkWrite(before, before, { licence: 'A-16-733717' }, 2027).error ?? '', /31\/12\/2026/);
  assert.match(checkWrite(before, { ...ok, levels: ['Niveau 1'] }, { levels: ['Niveau 2'] }, 2027).warning ?? '', /validation/);
  // Nom du référentiel envoyé, nom tronqué relu sur la fiche : pas de fausse alerte.
  const n4 = { ...ok, levels: ['Niveau 1', 'P-Plongeur Niveau 4 (P4-N4)'] };
  assert.deepEqual(checkWrite(before, n4, { levels: ['P-Plongeur Niveau 4 (P4-N4) (P4-ANMP) A.N.M.P.'] }, 2027), {});
});
