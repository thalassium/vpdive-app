import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayParticipants, defaultVolunteers, postsByPerson, setVolunteer } from './outing';
import type { RosterEntry } from '../services/vpdiveApi';

const person = (id: string, roles: string[] = [], waitingList = false): RosterEntry => ({
  id, name: id, firstname: id, lastname: id, levels: [], display: [], training: [], roles, age: 30, waitingList, comment: '', medical: { until: null, valid: true },
});

test('bénévoles proposés : pilote et sécurité surface connus de VPDive', () => {
  const roster = [person('p', ['Pilote']), person('s', ['Sécurité surface']), person('d', ['Directeur de plongée']), person('x')];
  assert.deepEqual(defaultVolunteers(roster), { pilotage: ['p'], securite: ['s'] });
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
