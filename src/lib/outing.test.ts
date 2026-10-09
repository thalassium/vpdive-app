import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedMemberId, adoptRegistrations, companionByComment, divingIds, mustBePlaced, parseDepth, pruneOrphans, sameContent, setGuideNote, toggleCompanion, dayParticipants, defaultRoles, guestEntry, memberEntry, headerFromRoles, newGuest, normalizeOuting, outOfWater, postsByPerson, rolesOf, setVolunteer, stillUnregistered, syncWithRoster, toggleDiving, toggleRole, withGuests, type OutingDoc, type Volunteers } from './outing';
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
  header: { etablissement: '', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '', creneau: '', lieu: '', accompagnants: '' },
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
  const { doc, departed, waitlisted } = syncWithRoster(outing(), roster);
  assert.deepEqual(departed.sort(), ['Nom gone1', 'Nom gone2', 'Nom gone3']);
  assert.deepEqual(waitlisted, ['Nom gone4'], 'passé en liste d’attente : dit à part, pas « désinscrit »');
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
  before.settings.excluded = ['x'];
  const roster = ['a', 'b', 'c', 'x', 'gone1', 'gone2', 'gone3', 'gone4'].map((id) => person(id));
  before.settings.seen = roster.map((r) => r.id);
  const { doc, departed } = syncWithRoster(before, roster);
  assert.deepEqual(departed, []);
  assert.equal(doc, before, 'même objet : rien à enregistrer');
});

test('« Qui plonge ? » : décoché, il sort des palanquées et des non-placés, garde ses rôles ; ce n’est pas un désinscrit', () => {
  const before = outing();
  before.settings.excluded = ['gone1', 'c'];
  const roster = ['a', 'b', 'c', 'gone1', 'gone2', 'gone3', 'gone4'].map((id) => person(id));
  const { doc, departed } = syncWithRoster(before, roster);
  assert.deepEqual(departed, [], 'décocher n’est pas se désinscrire : pas de bandeau');
  const d1 = doc.dives[0]!;
  assert.deepEqual(d1.plan!.palanquees.map((p) => [p.id, p.guide?.id ?? null, p.members.map((m) => m.id)]), [
    ['p1', null, ['a', 'b']],
    ['p2', null, ['gone2']],
    ['p3', null, ['gone3']],
  ]);
  assert.equal(d1.validated, null);
  assert.deepEqual(doc.roles, { dp: ['gone1'], securite: ['a'] }, 'il reste DP : il ne plonge pas, il dirige');
  assert.deepEqual(doc.dives[1]!.plan!.palanquees[0]!.members.map((m) => m.id), ['a']);
  assert.deepEqual(doc.settings.excluded, ['gone1', 'c']);
});

test('fiche : lieu pré-rempli avec le titre effacé, accompagnants ajouté ; sinon même objet', () => {
  const old = outing();
  const { accompagnants: _dropped, ...headerBefore } = old.header;
  const legacy = { ...old, header: { ...headerBefore, lieu: 'Sortie club' } } as unknown as OutingDoc;
  const fixed = normalizeOuting(legacy, { title: 'Sortie club' });
  assert.equal(fixed.header.lieu, '');
  assert.equal(fixed.header.accompagnants, '');
  const kept = { ...outing(), header: { ...outing().header, lieu: 'Grand Congloué' } };
  assert.equal(normalizeOuting(kept, { title: 'Sortie club' }), kept);
});

test('plongeurs hors VPDive : entrée de liste, baptême débutant, retirés avec la liste', () => {
  assert.equal(newGuest({ firstname: ' ', lastname: '', baptism: false, comment: '' }), null);
  const g = newGuest({ firstname: ' Léa ', lastname: 'Martin', baptism: true, comment: ' amie de Paul ' }, 'ext-1')!;
  assert.deepEqual(g, { id: 'ext-1', firstname: 'Léa', lastname: 'Martin', baptism: true, comment: 'amie de Paul' });
  const e = guestEntry(g);
  assert.equal(e.name, 'MARTIN Léa');
  assert.equal(e.outside, true);
  assert.ok(aptitudesFromLabels(e.levels).beginner, 'un baptême plonge comme débutant');
  assert.deepEqual(withGuests([], { guests: [g] }).map((r) => r.id), ['ext-1']);
  assert.deepEqual(stillUnregistered({ unregistered: [{ id: 'x', name: 'X', instructor: false, by: 'DP', at: '' }] }, [e]).map((u) => u.id), ['x']);
  assert.deepEqual(stillUnregistered({ unregistered: [{ id: 'ext-1', name: 'X', instructor: false, by: 'DP', at: '' }] }, [e]), [], 'revenu dans la liste : plus barré');
});

test('liste d’attente : toujours hors de l’eau, même arrivée après la fiche ; décocher un inscrit', () => {
  const r = (id: string, waitingList = false) => ({ id, name: id, firstname: id, lastname: '', levels: ['E3'], display: [], training: [], roles: [], age: 40, waitingList, comment: '', medical: { until: null, valid: true } }) as RosterEntry;
  const roster = [r('a'), r('w', true)];
  const settings = { excluded: [] as string[] };
  assert.deepEqual([...outOfWater(roster, settings)], ['w']);
  const g: Diver = { ...aptitudesFromLabels(['E3']), id: 'w', name: 'w', labels: ['E3'] };
  const doc = { settings, header: {} as OutingDoc['header'], dives: [{ id: 'd', label: 'P1', plan: { palanquees: [{ id: 'p', kind: 'guided' as const, guide: g, extra: null, members: [{ ...g, id: 'a', name: 'a' }] }], unassigned: [] }, validated: null, sheets: {}, gas: {} }] };
  assert.equal(syncWithRoster(doc, roster).doc.dives[0]!.plan!.palanquees[0]!.guide, null, 'en attente : retiré des palanquées');
  assert.deepEqual(toggleDiving(settings, 'a', false).excluded, ['a']);
  assert.deepEqual(toggleDiving({ excluded: ['a'] }, 'a', true).excluded, []);
});

test('membre ajouté sans inscription : dans la liste, puis remplacé par son inscription', () => {
  const m = { id: addedMemberId('U1'), uct: 'U1', name: 'GINS Niels', picture: '', levels: ['E3'], display: ['MF1'] };
  const e = memberEntry(m);
  assert.equal(e.firstname, 'Niels');
  assert.equal(e.lastname, 'GINS');
  assert.equal(e.added, true);
  assert.deepEqual(withGuests([], { members: [m] }).map((x) => x.id), ['uct:U1']);
  const doc = { settings: { excluded: ['uct:U1'] }, header: {} as OutingDoc['header'], dives: [], roles: { dp: ['uct:U1'] }, members: [m] } as OutingDoc;
  const registered = { id: '42', uct: 'U1', name: 'GINS Niels', firstname: 'Niels', lastname: 'GINS', levels: ['E3'], display: [], training: [], roles: [], age: 30, waitingList: false, comment: '', medical: { until: null, valid: true } } as RosterEntry;
  assert.deepEqual(withGuests([registered], doc).map((x) => x.id), ['42'], 'inscrit : plus de doublon');
  const adopted = adoptRegistrations(doc, [registered]);
  assert.deepEqual(adopted.roles, { dp: ['42'] });
  assert.deepEqual(adopted.settings.excluded, ['42']);
  assert.deepEqual(adopted.members, []);
  assert.equal(adoptRegistrations(doc, []), doc, 'pas inscrit : inchangé');
});

test('nouvel inscrit après la création : pilote, sécurité surface ou accompagnant décochés ; les autres cochés ; fiche ancienne sans « seen »', () => {
  const doc: OutingDoc = { ...outing(), dives: [], roles: {}, volunteers: {} };
  doc.settings = { excluded: [], seen: ['a'] };
  const companion = { ...person('acc'), comment: 'Un accompagnant non plongeur' };
  const roster = [person('a'), person('pil', ['Pilote']), person('sec', ['Sécurité surface']), person('dp', ['Directeur de plongée']), companion, person('new')];
  const { doc: synced } = syncWithRoster(doc, roster);
  assert.deepEqual(synced.settings.excluded.sort(), ['acc', 'pil', 'sec']);
  assert.deepEqual(synced.settings.companions, ['acc']);
  assert.deepEqual(synced.settings.seen, ['a', 'pil', 'sec', 'dp', 'acc', 'new']);
  // Le DP coche le pilote : à la synchronisation suivante, il n'est plus nouveau, il reste coché.
  const checked = { ...synced, settings: toggleDiving(synced.settings, 'pil', true) };
  assert.equal(syncWithRoster(checked, roster).doc, checked, 'rien de nouveau : même objet');
  // Fiche enregistrée avant « seen » : personne n'est nouveau, on retient la liste.
  const legacy: OutingDoc = { ...doc, settings: { excluded: [] } };
  const fromLegacy = syncWithRoster(legacy, roster).doc;
  assert.deepEqual(fromLegacy.settings.excluded, []);
  assert.deepEqual(fromLegacy.settings.seen, roster.map((r) => r.id));
});

test('accompagnant : désigné il est décoché ; coché, il redevient plongeur ; à placer : ni rôle ni accompagnant', () => {
  let s = toggleCompanion({ excluded: [] }, 'a', true);
  assert.deepEqual(s, { excluded: ['a'], companions: ['a'] });
  s = toggleDiving(s, 'a', true);
  assert.deepEqual(s, { excluded: [], companions: [] });
  const settings = { excluded: [], companions: ['acc'] };
  const unplaced = [{ id: 'dp' }, { id: 'acc' }, { id: 'x' }, { id: 'pil' }];
  assert.deepEqual(mustBePlaced(unplaced, { dp: ['dp'], pilote: ['pil'] }, settings).map((d) => d.id), ['x']);
  assert.ok(companionByComment({ comment: 'Accompagnante, ne plonge pas' }));
  assert.ok(companionByComment({ comment: 'non-plongeur' }));
  assert.ok(!companionByComment({ comment: 'Binôme souhaité : Jean' }));
});

test('fiches et commentaires orphelins retirés ; commentaire d’encadrant ; profondeur saisie', () => {
  const d = outing().dives[0]!;
  const noted = setGuideNote(d, 'p1', '  stagiaire MF1  ', 'Hélène', '2026-10-09T10:00:00Z');
  assert.deepEqual(noted.notes, { p1: { text: 'stagiaire MF1', by: 'Hélène', at: '2026-10-09T10:00:00Z' } });
  assert.deepEqual(setGuideNote(noted, 'p1', ' ', 'Hélène').notes, {}, 'texte vide : effacé');
  assert.equal(pruneOrphans(noted), noted, 'rien d’orphelin : même objet');
  const redone = pruneOrphans({ ...noted, notes: { ...noted.notes, old: { text: 'x', by: '', at: '' } }, plan: { palanquees: [noted.plan!.palanquees[0]!], unassigned: [] } });
  assert.deepEqual(Object.keys(redone.sheets), ['p1']);
  assert.deepEqual(Object.keys(redone.notes!), ['p1']);
  assert.equal(parseDepth('25'), 25);
  assert.equal(parseDepth('18,5 m'), 18.5);
  assert.equal(parseDepth(''), undefined);
  assert.equal(parseDepth('m'), undefined);
});

test('qui plonge réellement : les placés s’il y a une composition, sinon les cochés ; même contenu sans la révision', () => {
  const doc = outing();
  assert.deepEqual([...divingIds(doc, [])].sort(), ['a', 'b', 'c', 'gone1', 'gone2', 'gone3']);
  const noPlan: OutingDoc = { ...doc, dives: [{ ...doc.dives[0]!, plan: null }] };
  assert.deepEqual([...divingIds(noPlan, [person('a'), person('x'), person('w', [], true)])], ['a'], 'x décoché, w en liste d’attente');
  assert.ok(sameContent(doc, { ...doc, rev: 4, updatedAt: 'hier', updatedBy: 'Lucas' }));
  assert.ok(!sameContent(doc, { ...doc, header: { ...doc.header, lieu: 'Riou' } }));
});
