import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPeople,
  gapsFor,
  matchPerson,
  parseFfessmCsv,
  seasonOf,
  seasonsCovered,
  tierKind,
  vpdiveInsurance,
  type HaItem,
  type VpMember,
  type VpRecord,
} from './membership';

const item = (over: Partial<HaItem>): HaItem => ({
  id: 1,
  formSeason: 2027,
  tier: 'Adhésion à l\'association ',
  type: 'Membership',
  amount: 2000,
  state: 'Processed',
  date: '2026-09-15T10:00:00+02:00',
  firstName: 'Léa',
  lastName: 'Martin',
  birthDate: '1990-04-02',
  email: 'lea@example.org',
  payerEmail: 'parent@example.org',
  payerName: 'Paul Martin',
  ...over,
});

test('saisons : septembre ouvre la saison suivante ; payée en août, l’adhésion couvre aussi la suivante', () => {
  assert.equal(seasonOf('2026-09-01'), 2027);
  assert.equal(seasonOf('2026-08-31'), 2026);
  assert.deepEqual(seasonsCovered(2026, '2026-08-15'), [2026, 2027]);
  assert.deepEqual(seasonsCovered(2026, '2026-07-31'), [2026]);
  assert.deepEqual(seasonsCovered(2027, '2026-09-02'), [2027]);
});

test('tarifs HelloAsso', () => {
  assert.equal(tierKind('Adhésion à l\'association ', 'Membership'), 'adhesion');
  assert.equal(tierKind('Licence FFESSM ADULTE (+ de 16ans)', 'Membership'), 'licence');
  assert.equal(tierKind('Pass Plongée', 'Membership'), 'pass');
  assert.equal(tierKind('Assurance Individuelle Accidents et Assistance Formule 2', 'Membership'), 'assurance');
  assert.equal(tierKind('', 'Donation'), 'don');
  assert.equal(vpdiveInsurance('Loisir 3 Top'), 'Assurance Loisir 3 TOP');
  assert.equal(vpdiveInsurance('Loisir 1 2026'), 'Assurance Loisir 1');
  assert.equal(vpdiveInsurance('Aucune'), null);
});

test('export FFESSM : valeurs lues derrière leurs libellés, accents perdus tolérés', () => {
  const csv = [
    'textBox34,textBox35,textBox3,textBox16,textBox8,textBox17,textBox9,textBox22,textBox10,textBox23,textBox11,textBox24,textBox15,textBox25,textBox1,textBox14',
    'Liste des licences,Du 08/10/2025 au 08/10/2026,Saison,2026/2027,Licence,A-16-733717,Nom,MARTIN Léa,Date de naissance,02/04/1990,Assurance,Loisir 1,Tarification,R�duction Pass Plong�e,Souscription,03/10/2026',
    'Liste des licences,Du 08/10/2025 au 08/10/2026,Saison,2025/2026,Licence,A-27-4336564,Nom,DUPONT Jean,Date de naissance,01/01/1980,Assurance,Aucune,Tarification,Normal,Souscription,03/10/2025',
  ].join('\n');
  const { rows, period } = parseFfessmCsv(csv);
  assert.equal(period, 'Du 08/10/2025 au 08/10/2026');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { licence: 'A-16-733717', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '2026-10-03', insurance: 'Loisir 1', category: '', pricing: 'Réduction Pass Plongée' });
});

test('personnes : bénéficiaire et non payeur, adhésion d’août, réunion avec la FFESSM par naissance', () => {
  const items = [
    item({ id: 1 }),
    item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' }),
    item({ id: 3, formSeason: 2026, date: '2026-08-15T10:00:00Z', firstName: 'Tom', lastName: 'Petit', birthDate: '2010-05-05' }),
    item({ id: 4, formSeason: 2026, date: '2026-07-15T10:00:00Z', firstName: 'Old', lastName: 'Member', birthDate: '1970-01-01' }),
    item({ id: 5, state: 'Canceled', firstName: 'Ann', lastName: 'Ulé', birthDate: '1999-09-09' }),
  ];
  const rows = [{ licence: 'A-16-733717', name: 'MARTIN Lea', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Aucune', category: '', pricing: 'Normal' }];
  const people = buildPeople(items, rows, 2027);
  assert.deepEqual(people.map((p) => p.name), ['Léa Martin', 'Tom Petit']);
  const lea = people[0]!;
  assert.equal(lea.key, 'lic:A-16-733717');
  assert.equal(lea.ffessm?.licence, 'A-16-733717');
  assert.ok(lea.ha?.adhesion && lea.ha.licence);
  assert.equal(lea.email, 'lea@example.org', 'l’e-mail de l’adhérent, pas celui du payeur');
  assert.equal(people[1]!.ha?.bonus, true, 'août : adhésion de la saison suivante');
});

test('rapprochement VPDive : sûr par licence, naissance ou e-mail ; sinon à confirmer ; choix mémorisé', () => {
  const dir: VpMember[] = [
    { id: 'u1', name: 'MARTIN Léa', picture: '' },
    { id: 'u2', name: 'MARTIN Lea', picture: '' },
  ];
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, ...over });
  const [lea] = buildPeople([item({})], [], 2027);
  assert.equal(matchPerson(lea!, dir, {}).status, 'confirm', 'deux homonymes, rien pour trancher');
  const byBirth = matchPerson(lea!, dir, { u2: rec({ birthday: '1990-04-02' }), u1: rec({}) });
  assert.equal(byBirth.status, 'sure');
  assert.equal(byBirth.member?.id, 'u2');
  assert.equal(matchPerson(lea!, dir, { u1: rec({ email: 'PARENT@example.org' }) }).member?.id, 'u1', 'e-mail du parent (mineur)');
  assert.equal(matchPerson(lea!, dir, {}, { uct: 'u1', by: 'Lucas', at: '' }).why, 'choisi par Lucas');
  assert.equal(matchPerson(lea!, dir, {}, { uct: 'none', by: 'Lucas', at: '' }).status, 'missing');
  assert.equal(matchPerson(lea!, [], {}).status, 'missing');
});

test('écarts : saison, statut, licence à reporter, licence payée mais non prise, assurance', () => {
  const rows = [{ licence: 'A-16-733717', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Loisir 2', category: '', pricing: 'Normal' }];
  const [lea] = buildPeople([item({}), item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], rows, 2027);
  const r: VpRecord = { email: '', birthday: '', seasons: ['2026'], licences: [{ number: 'A-16-733717', organization: 'F.F.E.S.S.M.', expires: '2026-12-31' }], insurance: '', insuranceYear: null, member: false };
  const texts = gapsFor(lea!, r, 2027).map((g) => `${g.level}:${g.text}`);
  assert.deepEqual(texts, [
    'todo:Saison 2026/2027 à ajouter',
    'todo:Statut Invité dans VPDive : à passer en Membre',
    'todo:Licence A-16-733717 : validité à porter au 31/12/2027',
    'todo:Assurance « Loisir 2 » à porter dans VPDive',
  ]);
  const ok: VpRecord = { ...r, seasons: ['2027'], member: true, licences: [{ ...r.licences[0]!, expires: '2027-12-31' }], insurance: 'Assurance Loisir 2' };
  assert.deepEqual(gapsFor(lea!, ok, 2027), []);
  const [forgot] = buildPeople([item({ tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [], 2027);
  assert.deepEqual(gapsFor(forgot!, null, 2027).map((g) => g.level), ['warn']);
});
