import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listConversations, readConversation, sendMessage, startConversation, type ChatCaller } from './chat';
import type { Store } from './store';

const memoryStore = (): Store => {
  const data = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : null),
    set: async (k, v) => void data.set(k, structuredClone(v)),
  };
};
const uct = (c: string) => c.repeat(43);
const alice: ChatCaller = { clubId: '414', uct: uct('a'), name: 'Alice Martin' };
const bob: ChatCaller = { clubId: '414', uct: uct('b'), name: 'Bob Durand' };
const carol: ChatCaller = { clubId: '414', uct: uct('c'), name: 'Carol Petit' };
const member = (c: ChatCaller) => ({ uct: c.uct, name: c.name, picture: '' });

test('messagerie : une seule conversation par paire, non lue tant que le destinataire ne l’a pas ouverte', async () => {
  const store = memoryStore();
  const conv = await startConversation(store, alice, { members: [member(bob)] });
  assert.equal(conv.kind, 'direct');
  assert.equal(conv.title, 'Bob Durand', 'le titre est le nom de l’autre');
  const again = await startConversation(store, bob, { members: [member(alice)] });
  assert.equal(again.id, conv.id, 'Bob retrouve la même conversation');

  await sendMessage(store, alice, { id: conv.id, text: '  Rendez-vous 8 h au bateau  ' });
  const [forBob] = await listConversations(store, bob);
  assert.equal(forBob!.unread, true);
  assert.equal(forBob!.last?.text, 'Rendez-vous 8 h au bateau');
  assert.equal((await listConversations(store, alice))[0]!.unread, false, 'l’auteur l’a lu');

  const opened = await readConversation(store, bob, conv.id);
  assert.equal(opened.messages.length, 1);
  assert.equal((await listConversations(store, bob))[0]!.unread, false, 'ouverte, elle est lue');
});

test('messagerie : un groupe ; les autres membres du club n’y ont pas accès', async () => {
  const store = memoryStore();
  const group = await startConversation(store, alice, { members: [member(bob), member(carol)], title: 'Sortie Planier' });
  assert.equal(group.kind, 'group');
  assert.equal(group.title, 'Sortie Planier');
  assert.equal((await listConversations(store, carol)).length, 1);

  const dave: ChatCaller = { clubId: '414', uct: uct('d'), name: 'Dave' };
  await assert.rejects(readConversation(store, dave, group.id), /introuvable/);
  await assert.rejects(sendMessage(store, dave, { id: group.id, text: 'coucou' }), /introuvable/);
  await assert.rejects(sendMessage(store, alice, { id: group.id, text: '   ' }), /vide/);
  await assert.rejects(startConversation(store, alice, { members: [] }), /au moins une personne/);
});
