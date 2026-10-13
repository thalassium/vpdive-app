import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from './auth.js';
import { memoryStore, type Store } from './store.js';
import { handleWith, type Deps } from './handler.js';
import { FicheError, applyFicheOp, applyOutingSessions, createFiche, ficheIdOf, newFiche, outingSessions, summarize, type Fiche, type FicheActor, type FicheSummary } from './training.js';

const EV = 'evenement-0001';
const EV2 = 'evenement-0002';

const diver = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, labels: [], training: 0, ...extra });
const TEACHER = diver('7', 'MONITEUR Lucas', { teach: 3 });
const ANNA = diver('21', 'ELEVE Anna', { training: 2, picture: 'https://x/anna.jpg' });
const BOB = diver('22', 'ELEVE Bob', { training: 2, trainingApt: { kind: 'PA', depth: 20 } });

/** Une sortie d'une plongée : une palanquée de formation (Lucas, Anna, Bob), une exploration, un baptême et un invité hors VPDive. */
const outing = (over: { validated?: boolean; members?: unknown[]; depth?: string; date?: string } = {}) => ({
  header: { date: over.date ?? '2026-10-10', creneau: 'Matin' },
  dives: [
    {
      id: 'd1',
      label: 'Plongée 1',
      validated: over.validated === false ? null : { by: 'DP', at: '2026-10-10T08:00:00Z' },
      sheets: { p1: { planned: { time: '09:30', depth: '20' }, actual: { depth: over.depth ?? '', duration: '' } } },
      plan: {
        palanquees: [
          { id: 'p1', kind: 'teaching', guide: TEACHER, extras: [diver('8', 'GP Zoé')], members: over.members ?? [ANNA, BOB] },
          { id: 'p2', kind: 'guided', guide: diver('9', 'GUIDE Max'), extras: [], members: [diver('30', 'EXPLO Léa', { training: 0 })] },
          { id: 'p3', kind: 'teaching', guide: diver('10', 'E1 Paul'), extras: [], members: [diver('31', 'BAPTEME Tom', { beginner: true }), diver('ext-abc', 'INVITE Sam', { training: 1 })] },
        ],
        unassigned: [],
      },
    },
  ],
});

test('outingSessions : une séance par élève en formation d’une palanquée de formation validée', () => {
  const list = outingSessions(EV, outing({ depth: '18 m' }));
  assert.deepEqual(
    list.map((o) => [o.student.id, o.level, o.session.objective]),
    [
      ['21', 'N2', 'FN2'],
      ['22', 'N2', 'FPA20'],
    ],
    'ni l’exploration, ni le baptême sans formation, ni l’invité hors VPDive, ni l’encadrant supplémentaire',
  );
  const s = list[0]!.session;
  assert.equal(s.id, `${EV}:d1`);
  assert.deepEqual(s.teacher, { id: '7', name: 'MONITEUR Lucas' });
  assert.deepEqual([s.date, s.slot, s.label, s.depth], ['2026-10-10', 'Matin', 'Plongée 1', '18 m'], 'créneau d’après l’heure de mise à l’eau, profondeur réalisée');
  assert.equal(s.filled, null);
  assert.deepEqual(list[0]!.student, { id: '21', name: 'ELEVE Anna', picture: 'https://x/anna.jpg' });
});

test('outingSessions : élève et enseignant sont connus par leur jeton d’adhésion dès que la sortie le donne', () => {
  const members = [{ ...ANNA, uct: 'jeton-anna' }, diver('uct:jeton-zoe', 'AJOUTEE Zoé', { training: 2 })];
  const doc = outing({ members });
  (doc.dives[0]!.plan.palanquees[0] as { guide: object }).guide = { ...TEACHER, uct: 'jeton-lucas' };
  const list = outingSessions(EV, doc);
  assert.deepEqual(
    list.map((o) => [o.student.id, o.student.uct, o.session.teacher.id]),
    [
      ['uct:jeton-anna', 'jeton-anna', 'uct:jeton-lucas'],
      ['uct:jeton-zoe', 'jeton-zoe', 'uct:jeton-lucas'],
    ],
  );
  // La même fiche qu'une fiche créée à la main pour ce membre depuis l'annuaire.
  const uct = 'jeton-anna'.padEnd(24, 'x');
  const created = createFiche({ uct, name: 'Anna Eleve', level: 'N2' }, 'Fred', '2026-10-12T08:00:00.000Z');
  assert.equal(created.id, ficheIdOf(outingSessions(EV, outing({ members: [{ ...ANNA, uct }] }))[0]!.student.id, 'N2'));
});

test('createFiche : fiche vide, ou reprise du classeur avec ses séances et leurs moniteurs', () => {
  const uct = 'jeton-de-membre-'.padEnd(24, 'x');
  const now = '2026-10-12T08:00:00.000Z';
  const empty = createFiche({ uct, name: 'Anna Eleve', level: 'N1' }, 'Fred', now);
  assert.deepEqual([empty.id, empty.student, empty.sessions.length, empty.level], [`N1.uct_${uct}`, `uct:${uct}`, 0, 'N1']);
  assert.throws(() => createFiche({ uct: 'court', name: 'X', level: 'N1' }, 'Fred', now), (e) => e instanceof FicheError && e.status === 400);
  assert.throws(() => createFiche({ uct, name: 'X', level: 'N9' }, 'Fred', now), (e) => e instanceof FicheError && e.status === 400);

  const content = {
    model: 'N2L',
    general: 'Conso à surveiller',
    sessions: [
      { date: '2026-10-10', slot: 'Après-midi', teacher: 'Lucas', depth: '20m', duration: '43', weight: '3', evals: { '1-check': 'ECA', bad: 'ZZ' }, comment: 'Orientation' },
      { date: '2026-10-10', slot: 'Matin', teacher: 'Lucas Moniteur', teacherUct: 'jeton-lucas-'.padEnd(24, 'x'), depth: '20m', evals: {}, comment: '' },
      { date: '2026-10-11', teacher: 'Zoé', teacherUct: 'court', evals: {}, comment: 'Reprise en douceur' },
      'pas une séance',
    ],
    theory: { examen: { date: '2026-09-01', teacher: 'FH', note: '17/20' }, vide: {} },
    review: { status: { pratique: 'VALIDE', theorie: 'ATTENTE' }, certDate: '2026-10-11', responsable: 'Fred' },
  };
  const taken = createFiche({ uct, name: 'Quentin Eleve', level: 'N2', content }, 'Fred', now);
  assert.equal(taken.model, 'N2L');
  // Sans évaluation ni commentaire : à remplir, par son moniteur s'il est reconnu parmi les membres.
  assert.deepEqual(taken.sessions.map((s) => [s.slot, s.teacher, s.filled?.by, s.event]), [
    ['Matin', { id: `uct:${'jeton-lucas-'.padEnd(24, 'x')}`, name: 'Lucas Moniteur' }, undefined, undefined],
    ['Après-midi', { id: '', name: 'Lucas' }, 'Fred', undefined],
    ['', { id: '', name: 'Zoé' }, 'Fred', undefined],
  ]);
  assert.deepEqual(taken.sessions[1]!.evals, { '1-check': 'ECA' });
  assert.deepEqual(taken.theory, { examen: { date: '2026-09-01', teacher: 'FH', note: '17/20' } });
  assert.deepEqual(taken.review, { status: { pratique: 'VALIDE' }, theoryDate: '', certDate: '2026-10-11', responsable: 'Fred' });
  assert.deepEqual(summarize(taken).todo.map((t) => [t.date, t.teacher]), [['2026-10-10', `uct:${'jeton-lucas-'.padEnd(24, 'x')}`]]);
  assert.deepEqual(summarize(taken).teachers, [`uct:${'jeton-lucas-'.padEnd(24, 'x')}`]);
});

test('outingSessions : rien tant que les palanquées ne sont pas validées, ni sur une fiche illisible', () => {
  assert.deepEqual(outingSessions(EV, outing({ validated: false })), []);
  assert.deepEqual(outingSessions(EV, null), []);
  assert.deepEqual(outingSessions(EV, { dives: [{ id: 'd1', validated: true, plan: 'x' }, 3] }), []);
});

test('applyOutingSessions : une séance remplie ne bouge plus, une séance à remplir suit la sortie', () => {
  const [anna] = outingSessions(EV, outing());
  let fiche = applyOutingSessions(newFiche(anna!.student, 'N2', 'DP', '2026-10-10T08:00:00Z'), EV, [anna!.session]);
  assert.equal(fiche.sessions.length, 1);

  // La profondeur réalisée arrive après coup : la séance à remplir la prend.
  fiche = applyOutingSessions(fiche, EV, [outingSessions(EV, outing({ depth: '19' }))[0]!.session]);
  assert.equal(fiche.sessions[0]!.depth, '19');

  // Une autre sortie ajoute sa séance ; elle ne touche pas à la première.
  const second = outingSessions(EV2, outing({ date: '2026-10-17' }))[0]!.session;
  fiche = applyOutingSessions(fiche, EV2, [second]);
  assert.deepEqual(fiche.sessions.map((s) => s.id), [`${EV}:d1`, `${EV2}:d1`]);

  // Plongée rouverte : la séance pas remplie disparaît, la remplie reste.
  const filled = { ...fiche, sessions: fiche.sessions.map((s) => (s.event === EV ? { ...s, comment: 'RAS', filled: { by: 'Lucas', at: 'x' } } : s)) };
  assert.deepEqual(applyOutingSessions(applyOutingSessions(filled, EV, []), EV2, []).sessions.map((s) => s.id), [`${EV}:d1`]);
  assert.equal(applyOutingSessions(filled, EV, [anna!.session]).sessions[0]!.comment, 'RAS', 'la sortie ne réécrit pas une séance remplie');
});

const actor = (over: Partial<FicheActor> = {}): FicheActor => ({ admin: false, ids: ['7', 'uct:lucas'], who: 'Lucas', now: '2026-10-11T10:00:00.000Z', ...over });
const ficheOf = (): Fiche => {
  const [anna] = outingSessions(EV, outing());
  return applyOutingSessions(newFiche(anna!.student, 'N2', 'DP', '2026-10-10T08:00:00Z'), EV, [anna!.session]);
};

test('applyFicheOp : l’enseignant remplit sa séance, pas celle d’un autre ; les validations sont aux admins', () => {
  const fiche = ficheOf();
  const sid = fiche.sessions[0]!.id;
  const patch = { depth: ' 18 m ', weight: '4 kg', comment: 'Bonne stabilisation', evals: { 'c-ok': 'A', 'c-bad': 'XX', 'Pas Un Id': 'A', 'c-eca': 'ECA' }, date: '2020-01-01' };
  const done = applyFicheOp(fiche, 'session', { session: sid, patch }, actor())!;
  const s = done.sessions[0]!;
  assert.deepEqual(s.evals, { 'c-ok': 'A', 'c-eca': 'ECA' }, 'codes et identifiants inconnus écartés');
  assert.deepEqual([s.depth, s.weight, s.comment, s.date], ['18 m', '4 kg', 'Bonne stabilisation', '2026-10-10'], 'la date d’une séance de sortie ne se change pas');
  assert.deepEqual(s.filled, { by: 'Lucas', at: '2026-10-11T10:00:00.000Z' });
  assert.equal(summarize(done).todo.length, 0);

  const other = actor({ ids: ['99', 'uct:other'], who: 'Raymond' });
  assert.throws(() => applyFicheOp(fiche, 'session', { session: sid, patch }, other), (e) => e instanceof FicheError && e.status === 403);
  assert.throws(() => applyFicheOp(fiche, 'review', { status: { certification: 'VALIDE' } }, actor()), (e) => e instanceof FicheError && e.status === 403);
  assert.throws(() => applyFicheOp(fiche, 'delete', null, actor()), (e) => e instanceof FicheError && e.status === 403);
  assert.throws(() => applyFicheOp(fiche, 'remove_session', { session: sid }, actor({ admin: true })), (e) => e instanceof FicheError && e.status === 400, 'une séance de sortie suit ses palanquées');

  const admin = actor({ admin: true, ids: ['1', 'uct:admin'], who: 'Fred' });
  const reviewed = applyFicheOp(done, 'review', { status: { certification: 'VALIDE', pratique: 'ATTENTE' }, certDate: '2026-10-12', responsable: 'Fred' }, admin)!;
  assert.deepEqual(reviewed.review, { status: { certification: 'VALIDE' }, theoryDate: '', certDate: '2026-10-12', responsable: 'Fred' });
  assert.equal(summarize(reviewed).certified, true);
  assert.equal(applyFicheOp(done, 'delete', null, admin), null);
});

test('applyFicheOp : séance ajoutée à la main, cours théorique, variante de grille', () => {
  const admin = actor({ admin: true, ids: ['1', 'uct:admin'], who: 'Fred' });
  let fiche = applyFicheOp(ficheOf(), 'add_session', { date: '2026-08-15', slot: 'Matin', teacher: 'Raymond' }, admin)!;
  assert.deepEqual(fiche.sessions.map((s) => s.date), ['2026-08-15', '2026-10-10'], 'rangées par date');
  const manual = fiche.sessions[0]!;
  assert.deepEqual(manual.teacher, { id: '', name: 'Raymond' });
  assert.throws(() => applyFicheOp(fiche, 'add_session', { slot: 'Matin' }, admin), (e) => e instanceof FicheError && e.status === 400);

  fiche = applyFicheOp(fiche, 'session', { session: manual.id, patch: { date: '2026-08-16', comment: 'Reprise de la fiche papier' } }, admin)!;
  assert.equal(fiche.sessions[0]!.date, '2026-08-16');
  fiche = applyFicheOp(fiche, 'theory', { key: 'examen', date: '2026-09-01', teacher: 'FH', note: '17/20' }, actor())!;
  assert.deepEqual(fiche.theory, { examen: { date: '2026-09-01', teacher: 'FH', note: '17/20' } });
  assert.deepEqual(applyFicheOp(fiche, 'theory', { key: 'examen' }, actor())!.theory, {}, 'un cours vidé disparaît');
  fiche = applyFicheOp(fiche, 'general', { text: 'Conso à surveiller', model: 'N2L' }, actor())!;
  assert.deepEqual([fiche.general, fiche.model], ['Conso à surveiller', 'N2L']);
  assert.equal(applyFicheOp(fiche, 'general', { model: 'N2' }, actor())!.model, undefined, 'la grille du niveau : pas de variante');
  assert.equal(applyFicheOp(fiche, 'remove_session', { session: manual.id }, admin)!.sessions.length, 1);
});

// ── Par l'API : la sortie enregistrée crée les fiches, chacun voit ce qui le regarde ──

const caller = (over: Partial<Caller> = {}): Caller => ({ id: 1, uct: 'uct-admin-'.padEnd(24, 'x'), email: 'admin@club.fr', name: 'Fred Admin', clubId: '12', vpdiveAdmin: true, headers: {}, ...over });
const deps = (store: Store, who: Caller): Deps => ({ identify: async () => who, isDpOf: async () => false, store: () => store });
const req = (method: 'GET' | 'POST', query: string, body?: unknown) =>
  new Request(`http://localhost/api/app?${query}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
const LUCAS = caller({ id: 7, uct: 'uct-lucas-'.padEnd(24, 'x'), email: 'lucas@club.fr', name: 'Lucas Moniteur', vpdiveAdmin: false });
const RAYMOND = caller({ id: 99, uct: 'uct-raymond-'.padEnd(24, 'x'), email: 'raymond@club.fr', name: 'Raymond Autre', vpdiveAdmin: false });
type ListBody = { fiches: FicheSummary[]; admin: boolean; me: string[] };
type FicheBody = { fiche: Fiche; error?: string };

test('training : valider les palanquées crée les fiches ; rouvrir la plongée retire les séances pas remplies', async () => {
  const store = memoryStore();
  const admin = deps(store, caller());
  const save = async (doc: unknown, baseRev: number) => {
    const res = await handleWith(req('POST', `action=outing&event=${EV}`, { doc, baseRev }), admin);
    assert.equal(res.status, 200);
  };
  const list = async (who: Deps) => (await (await handleWith(req('GET', 'action=training'), who)).json()) as ListBody;

  await save(outing({ validated: false }), 0);
  assert.deepEqual((await list(admin)).fiches, [], 'pas validé : pas de fiche');

  await save(outing(), 1);
  const all = await list(admin);
  assert.deepEqual(all.fiches.map((f) => [f.id, f.name, f.sessions, f.todo.length]).sort(), [
    ['N2.21', 'ELEVE Anna', 1, 1],
    ['N2.22', 'ELEVE Bob', 1, 1],
  ]);

  // L'enseignant voit ses élèves et remplit sa séance ; un autre encadrant ne voit rien.
  assert.equal((await list(deps(store, LUCAS))).fiches.length, 2);
  assert.deepEqual((await list(deps(store, RAYMOND))).fiches, []);
  assert.equal((await handleWith(req('GET', 'action=training&fiche=N2.21'), deps(store, RAYMOND))).status, 403);
  assert.equal((await handleWith(req('GET', 'action=training&fiche=N2.404'), deps(store, RAYMOND))).status, 403, 'un membre n’apprend pas qu’une fiche existe ou non');
  assert.equal((await handleWith(req('GET', 'action=training&fiche=N2.404'), admin)).status, 404);
  const filled = await handleWith(req('POST', 'action=training&fiche=N2.21', { op: 'session', session: `${EV}:d1`, patch: { comment: 'OK', evals: { 'c-1': 'A' } } }), deps(store, LUCAS));
  assert.equal(filled.status, 200);
  assert.equal(((await filled.json()) as FicheBody).fiche.sessions[0]!.filled?.by, 'Lucas Moniteur');
  assert.equal((await handleWith(req('POST', 'action=training&fiche=N2.21', { op: 'review', status: { certification: 'VALIDE' } }), deps(store, LUCAS))).status, 403);

  // Bob quitte la formation, la plongée est revalidée sans lui : sa fiche vide disparaît, celle d'Anna (remplie) reste.
  await save(outing({ members: [ANNA] }), 2);
  assert.deepEqual((await list(admin)).fiches.map((f) => [f.id, f.todo.length]), [['N2.21', 0]]);
  assert.equal(await store.get('club:12:fiche:N2.22'), null);

  // Plongée rouverte : la séance remplie d'Anna reste sur sa fiche.
  await save(outing({ validated: false }), 3);
  const anna = (await (await handleWith(req('GET', 'action=training&fiche=N2.21'), admin)).json()) as FicheBody;
  assert.equal(anna.fiche.sessions.length, 1);
  assert.equal(anna.fiche.sessions[0]!.comment, 'OK');
});

test('training : un admin crée une fiche à la main ; la sortie suivante y ajoute sa séance', async () => {
  const store = memoryStore();
  const admin = deps(store, caller());
  const uct = 'jeton-anna-'.padEnd(24, 'x');
  const create = (who: Deps, body: object) => handleWith(req('POST', 'action=training', { op: 'create', uct, name: 'Anna Eleve', level: 'N2', ...body }), who);
  assert.equal((await create(deps(store, LUCAS), {})).status, 403, 'réservé aux admins');
  const first = (await (await create(admin, {})).json()) as FicheBody & { created: boolean };
  assert.deepEqual([first.created, first.fiche.id, first.fiche.sessions.length], [true, `N2.uct_${uct}`, 0]);
  const again = (await (await create(admin, {})).json()) as FicheBody & { created: boolean };
  assert.equal(again.created, false, 'déjà là : rendue telle quelle');
  assert.equal((await create(admin, { content: { sessions: [{ date: '2026-08-15' }] } })).status, 409, 'une reprise du classeur n’écrase pas une fiche');

  assert.equal((await handleWith(req('POST', `action=outing&event=${EV}`, { doc: outing({ members: [{ ...ANNA, uct }] }), baseRev: 0 }), admin)).status, 200);
  const index = (await (await handleWith(req('GET', 'action=training'), admin)).json()) as ListBody;
  assert.deepEqual(index.fiches.map((f) => [f.id, f.sessions, f.name]), [[`N2.uct_${uct}`, 1, 'ELEVE Anna']], 'pas de seconde fiche pour le même membre');
});

test('training : une deuxième sortie ajoute une séance à remplir à la fiche existante', async () => {
  const store = memoryStore();
  const admin = deps(store, caller());
  for (const [event, date] of [
    [EV, '2026-10-10'],
    [EV2, '2026-10-17'],
  ] as const) {
    assert.equal((await handleWith(req('POST', `action=outing&event=${event}`, { doc: outing({ date, members: [ANNA] }), baseRev: 0 }), admin)).status, 200);
  }
  const body = (await (await handleWith(req('GET', 'action=training&fiche=N2.21'), admin)).json()) as FicheBody;
  assert.deepEqual(body.fiche.sessions.map((s) => [s.date, s.filled]), [
    ['2026-10-10', null],
    ['2026-10-17', null],
  ]);
  const index = (await (await handleWith(req('GET', 'action=training'), admin)).json()) as ListBody;
  assert.deepEqual([index.fiches[0]!.sessions, index.fiches[0]!.last, index.fiches[0]!.teachers], [2, '2026-10-17', ['7']]);
});
