import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksFor, canSupervise, classifyRoles, cleanRoleLabel, entryFromRole, roleKeyFor, volunteerTotal } from './registration';

// Rôles d'une sortie, tels que VPDive les liste (available_roles, octobre 2026)
const roles = [
  { key: 'diver', label: 'Plongeur (dès 32€)' },
  { key: 'tok-dp', label: 'Directeur de plongée (0€)' },
  { key: 'tok-ens', label: 'Enseignant/Encadrant (0€)' },
  { key: 'tok-secu', label: 'Sécurité surface (0€)' },
  { key: 'tok-pilote', label: 'Pilote (dès 32€)' },
];
const cls = classifyRoles(roles);

test('libellé de rôle sans l’indication de prix', () => {
  assert.equal(cleanRoleLabel('Pilote (dès 32€)'), 'Pilote');
  assert.equal(cleanRoleLabel('Directeur de plongée (0€)'), 'Directeur de plongée');
  assert.equal(cleanRoleLabel('Plongeur'), 'Plongeur');
  assert.equal(cleanRoleLabel('Plongeur (débutant)'), 'Plongeur (débutant)', 'une parenthèse sans prix reste');
});

test('rôles reconnus à leur nom : plongeur, DP, encadrant, postes de surface', () => {
  assert.equal(cls.diver?.key, 'diver');
  assert.equal(cls.dp?.key, 'tok-dp');
  assert.equal(cls.instructor?.key, 'tok-ens');
  assert.deepEqual(
    cls.volunteers.map((v) => v.key),
    ['tok-secu', 'tok-pilote'],
  );
  assert.deepEqual(classifyRoles([]), { diver: null, dp: null, instructor: null, volunteers: [] });
  const gonfleur = classifyRoles([{ key: 'g', label: 'Gonfleur' }, { key: 'm', label: 'Moniteur' }]);
  assert.equal(gonfleur.instructor?.key, 'm');
  assert.deepEqual(gonfleur.volunteers.map((v) => v.key), ['g']);
});

test('encadrer : N4/GP, P5, E1 à E4 ; pas un N2 ni un niveau inconnu', () => {
  assert.equal(canSupervise(['P4']), true);
  assert.equal(canSupervise(['Niveau 4']), true);
  assert.equal(canSupervise(['GP']), true);
  assert.equal(canSupervise(['E1']), true);
  assert.equal(canSupervise(['Initiateur']), true);
  assert.equal(canSupervise(['MF1']), true);
  assert.equal(canSupervise(['E3']), true);
  assert.equal(canSupervise(['P5-DPE']), true);
  assert.equal(canSupervise(['P - Plongeur Niveau 5 - Directeur de plongée d’exploration en milieu naturel']), true);
  // Nom complet, tel que la fiche « Mon profil » le donne, sans code court
  assert.equal(canSupervise(['P-Plongeur Niveau 4 (P4-N4)']), true);
  assert.equal(canSupervise(['P2']), false);
  assert.equal(canSupervise(['Niveau 3', 'PA60']), false);
  assert.equal(canSupervise([]), false);
  assert.equal(canSupervise(['Apnéiste']), false);
});

test('modification : le rôle enregistré redonne l’entrée, ou un rôle gardé tel quel', () => {
  assert.deepEqual(entryFromRole('diver', cls), { entry: 'diver' });
  assert.deepEqual(entryFromRole('tok-ens', cls), { entry: 'instructor', mode: 'supervise' });
  assert.deepEqual(entryFromRole('tok-pilote', cls), { entry: 'volunteer', post: 'tok-pilote' });
  assert.deepEqual(entryFromRole('tok-dp', cls), { fixed: roles[1] });
  assert.deepEqual(entryFromRole('tok-disparu', cls), { fixed: { key: 'tok-disparu', label: '' } });
  assert.equal(entryFromRole(null, cls), null);
});

test('ce que le formulaire demande selon l’entrée', () => {
  assert.deepEqual(asksFor('diver', null), { tariff: true, gear: true, buddy: true });
  assert.deepEqual(asksFor('instructor', 'supervise'), { tariff: true, gear: true, buddy: false });
  assert.deepEqual(asksFor('instructor', 'dive'), { tariff: true, gear: true, buddy: true });
  assert.deepEqual(asksFor('volunteer', null), { tariff: false, gear: false, buddy: false });
  assert.deepEqual(asksFor(null, null), { tariff: true, gear: true, buddy: true }, 'sans rôle à choisir : tout, comme avant');
});

test('clé de rôle envoyée à VPDive', () => {
  assert.equal(roleKeyFor('diver', null, null, cls), 'diver');
  assert.equal(roleKeyFor('instructor', 'supervise', null, cls), 'tok-ens');
  assert.equal(roleKeyFor('instructor', 'dive', null, cls), 'diver', 'un encadrant qui plonge pour lui paie comme un plongeur');
  assert.equal(roleKeyFor('volunteer', null, 'tok-secu', cls), 'tok-secu');
  assert.equal(roleKeyFor('volunteer', null, null, cls), null);
  assert.equal(roleKeyFor(null, null, null, cls), null);
  assert.equal(roleKeyFor('diver', null, null, classifyRoles([])), null);
});


test('volunteerTotal : lit l’indication de prix du rôle VPDive', () => {
  assert.deepEqual(volunteerTotal('Sécurité surface (0€)'), { zero: true });
  assert.deepEqual(volunteerTotal('Pilote (dès 32€)'), { zero: false, from: 32 });
  assert.deepEqual(volunteerTotal('Pilote (dès 32,50 €)'), { zero: false, from: 32.5 });
  assert.deepEqual(volunteerTotal('Gonfleur'), { unknown: true });
});
