import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRestore, handleBackup, parseBackup, planRestore, runBackup, type BackupFile } from './backup.js';
import { memoryStore } from './store.js';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-key', SUPABASE_BACKUP_BUCKET: 'sauvegardes' };
type Call = { method: string; url: string; headers: Record<string, string>; body: string };

/** Supabase Storage simulé : `files` = noms déjà présents dans le bucket. */
async function withSupabase(files: string[], run: (calls: Call[]) => Promise<void>, status = 200) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? '') };
    calls.push(call);
    if (status !== 200) return new Response('{"error":"nope"}', { status });
    if (call.url.includes('/object/list/')) return new Response(JSON.stringify(files.map((name) => ({ name }))));
    return new Response('{}');
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const quiet = async <T,>(run: () => Promise<T>): Promise<T> => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await run();
  } finally {
    Object.assign(console, saved);
  }
};

const seeded = async () => {
  const store = memoryStore({ 'club:12:roles': { version: 2 }, 'app:helloasso-token': { access: 'secret' }, 'app:chat-purged-v1': { at: 'x' } });
  await store.set('club:12:outing:ev', { rev: 2 }, { ex: 3600 });
  await store.listPush('club:12:member-writes-log', { name: 'a' }, { max: 300 });
  await store.set('club:12:roles:lock', 1);
  return store;
};

test('sauvegarde : variables manquantes → rien d’envoyé', async () => {
  await withSupabase([], async (calls) => {
    const res = await quiet(() => runBackup(memoryStore(), {}));
    assert.equal(res.status, 'skipped');
    assert.equal(calls.length, 0);
  });
});

test('sauvegarde : clés club:* (sans verrous ni jeton HelloAsso) envoyées en un JSON daté ; plus de 90 jours supprimés', async () => {
  const store = await seeded();
  const now = new Date('2026-10-09T02:30:00Z');
  const files = ['gabian-2026-07-01.json', 'gabian-2026-07-11.json', 'gabian-2026-10-08.json', 'autre.txt'];
  await withSupabase(files, async (calls) => {
    const res = await quiet(() => runBackup(store, ENV, now));
    assert.equal(res.status, 'done');
    const upload = calls[0]!;
    assert.equal(upload.method, 'POST');
    assert.equal(upload.url, 'https://proj.supabase.co/storage/v1/object/sauvegardes/gabian-2026-10-09.json');
    assert.equal(upload.headers.Authorization, 'Bearer service-key');
    assert.equal(upload.headers['x-upsert'], 'true');
    const sent = parseBackup(upload.body);
    assert.deepEqual(Object.keys(sent.entries).sort(), ['club:12:member-writes-log', 'club:12:outing:ev', 'club:12:roles']);
    assert.ok(!upload.body.includes('secret'), 'pas de jeton HelloAsso');
    assert.deepEqual(sent.entries['club:12:member-writes-log'], { type: 'list', items: [{ name: 'a' }] });
    assert.equal(sent.at, now.toISOString());

    const del = calls.find((c) => c.method === 'DELETE')!;
    assert.equal(del.url, 'https://proj.supabase.co/storage/v1/object/sauvegardes');
    assert.deepEqual(JSON.parse(del.body), { prefixes: ['gabian-2026-07-01.json'] }, '11 juillet : 90 jours tout juste, gardé');
    if (res.status === 'done') assert.deepEqual(res.deleted, ['gabian-2026-07-01.json']);
  });
});

test('sauvegarde : refus de Supabase → erreur sans la clé ; route protégée par CRON_SECRET', async () => {
  await withSupabase(
    [],
    async () => {
      await assert.rejects(quiet(() => runBackup(memoryStore(), ENV)), (e: Error) => /HTTP 403/.test(e.message) && !e.message.includes('service-key'));
    },
    403,
  );

  const before = { ...process.env };
  try {
    const req = (auth?: string) => new Request('https://app/api/backup', { headers: auth ? { authorization: auth } : {} });
    delete process.env.CRON_SECRET;
    assert.equal((await quiet(() => handleBackup(req('Bearer x'), () => memoryStore()))).status, 503, 'sans secret configuré : refusé');
    process.env.CRON_SECRET = 'le-secret';
    assert.equal((await quiet(() => handleBackup(req(), () => memoryStore()))).status, 401);
    assert.equal((await quiet(() => handleBackup(req('Bearer autre'), () => memoryStore()))).status, 401);
    for (const k of Object.keys(ENV)) delete process.env[k];
    const ok = await quiet(() => handleBackup(req('Bearer le-secret'), () => memoryStore()));
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { status: string }).status, 'skipped', 'sans Supabase : 200, rien fait');
  } finally {
    process.env = before;
  }
});

test('restauration : essai à blanc (nouveau, différent, identique, expiré), puis écriture des seules différences', async () => {
  const at = '2026-10-01T00:00:00Z';
  const backup: BackupFile = {
    app: 'gabian',
    version: 1,
    at,
    count: 5,
    entries: {
      'club:12:roles': { type: 'value', value: { version: 2, admins: ['a'] } },
      'club:12:brevet-map': { type: 'value', value: { N1: ['Niveau 1'] } },
      'club:12:outing:ev': { type: 'value', value: { rev: 1 }, ttl: 10 * 86_400 },
      'club:12:outing:old': { type: 'value', value: { rev: 1 }, ttl: 3_600 },
      'club:12:member-writes-log': { type: 'list', items: [{ n: 2 }, { n: 1 }] },
      'app:helloasso-token': { type: 'value', value: { access: 'x' } },
    },
  };
  const store = memoryStore({ 'club:12:roles': { version: 2, admins: [] }, 'club:12:brevet-map': { N1: ['Niveau 1'] } });
  const now = Date.parse(at) + 2 * 86_400_000;
  const plan = planRestore(backup, await store.exportEntries('club:*'), 'club:*', now);
  assert.deepEqual(
    plan.map((s) => [s.key, s.status]),
    [
      ['club:12:brevet-map', 'same'],
      ['club:12:member-writes-log', 'new'],
      ['club:12:outing:ev', 'new'],
      ['club:12:outing:old', 'expired'],
      ['club:12:roles', 'changed'],
    ],
    'app:* jamais restauré',
  );
  assert.equal(plan.find((s) => s.key === 'club:12:outing:ev')!.entry.ttl, 8 * 86_400, 'durée de vie diminuée du temps écoulé');
  assert.equal(await applyRestore(store, plan), 3);
  assert.deepEqual(await store.get('club:12:roles'), { version: 2, admins: ['a'] });
  assert.deepEqual(await store.listRange('club:12:member-writes-log', 0, -1), [{ n: 2 }, { n: 1 }]);
  assert.equal(await store.get('club:12:outing:old'), null);

  const only = planRestore(backup, {}, 'club:*:outing:*', now);
  assert.deepEqual(only.map((s) => s.key), ['club:12:outing:ev', 'club:12:outing:old']);
  assert.throws(() => parseBackup('{"hello":1}'), /pas une sauvegarde/);
});
