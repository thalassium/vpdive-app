/**
 * Messagerie VPDive (/messages_) : conversations, fils, non-lus, envoi. Les
 * formes des réponses sont lues dans lib/vpdiveChat.ts.
 */
import { VpDiveError, type CallPace } from './transport';
import { obj, str, type Json } from './parse';
import { request } from './auth';
import { MEMBER_TTL } from './members';

/**
 * Conversations à deux, une page, la plus récente d'abord. Route VPDive :
 * /messages_/messages/{type_flux}/{start}/{more}/{filter}/{term}, chaque segment
 * ayant une valeur par défaut. Première page : aucun segment (les valeurs par
 * défaut) ; pages suivantes : seulement `start`, la position de la page
 * (lib/vpdiveChat.ts, nextStart). Jamais de terme de recherche : « null » y
 * cherchait le mot « null ».
 */
export function messageList(start = 0): Promise<Json> {
  return request(start > 0 ? `/messages_/messages/discussion/${start}` : '/messages_/messages');
}

/** Fil d'une conversation, par son jeton. */
export function messageThread(conversation: string): Promise<Json> {
  return request(`/messages_/detail/messages/${encodeURIComponent(conversation)}`);
}

/** Compteurs de non-lus : { res: { messages, groups, … } }. */
export function messageNotifications(): Promise<Json> {
  return request('/messages_/notifications');
}

/**
 * Champs d'envoi, sous les deux noms qu'emploie VPDive : ceux de sa nouvelle
 * messagerie (message, message_token…) et ceux du formulaire de l'ancienne
 * (message_new_message_form[…]). Une seule requête : pas de double envoi.
 */
function messageForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
    form.append(`message_new_message_form[${k}]`, v);
  }
  return form;
}

/** Répond dans une conversation existante. */
export async function messageReply(conversation: string, text: string): Promise<void> {
  const form = messageForm({ message: text, type_flux: 'discussion', message_token: conversation });
  const res = await request('/messages_/new_message', { method: 'POST', body: form });
  if (res.success === false) throw new VpDiveError(str(res.message) || 'Le message n’a pas été envoyé.', 0);
}

/**
 * Écrit à une ou plusieurs personnes (jetons utilisateur VPDive) : VPDive ouvre la
 * conversation au premier message. Destinataires au format de sa messagerie.
 */
export async function messageStart(userTokens: string[], text: string): Promise<void> {
  const form = messageForm({ message: text, message_token: JSON.stringify(userTokens.map((token) => ({ type: 'user', token }))) });
  const res = await request('/messages_/new-message-members', { method: 'POST', body: form });
  if (res.success === false) throw new VpDiveError(str(res.message) || 'Le message n’a pas été envoyé.', 0);
}

/** Jeton utilisateur VPDive d'un membre, à partir de son jeton d'adhésion. */
export async function userTokenOf(uct: string, opts: CallPace = {}): Promise<string> {
  const res = await request(`/user?uct_token=${encodeURIComponent(uct)}`, { ...opts, ttl: MEMBER_TTL });
  const token = str((obj(res.data) ?? res).token);
  if (!token) throw new VpDiveError('Membre introuvable dans la messagerie VPDive.', 0);
  return token;
}
