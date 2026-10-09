import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenMember, sheetAccess, sheetFallback, VPDIVE_MEMBER } from './memberSheet';
import { VpDiveError } from '../services/vpdive/transport';

test('fiche membre : complète pour les admins et super-admins, pas pour un simple membre', () => {
  assert.equal(canOpenMember('superadmin'), true);
  assert.equal(canOpenMember('admin'), true);
  assert.equal(canOpenMember('member'), false);
});

test('fiche membre : admin = complète ; DP non admin = « plongée » avec la ligne d’inscrit ; simple membre = rien', () => {
  // Admin, avec ou sans ligne d'inscrit.
  assert.equal(sheetAccess({ uct: 'uct-1', full: true, roster: false }), 'full');
  assert.equal(sheetAccess({ uct: 'uct-1', full: true, roster: true }), 'full');
  // DP non admin : seulement les inscrits de sa sortie (l'écran DP fournit la ligne).
  assert.equal(sheetAccess({ uct: 'uct-1', full: false, roster: true }), 'dive');
  // Simple membre, ou DP hors de l'écran de sa sortie : pas d'icône.
  assert.equal(sheetAccess({ uct: 'uct-1', full: false, roster: false }), 'none');
  // Plongeur hors VPDive : pas de jeton, pas de fiche, même pour un admin.
  assert.equal(sheetAccess({ uct: '', full: true, roster: true }), 'none');
  assert.equal(sheetAccess({ full: true, roster: false }), 'none');
});

test('fiche membre : refus de VPDive (403) → fiche « plongée » si la ligne d’inscrit est là, sinon réservé aux admins', () => {
  const refused = new VpDiveError('Accès refusé', 403);
  assert.equal(sheetFallback(refused, true), 'dive');
  assert.equal(sheetFallback(refused, false), 'forbidden');
  // Le pare-feu (403 sans JSON) n'est pas un refus de VPDive : « Réessayer ».
  assert.equal(sheetFallback(new VpDiveError('Pare-feu', 403, 'rate-limit'), true), 'error');
  assert.equal(sheetFallback(new VpDiveError('Introuvable', 404), true), 'missing');
  assert.equal(sheetFallback(new VpDiveError('Réseau', 0, 'network'), true), 'error');
  assert.equal(sheetFallback(new Error('autre'), true), 'error');
});

test('fiche membre : lien vers la fiche sur le site VPDive du club', () => {
  assert.equal(VPDIVE_MEMBER('a/b c'), 'https://septentrion-env.vpdive.com/app/member/a%2Fb%20c');
});
