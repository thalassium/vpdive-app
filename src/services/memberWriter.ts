/**
 * Corrections rapides de la gestion des adhésions, écrites dans VPDive pour
 * un membre : relecture de la fiche, envois espacés (un bloc à la fois, la file
 * du transport tenant une pause plus longue qu'entre deux lectures),
 * relecture et contrôle, puis journal sur le serveur (avec la fiche d'avant).
 * Les formulaires et les contrôles sont dans lib/memberWrite.
 */
import { SessionExpiredError, vpdive, type CallPace } from './vpdive';
import { appApi } from './appApi';
import { capacityEntries, checkWrite, generalEntries, insuranceEntries, licenceEntries, rawHasLicence, snapshot, type Entry, type Expect, type RawMember } from '../lib/memberWrite';
import { licenceEnd, type Fix, type VpRecord } from '../lib/membership';
import { message } from '../lib/errors';

// Plus lent que les lectures : ce sont des écritures, et le pare-feu de VPDive veille.
// Chaque appel de l'écriture d'une fiche attend 800 ms après le précédent (au lieu de 400).
const PACE: CallPace = { gap: 800 };

export interface WriteJob {
  uct: string;
  name: string;
  fixes: Fix[];
  /** N° de la licence FFESSM (date de fin ou licence à ajouter). */
  licence?: string;
  /** Libellé VPDive de l'assurance FFESSM. */
  insurance?: string;
  insuranceYear?: number;
  /** Niveaux VPDive à ajouter pour les brevets. */
  levels: { id: string; name: string }[];
}
export interface WriteResult {
  ok: boolean;
  message: string;
  warning?: string;
  /** Fiche relue après l'écriture (pour mettre le diagnostic à jour sans tout relire). */
  after?: VpRecord;
}

const KIND_LABEL: Record<string, string> = { season: 'saison', licence: 'date de licence', 'licence-add': 'licence', insurance: 'assurance', brevets: 'niveaux' };

export async function applyJob(job: WriteJob, season: number, catalog: Set<string>): Promise<WriteResult> {
  const { uct } = job;
  const kinds = new Set(job.fixes.map((f) => f.kind));
  const licenceFix = job.fixes.find((f) => f.kind === 'licence');
  const done: string[] = [];
  /** Au moins un envoi a changé la fiche. */
  let wrote = false;
  let before: ReturnType<typeof snapshot> | null = null;
  let after: VpRecord | undefined;
  let result: WriteResult;
  try {
    // Relue sans le cache : on écrit d'après la fiche telle qu'elle est maintenant.
    const record = await vpdive.memberRecord(uct, { ...PACE, fresh: true });
    let raw: RawMember = await vpdive.memberForm(uct, PACE);
    before = snapshot(raw);
    /** La licence a été relue à la FFESSM par VPDive : pas de date à saisir. */
    let refreshed = false;

    // Tous les formulaires d'abord : une fiche à la forme inattendue est refusée avant le moindre envoi.
    const want: Expect = {};
    const blocks: { kind: string; entries: () => Entry[] }[] = [];
    if (kinds.has('season')) {
      generalEntries(raw, season);
      blocks.push({ kind: 'season', entries: () => generalEntries(raw, season) });
      want.season = season;
    }
    // Licence à ajouter déjà sur la fiche relue (ajoutée entre-temps) : rien à ajouter, pas de doublon.
    let add = kinds.has('licence-add');
    if (add && job.licence && rawHasLicence(raw, job.licence)) {
      add = false;
      done.push('licence déjà présente, rien ajouté');
    }
    if (licenceFix || add) {
      if (!job.licence) throw new Error('n° de licence FFESSM inconnu');
      if (licenceFix && !licenceFix.licenceId) throw new Error('licence sans identifiant VPDive : à faire à la main');
      const change = () => ({
        ...(licenceFix?.licenceId && !refreshed ? { extend: { id: licenceFix.licenceId, expires: licenceEnd(season) } } : {}),
        ...(add ? { add: { number: job.licence!, expires: licenceEnd(season) } } : {}),
      });
      licenceEntries(raw, change());
      blocks.push({ kind: add ? 'licence-add' : 'licence', entries: () => licenceEntries(raw, change()) });
      want.licence = job.licence;
    }
    if (kinds.has('insurance')) {
      if (!job.insurance || !job.insuranceYear) throw new Error('assurance inconnue');
      blocks.push({ kind: 'insurance', entries: () => insuranceEntries(job.insurance!, job.insuranceYear!) });
      want.insurance = job.insurance;
      want.insuranceYear = job.insuranceYear;
    }
    if (job.levels.length) {
      const ids = job.levels.map((l) => l.id);
      capacityEntries(raw, ids, catalog);
      blocks.push({ kind: 'brevets', entries: () => capacityEntries(raw, ids, catalog) });
      want.levels = job.levels.map((l) => l.name);
    }

    // Licence vérifiée FFESSM : VPDive sait la relire lui-même ; la date n'est saisie que s'il n'y arrive pas.
    if (licenceFix?.refresh && licenceFix.licenceId) {
      const applied = await vpdive.refreshFfessmLicence(uct, licenceFix.licenceId, PACE).catch((e) => {
        if (e instanceof SessionExpiredError) throw e;
        return false;
      });
      if (applied) {
        wrote = true;
        const r = await vpdive.memberRecord(uct, { ...PACE, fresh: true });
        refreshed = r.licences.some((l) => l.id === licenceFix.licenceId && l.expires >= licenceEnd(season));
        if (refreshed) done.push('licence relue à la FFESSM');
        raw = await vpdive.memberForm(uct, PACE);
      }
    }

    for (const b of blocks) {
      if (b.kind === 'licence' && refreshed) continue;
      const entries = b.entries();
      await vpdive.updateMember(uct, entries, PACE);
      wrote = true;
      done.push(KIND_LABEL[b.kind] ?? b.kind);
    }

    after = await vpdive.memberRecord(uct, { ...PACE, fresh: true });
    const check = checkWrite(record, after, want, season);
    result = check.error
      ? { ok: false, message: `Écrit (${done.join(', ')}) mais à vérifier : ${check.error}`, after }
      : { ok: true, message: `Écrit : ${done.join(', ')}`, ...(check.warning ? { warning: check.warning } : {}), after };
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      // Session perdue entre deux blocs : ce qui est déjà écrit va quand même au journal (si le serveur l'accepte encore).
      if (before && wrote) {
        await appApi
          .logMemberWrite({ uct, name: job.name, kinds: [...kinds], ok: false, message: `Écrit en partie (${done.join(', ')}), puis : session VPDive expirée`, before })
          .catch(() => undefined);
      }
      throw e;
    }
    result = { ok: false, message: wrote ? `Écrit en partie (${done.join(', ')}), puis : ${message(e)}` : `Rien écrit : ${message(e)}`, ...(after ? { after } : {}) };
  }

  // Le journal garde la fiche d'avant : sans lui, on ne continue pas le lot.
  if (before) {
    try {
      await appApi.logMemberWrite({ uct, name: job.name, kinds: [...kinds], ok: result.ok, message: [result.message, result.warning].filter(Boolean).join(' · '), before });
    } catch (e) {
      return { ...result, ok: false, message: `${result.message} — journal non enregistré (${message(e)})` };
    }
  }
  return result;
}
