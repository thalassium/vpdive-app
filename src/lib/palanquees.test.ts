import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptitudesFromLabels, aptLabel, chosenDepth, depthOf, prerogativeLabel, proposePalanquees, validate, type Diver, type Palanquee } from './palanquees';

let n = 0;
const diver = (name: string, ...labels: string[]): Diver => ({ id: `d${++n}`, name, labels, ...aptitudesFromLabels(labels) });

test('libellés VPDive → aptitudes (annexe III-14 b)', () => {
  assert.deepEqual(aptitudesFromLabels(['Niveau 1']), { pe: 20, pa: 0, guide: null, teach: 0, training: 0, beginner: false, child: false, canBeExtra: false });
  assert.equal(aptitudesFromLabels(['N1 incluant l’autonomie']).pa, 12);
  assert.deepEqual(aptitudesFromLabels(['Niveau 2']), { pe: 40, pa: 20, guide: null, teach: 0, training: 0, beginner: false, child: false, canBeExtra: false });
  assert.deepEqual(aptitudesFromLabels(['PE-40']), { pe: 40, pa: 0, guide: null, teach: 0, training: 0, beginner: false, child: false, canBeExtra: false });
  assert.equal(aptitudesFromLabels(['PA 20']).pa, 20);
  assert.equal(aptitudesFromLabels(['PA20']).pe, 20, 'PA-20 suppose PE-20');
  assert.deepEqual(aptitudesFromLabels(['N3']), { pe: 60, pa: 60, guide: null, teach: 0, training: 0, beginner: false, child: false, canBeExtra: false });
  assert.equal(aptitudesFromLabels(['Guide de palanquée']).guide, 'GP');
  assert.equal(aptitudesFromLabels(['Niveau 4']).guide, 'GP');
  assert.equal(aptitudesFromLabels(['Initiateur', 'Niveau 3']).guide, 'E1');
  assert.equal(aptitudesFromLabels(['Initiateur', 'N4']).guide, 'GP', 'E2 = Initiateur + GP : encadre comme un GP en exploration');
  assert.equal(aptitudesFromLabels(['E2']).guide, 'GP');
  assert.equal(aptitudesFromLabels(['Initiateur', 'Niveau 3']).pa, 60, 'un E1 garde son autonomie de N3');
  assert.equal(aptitudesFromLabels(['MF1']).guide, 'E3');
  assert.equal(aptitudesFromLabels(['MF2', 'MF1']).guide, 'E4');
  assert.equal(aptitudesFromLabels(['Débutant']).beginner, true);
  assert.equal(aptitudesFromLabels(['Niveau 10']).pe, 0, 'pas de faux positif sur N10');
  assert.equal(aptitudesFromLabels(['Apnéiste']).pe, 0);
});

// Libellés relevés tels quels sur les inscrits du club (npm run probe, octobre 2026)
// et dans le référentiel des capacités VPDive.
test('libellés réels de VPDive', () => {
  const apt = (...l: string[]) => aptitudesFromLabels(l);
  assert.equal(apt('P1').pe, 20);
  assert.equal(apt('P1-ANMP').pe, 20);
  assert.equal(apt('P1-PE20-FSGT').pe, 20);
  assert.deepEqual([apt('P2').pe, apt('P2').pa], [40, 20]);
  assert.deepEqual([apt('P3-ANMP').pe, apt('P3-ANMP').pa], [60, 60]);
  assert.equal(apt('P4').guide, 'GP');
  assert.equal(apt('P4-ANMP').guide, 'GP');
  assert.equal(apt('GP-FSGT').guide, 'GP');
  assert.equal(apt('P5-DPE').guide, 'GP');
  assert.equal(apt('PE40').pe, 40);
  assert.equal(apt('PE-40').pe, 40);
  assert.equal(apt('PA-60').pa, 60);
  assert.equal(apt('E2').guide, 'GP');
  assert.equal(apt('E3').guide, 'E3');
  assert.equal(apt('E3 A').guide, 'E3');
  assert.equal(apt('MF-AS').guide, 'E3');
  assert.equal(apt('E4').guide, 'E4');
  assert.equal(apt('P - Enseignant 3 - Moniteur Fédéral - 1 er degré').guide, 'E3');
  assert.equal(apt('P-Plongeur Niveau 4 (P4-N4)').guide, 'GP');
  assert.equal(apt('Moniteur 2 *').guide, 'E3');
  assert.equal(apt('Moniteur 1 * CMAS').guide, 'GP', 'Moniteur 1★ = E2 : encadre comme un GP en exploration');

  // CMAS : un 2★ n'est pas un N2 (annexe III-14 b).
  assert.deepEqual([apt('CMAS - P*').pe, apt('CMAS - P*').pa], [20, 0]);
  assert.deepEqual([apt('CMAS - P **').pe, apt('CMAS - P **').pa], [20, 12]);
  assert.deepEqual([apt('CMAS - P ***').pe, apt('CMAS - P ***').pa], [40, 20]);

  assert.equal(apt('Pass-Découverte').beginner, true);
  assert.equal(apt('P-Pp').beginner, true);
  assert.equal(apt('Pbr').child, true);
  assert.equal(apt('Por').child, true);

  // Qualifications sans rapport avec la plongée en scaphandre : ignorées.
  for (const other of ['IE2', 'PNC', 'MNC', 'RIFA-P', 'RIFA-A', 'TSI', 'AC', 'PA1', 'PB1', 'FB1-EB', 'EH1 - Technique', 'PN', 'PA', 'P.A.E.-1', 'TIV']) {
    const a = apt(other);
    assert.deepEqual([a.pe, a.pa, a.guide, a.beginner], [0, 0, null, false], other);
  }
  // Brevets étrangers : pas d'équivalence officielle, le DP décide (niveau à choisir à la main).
  assert.equal(apt('PADI - AOW').pe, 0);
  assert.equal(apt('OWSI / AI').guide, null);
});

test('un plongeur enfant n’est jamais placé automatiquement', () => {
  const plan = proposePalanquees([diver('G', 'N4'), diver('Kid', 'Por'), diver('A', 'N1')]);
  assert.match(plan.unassigned.find((u) => u.diver.name === 'Kid')!.reason, /enfant/);
});

test('N1 encadrés par un GP, N3 en autonomie (sortie à 40 m)', () => {
  const gp = diver('Gaby', 'N4');
  const n1 = [diver('Anna', 'N1'), diver('Bob', 'N1'), diver('Chloé', 'PE20')];
  const n3 = [diver('Dan', 'N3'), diver('Eve', 'N3')];
  const plan = proposePalanquees([gp, ...n1, ...n3], { maxDepth: 40 });

  assert.equal(plan.unassigned.length, 0);
  const guided = plan.palanquees.filter((p) => p.kind === 'guided');
  const auto = plan.palanquees.filter((p) => p.kind === 'autonomous');
  assert.equal(guided.length, 1);
  assert.equal(guided[0]!.guide!.name, 'Gaby');
  assert.equal(guided[0]!.members.length, 3);
  assert.equal(depthOf(guided[0]!, 40), 20);
  assert.equal(auto.length, 1);
  assert.equal(depthOf(auto[0]!, 40), 40);
  for (const p of plan.palanquees) assert.deepEqual(validate(p, 40), []);
});

test('jamais plus de 4 plongeurs encadrés par encadrant', () => {
  const guides = [diver('G1', 'N4'), diver('G2', 'N4')];
  const n1 = Array.from({ length: 7 }, (_, i) => diver(`N1-${i}`, 'N1'));
  const plan = proposePalanquees([...guides, ...n1]);
  const guided = plan.palanquees.filter((p) => p.kind === 'guided');
  assert.equal(guided.length, 2);
  assert.deepEqual(guided.map((p) => p.members.length).sort(), [3, 4]);
});

test('encadrants insuffisants : les plongeurs en trop sont signalés, pas placés en douce', () => {
  const plan = proposePalanquees([diver('G', 'N4'), ...Array.from({ length: 6 }, (_, i) => diver(`P${i}`, 'N1'))]);
  assert.equal(plan.palanquees[0]!.members.length, 4);
  assert.equal(plan.unassigned.length, 2);
  assert.match(plan.unassigned[0]!.reason, /encadrants/);
});

test('N2 encadrés à 40 m s’il y a des encadrants, autonomes à 20 m sinon', () => {
  const n2 = [diver('A', 'N2'), diver('B', 'N2'), diver('C', 'N2')];

  const withGuide = proposePalanquees([diver('G', 'N4'), ...n2], { maxDepth: 40 });
  assert.equal(withGuide.palanquees.length, 1);
  assert.equal(withGuide.palanquees[0]!.kind, 'guided');
  assert.equal(depthOf(withGuide.palanquees[0]!, 40), 40);

  const noGuide = proposePalanquees(n2, { maxDepth: 40 });
  assert.equal(noGuide.palanquees[0]!.kind, 'autonomous');
  assert.equal(depthOf(noGuide.palanquees[0]!, 40), 20);

  // À 20 m les N2 sont autonomes : le GP n'a personne à encadrer et plonge avec eux.
  const shallow = proposePalanquees([diver('G', 'N4'), ...n2], { maxDepth: 20 });
  assert.ok(shallow.palanquees.every((p) => p.kind === 'autonomous'));
  assert.equal(shallow.palanquees.reduce((s, p) => s + p.members.length, 0), 4);
});

test('le moins qualifié suffisant encadre : le MF2 reste pour les PE-60', () => {
  const e4 = diver('Mo', 'MF2');
  const gp = diver('Guy', 'N4');
  const pe60 = [diver('X', 'PE60'), diver('Y', 'PE60')];
  const n1 = [diver('Z', 'N1')];
  const plan = proposePalanquees([e4, gp, ...pe60, ...n1], { maxDepth: 60 });
  const deep = plan.palanquees.find((p) => p.members.some((m) => m.name === 'X'))!;
  assert.equal(deep.guide!.name, 'Mo');
  assert.equal(depthOf(deep, 60), 60);
  const shallow = plan.palanquees.find((p) => p.members.some((m) => m.name === 'Z'))!;
  assert.equal(shallow.guide!.name, 'Guy');
});

test('un seul encadrant pour deux niveaux : une palanquée, limitée au moins qualifié', () => {
  const plan = proposePalanquees([diver('G', 'N4'), diver('A', 'PE40'), diver('B', 'PE40'), diver('C', 'N1')], { maxDepth: 40 });
  assert.equal(plan.palanquees.length, 1);
  assert.equal(plan.palanquees[0]!.members.length, 3);
  assert.equal(depthOf(plan.palanquees[0]!, 40), 20);
  assert.equal(plan.unassigned.length, 0);
});

test('deux encadrants : les niveaux restent séparés plutôt que de brider les PE-40', () => {
  const plan = proposePalanquees([diver('G1', 'N4'), diver('G2', 'N4'), diver('A', 'PE40'), diver('B', 'PE40'), diver('C', 'N1')], {
    maxDepth: 40,
  });
  assert.deepEqual(plan.palanquees.map((p) => depthOf(p, 40)).sort(), [20, 40]);
});

test('les N2 partent en autonomie à 20 m plutôt que de faire descendre des N1 à 6 m', () => {
  // Cas réel : 2 encadrants, des PE-40/N2, des N1 et un débutant.
  const plan = proposePalanquees(
    [
      diver('Gaby', 'N4'), diver('Hélène', 'MF1'),
      diver('Sami', 'PE40'), diver('Paul', 'N2'), diver('Marc', 'N2'),
      diver('Chloé', 'PE20'), diver('Anna', 'N1'), diver('Bruno', 'N1'),
      diver('Zoé', 'Débutant'),
      diver('Tom', 'N3'), diver('Dan', 'N3'), diver('Eve', 'N3'),
    ],
    { maxDepth: 40 },
  );
  const depthFor = (name: string) => depthOf(plan.palanquees.find((p) => p.members.some((m) => m.name === name))!, 40);
  assert.equal(plan.unassigned.length, 0);
  assert.equal(depthFor('Anna'), 20, 'les N1 plongent à 20 m');
  assert.equal(depthFor('Zoé'), 6);
  assert.equal(depthFor('Paul'), 20, 'N2 autonome');
  assert.equal(depthFor('Tom'), 40);
  for (const p of plan.palanquees) assert.deepEqual(validate(p, 40), [], p.members.map((m) => m.name).join());
});

test('un autonome seul devient plongeur supplémentaire s’il est GP', () => {
  const plan = proposePalanquees([diver('G1', 'N4'), diver('G2', 'N4'), diver('A', 'N1')], { maxDepth: 20 });
  const p = plan.palanquees[0]!;
  assert.equal(plan.palanquees.length, 1);
  assert.equal(p.extra?.name, 'G2');
  assert.deepEqual(validate(p, 20), []);
});

test('palanquées autonomes de 2 ou 3, jamais 1 ni 4', () => {
  for (const count of [2, 3, 4, 5, 7]) {
    const plan = proposePalanquees(Array.from({ length: count }, (_, i) => diver(`A${i}`, 'N3')));
    for (const p of plan.palanquees) assert.ok(p.members.length >= 2 && p.members.length <= 3, `${count} → ${p.members.length}`);
    assert.equal(plan.palanquees.reduce((s, p) => s + p.members.length, 0), count);
  }
});

test('un mineur n’est jamais autonome', () => {
  const kid = { ...diver('Kid', 'N2'), minor: true };
  const plan = proposePalanquees([kid, diver('A', 'N2'), diver('B', 'N2')], { maxDepth: 20 });
  assert.ok(plan.palanquees.every((p) => !(p.kind === 'autonomous' && p.members.includes(kid))));
  assert.equal(plan.unassigned[0]?.diver, kid);
});

test('validate signale les erreurs d’une palanquée modifiée à la main', () => {
  const n1 = diver('N1', 'N1');
  const bad: Palanquee = { id: 'x', kind: 'autonomous', guide: null, extra: null, members: [n1, diver('N3', 'N3')] };
  assert.ok(validate(bad, 40).some((i) => /pas autonome/.test(i)));

  const crowded: Palanquee = {
    id: 'y', kind: 'guided', guide: diver('G', 'N4'), extra: null,
    members: Array.from({ length: 5 }, (_, i) => diver(`P${i}`, 'N1')),
  };
  assert.ok(validate(crowded, 40).some((i) => /4 au maximum/.test(i)));
});

test('les binômes demandés sont réunis quand c’est possible', () => {
  const g = [diver('G1', 'N4'), diver('G2', 'N4')];
  const a = diver('Alice', 'N1');
  const b = diver('Bruno', 'N1');
  const rest = Array.from({ length: 6 }, (_, i) => diver(`P${i}`, 'N1'));
  // Alice et Bruno en tête et en queue de liste : sans binôme ils seraient séparés.
  const plan = proposePalanquees([...g, a, ...rest, b], { buddies: [[a.id, b.id]] });
  const home = plan.palanquees.find((p) => p.members.includes(a))!;
  assert.ok(home.members.includes(b));
  for (const p of plan.palanquees) assert.deepEqual(validate(p, 40), []);
});

test('prérogative la plus haute : un N4 + MF1 est MF1 (E3)', () => {
  const a = aptitudesFromLabels(['P4', 'E3']);
  assert.equal(a.guide, 'E3');
  assert.equal(a.teach, 3);
  assert.equal(aptLabel(a), 'E3');
  assert.equal(aptLabel(aptitudesFromLabels(['E2'])), 'E2 / GP');
  assert.equal(aptLabel(aptitudesFromLabels(['P4'])), 'GP');
  assert.equal(aptLabel(aptitudesFromLabels(['P2'])), 'PA20 / PE40');
  assert.equal(aptLabel(aptitudesFromLabels(['P3'])), 'PA60');
  assert.equal(aptLabel(aptitudesFromLabels(['P1'])), 'PE20');
});

test('formation : FN# lu dans les libellés', () => {
  assert.equal(aptitudesFromLabels(['FN2']).training, 2);
  assert.equal(aptitudesFromLabels(['Prépa N2']).training, 2);
  assert.equal(aptitudesFromLabels(['Formation niveau 1']).training, 1);
  assert.equal(aptitudesFromLabels(['P1', 'FN2']).pe, 20, 'garde son niveau actuel');
  assert.equal(aptLabel(aptitudesFromLabels(['P1', 'FN2'])), 'FN2');
  assert.equal(aptitudesFromLabels(['SECTION SPORTIVE']).training, 0);
});

test('les élèves FN# plongent avec un enseignant dont la zone suffit', () => {
  const plan = proposePalanquees([
    diver('Mo', 'MF1'), diver('Ed', 'E2'), diver('Guy', 'N4'),
    diver('F2a', 'P1', 'FN2'), diver('F2b', 'P1', 'FN2'),
    diver('F1a', 'FN1'), diver('F1b', 'FN1'),
    diver('N1a', 'N1'), diver('N1b', 'N1'),
  ]);
  const of = (name: string) => plan.palanquees.find((p) => p.members.some((m) => m.name === name))!;
  assert.equal(of('F2a').kind, 'teaching');
  assert.equal(of('F2a').guide!.name, 'Mo', 'FN2 : E3, 40 m');
  assert.equal(chosenDepth(of('F2a')), 40);
  assert.equal(of('F1a').guide!.name, 'Ed', 'FN1 : E2 suffit, le MF1 reste pour les FN2');
  assert.equal(chosenDepth(of('F1a')), 20);
  assert.equal(of('N1a').kind, 'guided');
  assert.equal(of('N1a').guide!.name, 'Guy');
  assert.equal(prerogativeLabel(of('F2a')), 'Formation E3 · 40 m');
  for (const p of plan.palanquees) assert.deepEqual(validate(p), [], p.members.map((m) => m.name).join());
});

test('élève sans enseignant : signalé, jamais confié à un simple GP', () => {
  const plan = proposePalanquees([diver('Guy', 'N4'), diver('F1', 'FN1'), diver('N1', 'N1')]);
  assert.match(plan.unassigned.find((u) => u.diver.name === 'F1')!.reason, /aucun enseignant/);
});

test('profondeur par palanquée : 40 m au plus en automatique, 60 m seulement à la main', () => {
  const plan = proposePalanquees([diver('A', 'N3'), diver('B', 'N3'), diver('C', 'N2'), diver('D', 'N2')]);
  const deep = plan.palanquees.find((p) => p.members.some((m) => m.name === 'A'))!;
  const n2 = plan.palanquees.find((p) => p.members.some((m) => m.name === 'C'))!;
  assert.equal(depthOf(deep), 60, 'prérogative PA60');
  assert.equal(chosenDepth(deep), 40, 'proposée à 40 m');
  assert.equal(prerogativeLabel(deep), 'PA 40');
  assert.equal(chosenDepth({ ...deep, depth: 60 }), 60);
  assert.equal(prerogativeLabel({ ...deep, depth: 20 }), 'PA 20');
  assert.equal(prerogativeLabel(n2), 'PA 20');
  assert.ok(validate({ ...n2, depth: 40 }).some((i) => /dépasse la prérogative/.test(i)));
});
