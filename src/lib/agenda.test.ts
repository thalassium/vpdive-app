import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayBefore, isCancelledTitle, isoDateTime, listDaysOf } from './agenda';

test('isCancelledTitle : convention du club, avec ou sans crochets, accents et majuscules', () => {
  assert.equal(isCancelledTitle('[ANNULÉE] Riou – plongée du matin'), true);
  assert.equal(isCancelledTitle('Frioul (annulée)'), true);
  assert.equal(isCancelledTitle('ANNULE - Planier'), true);
  assert.equal(isCancelledTitle('Annulation : sortie Cassidaigne'), true);
  assert.equal(isCancelledTitle('Assemblée annuelle'), false);
  assert.equal(isCancelledTitle('Plongée de nuit'), false);
});

test('isoDateTime : « AAAA-MM-JJ HH:MM:SS » devient de l’ISO, l’ISO reste tel quel', () => {
  assert.equal(isoDateTime('2026-10-10 08:15:00'), '2026-10-10T08:15:00');
  assert.equal(isoDateTime('2026-10-10 08:15:00.000000'), '2026-10-10T08:15:00');
  assert.equal(isoDateTime('2026-10-10 08:15'), '2026-10-10T08:15:00');
  assert.equal(isoDateTime('2026-10-10T08:15:00+02:00'), '2026-10-10T08:15:00+02:00');
  assert.equal(isoDateTime(''), '');
  assert.equal(isoDateTime('2026-10-10'), '2026-10-10');
  assert.ok(!Number.isNaN(Date.parse(isoDateTime('2026-10-10 08:15:00'))));
});

test('listDaysOf : mois en cours depuis la veille, autres mois en entier, rangés', () => {
  const days = ['2026-10-20', '2026-10-01', '2026-10-08', '2026-10-09', '2026-11-02', '2026-09-30'];
  assert.deepEqual(listDaysOf(days, 2026, 9, '2026-10-09'), ['2026-10-08', '2026-10-09', '2026-10-20']);
  assert.deepEqual(listDaysOf(days, 2026, 10, '2026-10-09'), ['2026-11-02']);
  assert.deepEqual(listDaysOf(days, 2026, 9, '2026-12-01'), ['2026-10-01', '2026-10-08', '2026-10-09', '2026-10-20']);
  assert.equal(dayBefore('2026-03-01'), '2026-02-28');
  assert.equal(dayBefore('2027-01-01'), '2026-12-31');
});
