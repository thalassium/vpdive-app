import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsExtra, aptitudesFromLabels, chosenDepth, depthOf, guideLabel, kindLabel, lowestTeacher, memberLabel, minTeachFor, trainingLabel, settleKind, toTeaching, prerogativeCode, prerogativeLabel, proposePalanquees, validate, type Diver, type Palanquee, type Plan } from './palanquees';

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

test('les N2 sont autonomes PA20 entre eux ; un encadrant libre plonge avec eux', () => {
  const n2 = [diver('A', 'N2'), diver('B', 'N2'), diver('C', 'N2')];
  const plan = proposePalanquees([diver('G', 'N4'), ...n2]);
  assert.ok(plan.palanquees.every((p) => p.kind === 'autonomous'));
  assert.equal(plan.palanquees.reduce((s, p) => s + p.members.length, 0), 4);
  assert.ok(plan.palanquees.every((p) => chosenDepth(p) === 20), 'prérogative du moins formé : PA20');
});

test('autonomes regroupés par prérogative : PA60 ensemble, PA20 ensemble', () => {
  const plan = proposePalanquees([diver('N3a', 'N3'), diver('N3b', 'N3'), diver('N2a', 'N2'), diver('N2b', 'N2'), diver('N3c', 'N3')], { maxDepth: 60 });
  const of = (n: string) => plan.palanquees.find((p) => p.members.some((m) => m.name === n))!;
  assert.equal(of('N3a'), of('N3c'));
  assert.equal(chosenDepth({ ...of('N3a'), depth: 60 }), 60);
  assert.equal(of('N2a'), of('N2b'));
  assert.equal(depthOf(of('N2a')), 20);
});

test('un PA40 seul à son niveau rejoint les PA20 (la palanquée reste PA20)', () => {
  const plan = proposePalanquees([diver('X', 'PA40'), diver('A', 'N2'), diver('B', 'N2')]);
  assert.equal(plan.palanquees.length, 1);
  assert.equal(depthOf(plan.palanquees[0]!), 20);
});

test('un E1 n’encadre que des débutants ; les N1 attendent un N4/GP', () => {
  const plan = proposePalanquees([diver('Ini', 'Initiateur', 'N2'), diver('Bob', 'Débutant'), diver('N1', 'N1')]);
  const bob = plan.palanquees.find((p) => p.members.some((m) => m.name === 'Bob'))!;
  assert.equal(bob.guide!.name, 'Ini');
  assert.match(plan.unassigned.find((u) => u.diver.name === 'N1')!.reason, /N4\/GP/);
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

test('un mineur avec une aptitude PA est autonome : l’aptitude décide, pas l’âge', () => {
  const kid = { ...diver('Kid', 'N2'), minor: true };
  const plan = proposePalanquees([kid, diver('A', 'N2'), diver('B', 'N2')], { maxDepth: 20 });
  const p = plan.palanquees.find((x) => x.members.includes(kid));
  assert.equal(p?.kind, 'autonomous');
  assert.deepEqual(validate(p!, 20), []);
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
  assert.equal(prerogativeCode(a), 'E3');
  assert.equal(prerogativeCode(aptitudesFromLabels(['E2'])), 'E2');
  assert.equal(prerogativeCode(aptitudesFromLabels(['P4'])), 'GP');
  assert.equal(prerogativeCode(aptitudesFromLabels(['P2'])), 'PE40 · PA20');
  assert.equal(prerogativeCode(aptitudesFromLabels(['P3'])), 'PA60');
  assert.equal(prerogativeCode(aptitudesFromLabels(['P1'])), 'PE20');
});

test('formation : FN# lu dans les libellés', () => {
  assert.equal(aptitudesFromLabels(['FN2']).training, 2);
  assert.equal(aptitudesFromLabels(['Prépa N2']).training, 2);
  assert.equal(aptitudesFromLabels(['Formation niveau 1']).training, 1);
  assert.equal(aptitudesFromLabels(['P1', 'FN2']).pe, 20, 'garde son niveau actuel');
  assert.equal(memberLabel(diver('X', 'P1', 'FN2'), { id: 't', kind: 'teaching', guide: null, extra: null, members: [] }), 'PE20', 'sans enseignant, sa propre aptitude, pas l’objectif');
  assert.equal(aptitudesFromLabels(['SECTION SPORTIVE']).training, 0);
  // Un élève en prépa N2 n'est pas encore N2.
  const prepa = aptitudesFromLabels(['P1', 'Prépa N2']);
  assert.deepEqual([prepa.pe, prepa.pa, prepa.training], [20, 0, 2]);
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
  assert.equal(prerogativeLabel(of('F2a')), 'PE40');
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
  assert.equal(prerogativeLabel(deep), 'PA60', 'la prérogative vient des aptitudes, pas de la profondeur retenue');
  assert.equal(chosenDepth({ ...deep, depth: 60 }), 60);
  assert.equal(chosenDepth({ ...deep, depth: 25 }), 25, 'profondeur max libre');
  assert.equal(prerogativeLabel({ ...deep, depth: 20 }), 'PA60');
  assert.equal(prerogativeLabel(n2), 'PA20');
  assert.ok(validate({ ...n2, depth: 40 }).some((i) => /dépasse la prérogative/.test(i)));
});

test('prérogative la plus haute : E1…E4 pour un enseignant, GP, sinon PE / PA', () => {
  const code = (...l: string[]) => prerogativeCode(aptitudesFromLabels(l));
  assert.equal(code('P4', 'E3'), 'E3', 'un N4 + MF1 est E3');
  assert.equal(code('E2'), 'E2');
  assert.equal(code('Initiateur', 'P4'), 'E2', 'Initiateur + N4 = E2');
  assert.equal(code('P - Enseignant 3 - Diplôme d’Etat de la Jeunesse et de l’Education Populaire - activités de plongée subaquatique'), 'E3', 'DEJEPS activité : E3');
  assert.equal(code('P - Enseignant 4 - Diplôme d’Etat de la Jeunesse et de l’Education Populaire - plongée subaquatique'), 'E4', 'DEJEPS plongée : E4');
  assert.equal(code('BPJEPS - avec scaphandre'), 'E2');
  assert.equal(code('P4-ANMP'), 'GP');
  assert.equal(code('P5-DPE'), 'GP');
  assert.equal(code('MF2'), 'E4');
  assert.equal(code('P3'), 'PA60');
  assert.equal(code('P2'), 'PE40 · PA20');
  assert.equal(code('PE-40'), 'PE40');
  assert.equal(code('P1-ANMP'), 'PE20');
  assert.equal(code('PADI - AOW'), '');
});

test('plusieurs encadrants : des palanquées plus petites, un encadrant chacune', () => {
  const plan = proposePalanquees([diver('G1', 'N4'), diver('G2', 'N4'), diver('G3', 'N4'), ...['a', 'b', 'c', 'd'].map((n) => diver(n, 'N1'))]);
  const instructorsIn = (p: Palanquee) => [p.guide, p.extra, ...p.members].filter((d) => d?.guide).length;
  assert.equal(plan.palanquees.length, 3);
  assert.ok(plan.palanquees.every((p) => p.kind === 'guided' && instructorsIn(p) === 1));
  assert.equal(plan.unassigned.length, 0);
});

test('encadrants en surnombre en autonomie : répartis, jamais tous ensemble', () => {
  // Cas réel du 8 octobre : 5 encadrants et 2 N3.
  const plan = proposePalanquees([diver('E3a', 'MF1'), diver('GPa', 'N4'), diver('E2', 'E2'), diver('E3b', 'MF1'), diver('GPb', 'N4'), diver('N3a', 'N3'), diver('N3b', 'N3')]);
  const instructorsIn = (p: Palanquee) => p.members.filter((d) => d.guide).length;
  assert.equal(plan.palanquees.length, 3);
  assert.ok(plan.palanquees.every((p) => instructorsIn(p) <= 2), plan.palanquees.map((p) => p.members.map((m) => m.name).join('+')).join(' / '));
  assert.ok(plan.palanquees.every((p) => p.members.length >= 2 && p.members.length <= 3));
  const n3 = plan.palanquees.filter((p) => p.members.some((m) => m.name.startsWith('N3')));
  assert.equal(n3.length, 2, 'chaque N3 fait binôme avec un encadrant');
});

test('la prérogative d’une palanquée ne dépasse jamais celle du moins formé', () => {
  const own = (d: Diver, p: Palanquee) => (p.kind === 'autonomous' ? d.pa : p.kind === 'teaching' && d.training ? 60 : d.pe || (d.beginner ? 6 : 0));
  const scenarios = [
    [diver('G', 'N4'), diver('A', 'PE40'), diver('B', 'N1'), diver('C', 'N2'), diver('D', 'N3'), diver('E', 'PA40')],
    [diver('M', 'MF1'), diver('F', 'P1', 'FN2'), diver('X', 'N2'), diver('Y', 'N2'), diver('Z', 'N3')],
    [diver('E1', 'Initiateur', 'N2'), diver('Deb', 'Débutant'), diver('G', 'N4'), diver('K', 'N1'), diver('L', 'PE40')],
  ];
  for (const divers of scenarios) {
    for (const p of proposePalanquees(divers).palanquees) {
      const floor = Math.min(...p.members.map((m) => own(m, p)));
      assert.ok(chosenDepth(p) <= floor, `${prerogativeLabel(p)} > ${floor} pour ${p.members.map((m) => m.name).join(',')}`);
    }
  }
});

test('moniteur plongeur en exploration : la prérogative de la palanquée, celle du moins formé', () => {
  const n2 = diver('N2', 'Niveau 2');
  const e4s = [diver('A', 'MF2'), diver('B', 'MF2'), diver('C', 'MF2')];
  const p: Palanquee = { id: 'p', kind: 'autonomous', guide: null, extra: null, members: [n2, ...e4s] };
  for (const e of e4s) assert.equal(memberLabel(e, p), 'PA20');
  assert.equal(memberLabel(n2, p), 'PA20', 'un plongeur qui n’est pas moniteur garde sa propre prérogative');

  const gp = diver('GP', 'N4');
  const guided: Palanquee = { id: 'g', kind: 'guided', guide: gp, extra: null, members: [diver('N1', 'Niveau 1'), diver('E3', 'MF1')] };
  assert.equal(memberLabel(guided.members[1]!, guided), 'PE20');
});

test('moniteur plongeur en formation : statut E# pour un enseignant, prérogative de la palanquée pour un GP, hors des 4 élèves', () => {
  const teacher = diver('Prof', 'MF1');
  const students = [1, 2, 3, 4].map((i) => diver(`S${i}`, 'P1', 'FN2'));
  const gp = diver('GP', 'N4');
  const e2 = diver('E2', 'Initiateur', 'N4');
  const mf2 = diver('MF2', 'MF2');
  const p: Palanquee = { id: 'p', kind: 'teaching', guide: teacher, extra: null, members: [...students, gp, e2, mf2] };
  assert.equal(memberLabel(gp, p), 'PE40', 'un N4/GP qui assiste n’a pas de statut N4');
  assert.equal(memberLabel(e2, p), 'E2');
  assert.equal(memberLabel(mf2, p), 'E4');
  assert.deepEqual(validate(p).filter((i) => i.includes('élève')), [], '4 élèves + 3 moniteurs : conforme');

  const fifth = { ...p, members: [...p.members, diver('S5', 'P1', 'FN2')] };
  assert.ok(validate(fifth).includes('5 élèves : 4 au maximum.'));
  const onlyInstructors = { ...p, members: [gp, mf2] };
  assert.ok(validate(onlyInstructors).includes('Aucun élève.'));
});

test('un N4/GP n’encadre jamais une formation ; un E1 n’encadre pas en exploration', () => {
  const gp = diver('GP', 'N4');
  const e2 = diver('E2', 'Initiateur', 'N4');
  const e4 = diver('E4', 'MF2');
  const fn1 = diver('FN1', 'Débutant', 'FN1');
  // Un élève arrive dans la palanquée du GP : le moins qualifié des enseignants qui suffit (E2 pour un FN1) prend la formation.
  const p = settleKind({ id: 'p', kind: 'guided', guide: gp, extra: null, members: [e4, e2, fn1] });
  assert.equal(p.kind, 'teaching');
  assert.equal(p.guide?.name, 'E2');
  assert.deepEqual(p.members.map((m) => m.name).sort(), ['E4', 'FN1', 'GP']);
  // Sans enseignant, le GP ne reste pas encadrant : la palanquée est signalée.
  const alone = toTeaching({ id: 'q', kind: 'guided', guide: gp, extra: null, members: [fn1] });
  assert.equal(alone.guide, null);
  assert.ok(validate(alone).includes('Pas d’enseignant.'));

  const ini = diver('Ini', 'Initiateur', 'N2');
  const explo: Palanquee = { id: 'e', kind: 'guided', guide: ini, extra: null, members: [diver('Bob', 'Débutant')] };
  assert.ok(validate(explo).some((i) => i.includes('au minimum N4/GP')));
  const auto = proposePalanquees([ini, diver('Bob', 'Débutant')]);
  assert.equal(auto.palanquees[0]!.kind, 'teaching', 'les débutants avec un E1 : palanquée de formation');
  assert.deepEqual(validate(auto.palanquees[0]!), []);
});

test('un Initiateur est au moins N2 : PE40 / PA20 si rien d’autre n’est connu', () => {
  const e1 = aptitudesFromLabels(['E1']);
  assert.deepEqual([e1.pe, e1.pa, e1.guide, e1.teach], [40, 20, 'E1', 1]);
  assert.equal(aptitudesFromLabels(['Initiateur', 'N3']).pa, 60, 'ne rabaisse pas un N3');
});

test('enseignant minimum : E2 pour FN1, E3 pour FN2 à FN4 ; sans lui, les élèves attendent', () => {
  const e2 = diver('E2', 'E2');
  const e3 = diver('E3', 'MF1');
  const e4 = diver('E4', 'MF2');
  const fn4 = diver('Prépa', 'N3', 'Prépa N4');
  const of = (plan: Plan, name: string) => plan.palanquees.find((p) => [p.guide, ...p.members].some((m) => m?.name === name))!;
  // Un E3 suffit pour un FN4 : le MF2 reste libre.
  const plan = proposePalanquees([e3, e4, fn4, diver('N3', 'N3')]);
  assert.equal(of(plan, 'Prépa').guide!.name, 'E3');
  // Un E2 seul : le FN4 attend, avec la raison ; personne ne disparaît.
  const short = proposePalanquees([e2, fn4, diver('N1', 'N1')]);
  assert.match(short.unassigned.find((u) => u.diver.name === 'Prépa')!.reason, /E3 au minimum/);
  const placed = short.palanquees.flatMap((p) => [p.guide, p.extra, ...p.members]).filter(Boolean).length + short.unassigned.length;
  assert.equal(placed, 3);
  // Plus de repli sur un E1 pour des FN1.
  assert.equal(lowestTeacher([diver('Ini', 'Initiateur', 'N2')], [diver('F', 'FN1')]), undefined);
  const bad: Palanquee = { id: 'b', kind: 'teaching', guide: e2, extra: null, members: [diver('F2', 'P1', 'FN2')] };
  assert.ok(validate(bad).some((i) => /FN2 demande un E3/.test(i)));
});

test('un moniteur en formation est élève ce jour-là : jamais encadrant ni enseignant, et personne ne disparaît', () => {
  const ini = diver('Ini', 'Initiateur', 'N3', 'Prépa N4');
  const all = [ini, diver('GP', 'N4'), diver('F1', 'FN1'), diver('N1', 'N1')];
  const plan = proposePalanquees(all);
  const everyone = plan.palanquees.flatMap((p) => [p.guide, p.extra, ...p.members]).filter(Boolean).length + plan.unassigned.length;
  assert.equal(everyone, all.length, 'aucun plongeur perdu');
  assert.ok(plan.palanquees.every((p) => p.guide?.id !== ini.id));
  assert.match(plan.unassigned.find((u) => u.diver.id === ini.id)!.reason, /aucun enseignant/);
  const asGuide: Palanquee = { id: 'g', kind: 'guided', guide: { ...diver('GP2', 'N4'), training: 4 }, extra: null, members: [diver('N1b', 'N1')] };
  assert.ok(validate(asGuide).some((i) => /ne peut pas encadrer/.test(i)));
});

test('un N4/GP qui assiste une formation : hors des 4 élèves, à la prérogative de la palanquée ; l’encadrant d’exploration à sa plus haute', () => {
  const t = diver('T', 'MF1');
  const gp = diver('GP', 'N4');
  const e3 = diver('E3b', 'MF1');
  const students = [1, 2, 3, 4].map((i) => diver(`S${i}`, 'P1', 'FN2'));
  const p: Palanquee = { id: 'p', kind: 'teaching', guide: t, extra: null, members: [...students, gp, e3] };
  assert.equal(memberLabel(gp, p), 'PE40');
  assert.equal(memberLabel(e3, p), 'E3');
  assert.equal(guideLabel(t, p), 'E3');
  assert.deepEqual(validate(p), []);
  const g: Palanquee = { id: 'g', kind: 'guided', guide: diver('MF2', 'MF2'), extra: null, members: [diver('N1', 'N1'), gp] };
  assert.equal(guideLabel(g.guide!, g), 'E4');
  assert.equal(memberLabel(gp, g), 'PE20');
  assert.equal(guideLabel(diver('G', 'N4'), g), 'GP');
});

test('formation qui perd son enseignant : un membre qui suffit est promu, sinon « Pas d’enseignant »', () => {
  const e3 = diver('E3', 'MF1');
  const e2 = diver('E2', 'E2');
  const gp = diver('GP', 'N4');
  const fn2 = diver('F2', 'P1', 'FN2');
  const p: Palanquee = { id: 'p', kind: 'teaching', guide: e3, extra: null, members: [fn2, e2, gp] };
  const orphan = settleKind({ ...p, guide: null });
  assert.equal(orphan.guide, null, 'l’E2 ne suffit pas pour un FN2, le GP jamais');
  assert.ok(validate(orphan).includes('Pas d’enseignant.'));
  const fn1 = settleKind({ ...p, guide: null, members: [diver('F1', 'FN1'), e2, gp] });
  assert.equal(fn1.guide?.name, 'E2');
  // Un E2 encadrant quand un FN2 arrive : l’E3 membre prend la formation, l’E2 plonge comme E2.
  const swapped = settleKind({ id: 'q', kind: 'guided', guide: e2, extra: null, members: [e3, fn2] });
  assert.equal(swapped.kind, 'teaching');
  assert.equal(swapped.guide?.name, 'E3');
  assert.equal(memberLabel(e2, swapped), 'E2');
});

test('un enfant est signalé', () => {
  const child = { ...diver('Bronze', 'PBR'), minor: true };
  assert.ok(validate({ id: 'c', kind: 'guided', guide: diver('G2', 'N4'), extra: null, members: [child] }).some((i) => /enfant/.test(i)));
});

test('plongeur supplémentaire : exploration encadrée seulement ; en formation le GP seul devient plongeur', () => {
  const plan = proposePalanquees([diver('E2', 'E2'), diver('G2', 'N4'), diver('F1', 'FN1')], { maxDepth: 20 });
  const p = plan.palanquees[0]!;
  assert.equal(plan.palanquees.length, 1);
  assert.equal(p.kind, 'teaching');
  assert.equal(p.extra, null);
  assert.ok(p.members.some((m) => m.name === 'G2'), 'le GP assiste la formation comme plongeur');
  assert.deepEqual(validate(p, 20), []);
  assert.ok(validate({ ...p, extra: diver('G3', 'N4') }).some((i) => /pas de plongeur supplémentaire en formation/.test(i)));
});

test('formation vers une aptitude précise : FPA20 pour un PE40, zone 20 m, un E2 suffit', () => {
  const fpa20 = aptitudesFromLabels(['PE40', 'FPA20']);
  assert.deepEqual([fpa20.pe, fpa20.training, fpa20.trainingApt, trainingLabel(fpa20), minTeachFor(fpa20)], [40, 2, { kind: 'PA', depth: 20 }, 'FPA20', 2]);
  assert.deepEqual([trainingLabel(aptitudesFromLabels(['FN2'])), minTeachFor(aptitudesFromLabels(['FN2']))], ['FN2', 3], 'sans précision, le niveau entier : 40 m, E3');
  assert.deepEqual([aptitudesFromLabels(['FPE60']).training, minTeachFor(aptitudesFromLabels(['FPE60']))], [3, 3]);

  const e2 = diver('E2', 'E2');
  const e3 = diver('E3', 'MF1');
  const student = diver('Paul', 'PE40', 'FPA20');
  const plan = proposePalanquees([e2, e3, student, diver('N1', 'N1')]);
  const p = plan.palanquees.find((x) => x.members.includes(student))!;
  assert.equal(p.kind, 'teaching');
  assert.equal(p.guide!.name, 'E2', 'l’E2 se positionne, l’E3 reste libre');
  assert.equal(chosenDepth(p), 20);
  assert.equal(memberLabel(student, p), 'PE20', 'l’aptitude la plus faible du groupe (zone 20 m), pas la sienne ; l’objectif est en tête');
  assert.equal(kindLabel(p), 'Formation FPA20');
  assert.deepEqual(validate(p), []);
  // Le même élève noté FN2 mobilise l’E3.
  const vague = proposePalanquees([e2, e3, diver('Paul', 'PE40', 'FN2'), diver('N1', 'N1')]);
  assert.equal(vague.palanquees.find((x) => x.kind === 'teaching')!.guide!.name, 'E3');
  const bad: Palanquee = { id: 'b', kind: 'teaching', guide: e2, extra: null, members: [diver('F', 'FPE40')] };
  assert.ok(validate(bad).some((i) => /FPE40 demande un E3/.test(i)));
});

test('dans une palanquée, tous les plongeurs portent l’aptitude la plus faible du groupe', () => {
  const g = diver('G', 'N4');
  const pe40 = diver('A', 'PE40');
  const pe20 = diver('B', 'N1');
  const p: Palanquee = { id: 'p', kind: 'guided', guide: g, extra: null, members: [pe40, pe20] };
  assert.equal(memberLabel(pe40, p), 'PE20', 'le PE40 plonge PE20');
  assert.equal(memberLabel(pe20, p), 'PE20');
  assert.equal(guideLabel(g, p), 'GP', 'l’encadrant garde sa prérogative');
  const auto: Palanquee = { id: 'a', kind: 'autonomous', guide: null, extra: null, members: [diver('C', 'N3'), diver('D', 'N2')] };
  assert.equal(memberLabel(auto.members[0]!, auto), 'PA20');
});

test('le directeur de plongée reste sur le bateau, sauf si sans lui des plongeurs restent à terre', () => {
  const dp = diver('DP', 'N4');
  const guide = diver('Guide', 'N4');
  const n1 = (k: number) => Array.from({ length: k }, (_, i) => diver(`N1-${k}-${i}`, 'N1'));
  const everyone = (p: Plan) => p.palanquees.flatMap((x) => [x.guide, x.extra, ...x.members]).filter(Boolean).map((d) => d!.id);

  // Quatre N1 : un seul encadrant suffit, palanquée pleine ; le DP ne plonge pas.
  const four = proposePalanquees([dp, guide, ...n1(4)], { lastResort: [dp.id] });
  assert.ok(!everyone(four).includes(dp.id));
  assert.equal(four.unassigned.find((u) => u.diver.id === dp.id)?.reason, 'Directeur de plongée : reste sur le bateau.');
  assert.equal(four.palanquees[0]!.members.length, 4);

  // Cinq N1 : sans lui, un N1 resterait à terre ; il encadre.
  const five = proposePalanquees([dp, guide, ...n1(5)], { lastResort: [dp.id] });
  assert.ok(everyone(five).includes(dp.id));
  assert.equal(five.unassigned.length, 0);

});

test('6 m sans aptitude PE6 ; palanquée vide signalée comme telle ; plongeur supplémentaire refusé sur une palanquée à revoir', () => {
  const gp = diver('GP', 'N4');
  const mixed: Palanquee = { id: 'm', kind: 'guided', guide: gp, extra: null, members: [diver('Deb', 'Débutant'), diver('N1', 'N1')] };
  assert.equal(prerogativeLabel(mixed), '6 m', 'un N1 avec un débutant : 6 m, pas « PE6 »');
  assert.equal(memberLabel(mixed.members[1]!, mixed), '6 m');
  assert.equal(prerogativeLabel({ ...mixed, members: [diver('Deb2', 'Débutant')] }), 'Débutants 6 m');

  const empty: Palanquee = { id: 'e', kind: 'autonomous', guide: null, extra: null, members: [] };
  assert.deepEqual(validate(empty), ['Palanquée vide.']);

  assert.equal(acceptsExtra({ id: 'g', kind: 'guided', guide: gp, extra: null, members: [diver('A', 'N1')] }), true);
  const unknown: Palanquee = { id: 'u', kind: 'guided', guide: gp, extra: null, members: [diver('Inconnu')] };
  assert.equal(depthOf(unknown), 0);
  assert.equal(acceptsExtra(unknown), false, '« À revoir » : pas de plongeur supplémentaire');
  assert.equal(acceptsExtra({ id: 'd', kind: 'guided', guide: diver('E4', 'MF2'), extra: null, members: [diver('B', 'N3')] }), false, 'au-delà de 40 m');
});
