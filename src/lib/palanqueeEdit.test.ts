import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposePalanquees, validate } from './palanquees';
import { buddyPairs, moveDiver, planToText, rosterToDivers, setDepth, setGuide, setKind } from './palanqueeEdit';
import type { RosterEntry } from '../services/vpdiveApi';

const entry = (id: string, name: string, levels: string[], comment = '', age: number | null = 30): RosterEntry => ({
  id, name, firstname: name.split(' ')[1] ?? '', lastname: name.split(' ')[0] ?? '', levels, training: [], roles: [],
  age, waitingList: false, comment, medical: { until: null, valid: true },
});

const roster = [
  entry('1', 'GUIDE Gaby', ['Niveau 4']),
  entry('2', 'ANNA Lise', ['Niveau 1'], 'Binôme souhaité : Bruno Martn'),
  entry('3', 'MARTIN Bruno', ['Niveau 1']),
  entry('4', 'NOEL Dan', ['Niveau 3']),
  entry('5', 'EVE Line', ['Niveau 3']),
  entry('6', 'SANS Niveau', []),
];

test('inscrits VPDive → plongeurs, avec niveau corrigé à la main', () => {
  const divers = rosterToDivers(roster, { levels: { '6': 'N2' } });
  assert.equal(divers.find((d) => d.id === '1')!.guide, 'GP');
  assert.equal(divers.find((d) => d.id === '6')!.pa, 20);
  assert.deepEqual(divers.find((d) => d.id === '6')!.labels, ['N2']);
});

test('binôme écrit à l’inscription retrouvé parmi les inscrits malgré la faute', () => {
  assert.deepEqual(buddyPairs(roster), [['2', '3']]);
});

test('déplacer, nommer encadrant, basculer en autonome', () => {
  const divers = rosterToDivers(roster.slice(0, 5));
  let plan = proposePalanquees(divers, { maxDepth: 40 });
  const guided = plan.palanquees.find((p) => p.kind === 'guided')!;
  const auto = plan.palanquees.find((p) => p.kind === 'autonomous')!;
  const dan = divers.find((d) => d.id === '4')!;

  plan = moveDiver(plan, dan, guided.id);
  assert.ok(plan.palanquees.find((p) => p.id === guided.id)!.members.includes(dan));
  // L'autre N3 reste seul en autonomie : non conforme, et l'écran le signale.
  assert.ok(validate(plan.palanquees.find((p) => p.id === auto.id)!, 40).length > 0);

  plan = moveDiver(plan, dan, 'unassigned');
  assert.equal(plan.unassigned.at(-1)!.diver, dan);

  const lone = plan.palanquees.find((p) => p.id === auto.id)!;
  plan = setKind(plan, lone.id, 'guided');
  assert.equal(plan.palanquees.find((p) => p.id === lone.id)!.kind, 'guided');

  plan = moveDiver(plan, divers[0]!, 'new');
  const gp = plan.palanquees.at(-1)!;
  assert.equal(gp.guide?.id, '1');
  const left = plan.palanquees.find((p) => p.id === guided.id)!;
  assert.equal(left.guide, null, 'la palanquée quittée perd son encadrant');
  assert.ok(validate(left, 40).includes('Pas d’encadrant.'));
});

test('setGuide échange encadrant et membre', () => {
  const divers = rosterToDivers([entry('a', 'A', ['N4']), entry('b', 'B', ['MF1']), entry('c', 'C', ['N1'])]);
  let plan = proposePalanquees(divers);
  const p = plan.palanquees.find((x) => x.kind === 'guided')!;
  const other = divers.find((d) => d.id !== p.guide!.id && d.guide)!;
  plan = moveDiver(plan, other, p.id);
  plan = setGuide(plan, p.id, other.id);
  const after = plan.palanquees.find((x) => x.id === p.id)!;
  assert.equal(after.guide!.id, other.id);
  assert.ok(after.members.some((m) => m.id === p.guide!.id));
});

test('export texte lisible', () => {
  const plan = proposePalanquees(rosterToDivers(roster.slice(0, 5)), { maxDepth: 40 });
  const text = planToText('Épave du Liban', plan);
  assert.match(text, /^Palanquées — Épave du Liban/);
  assert.match(text, /P1 · PE 20/);
  assert.match(text, /Encadrant : GUIDE Gaby \(GP \/ N4\)/);
  assert.match(text, /PA 40/);
});

test('mineurs repérés par l’âge, formation choisie à la main', () => {
  const [kid, adult] = rosterToDivers([entry('k', 'JEUNE Kim', ['P2'], '', 17), entry('a', 'GRAND Al', ['P2'], '', 40)], { training: { a: 'FN3' } });
  assert.equal(kid!.minor, true);
  assert.equal(adult!.minor, false);
  assert.equal(adult!.training, 3);
  assert.deepEqual(adult!.labels, ['P2', 'FN3']);
});

test('profondeur et type changés à la main', () => {
  const divers = rosterToDivers([entry('a', 'A A', ['N3']), entry('b', 'B B', ['N3'])]);
  let plan = proposePalanquees(divers);
  const id = plan.palanquees[0]!.id;
  plan = setDepth(plan, id, 60);
  assert.equal(plan.palanquees[0]!.depth, 60);
  assert.deepEqual(validate(plan.palanquees[0]!), []);
  plan = setKind(plan, id, 'teaching');
  assert.ok(validate(plan.palanquees[0]!).length > 0, 'pas d’enseignant parmi deux N3');
});
