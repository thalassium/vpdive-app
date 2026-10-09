import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMaterial, bottlesLine, materialText, parseMaterialLine, type MaterialRegistrant } from './material';

const diver = (name: string, material: string[] = [], comment = '', waitingList = false): MaterialRegistrant => ({ name, material, comment, waitingList });

test('ligne VPDive : quantité, nom, taille de la déclinaison', () => {
  assert.deepEqual(parseMaterialLine('1 Gilet stabilisateur'), { qty: 1, name: 'Gilet stabilisateur', size: null });
  assert.deepEqual(parseMaterialLine('1 Gilet stabilisateur - M'), { qty: 1, name: 'Gilet stabilisateur', size: 'M' });
  assert.deepEqual(parseMaterialLine('2 Combinaison (Taille XXL)'), { qty: 2, name: 'Combinaison', size: '2XL' });
  // Les parenthèses du nom restent quand ce n'est pas une taille
  assert.deepEqual(parseMaterialLine('1 Pack complet (hors ordinateur)'), { qty: 1, name: 'Pack complet (hors ordinateur)', size: null });
  assert.deepEqual(parseMaterialLine('Détendeur'), { qty: 1, name: 'Détendeur', size: null });
});

test('matériel compté par taille : déclinaison, sinon message, sinon taille ?', () => {
  const s = aggregateMaterial([
    diver('A', ['1 Gilet stabilisateur - M', '1 Détendeur']),
    diver('B', ['1 Gilet stabilisateur'], 'Taille gilet stabilisateur : M'),
    diver('C', ['1 Gilet stabilisateur', '1 Combinaison'], 'Taille combinaison : L'),
    diver('D', ['1 Pack complet (hors ordinateur)'], 'Taille combinaison : S · Taille gilet stabilisateur : M'),
    diver('E', ['1 Pack complet (hors ordinateur)'], 'Taille combinaison : L · Taille gilet stabilisateur : L'),
    diver('F', ['2 Détendeur', '1 Ordinateur de plongée']),
  ]);
  assert.deepEqual(s.items, [
    { name: 'Combinaison', total: 1, bySize: { L: 1 } },
    { name: 'Détendeur', total: 3, bySize: {} },
    { name: 'Gilet stabilisateur', total: 3, bySize: { M: 2, 'taille ?': 1 } },
    { name: 'Ordinateur de plongée', total: 1, bySize: {} },
    { name: 'Pack complet (hors ordinateur)', total: 2, bySize: { L: 1, 'combi S, gilet M': 1 } },
  ]);
  assert.deepEqual(s.people.find((p) => p.name === 'C')?.lines, ['Gilet stabilisateur · taille ?', 'Combinaison · L']);
  assert.deepEqual(s.people.find((p) => p.name === 'F')?.lines, ['2 × Détendeur', 'Ordinateur de plongée']);
});

test('une bouteille par plongeur inscrit, liste d’attente à part et non comptée', () => {
  const s = aggregateMaterial([
    diver('A'),
    diver('B', [], 'Bouteille : 15 L'),
    diver('C', [], 'Bouteille : Enfant (8/10 L)'),
    diver('D', ['1 Combinaison - M'], 'Bouteille : 15 L', true),
  ]);
  assert.deepEqual(s.bottles, { '12 L': 1, '15 L': 1, 'Enfant (8/10 L)': 1 });
  assert.equal(bottlesLine(s.bottles), '12 L : 1 · 15 L : 1 · Enfant : 1');
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.people.map((p) => p.lines), [[], ['Bouteille 15 L'], ['Bouteille Enfant (8/10 L)']]);
  assert.deepEqual(s.waiting, [{ name: 'D', picture: '', lines: ['Combinaison · M', 'Bouteille 15 L'] }]);
});

test('liste à copier', () => {
  const s = aggregateMaterial([diver('A', ['1 Gilet stabilisateur - M']), diver('B', ['1 Gilet stabilisateur - L', '1 Détendeur'], 'Bouteille : 15 L')]);
  assert.equal(materialText(s, 'Sortie'), 'Sortie\n\nDétendeur : 1\nGilet stabilisateur : 2 (M × 1, L × 1)\n\nBouteilles : 12 L : 1 · 15 L : 1 · Enfant : 0');
});

test('une bouteille par plongeur : ni pilote, ni sécurité surface, ni DP qui ne plonge pas ; la fiche de sortie fait foi', () => {
  const r = (id: string, roles: string[] = [], comment = ''): MaterialRegistrant => ({ id, name: id, roles, comment, waitingList: false, material: [] });
  const roster = [r('a'), r('pilote', ['Pilote']), r('secu', ['Sécurité surface'], 'Bouteille : 15 L'), r('dp', ['Directeur de plongée']), r('dpe', ['Directeur de plongée', 'Enseignant/Encadrant'])];
  const byRoles = aggregateMaterial(roster);
  assert.deepEqual(byRoles.bottles, { '12 L': 2, '15 L': 0, 'Enfant (8/10 L)': 0 }, 'a et le DP qui encadre');
  assert.equal(byRoles.people.find((p) => p.name === 'pilote')?.noBottle, 'pilote, ne plonge pas');
  assert.deepEqual(byRoles.people.find((p) => p.name === 'secu')?.lines, [], 'pas de « Bouteille 15 L » pour qui ne plonge pas');
  // Fiche de sortie : le pilote plonge finalement, le DP encadrant reste à bord.
  const byOuting = aggregateMaterial(roster, new Set(['a', 'pilote']));
  assert.deepEqual(byOuting.bottles, { '12 L': 2, '15 L': 0, 'Enfant (8/10 L)': 0 });
  assert.equal(byOuting.people.find((p) => p.name === 'dpe')?.noBottle, 'ne plonge pas d’après la fiche de sortie');
  assert.equal(byOuting.people.find((p) => p.name === 'pilote')?.noBottle, undefined);
});

test('le jeton d’adhésion de l’inscrit suit jusqu’à la liste (icône « fiche ») ; absent pour un plongeur hors VPDive', () => {
  const s = aggregateMaterial([{ ...diver('A'), uct: 'uct-a' }, diver('B'), { ...diver('C', [], '', true), uct: 'uct-c' }]);
  assert.equal(s.people.find((p) => p.name === 'A')?.uct, 'uct-a');
  assert.equal('uct' in (s.people.find((p) => p.name === 'B') ?? {}), false);
  assert.equal(s.waiting[0]?.uct, 'uct-c');
});
