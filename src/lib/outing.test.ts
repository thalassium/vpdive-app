import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayParticipants, defaultRoles, headerFromRoles, postsByPerson, rolesOf, setVolunteer, syncWithRoster, toggleRole, type OutingDoc, type Volunteers } from './outing';
import { aptitudesFromLabels, type Diver } from './palanquees';
import type { RosterEntry } from '../services/vpdiveApi';

const person = (id: string, roles: string[] = [], waitingList = false): RosterEntry => ({
  id, name: id, firstname: id, lastname: id, levels: [], display: [], training: [], roles, age: 30, waitingList, comment: '', medical: { until: null, valid: true },
});

test('rôles proposés : DP, pilote et sécurité surface connus de VPDive', () => {
  const roster = [person('p', ['Pilote']), person('s', ['Sécurité surface']), person('d', ['Directeur de plongée']), person('x'), person('w', ['Pilote'], true)];
  assert.deepEqual(defaultRoles(roster), { dp: ['d'], pilote: ['p'], securite: ['s'] });
});

test('rôles : un même inscrit peut cumuler, plongeur ou non ; l’en-tête de la fiche suit', () => {
  let roles = toggleRole({}, 'dp', 'a');
  roles = toggleRole(roles, 'securite', 'a');
  roles = toggleRole(roles, 'securite', 'b');
  assert.deepEqual(rolesOf(roles, 'a'), ['dp', 'securite']);
  assert.deepEqual(headerFromRoles([person('a'), person('b')], roles), { dp: 'a a', pilote: '', securite: 'a a, b b' });
  assert.deepEqual(toggleRole(roles, 'securite', 'a').securite, ['b'], 'un second clic retire le rôle');
});

test('participants de la journée : sans la liste d’attente', () => {
  assert.deepEqual(dayParticipants([person('a'), person('b', [], true)]).map((r) => r.id), ['a']);
});

test('deux personnes au plus par poste, une personne sur plusieurs postes', () => {
  let v = setVolunteer({}, 'matelotage', 0, 'a');
  v = setVolunteer(v, 'matelotage', 1, 'b');
  assert.deepEqual(v.matelotage, ['a', 'b']);
  assert.deepEqual(setVolunteer(v, 'matelotage', 1, 'a').matelotage, ['a', 'b'], 'pas deux fois la même personne sur un poste');
  v = setVolunteer(v, 'eau', 0, 'a');
  assert.deepEqual(postsByPerson(v).get('a'), ['matelotage', 'eau']);
  v = setVolunteer(v, 'matelotage', 0, null);
  assert.deepEqual(v.matelotage, ['b'], 'retirer la première place décale la seconde');
  v = setVolunteer(v, 'matelotage', 1, 'c');
  v = setVolunteer(v, 'matelotage', 2, 'd');
  assert.equal(v.matelotage!.length, 2);
});

test('en-tête de la fiche : seul le champ du rôle changé est réécrit ; les anciens postes pilotage/securite disparaissent', () => {
  const roster = [person('a'), person('b')];
  const roles = toggleRole(toggleRole({}, 'dp', 'a'), 'pilote', 'b');
  assert.deepEqual(headerFromRoles(roster, roles, 'pilote'), { pilote: 'b b' });
  assert.deepEqual(headerFromRoles(roster, roles), { dp: 'a a', pilote: 'b b', securite: '' });
  const legacy = { pilotage: ['x'], securite: ['y'], matelotage: ['a'] } as Volunteers;
  assert.deepEqual(setVolunteer(legacy, 'eau', 0, 'b'), { matelotage: ['a'], eau: ['b'] });
});

const diver = (id: string, ...labels: string[]): Diver => ({ id, name: `Nom ${id}`, labels, ...aptitudesFromLabels(labels) });

const outing = (): OutingDoc => ({
  settings: { levels: {}, training: {}, excluded: ['x', 'gone3'] },
  header: { etablissement: '', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '', creneau: '', lieu: '' },
  dives: [
    {
      id: 'd1',
      label: 'Plongée 1',
      validated: { by: 'DP', at: '2026-10-10' },
      sheets: { p1: { planned: { duration: '40', depth: '20', time: '09:00' }, actual: { duration: '', depth: '', time: '' } }, p2: { planned: { duration: '', depth: '', time: '' }, actual: { duration: '', depth: '', time: '' } } },
      gas: { a: 'Nx32', gone1: 'air' },
      plan: {
        palanquees: [
          { id: 'p1', kind: 'guided', guide: diver('gone1', 'E3'), extra: null, members: [diver('a', 'P1'), diver('b', 'P1')] },
          { id: 'p2', kind: 'autonomous', guide: null, extra: null, members: [diver('gone2', 'P2'), diver('c', 'P2')] },
          { id: 'p3', kind: 'autonomous', guide: null, extra: null, members: [diver('gone3', 'P3')] },
        ],
        unassigned: [{ diver: diver('gone4', 'P1'), reason: 'x' }],
      },
    },
    { id: 'd2', label: 'Plongée 2', validated: { by: 'DP', at: '2026-10-10' }, sheets: {}, gas: {}, plan: { palanquees: [{ id: 'q1', kind: 'autonomous', guide: null, extra: null, members: [diver('a', 'P1'), diver('c', 'P2')] }], unassigned: [] } },
  ],
  roles: { dp: ['gone1'], securite: ['a'] },
  volunteers: { matelotage: ['gone2', 'c'] },
});

test('désinscrits : retirés des palanquées, des rôles et des postes ; la palanquée sans encadrant reste, la plongée touchée est dévalidée', () => {
  const roster = [person('a'), person('b'), person('c'), person('x'), person('gone4', [], true)];
  const { doc, departed } = syncWithRoster(outing(), roster);
  assert.deepEqual(departed.sort(), ['Nom gone1', 'Nom gone2', 'Nom gone3', 'Nom gone4']);
  const d1 = doc.dives[0]!;
  assert.equal(d1.validated, null, 'composition changée : fiche à refaire');
  assert.deepEqual(d1.plan!.palanquees.map((p) => [p.id, p.guide?.id ?? null, p.members.map((m) => m.id)]), [
    ['p1', null, ['a', 'b']],
    ['p2', null, ['c']],
  ]);
  assert.deepEqual(d1.plan!.unassigned, []);
  assert.deepEqual(Object.keys(d1.sheets), ['p1', 'p2'], 'la fiche de la palanquée vidée disparaît');
  assert.deepEqual(d1.gas, { a: 'Nx32' });
  assert.deepEqual(doc.roles, { securite: ['a'] });
  assert.deepEqual(doc.volunteers, { matelotage: ['c'] });
  assert.deepEqual(doc.settings.excluded, ['x']);
  // Plongée 2 : personne n'est parti, elle reste validée telle quelle.
  assert.deepEqual(doc.dives[1]!.validated, { by: 'DP', at: '2026-10-10' });
});

test('désinscrits : rien à faire quand tout le monde est là (même objet, rien de dévalidé)', () => {
  const before = outing();
  const roster = ['a', 'b', 'c', 'x', 'gone1', 'gone2', 'gone3', 'gone4'].map((id) => person(id));
  const { doc, departed } = syncWithRoster(before, roster);
  assert.deepEqual(departed, []);
  assert.equal(doc.dives[0], before.dives[0]);
  assert.equal(doc.dives[1], before.dives[1]);
});
