import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptitudesFromLabels, type Diver, type Palanquee } from './palanquees';
import { emptySheet, type Dive, type OutingDoc } from './outing';
import { headerText, sheetApt, sheetRows } from './safetySheet';
import { safetySheetFileName, safetySheetPdf } from './safetySheetPdf';

let n = 0;
const diver = (name: string, ...labels: string[]): Diver => ({ id: `d${++n}`, name, firstname: name, lastname: `${name}son`, labels, ...aptitudesFromLabels(labels) });

test('fiche : une palanquée autonome n’a pas d’encadrant, ses plongeurs prennent les lignes 1 à 4', () => {
  const a = diver('A', 'P3');
  const b = diver('B', 'P3');
  const p: Palanquee = { id: 'p', kind: 'autonomous', guide: a, extra: null, members: [b] };
  const rows = sheetRows(p);
  assert.equal(rows.length, 6);
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
  const palanquees: Palanquee[] = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, kind: 'guided', guide: g, extra: null, members: [diver('Zoé', 'P1')] }));
  const header = { etablissement: 'Club', reference: '', bateau: 'Ève', pilote: '', dp: 'Hélène', securite: '', date: '2026-10-08', creneau: 'Après-midi', lieu: 'Île' };
  const dive: Dive = { id: 'd1', label: 'Plongée 1', plan: { palanquees, unassigned: [] }, validated: null, sheets: { p0: emptySheet() }, gas: {} };
  const pdf = safetySheetPdf({ settings: {} as OutingDoc['settings'], header, dives: [dive] }, dive, 'Sortie');
  assert.equal(pdf.getNumberOfPages(), 2);
  const raw = Buffer.from(pdf.output('arraybuffer')).toString('latin1');
  assert.match(raw, /%PDF-/);
});
