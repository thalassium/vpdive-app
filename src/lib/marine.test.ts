import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beaufort, compass, level, metres, preferModels, toSlots, windColor, worstIn, type Slot } from './marine';

test('compass : rose des 16 directions en français', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(225), 'SO');
  assert.equal(compass(292), 'ONO');
  assert.equal(compass(359), 'N');
  assert.equal(compass(-90), 'O');
});

test('beaufort : bornes en nœuds', () => {
  assert.equal(beaufort(0), 0);
  assert.equal(beaufort(5), 2);
  assert.equal(beaufort(12), 4);
  assert.equal(beaufort(16), 5);
  assert.equal(beaufort(30), 7);
  assert.equal(beaufort(70), 12);
});

test('level : le pire des trois critères', () => {
  assert.equal(level({ wind: 10, gusts: 15, waves: 0.5 }), 'ok');
  assert.equal(level({ wind: 16, gusts: 18, waves: 0.5 }), 'jaune');
  assert.equal(level({ wind: 10, gusts: 15, waves: 1.1 }), 'jaune');
  assert.equal(level({ wind: 12, gusts: 31, waves: 0.4 }), 'rouge');
  assert.equal(level({ wind: 8, gusts: 10, waves: null }), 'ok');
});

test('toSlots : fusionne vent et mer sur l’heure, la mer peut manquer', () => {
  const slots = toSlots(
    {
      time: ['2026-10-11T09:00', '2026-10-11T10:00', '2026-10-11T11:00'],
      wind_speed_10m: [8.4, 12.6, null],
      wind_gusts_10m: [14, 19.2, 20],
      wind_direction_10m: [300, 310, 315],
    },
    {
      time: ['2026-10-11T10:00'],
      wave_height: [0.8],
      wind_wave_height: [0.5],
      swell_wave_height: [0.4],
      swell_wave_period: [6.5],
      swell_wave_direction: [220],
      sea_surface_temperature: [19.4],
    },
  );
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[0], {
    time: '2026-10-11T09:00', wind: 8, gusts: 14, windDir: 300,
    waves: null, windWaves: null, swell: null, swellPeriod: null, swellDir: null, water: null,
  });
  assert.equal(slots[1]!.wind, 13);
  assert.equal(slots[1]!.waves, 0.8);
  assert.equal(slots[1]!.water, 19.4);
});

test('worstIn : pire créneau dans les horaires de la sortie', () => {
  const s = (time: string, wind: number, gusts: number, waves: number): Slot => ({
    time, wind, gusts, windDir: 0, waves, windWaves: null, swell: null, swellPeriod: null, swellDir: null, water: null,
  });
  const slots = [s('2026-10-11T08:00', 25, 35, 2), s('2026-10-11T09:00', 10, 14, 0.5), s('2026-10-11T11:00', 12, 18, 1.2), s('2026-10-11T13:00', 30, 40, 2)];
  assert.equal(worstIn(slots, '2026-10-11T09:00:00', '2026-10-11T12:00:00')?.time, '2026-10-11T11:00');
  assert.equal(worstIn(slots, '2026-10-11 09:00', '2026-10-11 09:30')?.time, '2026-10-11T09:00');
  assert.equal(worstIn(slots, '2026-10-12T09:00', '2026-10-12T12:00'), null);
});

test('preferModels : Météo-France d’abord, le modèle par défaut au-delà', () => {
  const h = preferModels(
    {
      time: ['a', 'b'],
      wind_speed_10m_meteofrance_seamless: [10, null],
      wind_speed_10m_best_match: [12, 14],
      wind_gusts_10m_meteofrance_seamless: [null, null],
      wind_gusts_10m_best_match: [20, null],
    },
    ['meteofrance_seamless', 'best_match'],
  );
  assert.deepEqual(h.wind_speed_10m, [10, 14]);
  assert.deepEqual(h.wind_gusts_10m, [20, null]);
});

test('windColor : paliers exacts, interpolation, bornes', () => {
  assert.equal(windColor(-3), '#a9c3f0');
  assert.equal(windColor(16), '#b5d84a');
  assert.equal(windColor(22), '#f39a3c');
  assert.equal(windColor(60), '#8e3fa6');
  // À mi-chemin entre 16 (#b5d84a) et 19 (#f2d04a) : #d4d44a.
  assert.equal(windColor(17.5), '#d4d44a');
});

test('metres : virgule décimale', () => {
  assert.equal(metres(0.64), '0,6 m');
  assert.equal(metres(null), '–');
});
