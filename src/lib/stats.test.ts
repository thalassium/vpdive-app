import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptitudesFromLabels } from './palanquees';
import { computeStats, dateFr, diverLevel, isDiveActivity, monthSeries, presetRange, staffLevel, type StatEvent, type StatPerson } from './stats';

const ev = (token: string, start: string, activity = 'Sortie', registered = 0, max: number | null = null): StatEvent => ({ token, start, activity, registered, max });
const p = (id: string, levels: string[], extra: Partial<StatPerson> = {}): StatPerson => ({ id, name: `Nom ${id}`, age: 30, levels, training: [], roles: [], waitingList: false, ...extra });

test('activités : réunions, repas et théorie ne sont pas de la plongée', () => {
  assert.equal(isDiveActivity('Sortie'), true);
  assert.equal(isDiveActivity('Cours pratique'), true);
  assert.equal(isDiveActivity('Réunion'), false);
  assert.equal(isDiveActivity('Repas'), false);
  assert.equal(isDiveActivity('Cours théorique'), false);
});

test('niveaux : profondeur de prérogative et libellé lisible', () => {
  const lv = (...l: string[]) => diverLevel(aptitudesFromLabels(l));
  assert.deepEqual(lv('P1'), { depth: 20, label: 'N1' });
  assert.deepEqual(lv('P2'), { depth: 40, label: 'N2' });
  assert.deepEqual(lv('P3'), { depth: 60, label: 'N3' });
  assert.deepEqual(lv('PA20'), { depth: 20, label: 'PE20 + PA20' });
  assert.deepEqual(lv('PE40'), { depth: 40, label: 'PE40' });
  assert.deepEqual(lv('Débutant'), { depth: 6, label: 'Débutant' });
  assert.equal(lv(), null);
  assert.equal(staffLevel(aptitudesFromLabels(['P4'])), 'GP');
  assert.equal(staffLevel(aptitudesFromLabels(['E2'])), 'E2');
  assert.equal(staffLevel(aptitudesFromLabels(['MF1'])), 'E3');
  assert.equal(staffLevel(aptitudesFromLabels(['P2'])), null);
});

test('statistiques : sorties, places, plongeurs distincts, encadrement, âges', () => {
  const events = [
    ev('a', '2026-03-14T08:15:00', 'Sortie', 0, 10), // samedi
    ev('b', '2026-03-15T08:15:00', 'Sortie', 0, 4), // dimanche
    ev('c', '2026-04-02T19:00:00', 'Réunion', 12),
    ev('d', '2026-04-18T08:15:00', 'Cours pratique', 6), // pas encore lue
  ];
  const rosters = {
    a: [p('1', ['P1'], { age: 16 }), p('2', ['MF1'], { roles: ['Directeur de plongée'] }), p('3', ['P2'], { age: 45, training: ['Prépa N3'] }), p('9', ['P1'], { waitingList: true })],
    b: [p('1', ['P1'], { age: 16 }), p('4', ['P4'], { roles: ['Enseignant/Encadrant'], age: 52 }), p('5', [], { age: 70 })],
  };
  const s = computeStats(events, rosters);
  assert.equal(s.outings, 4);
  assert.equal(s.diveOutings, 3);
  assert.deepEqual(s.activities, [{ label: 'Sortie', count: 2 }, { label: 'Cours pratique', count: 1 }, { label: 'Réunion', count: 1 }]);
  assert.equal(s.places, 3 + 3 + 6, 'liste d’attente exclue ; sortie non lue : places de l’agenda');
  assert.equal(s.divers, 5);
  assert.equal(s.waiting, 1);
  assert.deepEqual(s.weekdays, [0, 0, 0, 0, 0, 2, 1], 'samedi, dimanche, et le cours du 18 avril (samedi)');
  assert.deepEqual(s.months, [
    { key: '2026-03', outings: 2, places: 6 },
    { key: '2026-04', outings: 1, places: 6 },
  ]);
  assert.equal(s.fill, (3 / 10 + 3 / 4) / 2, 'remplissage moyen des sorties à jauge');
  assert.deepEqual(s.levels, [{ label: 'N1', count: 1 }, { label: 'N2', count: 1 }]);
  assert.deepEqual(s.groups, { divers: 2, staff: 2, otherSchool: 0, none: 1 });
  assert.equal(s.groups.divers + s.groups.staff + s.groups.otherSchool + s.groups.none, s.divers, 'la répartition retombe sur le total');
  assert.deepEqual(s.dpKnown, { known: 1, of: 2 });
  assert.deepEqual(s.staff.filter((x) => x.count), [{ level: 'E3', count: 1 }, { level: 'GP', count: 1 }]);
  assert.deepEqual(s.directors.map((d) => [d.id, d.count]), [['2', 1]]);
  assert.deepEqual(s.instructors.map((d) => [d.id, d.count]), [['4', 1]]);
  assert.deepEqual(s.regulars[0], { id: '1', name: 'Nom 1', count: 2 });
  assert.equal(s.ages.minors, 1);
  assert.equal(s.ages.median, 45);
  assert.deepEqual(s.training, [{ label: 'N3', count: 1 }]);
});

test('périodes : depuis janvier, 12 derniers mois, année précédente', () => {
  const today = new Date(2026, 9, 8);
  assert.deepEqual(presetRange('year', today), { from: '2026-01-01', to: '2026-10-08' });
  assert.deepEqual(presetRange('12m', today), { from: '2025-10-09', to: '2026-10-08' });
  assert.deepEqual(presetRange('last-year', today), { from: '2025-01-01', to: '2025-12-31' });
});

test('DP : celui de l’appli l’emporte sur le rôle pris à l’inscription ; « Directrice » reconnu', () => {
  const events = [ev('a', '2026-03-14T08:15:00'), ev('b', '2026-03-15T08:15:00'), ev('c', '2026-03-21T08:15:00')];
  const rosters = {
    a: [p('carla', ['MF1'], { roles: ['Directeur de plongée'] }), p('niels', ['MF1'], { roles: ['Enseignant/Encadrant'] })],
    b: [p('niels', ['MF1'], { roles: ['Enseignant/Encadrant'] })],
    c: [p('fred', ['MF2'], { roles: ['Directrice de plongée'] })],
  };
  const s = computeStats(events, rosters, { a: ['niels'], b: ['niels'] });
  assert.deepEqual(s.directors.map((d) => [d.id, d.count]), [['niels', 2], ['fred', 1]]);
  assert.deepEqual(s.dpKnown, { known: 3, of: 3 });
});

test('niveaux : autres écoles à part, aucun niveau à part', () => {
  const events = [ev('a', '2026-03-14T08:15:00')];
  const s = computeStats(events, { a: [p('1', ['PADI - AOW']), p('2', ['SSI - AOW']), p('3', ['PADI - OWD']), p('4', []), p('5', ['RIFA-P']), p('6', ['P1'])] });
  assert.deepEqual(s.otherSchools, [{ label: 'PADI', count: 2 }, { label: 'SSI', count: 1 }]);
  assert.deepEqual(s.groups, { divers: 1, staff: 0, otherSchool: 3, none: 2 });
});

test('DP : sans DP sur la sortie, le pilote ou la sécurité surface en tient lieu', () => {
  const events = [ev('a', '2026-03-14T08:15:00'), ev('b', '2026-03-15T08:15:00')];
  const rosters = {
    a: [p('pilote', ['P4'], { roles: ['Pilote'] }), p('x', ['P1'])],
    b: [p('dp', ['MF1'], { roles: ['Directeur de plongée'] }), p('secu', ['P3'], { roles: ['Sécurité surface'] })],
  };
  const s = computeStats(events, rosters);
  assert.deepEqual(s.directors.map((d) => [d.id, d.count]), [['dp', 1], ['pilote', 1]], 'sur b il y a un DP : la sécu ne compte pas');
  assert.deepEqual(s.dpKnown, { known: 2, of: 2 });
});

test('équipe non inscrite : un pilote désigné dans VPDive compte comme DP s’il n’y a pas de DP, pas comme plongeur', () => {
  const events = [ev('a', '2026-09-26T08:15:00')];
  const rosters = { a: [p('lucas', ['MF1'], { roles: ['Enseignant/Encadrant'] }), p('x', ['P2'])] };
  const s = computeStats(events, rosters, {}, { a: [{ id: 'niels', name: 'GINS Niels', roles: ['Pilote'] }] });
  assert.deepEqual(s.directors.map((d) => [d.id, d.count]), [['niels', 1]]);
  assert.equal(s.divers, 2, 'le pilote non inscrit ne compte pas comme plongeur');
  assert.equal(s.places, 2);
  assert.deepEqual(s.instructors.map((d) => d.id), ['lucas']);
});

test('monthSeries : chaque mois de la période, même sans sortie, et dates en français', () => {
  const s = monthSeries([{ key: '2026-03', outings: 4, places: 30 }], '2026-01-15', '2026-04-02');
  assert.deepEqual(s.map((m) => [m.key, m.outings]), [['2026-01', 0], ['2026-02', 0], ['2026-03', 4], ['2026-04', 0]]);
  assert.equal(dateFr('2026-01-01'), '1er janvier');
  assert.equal(dateFr('2026-10-08', true), '8 octobre 2026');
});

test('classements : les ex aequo du dernier rang restent, l’alphabet ne départage pas', () => {
  // 12 plongeurs : A…H font 3 sorties, I…L en font 2 (ex aequo pour la 10e place), M en fait 1.
  const names = 'ABCDEFGHIJKLM'.split('');
  const visits: Record<string, number> = Object.fromEntries(names.map((x, i) => [x, i < 8 ? 3 : i < 12 ? 2 : 1]));
  const events = [0, 1, 2].map((k) => ev(`e${k}`, `2026-0${k + 3}-07T08:00:00`));
  const rosters = Object.fromEntries(events.map((e, k) => [e.token, names.filter((x) => visits[x]! > k).map((x) => p(x, ['P2']))]));
  const s = computeStats(events, rosters);
  assert.deepEqual(s.regulars.map((r) => r.id), names.slice(0, 12), 'I, J, K et L restent tous les quatre');
});
