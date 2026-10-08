import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkReminderText, checkDocs, reminderText, type DocsStatus } from './docsCheck';

const TODAY = '2026-10-08';
const OUTING = '2026-10-11';
const ffessm = (expires: string, expired = false) => ({ number: 'A-26-123456', organization: 'FFESSM', expires, expired, validated: true });
const inOrder: DocsStatus = { seasons: ['2026', '2025'], licences: [ffessm('2027-12-31')] };
const entry = (until: string | null, valid = until !== null, licences: { number: string; until: string | null; valid: boolean }[] = []) => ({
  medical: { until, valid },
  licences,
});

test('dossier complet le jour de la sortie : rien à signaler', () => {
  assert.deepEqual(checkDocs(entry('2027-03-01'), OUTING, inOrder, TODAY), { level: 'ok', issues: [] });
  // Certificat valable jusqu'au jour même de la sortie : couvert.
  assert.equal(checkDocs(entry(OUTING), OUTING, inOrder, TODAY).level, 'ok');
});

test('CACI manquant ou périmé à la date de la sortie : rouge', () => {
  assert.deepEqual(checkDocs(entry(null, false), OUTING, inOrder, TODAY).issues, [{ kind: 'caci', level: 'red', text: 'CACI manquant' }]);
  const expired = checkDocs(entry('2026-09-12'), OUTING, inOrder, TODAY);
  assert.equal(expired.level, 'red');
  assert.deepEqual(expired.issues, [{ kind: 'caci', level: 'red', text: 'CACI expiré le 12/09/2026' }]);
  // Encore valable aujourd'hui, plus le jour de la sortie.
  assert.deepEqual(checkDocs(entry('2026-10-10'), OUTING, inOrder, TODAY).issues[0]?.text, 'CACI expire le 10/10/2026');
  // Le rouge l'emporte sur le jaune.
  assert.equal(checkDocs(entry(null, false), OUTING, { seasons: [], licences: [] }, TODAY).level, 'red');
});

test('licence FFESSM lue sur la fiche du membre : jaune si aucune ne couvre la sortie', () => {
  const none = checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [] }, TODAY);
  assert.equal(none.level, 'yellow');
  assert.deepEqual(none.issues, [{ kind: 'licence', level: 'yellow', text: 'Licence FFESSM manquante' }]);
  // Une licence d'une autre fédération ne compte pas.
  const padi = { number: '123', organization: 'PADI', expires: '2030-01-01', expired: false, validated: true };
  assert.equal(checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [padi] }, TODAY).issues[0]?.text, 'Licence FFESSM manquante');
  // La plus récente est citée.
  const old = checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [ffessm('2024-12-31', true), ffessm('2025-12-31', true)] }, TODAY);
  assert.equal(old.issues[0]?.text, 'Licence FFESSM expirée le 31/12/2025');
  // Sans date de fin, on se fie à l'indicateur « expirée ».
  assert.equal(checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [ffessm('')] }, TODAY).level, 'ok');
  assert.equal(checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [ffessm('', true)] }, TODAY).level, 'yellow');
  // Organisation écrite autrement
  const longName = { ...ffessm('2027-12-31'), organization: 'Ffessm - Fédération française' };
  assert.equal(checkDocs(entry('2027-01-01'), OUTING, { seasons: ['2026'], licences: [longName] }, TODAY).level, 'ok');
});

test('fiche du membre illisible : licences de la liste des inscrits, adhésion non vérifiée', () => {
  const ok = checkDocs(entry('2027-01-01', true, [{ number: 'A-26-123456', until: '2027-12-31', valid: true }]), OUTING, null, TODAY);
  assert.equal(ok.level, 'ok');
  assert.deepEqual(ok.issues, [{ kind: 'adhesion', level: 'muted', text: 'Adhésion non vérifiée' }]);
  // Numéro qui n'a pas la forme FFESSM : pas une licence FFESSM.
  const other = checkDocs(entry('2027-01-01', true, [{ number: 'PADI-998877', until: '2030-01-01', valid: true }]), OUTING, null, TODAY);
  assert.equal(other.level, 'yellow');
  assert.equal(other.issues[0]?.text, 'Licence FFESSM manquante');
  const expired = checkDocs(entry('2027-01-01', true, [{ number: 'a-25-0001', until: '2025-12-31', valid: false }]), OUTING, null, TODAY);
  assert.equal(expired.issues[0]?.text, 'Licence FFESSM expirée le 31/12/2025');
  // Sans date : l'indicateur de validité.
  assert.equal(checkDocs(entry('2027-01-01', true, [{ number: 'A-26-12345', until: null, valid: true }]), OUTING, null, TODAY).level, 'ok');
});

test('adhésion : la saison est l’année de la sortie', () => {
  const r = checkDocs(entry('2027-06-01'), '2027-01-10', { seasons: ['2026', '2025'], licences: [ffessm('2027-12-31')] }, TODAY);
  assert.equal(r.level, 'yellow');
  assert.deepEqual(r.issues, [{ kind: 'adhesion', level: 'yellow', text: 'Adhésion 2027 non confirmée' }]);
  assert.equal(checkDocs(entry('2027-06-01'), OUTING, { seasons: ['2026'], licences: [ffessm('2027-12-31')] }, TODAY).level, 'ok');
});

test('messages de relance', () => {
  assert.equal(
    reminderText({ firstName: 'Marie', date: 'sam. 11 oct.', title: 'Sortie Club', kinds: ['licence', 'caci'], year: '2026', from: 'Lucas' }),
    'Bonjour Marie,\n\nPour la sortie du sam. 11 oct. (Sortie Club), il manque dans ton dossier VPDive : un certificat médical (CACI) valable le jour de la sortie et une licence FFESSM en cours de validité.\n' +
      'Peux-tu les mettre à jour sur https://septentrion-env.vpdive.com/app/profile ?\n\nMerci,\nLucas',
  );
  assert.match(reminderText({ firstName: '', date: 'sam. 11 oct.', title: 'Fosse', kinds: ['adhesion'], year: '2026', from: 'Lucas' }), /^Bonjour,\n[\s\S]*ton adhésion au club pour la saison 2026\.\nPeux-tu la mettre à jour/);
  const bulk = bulkReminderText({ year: '2026', from: 'Lucas' });
  assert.match(bulk, /^Bonjour,\n/);
  assert.match(bulk, /certificat médical \(CACI\)/);
  assert.match(bulk, /licence FFESSM/);
  assert.match(bulk, /saison 2026/);
});
