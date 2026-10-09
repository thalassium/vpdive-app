import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adhesionView,
  brevetsView,
  buildPeople,
  federationIssue,
  licenceView,
  needsVpdiveFix,
  viewOf,
  automaticLevels,
  brevetsByLicence,
  hasBrevet,
  parseFfessmBrevets,
  restoreAccents,
  quickFixes,
  arbitrageCases,
  familyCandidates,
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
  assert.equal(vpdiveInsurance('Loisir Base'), 'Assurance Loisir 1');
  assert.equal(vpdiveInsurance('Loisir 1 base'), 'Assurance Loisir 1');
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
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [], ...over });
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

test('licence : HelloAsso fait foi ; FFESSM non prise ❌ ; VPDive absente ❌, ancienne date ⚠️, à jour ✅', () => {
  const row = { licence: 'A-16-733717', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Loisir 2', category: '', pricing: 'Normal' };
  const [lea] = buildPeople([item({}), item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [row], 2027);
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [], ...over });
  const marks = (v: ReturnType<typeof licenceView>) => [v.helloasso.mark, v.ffessm.mark, v.vpdive.mark].join(' ');
  assert.equal(marks(licenceView(lea!, rec({}), 2027)), 'ok ok missing');
  assert.equal(licenceView(lea!, rec({}), 2027).helloasso.text, 'Adulte');
  const old = rec({ licences: [{ number: 'A-16-733717', organization: 'F.F.E.S.S.M.', expires: '2026-12-31' }] });
  assert.equal(marks(licenceView(lea!, old, 2027)), 'ok ok diff');
  const fine = rec({ licences: [{ number: 'A16733717', organization: 'F.F.E.S.S.M.', expires: '2027-12-31' }] });
  assert.equal(marks(licenceView(lea!, fine, 2027)), 'ok ok ok');
  const [forgot] = buildPeople([item({ tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [], 2027);
  const v = licenceView(forgot!, null, 2027);
  assert.equal(v.ffessm.mark, 'missing');
  assert.ok(federationIssue({ licence: v, adhesion: v, brevets: v }));
});

test('adhésion : saison absente ❌, statut Invité ⚠️, à jour ✅ ; brevets FFESSM comparés aux niveaux VPDive', () => {
  const [lea] = buildPeople([item({})], [{ licence: 'A-1-12345', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Aucune', category: '', pricing: 'Normal' }], 2027);
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [], ...over });
  assert.equal(adhesionView(lea!, rec({}), 2027).vpdive.mark, 'missing');
  assert.equal(adhesionView(lea!, rec({ seasons: ['2027'], member: false }), 2027).vpdive.mark, 'diff');
  assert.equal(adhesionView(lea!, rec({ seasons: ['2027'] }), 2027).vpdive.mark, 'ok');
  const brevets = { 'A-1-12345': ['Niveau 2', 'Plongeur Nitrox'] };
  assert.equal(brevetsView(lea!, rec({ levels: ['P - Plongeur(se) Niveau 2 (P2-N2) (P2) F.F.E.S.S.M.', 'P - Plongeur Nitrox (base) (PN) F.F.E.S.S.M.'] }), brevets).vpdive.mark, 'ok');
  assert.equal(brevetsView(lea!, rec({ levels: ['P - Plongeur(se) Niveau 2 (P2-N2)'] }), brevets).vpdive.text, 'manque Plongeur Nitrox');
  assert.equal(brevetsView(lea!, rec({}), brevets).vpdive.mark, 'missing');
  assert.equal(brevetsView(lea!, rec({}), null).ffessm.text, 'export à déposer');
  const v = viewOf(lea!, rec({ seasons: ['2027'] }), 2027, null);
  assert.equal(needsVpdiveFix(v), true, 'licence absente de VPDive');
});

test('export des brevets : plongeur, brevet, date ; comparaison par code avec les niveaux VPDive', () => {
  const csv = [
    'textBox34,textBox35,textBox1,textBox13,textBox4,textBox16,textBox7,textBox9,textBox12,textBox22,textBox11,textBox19,textBox24',
    'Liste des brevets,Du 08/10/2025 au 08/10/2026,Date Obtention,12/05/2026,Niveau,Plongeur Nitrox confirm\ufffd,Plongeur,A-21-942895,Mme,DI SANTO Carla,Moniteur,A-03-000864,MONITEUR Jean',
  ].join('\n');
  const { rows, period } = parseFfessmBrevets(csv);
  assert.equal(period, 'Du 08/10/2025 au 08/10/2026');
  assert.deepEqual(rows, [{ licence: 'A-21-942895', name: 'DI SANTO Carla', brevet: 'Plongeur Nitrox confirmé', obtainedAt: '2026-05-12' }]);
  assert.deepEqual(brevetsByLicence([...rows, ...rows]), { 'A-21-942895': ['Plongeur Nitrox confirmé'] });
  assert.ok(hasBrevet(['P - Plongeur Nitrox Confirmé (PNC) F.F.E.S.S.M.'], 'Plongeur Nitrox confirmé'));
  assert.equal(restoreAccents('Plongeur en autonomie 40 m�tres'), 'Plongeur en autonomie 40 mètres');
  assert.ok(!hasBrevet(['P - Plongeur Nitrox (base) (PN) F.F.E.S.S.M.'], 'Plongeur Nitrox confirme'));
  assert.ok(hasBrevet(['P - Réaction et intervention face à un accident - Plongée (RIFA-P) F.F.E.S.S.M.'], 'RIFA Plongee'));
  assert.ok(hasBrevet(['P - Plongeur(se) Niveau 1 (P1-N1) (P1) F.F.E.S.S.M.'], 'Niveau 1'));
  assert.ok(!hasBrevet(['TSC - Tir sur cible - Tireur Niveau 1 (T1) F.F.E.S.S.M.'], 'Niveau 1'));
  assert.ok(hasBrevet(['P - Plongeur Autonome 40 mètres (PA40)'], 'Plongeur en autonomie 40 metres'));
});

test('table des brevets : le choix des admins prime sur la règle automatique', () => {
  const names = ['P - Plongeur(se) Niveau 1 (P1-N1) (P1) F.F.E.S.S.M.', 'P-Plongeur Niveau 1 (P1-N1) (P1-ANMP) A.N.M.P.', 'TSC - Tir sur cible - Tireur Niveau 1 (T1) F.F.E.S.S.M.'];
  assert.deepEqual(automaticLevels('Niveau 1', names), names.slice(0, 2));
  const map = { 'Plongeur Or': ['EB - Jeune plongeur bio (PBJ) F.F.E.S.S.M.'] };
  assert.ok(hasBrevet(['EB - Jeune plongeur bio (PBJ)'], 'Plongeur Or', map), 'nom sans la fédération en fin');
  assert.ok(!hasBrevet(['P - Plongeur Or (POR) F.F.E.S.S.M.'], 'Plongeur Or', map), 'la table remplace la règle');
  assert.ok(hasBrevet(['P - Plongeur Or (POR) F.F.E.S.S.M.'], 'Plongeur Or'), 'sans table : règle automatique');
});

test('rapprochement : toujours vers un compte Membre ; un invité homonyme n’est pas proposé', () => {
  const dir: VpMember[] = [
    { id: 'guest', name: 'Stephane SARTORETTO', picture: '' },
    { id: 'member', name: 'Stéphane SARTORETTO', picture: '' },
  ];
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [], ...over });
  const [st] = buildPeople([item({ firstName: 'Stéphane', lastName: 'SARTORETTO', birthDate: '1967-12-07' })], [], 2027);
  const m = matchPerson(st!, dir, { guest: rec({ member: false }), member: rec({}) });
  assert.equal(m.status, 'sure');
  assert.equal(m.member?.id, 'member');
  assert.equal(m.why, 'seul compte Membre à ce nom');
  // La preuve sur l'invité ne l'emporte pas sur le compte Membre.
  assert.equal(matchPerson(st!, dir, { guest: rec({ member: false, birthday: '1967-12-07' }), member: rec({}) }).member?.id, 'member');
  // Deux comptes Membre homonymes, rien pour trancher : à confirmer, sans l'invité.
  const two = matchPerson(st!, [...dir, { id: 'm2', name: 'SARTORETTO Stéphane', picture: '' }], { guest: rec({ member: false }), member: rec({}), m2: rec({}) });
  assert.equal(two.status, 'confirm');
  assert.deepEqual(two.candidates.map((c) => c.id).sort(), ['m2', 'member']);
});

test('corrections rapides : saison, licence (date ou ajout), assurance, brevets ; jamais sans rapprochement sûr', () => {
  const row = { licence: 'A-16-733717', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Loisir 2', category: '', pricing: 'Normal' };
  const [lea] = buildPeople([item({}), item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [row], 2027);
  const member = { id: 'u1', name: 'MARTIN Léa', picture: '' };
  const sure = { status: 'sure' as const, member, why: 'même date de naissance', candidates: [] };
  const rec: VpRecord = { email: '', birthday: '', seasons: ['2026'], licences: [{ number: 'A-16-733717', organization: 'F.F.E.S.S.M.', expires: '2026-12-31', id: 7, verified: true }], insurance: '', insuranceYear: null, member: true, levels: [] };
  const fixes = quickFixes(lea!, sure, rec, 2027, ['Niveau 2']);
  assert.deepEqual(fixes.map((f) => [f.kind, f.after]), [['season', '+ 2026/2027'], ['licence', 'jusqu’au 31/12/2027'], ['insurance', 'Assurance Loisir 2 (2026/2027)'], ['brevets', '+ Niveau 2']]);
  assert.equal(fixes[1]!.refresh, true);
  assert.equal(fixes[2]!.insurance, 'Assurance Loisir 2');
  // Assurance : l'année seule ancienne suffit ; « Autre » texte libre FFESSM remplacé ; DAN et autres gardées.
  // Année : la saison par son année de début (2026 = 2026/2027).
  assert.equal(fixes[2]!.insuranceYear, 2026);
  const ins = (insurance: string, insuranceYear: number | null) => quickFixes(lea!, sure, { ...rec, insurance, insuranceYear }, 2027).find((f) => f.kind === 'insurance')?.before ?? null;
  assert.equal(ins('Assurance Loisir 2', 2025), 'Assurance Loisir 2 (2025/2026)');
  assert.equal(ins('Assurance Loisir 2', 2026), null);
  assert.equal(ins('Loisir 1 base', 2026), 'Loisir 1 base (2026/2027)');
  assert.equal(ins('DAN SILVER', 2025), null);
  // Licence non vérifiée : c'est quand même une correction rapide, la date se saisit.
  const manual = { ...rec, licences: [{ ...rec.licences[0]!, verified: false }] };
  assert.equal(quickFixes(lea!, sure, manual, 2027).find((f) => f.kind === 'licence')?.refresh, false);
  // Aucune licence FFESSM sur la fiche : à ajouter.
  assert.deepEqual(quickFixes(lea!, sure, { ...rec, licences: [] }, 2027).filter((f) => f.kind === 'licence-add').map((f) => f.after), ['A-16-733717, jusqu’au 31/12/2027']);
  assert.deepEqual(quickFixes(lea!, { ...sure, status: 'confirm', member: null }, rec, 2027), [], 'pas de correction tant que le membre est à confirmer');
});

test('arbitrage : homonymes, parents, absent, invité, licence non prise, autre numéro de licence', () => {
  const [lea] = buildPeople([item({}), item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [], 2027);
  const rec: VpRecord = { email: '', birthday: '', seasons: ['2027'], licences: [], insurance: '', insuranceYear: null, member: false, levels: [] };
  const v = viewOf(lea!, rec, 2027, null);
  const sure = { status: 'sure' as const, member: { id: 'u1', name: 'MARTIN Léa', picture: '' }, why: 'x', candidates: [] };
  assert.deepEqual(arbitrageCases(lea!, sure, rec, v).map((c) => c.kind), ['not-taken', 'guest']);
  const nobody = { status: 'missing' as const, member: null, why: '', candidates: [] };
  assert.deepEqual(arbitrageCases(lea!, nobody, null, viewOf(lea!, null, 2027, null)).map((c) => c.kind), ['absent', 'not-taken']);
  const parent = { id: 'p1', name: 'MARTIN Paul', picture: '' };
  assert.deepEqual(arbitrageCases(lea!, nobody, null, viewOf(lea!, null, 2027, null), [parent]).map((c) => c.kind), ['family', 'not-taken']);
  const decided = { status: 'missing' as const, member: null, why: 'pas dans VPDive, selon Lucas', candidates: [] };
  assert.ok(!arbitrageCases(lea!, decided, null, viewOf(lea!, null, 2027, null)).some((c) => c.kind === 'absent'), 'déjà tranché');
  const row = { licence: 'A-16-733717', name: 'MARTIN Léa', birthDate: '1990-04-02', season: 2027, subscribedAt: '', insurance: 'Aucune', category: '', pricing: 'Normal' };
  const [withLic] = buildPeople([item({}), item({ id: 2, tier: 'Licence FFESSM ADULTE (+ de 16ans)' })], [row], 2027);
  const other = { ...rec, member: true, licences: [{ number: 'A-99-000001', organization: 'F.F.E.S.S.M.', expires: '2027-12-31' }] };
  assert.deepEqual(arbitrageCases(withLic!, sure, other, viewOf(withLic!, other, 2027, null)).map((c) => c.kind), ['licence-other']);
});

test('rapprochement : une naissance différente sur la fiche interdit « sûr » (Jean/Jeanne, Léa/Léa-Marie, père/fils)', () => {
  const rec = (over: Partial<VpRecord>): VpRecord => ({ email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [], ...over });
  // Seul compte Membre « à ce nom » (préfixe jean/jeanne), mais née en 2010.
  const [jean] = buildPeople([item({ firstName: 'Jean', lastName: 'Dupont', birthDate: '1980-03-03', email: 'jean@ex.org' })], [], 2027);
  const jeanne = [{ id: 'j', name: 'DUPONT Jeanne', picture: '' }];
  assert.equal(matchPerson(jean!, jeanne, { j: rec({ birthday: '2010-06-06' }) }).status, 'confirm');
  assert.equal(matchPerson(jean!, jeanne, { j: rec({}) }).status, 'sure', 'naissance vide sur la fiche : le nom seul vaut encore');
  // Même e-mail, mais pas la même personne (le parent qui a donné son e-mail).
  assert.equal(matchPerson(jean!, jeanne, { j: rec({ birthday: '2010-06-06', email: 'jean@ex.org' }) }).status, 'confirm');
  // Un autre e-mail propre, sans naissance : le nom seul ne suffit plus.
  assert.equal(matchPerson(jean!, jeanne, { j: rec({ email: 'jeanne@ex.org' }) }).status, 'confirm');
  assert.equal(matchPerson(jean!, jeanne, { j: rec({ email: 'parent@example.org' }) }).status, 'sure', 'e-mail du payeur : pas un doute');
  // Léa / Léa-Marie.
  const [lea] = buildPeople([item({})], [], 2027);
  const leaMarie = [{ id: 'lm', name: 'MARTIN Léa-Marie', picture: '' }];
  assert.equal(matchPerson(lea!, leaMarie, { lm: rec({ birthday: '2015-01-01' }) }).status, 'confirm');
  // Père et fils homonymes : un seul compte Membre (le père), même nom exact.
  const [fils] = buildPeople([item({ firstName: 'Jean', lastName: 'Dupont', birthDate: '2008-02-02' })], [], 2027);
  const dir: VpMember[] = [
    { id: 'pere', name: 'DUPONT Jean', picture: '' },
    { id: 'fils', name: 'Jean DUPONT', picture: '' },
  ];
  const m = matchPerson(fils!, dir, { pere: rec({ birthday: '1975-05-05' }), fils: rec({ member: false }) });
  assert.equal(m.status, 'confirm');
  assert.equal(matchPerson(fils!, dir.slice(0, 1), { pere: rec({ birthday: '1975-05-05' }) }).status, 'confirm', 'même nom (accents près) : pas sûr non plus');
  // Même licence, mais naissance différente : à confirmer aussi (erreur de saisie à regarder).
  const row = { licence: 'A-16-1', name: 'DUPONT Jean', birthDate: '2008-02-02', season: 2027, subscribedAt: '', insurance: 'Aucune', category: '', pricing: 'Normal' };
  const [lic] = buildPeople([], [row], 2027);
  const withLic = rec({ birthday: '1975-05-05', licences: [{ number: 'A-16-1', organization: 'F.F.E.S.S.M.', expires: '' }] });
  assert.equal(matchPerson(lic!, dir.slice(0, 1), { pere: withLic }).status, 'confirm');
  assert.equal(matchPerson(lic!, dir.slice(0, 1), { pere: { ...withLic, birthday: '2008-02-02' } }).why, 'même n° de licence');
});

test('rapprochement : choix mémorisé vers un membre sorti de l’annuaire = « choix obsolète », jamais sûr', () => {
  const [lea] = buildPeople([item({})], [], 2027);
  const dir: VpMember[] = [{ id: 'u1', name: 'MARTIN Léa', picture: '' }];
  const rec: VpRecord = { email: '', birthday: '1990-04-02', seasons: [], licences: [], insurance: '', insuranceYear: null, member: true, levels: [] };
  const m = matchPerson(lea!, dir, { u1: rec }, { uct: 'parti', by: 'Lucas', at: '' });
  assert.equal(m.status, 'confirm');
  assert.deepEqual(m.candidates.map((c) => c.id), ['u1']);
  assert.match(m.obsolete ?? '', /choix obsolète/);
  assert.equal(matchPerson(lea!, [], {}, { uct: 'parti', by: 'Lucas', at: '' }).status, 'missing');
});

test('parents : même nom de famille ou payeur HelloAsso ; un seul compte au même nom (accents près) est sûr', () => {
  const [tom] = buildPeople([item({ firstName: 'Tom', lastName: 'Petit', birthDate: '2012-05-05', payerName: 'Claire Durand' })], [], 2027);
  const dir: VpMember[] = [
    { id: 'a', name: 'PETIT Marc', picture: '' },
    { id: 'b', name: 'DURAND Claire', picture: '' },
    { id: 'c', name: 'MARTIN Léa', picture: '' },
  ];
  assert.deepEqual(familyCandidates(tom!, dir).map((m) => m.id), ['b', 'a'], 'le payeur d’abord, puis le même nom');
  const linked = matchPerson(tom!, dir, {}, { uct: 'b', by: 'Lucas', at: '', relation: 'parent' });
  assert.equal(linked.status, 'missing');
  assert.equal(linked.parent?.id, 'b');
  const [adrien] = buildPeople([item({ firstName: 'Adrien', lastName: 'Cheminee', birthDate: '1985-01-01' })], [], 2027);
  const one = [{ id: 'x', name: 'CHEMINÉE Adrien', picture: '' }];
  const rec: VpRecord = { email: '', birthday: '', seasons: [], licences: [], insurance: '', insuranceYear: null, member: false, levels: [] };
  const m = matchPerson(adrien!, one, { x: rec });
  assert.equal(m.status, 'sure');
  assert.equal(m.why, 'même nom (accents près)');
});
