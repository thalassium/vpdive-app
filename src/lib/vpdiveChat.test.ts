import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, mergeConversations, nextStart, oldestShown, pageSize, parseConversations, parseThread, reachesCutoff, unreadCount, type ChatSummary } from './vpdiveChat';

const pic = (p: string) => (p ? `https://x${p}` : '');
const ME = { uct: 'me-uct', name: 'Moi', picture: '' };
const alice = { first_name: 'Alice', last_name: 'MARTIN', username: 'alice@x.fr', profile_picture: '/files/a.jpg', token: 'tok-alice', socket: 'sock-alice' };
const meUser = { first_name: 'Lucas', last_name: 'L', username: 'l@x.fr', profile_picture: '', token: 'tok-me', socket: 'sock-me' };

test('htmlToText : retours à la ligne, balises et entités', () => {
  assert.equal(htmlToText('Bonjour&nbsp;!<br>Rendez-vous &agrave; 9 h &amp; pas plus<br/>'), 'Bonjour !\nRendez-vous à 9 h & pas plus');
  assert.equal(htmlToText('<p>A</p><p>B</p>'), 'A\nB');
  assert.equal(htmlToText('l&#39;eau &#x26; le vent'), 'l\'eau & le vent');
});

test('parseConversations : liste rangée par mois, l’autre personne, non lu, plus récente d’abord', () => {
  const body = {
    messages: {
      juillet: {
        'conv-1': { 11: { token: 'conv-1', content: 'Salut<br>ça va ?', timestamp: 1753110735, read: true, to_user_is_current_user: true, from_user: alice, to_user: meUser, fullname: 'Alice MARTIN' } },
      },
      octobre: {
        'conv-2': { 12: { token: 'conv-2', content: 'Sortie demain', timestamp: 1760000000, read: false, to_user_is_current_user: false, from_user: meUser, to_user: { ...alice, token: 'tok-bob', first_name: 'Bob' } } },
      },
      previous_screen: null,
      next_screen: null,
    },
    more: '0',
  };
  const list = parseConversations(body, ME, pic);
  assert.deepEqual(list.map((c) => c.id), ['conv-2', 'conv-1']);
  assert.equal(list[0]!.title, 'Bob MARTIN');
  assert.equal(list[0]!.unread, true);
  assert.equal(list[1]!.title, 'Alice MARTIN');
  assert.equal(list[1]!.members[0]!.picture, 'https://x/files/a.jpg');
  assert.equal(list[1]!.last!.text, 'Salut\nça va ?');
  assert.equal(list[1]!.last!.at, new Date(1753110735 * 1000).toISOString());
});

test('parseThread : messages du plus ancien au plus récent, les miens repérés par sender', () => {
  const body = {
    token: 'conv-1',
    user: alice,
    can_respond: true,
    messages: {
      '2025-07-21 17:12:15': { m2: { message_id: 2, sender: false, message: 'Réponse', timestamp: 200, message_files: [] } },
      '2025-07-21 17:00:00': { m1: { message_id: 1, sender: true, message: 'Question', timestamp: 100, message_files: [] } },
      '2025-07-21 18:00:00': { m3: { message_id: 3, sender: false, message: '', timestamp: 300, message_files: [{}, {}] } },
    },
  };
  const t = parseThread(body, ME, pic);
  assert.equal(t.id, 'conv-1');
  assert.equal(t.title, 'Alice MARTIN');
  assert.deepEqual(t.messages.map((m) => [m.id, m.from, m.text]), [
    ['1', 'me-uct', 'Question'],
    ['2', 'tok-alice', 'Réponse'],
    ['3', 'tok-alice', '📎 2 pièces jointes'],
  ]);
  assert.equal(t.canRespond, true);
  assert.equal(parseThread({ ...body, is_close: true }, ME, pic).canRespond, false);
});

test('unreadCount : les conversations à deux seulement (les groupes ne sont pas listés)', () => {
  assert.equal(unreadCount({ responseCode: 200, res: { messages: 2, groups: '1', newsletters: '3' } }), 2);
  assert.equal(unreadCount({ res: { messages: '4' } }), 4);
  assert.equal(unreadCount({ res: { groups: 5 } }), 0);
  assert.equal(unreadCount(null), 0);
});

test('parseConversations : l’auteur du dernier message (« Vous : » dans l’aperçu)', () => {
  const body = {
    messages: {
      octobre: {
        'conv-a': { 1: { token: 'conv-a', content: 'De moi', timestamp: 1760000000, read: true, to_user_is_current_user: false, from_user: meUser, to_user: alice } },
        'conv-b': { 2: { token: 'conv-b', content: 'D’elle', timestamp: 1760000100, read: false, to_user_is_current_user: true, from_user: alice, to_user: meUser } },
      },
    },
  };
  const [b, a] = parseConversations(body, ME, pic);
  assert.equal(a!.last!.from, 'me-uct');
  assert.equal(b!.last!.from, 'tok-alice');
});

const conv = (id: string, updatedAt: string, unread = false): ChatSummary => ({
  id, kind: 'direct', title: id, members: [], last: null, unread, updatedAt,
});

test('pagination : position de la page suivante', () => {
  const page = { messages: { octobre: { c1: { 1: { token: 'c1', from_user: alice, to_user: meUser } }, c2: { 2: { token: 'c2', from_user: alice, to_user: meUser } } }, next_screen: null }, more: '0' };
  assert.equal(pageSize(page), 2);
  assert.equal(nextStart(page, 2), null);
  assert.equal(nextStart({ ...page, more: '1' }, 2), 2);
  assert.equal(nextStart({ ...page, more: true }, 20), 20);
  assert.equal(nextStart({ ...page, more: 12 }, 20), 20);
  assert.equal(nextStart({ messages: { ...page.messages, next_screen: 40 }, more: '1' }, 20), 40);
  assert.equal(nextStart({ ...page, more: '1' }, 0), null);
  assert.equal(nextStart(null, 3), null);
});

test('pagination : limite au 1er janvier de l’année précédente, pages fusionnées', () => {
  const cutoff = oldestShown(new Date(2026, 9, 9));
  assert.equal(cutoff, new Date(2025, 0, 1).toISOString());
  const p1 = [conv('a', '2026-10-01T10:00:00.000Z', true), conv('b', '2026-03-01T10:00:00.000Z')];
  const p2 = [conv('b', '2026-03-01T10:00:00.000Z'), conv('c', '2025-02-01T10:00:00.000Z'), conv('d', '2024-12-31T10:00:00.000Z')];
  assert.equal(reachesCutoff(p1, cutoff), false);
  assert.equal(reachesCutoff(p2, cutoff), true);
  assert.deepEqual(mergeConversations([p1, p2], cutoff).map((c) => c.id), ['a', 'b', 'c']);
  // La version la plus récente d'une conversation l'emporte (rafraîchissement de la première page).
  const fresh = [conv('c', '2026-10-09T08:00:00.000Z', true)];
  assert.deepEqual(mergeConversations([fresh, p1, p2], cutoff).map((c) => [c.id, c.unread]), [['c', true], ['a', true], ['b', false]]);
  // Sans date lisible : gardée.
  assert.equal(mergeConversations([[conv('x', '')]], cutoff).length, 1);
});
