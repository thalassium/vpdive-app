import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryScript } from './newVersion';

test('entryScript : le fichier principal cité par index.html', () => {
  const html = `<head>
    <script>/* thème */</script>
    <script type="module" crossorigin src="/assets/index-C4dqyIHi.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-AbC123.js">
  </head>`;
  assert.equal(entryScript(html), '/assets/index-C4dqyIHi.js');
});

test('entryScript : null sans fichier construit (serveur de dev, page d’erreur)', () => {
  assert.equal(entryScript('<script type="module" src="/src/main.tsx"></script>'), null);
  assert.equal(entryScript('<h1>502 Bad Gateway</h1>'), null);
});
