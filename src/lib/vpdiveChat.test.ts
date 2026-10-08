import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseConversations, parseThread, unreadCount } from './vpdiveChat';

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

test('unreadCount : messages + groupes', () => {
  assert.equal(unreadCount({ responseCode: 200, res: { messages: 2, groups: '1', newsletters: '3' } }), 3);
  assert.equal(unreadCount(null), 0);
});
