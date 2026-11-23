import { test } from 'node:test';
import assert from 'node:assert/strict';
import { santaLink, santaRoute, whatsappUrl } from './santaRoute';

test('santaRoute : lien de participant, page de suivi, reste de l’appli', () => {
  assert.deepEqual(santaRoute('#santa=abc_DEF-123'), { page: 'reveal', token: 'abc_DEF-123' });
  assert.deepEqual(santaRoute('#santa-admin'), { page: 'admin', key: null });
  assert.deepEqual(santaRoute('#santa-admin=k1'), { page: 'admin', key: 'k1' });
  for (const hash of ['', '#messages', '#santa', '#santa=', '#santa=a/b', '#santax=abc']) assert.equal(santaRoute(hash), null, hash);
});

test('whatsappUrl : le lien entier est dans le message, fragment compris', () => {
  const link = santaLink('tok', 'https://gabian.app');
  assert.equal(link, 'https://gabian.app/#santa=tok');
  const text = new URL(whatsappUrl('Anna', 'Noël 2026', link)).searchParams.get('text')!;
  assert.ok(text.includes('Anna') && text.includes('Noël 2026') && text.endsWith(link));
});
