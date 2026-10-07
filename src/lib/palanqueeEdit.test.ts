import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptitudesFromLabels, depthOf, proposePalanquees, validate, type Diver, type Plan } from './palanquees';
import { NO_TRAINING, addPalanquee, assignGuide, buddyPairs, deletePalanquee, moveDiver, refreshDivers, removeGuide, setDiverChoice, planToText, rosterToDivers, setDepth, setExtra, setType } from './palanqueeEdit';
import type { RosterEntry } from '../services/vpdiveApi';

const entry = (id: string, name: string, levels: string[], comment = '', age: number | null = 30): RosterEntry => ({
  id, name, firstname: name.split(' ')[1] ?? '', lastname: name.split(' ')[0] ?? '', levels, display: levels, training: [], roles: [],
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

  plan = moveDiver(plan, divers[0]!, 'new');
  const gp = plan.palanquees.at(-1)!;
  assert.equal(gp.guide?.id, '1');
  const left = plan.palanquees.find((p) => p.id === guided.id)!;
  assert.equal(left.guide, null, 'la palanquée quittée perd son encadrant');
  assert.equal(left.kind, 'autonomous', 'sans encadrant, une exploration est autonome');
  assert.ok(validate(left, 40).some((i) => /pas autonome/.test(i)), 'des N1 ne peuvent pas être autonomes : signalé');
});

test('choisir l’encadrant : il quitte sa place, l’ancien redevient disponible', () => {
  const divers = rosterToDivers([entry('a', 'A A', ['N4']), entry('b', 'B B', ['MF1']), entry('c', 'C C', ['N1'])]);
  let plan = proposePalanquees(divers);
  const p = plan.palanquees.find((x) => x.kind === 'guided')!;
  const before = p.guide!;
  const other = divers.find((d) => d.guide && d.id !== before.id)!;
  plan = assignGuide(plan, p.id, other);
  const after = plan.palanquees.find((x) => x.id === p.id)!;
  assert.equal(after.guide!.id, other.id);
  assert.ok(plan.unassigned.some((u) => u.diver.id === before.id), 'l’ancien encadrant est disponible');
  assert.equal(plan.palanquees.filter((x) => [x.guide, x.extra, ...x.members].some((d) => d?.id === other.id)).length, 1, 'une seule place');
});

test('export texte lisible', () => {
  const plan = proposePalanquees(rosterToDivers(roster.slice(0, 5)), { maxDepth: 40 });
  const text = planToText('Épave du Liban', plan);
  assert.match(text, /^Palanquées — Épave du Liban/);
  assert.match(text, /P1 · Exploration · PE20/);
  assert.match(text, /Encadrant : GUIDE Gaby \(GP\)/);
  assert.match(text, /PA40/);
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
  plan = setType(plan, id, 'teaching');
  assert.ok(validate(plan.palanquees[0]!).length > 0, 'pas d’enseignant parmi deux N3');
});

test('brevet étranger : prérogative retenue à la main, cumulable avec une formation', () => {
  // Cas réel : un Open Water PADI n'a aucune prérogative dans VPDive.
  const padi = entry('p', 'MARCHAIS Q', ['PADI - OWD']);
  assert.equal(rosterToDivers([padi])[0]!.pe, 0, 'sans choix du DP : pas de prérogative');

  let settings = setDiverChoice({}, 'levels', 'p', 'PE20');
  settings = setDiverChoice(settings, 'training', 'p', 'FN2');
  const [d] = rosterToDivers([padi], settings);
  assert.equal(d!.pe, 20, 'PE20 retenu');
  assert.equal(d!.training, 2, 'et en formation N2');
  assert.deepEqual(d!.original, ['PADI - OWD'], 'le brevet d’origine reste en vue');

  // En formation, il plonge en palanquée PE40 avec un E3.
  const plan = proposePalanquees([d!, ...rosterToDivers([entry('m', 'MONI M', ['E3'])])]);
  assert.equal(plan.palanquees[0]!.kind, 'teaching');
  assert.equal(depthOf(plan.palanquees[0]!), 40);

  // Effacer la formation garde la prérogative.
  settings = setDiverChoice(settings, 'training', 'p', '');
  assert.deepEqual(settings, { levels: { p: 'PE20' }, training: {} });
});

test('supprimer une palanquée libère tout le monde ; en créer une vide, même sans génération', () => {
  const divers = rosterToDivers([entry('g', 'G G', ['N4']), entry('a', 'A A', ['N1']), entry('b', 'B B', ['N1'])]);
  let plan = proposePalanquees(divers);
  const p = plan.palanquees[0]!;
  plan = deletePalanquee(plan, p.id);
  assert.equal(plan.palanquees.length, 0);
  assert.deepEqual(plan.unassigned.map((u) => u.diver.id).sort(), ['a', 'b', 'g']);

  plan = addPalanquee(plan, divers);
  const empty = plan.palanquees[0]!;
  assert.ok(validate(empty).length > 0, 'vide : bloque la validation');
  plan = assignGuide(plan, empty.id, divers[0]!);
  plan = moveDiver(plan, divers[1]!, empty.id);
  plan = moveDiver(plan, divers[2]!, empty.id);
  assert.deepEqual(validate(plan.palanquees[0]!), []);
  assert.equal(plan.unassigned.length, 0);

  // Composition entièrement à la main : tout le monde part des disponibles.
  const scratch = addPalanquee(null, divers, 'autonomous');
  assert.equal(scratch.palanquees.length, 1);
  assert.equal(scratch.unassigned.length, 3);
});

test('Exploration : encadrée dès qu’il y a un encadrant, autonome sinon', () => {
  const divers = rosterToDivers([entry('g', 'GUIDE G', ['P4']), entry('a', 'AOW A', ['PADI - AOW']), entry('b', 'AOW B', ['PADI - AOW'])], {
    levels: { a: 'PE40', b: 'PE40' },
  });
  let plan = addPalanquee(null, divers);
  const id = plan.palanquees[0]!.id;
  plan = moveDiver(plan, divers[1]!, id);
  plan = moveDiver(plan, divers[2]!, id);
  assert.equal(plan.palanquees[0]!.kind, 'autonomous', 'pas d’encadrant : autonome');
  assert.ok(validate(plan.palanquees[0]!).length > 0, 'des PE40 sans PA ne peuvent pas être autonomes');

  plan = assignGuide(plan, id, divers[0]!);
  assert.equal(plan.palanquees[0]!.kind, 'guided', 'un encadrant : encadrée');
  assert.deepEqual(validate(plan.palanquees[0]!), [], 'deux PADI AOW retenus PE40 avec un GP : exploration PE40');

  plan = removeGuide(plan, id);
  assert.equal(plan.palanquees[0]!.kind, 'autonomous');
  assert.ok(plan.unassigned.some((u) => u.diver.id === 'g'), 'l’encadrant retiré est disponible');

  // Formation : le même AOW, PE40 et FN2, avec un enseignant.
  const teacher = rosterToDivers([entry('m', 'MONI M', ['E3'])])[0]!;
  plan = assignGuide(plan, id, teacher);
  plan = setType(plan, id, 'teaching');
  assert.equal(plan.palanquees[0]!.kind, 'teaching');
  plan = setType(plan, id, 'exploration');
  assert.equal(plan.palanquees[0]!.kind, 'guided', 'retour en exploration, toujours encadrée');
});

test('un réglage changé après la génération se voit tout de suite dans la palanquée', () => {
  const roster = [entry('m', 'MONI M', ['E3']), entry('q', 'MARCHAIS Q', ['PADI - OWD'])];
  let settings = setDiverChoice(setDiverChoice({}, 'levels', 'q', 'PE20'), 'training', 'q', 'FN2');
  const plan = proposePalanquees(rosterToDivers(roster, settings));
  assert.equal(plan.palanquees[0]!.members[0]!.training, 2);
  settings = setDiverChoice(settings, 'training', 'q', '');
  const shown = refreshDivers(plan, rosterToDivers(roster, settings));
  assert.equal(shown.palanquees[0]!.members[0]!.training, 0, 'plus en formation');
  assert.ok(validate(shown.palanquees[0]!).length === 0 || shown.palanquees[0]!.kind === 'teaching', 'même place, valeurs à jour');
});

test('« Pas en formation » l’emporte sur une prépa VPDive', () => {
  const r = { ...entry('t', 'CHEVALIER Tom', ['P1']), training: ['Prépa N2'] };
  assert.equal(rosterToDivers([r])[0]!.training, 2, 'prépa N2 : FN2');
  assert.equal(rosterToDivers([r], setDiverChoice({}, 'training', 't', NO_TRAINING))[0]!.training, 0);
});

const diverOf = (name: string, ...labels: string[]): Diver => ({ id: name, name, labels, ...aptitudesFromLabels(labels) });

test('un élève FN# fait passer la palanquée en formation ; un moniteur qui enseigne remplace le GP', () => {
  const gp = diverOf('GP', 'N4');
  const mf1 = diverOf('MF1', 'MF1');
  const student = diverOf('Élève', 'P1', 'FN2');
  const plan: Plan = { palanquees: [{ id: 'p', kind: 'guided', guide: gp, extra: null, members: [diverOf('N2', 'P2'), mf1] }], unassigned: [{ diver: student, reason: '' }] };
  const p = moveDiver(plan, student, 'p').palanquees[0]!;
  assert.equal(p.kind, 'teaching');
  assert.equal(p.guide?.id, mf1.id, 'le MF1 enseigne');
  assert.ok(p.members.some((m) => m.id === gp.id), 'le GP plonge comme moniteur');
  assert.equal(setType({ ...plan, palanquees: [p] }, 'p', 'exploration').palanquees[0]!.kind, 'teaching', 'pas d’exploration avec un élève');
});

test('export texte : mêmes étiquettes que la fiche (E2 enseignant, moniteurs à la prérogative de la palanquée)', () => {
  const e2 = diverOf('E2', 'Initiateur', 'N4');
  const plan: Plan = {
    palanquees: [
      { id: 't', kind: 'teaching', guide: e2, extra: null, members: [diverOf('F1', 'FN1')] },
      { id: 'a', kind: 'autonomous', guide: null, extra: null, members: [diverOf('N2', 'P2'), diverOf('M1', 'MF2'), diverOf('M2', 'MF2')] },
    ],
    unassigned: [],
  };
  const text = planToText('Test', plan);
  assert.match(text, /Enseignant : E2 \(E2\)/);
  assert.match(text, /- M1 \(PA20\)/);
  assert.match(text, /- N2 \(PA20\)/);
});

test('plongeur supplémentaire à la main vers une exploration encadrée ; un E1 seul ouvre une palanquée comme plongeur', () => {
  const g = diverOf('G', 'N4');
  const gp2 = diverOf('GP2', 'N4');
  let plan: Plan = { palanquees: [{ id: 'p', kind: 'guided', guide: g, extra: null, members: [diverOf('N1', 'P1')] }], unassigned: [{ diver: gp2, reason: '' }] };
  plan = setExtra(plan, 'p', gp2);
  assert.equal(plan.palanquees[0]!.extra?.id, gp2.id);
  assert.equal(plan.unassigned.length, 0);
  const ini = diverOf('Ini', 'Initiateur', 'N2');
  const fresh = moveDiver({ palanquees: [], unassigned: [{ diver: ini, reason: '' }] }, ini, 'new').palanquees[0]!;
  assert.equal(fresh.guide, null, 'un E1 seul n’encadre pas en exploration');
  assert.deepEqual(fresh.members.map((m) => m.id), [ini.id]);
});
