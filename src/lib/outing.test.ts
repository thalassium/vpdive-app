import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayParticipants, defaultRoles, headerFromRoles, postsByPerson, rolesOf, setVolunteer, toggleRole, type Volunteers } from './outing';
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
