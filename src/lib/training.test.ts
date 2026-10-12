import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, VARIANTS, latestEvals, modelOf, progress, sessionState, todoCount, type Fiche, type FicheSession } from './training';

test('grilles : identifiants de compétence uniques dans chaque grille, à la forme que le serveur accepte', () => {
  for (const model of Object.values(MODELS)) {
    const ids = model.sections.flatMap((s) => s.items.map((c) => c.id));
    assert.equal(new Set(ids).size, ids.length, `${model.id} : identifiants en double`);
    for (const id of [...ids, ...model.theory.map((t) => t.id), ...model.review.map((r) => r.id)]) assert.match(id, /^[a-z0-9-]{1,48}$/, `${model.id} : ${id}`);
  }
  // Les fiches du club : 28 compétences au niveau 1, 36 au niveau 2, 36 au niveau 3.
  const count = (id: string) => MODELS[id]!.sections.reduce((n, s) => n + s.items.length, 0);
  assert.deepEqual([count('N1'), count('N2'), count('N2L'), count('N3')], [28, 36, 49, 36]);
  assert.deepEqual([MODELS.N1!.forfait, MODELS.N2!.forfait, MODELS.N3!.forfait], [5, 10, 10]);
});

test('modelOf : la grille du niveau, ou la variante choisie si elle est de ce niveau', () => {
  assert.equal(modelOf({ level: 'N2' }).id, 'N2');
  assert.equal(modelOf({ level: 'N2', model: 'N2L' }).id, 'N2L');
  assert.equal(modelOf({ level: 'N1', model: 'N2L' }).id, 'N1');
  for (const [level, ids] of Object.entries(VARIANTS)) assert.equal(ids[0], level);
});

const session = (id: string, date: string, evals: FicheSession['evals'], filled = true): FicheSession => ({
  id,
  label: '',
  date,
  slot: '',
  objective: 'FN1',
  teacher: { id: '7', name: 'Lucas' },
  depth: '',
  duration: '',
  weight: '',
  evals,
  comment: '',
  filled: filled ? { by: 'Lucas', at: date } : null,
});

test('latestEvals et progress : la dernière évaluation de chaque compétence', () => {
  const [a, b] = MODELS.N1!.sections[0]!.items;
  const sessions = [session('s1', '2026-07-05', { [a!.id]: 'ECA', [b!.id]: 'A' }), session('s2', '2026-07-11', { [a!.id]: 'A', [b!.id]: 'NE' })];
  assert.deepEqual(latestEvals(sessions), { [a!.id]: 'A', [b!.id]: 'A' }, '« non évalué » ne remplace pas « acquis »');
  assert.deepEqual(latestEvals(sessions, 's2'), { [a!.id]: 'ECA', [b!.id]: 'A' }, 'avant la séance 2');
  const fiche = { level: 'N1', sessions } as Fiche;
  assert.deepEqual(progress(fiche), { acquired: 2, total: 28 });
});

test('sessionState et todoCount : une plongée à venir n’est pas encore à remplir', () => {
  assert.equal(sessionState(session('s', '2026-10-10', {}), '2026-10-12'), 'filled');
  assert.equal(sessionState(session('s', '2026-10-10', {}, false), '2026-10-12'), 'todo');
  assert.equal(sessionState(session('s', '2026-10-17', {}, false), '2026-10-12'), 'upcoming');
  const todo = [
    { id: 'a', date: '2026-10-10', teacher: '7' },
    { id: 'b', date: '2026-10-10', teacher: '9' },
    { id: 'c', date: '2026-10-17', teacher: '7' },
  ];
  assert.equal(todoCount({ todo }, '2026-10-12'), 2);
  assert.equal(todoCount({ todo }, '2026-10-12', ['7', 'uct:x']), 1);
});
