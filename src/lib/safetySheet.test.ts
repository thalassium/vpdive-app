import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptitudesFromLabels, type Diver, type Palanquee } from './palanquees';
import { emptySheet, type Dive, type OutingDoc } from './outing';
import { headerText, missingHeader, noteText, overDepth, printWarnings, sheetApt, sheetRows } from './safetySheet';
import { safetySheetFileName, safetySheetPdf } from './safetySheetPdf';

let n = 0;
const diver = (name: string, ...labels: string[]): Diver => ({ id: `d${++n}`, name, firstname: name, lastname: `${name}son`, labels, ...aptitudesFromLabels(labels) });

test('fiche : une palanquée autonome n’a pas d’encadrant, ses plongeurs prennent les lignes 1 à 4', () => {
  const a = diver('A', 'P3');
  const b = diver('B', 'P3');
  const p: Palanquee = { id: 'p', kind: 'autonomous', guide: a, extras: [], members: [b] };
  const rows = sheetRows(p);
  assert.equal(rows.length, 5, 'ligne encadrant vide, pas d’encadrant suppl. en autonomie');
  assert.equal(rows[0]!.d, null);
  assert.deepEqual(rows.slice(1, 3).map((r) => r.d?.id), [a.id, b.id]);
  assert.equal(sheetApt(a, p, 'member'), 'PA60');
});

test('fiche : date en toutes lettres, nom de fichier sans accents', () => {
  assert.equal(headerText('date', '2026-10-08'), 'jeudi 8 octobre 2026');
  assert.equal(headerText('lieu', 'Planier'), 'Planier');
  const outing = { header: { date: '2026-10-08', lieu: 'Pointe Rouge — Grand Congloué' } } as OutingDoc;
  assert.equal(safetySheetFileName(outing, { label: 'Plongée 1' } as Dive), 'Fiche-securite_2026-10-08_Pointe-Rouge-Grand-Congloue_Plongee-1.pdf');
});

test('fiche PDF : six palanquées par page', () => {
  const g = diver('Guide', 'P4');
  const palanquees: Palanquee[] = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, kind: 'guided', guide: g, extras: [], members: [diver('Zoé', 'P1')] }));
  const header = { etablissement: 'Club', reference: '', bateau: 'Ève', pilote: '', dp: 'Hélène', securite: '', date: '2026-10-08', creneau: 'Après-midi', lieu: 'Île', accompagnants: '' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees, unassigned: [] }, validated: null, sheets: { p0: emptySheet() }, gas: {} };
  const pdf = safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie');
  assert.equal(pdf.getNumberOfPages(), 2);
  const raw = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  assert.match(raw, /%PDF-/);
});

test('fiche : moniteurs plongeurs, statut en formation et une ligne de plus chacun', () => {
  const students = [1, 2, 3, 4].map((i) => diver(`S${i}`, 'P1', 'FN2'));
  const mf2 = diver('M', 'MF2');
  const p: Palanquee = { id: 'p', kind: 'teaching', guide: diver('T', 'MF1'), extras: [], members: [...students, mf2] };
  const rows = sheetRows(p);
  assert.equal(rows.length, 7, 'enseignant, 5 plongeurs, et la ligne de l’encadrant suppl., vide');
  assert.equal(rows[5]!.label, 'Plongeur 5');
  assert.deepEqual([rows[6]!.label, rows[6]!.d, rows[6]!.slot], ['Encadrant suppl.', null, 'extra']);
  assert.equal(sheetApt(mf2, p, 'member'), 'E4');

  const explo: Palanquee = { id: 'e', kind: 'autonomous', guide: null, extras: [], members: [diver('N2', 'P2'), mf2] };
  assert.equal(sheetApt(mf2, explo, 'member'), 'PA20');
});

test('fiche : un encadrant d’exploration est noté à sa prérogative la plus haute', () => {
  const members = [diver('N1', 'P1')];
  for (const [labels, apt] of [[['MF2'], 'E4'], [['Initiateur', 'N4'], 'E2'], [['N4'], 'GP']] as const) {
    const g = diver('G', ...labels);
    assert.equal(sheetApt(g, { id: 'p', kind: 'guided', guide: g, extras: [], members }, 'guide'), apt);
  }
});

test('fiche : encadrant suppl. en formation seulement, à sa prérogative d’encadrant (GP ou E#), jamais celle de la palanquée', () => {
  const gp2 = diver('GP2', 'N4');
  const teaching: Palanquee = { id: 't', kind: 'teaching', guide: diver('T', 'MF1'), extras: [gp2], members: [diver('F', 'FN1')] };
  const last = sheetRows(teaching).at(-1)!;
  assert.deepEqual([last.label, last.d, last.slot], ['Encadrant suppl.', gp2, 'extra']);
  assert.equal(sheetRows(teaching).length, 6, 'il ne prend pas une ligne de plongeur');
  assert.equal(sheetApt(gp2, teaching, 'extra'), 'GP');
  assert.equal(sheetApt(gp2, { ...teaching, members: [...teaching.members, gp2] }, 'member'), 'PE20', 'plongeur de la formation, il prend celle de la palanquée');
  const e2 = diver('E2', 'Initiateur', 'N4');
  assert.equal(sheetApt(e2, { ...teaching, extras: [e2] }, 'extra'), 'E2');
  // Pas de ligne en exploration, sauf pour une ancienne composition qui en a encore un.
  const guided: Palanquee = { id: 'g', kind: 'guided', guide: diver('G', 'N4'), extras: [], members: [diver('N2', 'P2')] };
  assert.ok(sheetRows(guided).every((r) => r.slot !== 'extra'));
  assert.equal(sheetRows({ ...guided, extras: [gp2] }).at(-1)!.label, 'Encadrant suppl.');
});

test('fiche PDF : « Encadrant suppl. » imprimé en entier', () => {
  const sup = diver('Sup', 'N4');
  const p: Palanquee = { id: 't', kind: 'teaching', guide: diver('T', 'MF1'), extras: [sup], members: [diver('F', 'FN1')] };
  const header = { etablissement: 'Club', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '2026-10-08', creneau: '', lieu: '', accompagnants: '' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees: [p], unassigned: [] }, validated: null, sheets: {}, gas: {} };
  const raw = Buffer.from(safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie').output('arraybuffer')).toString('latin1');
  assert.match(raw, /\(Encadrant suppl\.\)/, 'pas tronqué par la largeur de la colonne');
  assert.match(raw, /\(SUPSON\)/);
});

test('fiche : deux encadrants supplémentaires, deux lignes « Encadrant suppl. » (écran et PDF)', () => {
  const gp = diver('Gp', 'N4');
  const e3 = diver('Mf', 'MF1');
  const students = [1, 2, 3, 4].map((i) => diver(`S${i}`, 'P1', 'FN2'));
  const p: Palanquee = { id: 't', kind: 'teaching', guide: diver('T', 'MF1'), extras: [gp, e3], members: students };
  const rows = sheetRows(p);
  assert.equal(rows.length, 7, 'enseignant, 4 plongeurs, une ligne par encadrant suppl. (pas de ligne vide en plus)');
  assert.deepEqual(rows.slice(5).map((r) => [r.label, r.d, r.slot]), [['Encadrant suppl.', gp, 'extra'], ['Encadrant suppl.', e3, 'extra']]);
  assert.deepEqual(rows.slice(5).map((r) => sheetApt(r.d!, p, r.slot)), ['GP', 'E3']);
  // Une seule ligne quand il n’y en a qu’un, une ligne vide quand il n’y en a pas.
  assert.equal(sheetRows({ ...p, extras: [gp] }).filter((r) => r.slot === 'extra').length, 1);
  assert.deepEqual(sheetRows({ ...p, extras: [] }).filter((r) => r.slot === 'extra').map((r) => r.d), [null]);

  // PDF : les deux lignes sont imprimées ; les deux autres tableaux de la rangée sont complétés à la même hauteur, sur une page.
  const small: Palanquee = { id: 's', kind: 'guided', guide: diver('G2', 'N4'), extras: [], members: [diver('Z', 'P1')] };
  const header = { etablissement: 'Club', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '2026-10-08', creneau: '', lieu: '', accompagnants: '' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees: [small, p, { ...small, id: 's2' }], unassigned: [] }, validated: null, sheets: {}, gas: {} };
  const pdf = safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie');
  const raw = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  assert.equal(raw.match(/\(Encadrant suppl\.\)/g)?.length, 2);
  assert.match(raw, /\(GPSON\)/);
  assert.match(raw, /\(MFSON\)/);
  assert.match(raw, /\(Nb plongeurs\)[^(]*\(11\)/, 'tous deux comptés parmi les plongeurs à l’eau');
  assert.equal(pdf.getNumberOfPages(), 1);
});

test('fiche PDF : une formation de six et deux explorations sur la même rangée tiennent sur une page', () => {
  const big: Palanquee = {
    id: 'b', kind: 'teaching', guide: diver('T', 'MF1'), extras: [],
    members: [...[1, 2, 3, 4].map((i) => diver(`S${i}`, 'P1', 'FN2')), diver('M', 'MF2'), diver('G', 'N4')],
  };
  const small: Palanquee = { id: 's', kind: 'guided', guide: diver('G2', 'N4'), extras: [], members: [diver('Z', 'P1')] };
  const header = { etablissement: 'Club', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '2026-10-08', creneau: '', lieu: '', accompagnants: '' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees: [big, small, { ...small, id: 's2' }], unassigned: [] }, validated: null, sheets: {}, gas: {} };
  const pdf = safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie');
  assert.equal(pdf.getNumberOfPages(), 1);
});

test('avant d’imprimer : DP, pilote, date et lieu manquants ; profondeur prévue au-delà de la prérogative', () => {
  const header = { etablissement: 'Club', reference: '', bateau: '', pilote: ' ', dp: 'Hélène', securite: '', date: '2026-10-08', creneau: '', lieu: '', accompagnants: '' };
  assert.deepEqual(missingHeader(header), ['Pilote', 'Lieu de plongée']);
  const n1: Palanquee = { id: 'a', kind: 'guided', guide: diver('G', 'N4'), extras: [], members: [diver('Z', 'P1')] };
  const n3: Palanquee = { id: 'b', kind: 'autonomous', guide: null, extras: [], members: [diver('X', 'P3'), diver('Y', 'P3')] };
  const sheet = (depth: string) => ({ ...emptySheet(), planned: { duration: '', depth, time: '' } });
  const dive = { plan: { palanquees: [n1, n3], unassigned: [] }, sheets: { a: sheet('25 m'), b: sheet('45') } };
  assert.deepEqual(overDepth(dive), [{ label: 'P1', planned: 25, legal: 20 }]);
  assert.deepEqual(printWarnings(header, dive), ['Non renseigné : Pilote, Lieu de plongée.', 'P1 : 25 m prévus, au-delà de sa prérogative (20 m).']);
  assert.deepEqual(printWarnings({ ...header, pilote: 'Niels', lieu: 'Riou' }, { ...dive, sheets: {} }), []);
});

test('fiche PDF : le commentaire sur l’encadrant est imprimé', () => {
  const g = diver('Guide', 'P4');
  const p: Palanquee = { id: 'p', kind: 'guided', guide: g, extras: [], members: [diver('Zoé', 'P1')] };
  const note = { text: 'Stagiaire GP', by: 'Hélène', at: '2026-10-08T08:00:00Z' };
  assert.match(noteText(note), /^Stagiaire GP \(Hélène, \d\d\/\d\d\/\d{4} \d\d:\d\d\)$/);
  const header = { etablissement: 'Club', reference: '', bateau: '', pilote: '', dp: '', securite: '', date: '2026-10-08', creneau: '', lieu: '', accompagnants: '' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees: [p], unassigned: [] }, validated: null, sheets: {}, gas: {}, notes: { p: note } };
  const pdf = safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie');
  const raw = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  assert.match(raw, /Stagiaire GP/);
});
