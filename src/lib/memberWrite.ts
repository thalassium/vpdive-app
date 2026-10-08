/**
 * Écriture d'une fiche membre VPDive (POST /user/member/{uct}/update) pour
 * les corrections rapides de la gestion des adhésions. Formulaires construits
 * comme le site VPDive les envoie, un bloc par envoi ; un bloc absent n'est
 * pas touché (vérifié sur une fiche le 9 octobre 2026).
 *
 * Deux pièges :
 *   - bloc général sans `all_members=1` : le membre repasse Invité. On ne
 *     l'envoie donc que sur une fiche lue en vue admin, en recopiant le statut ;
 *   - blocs licences et niveaux : VPDive remplace la liste entière. On renvoie
 *     toutes les licences (et tous les niveaux) de la fiche, plus le changement.
 */
import { flatLicence, isFfessmLicence, licenceEnd, type VpRecord } from './membership';

export type Entry = [string, string];

/** Refus d'écrire : la fiche n'a pas la forme attendue, rien n'est envoyé. */
export class WriteError extends Error {}

type Ref = { id?: number | null };
type Years = (string | number)[];
/** Ce qu'on lit de GET /user/member/{uct} (le reste est ignoré). */
export interface RawMember {
  first_name?: string | null;
  last_name?: string | null;
  birthday?: string | null;
  email?: string | null;
  civility?: string | null;
  profession?: { token?: string | null } | null;
  username?: string | null;
  profile_picture?: string | null;
  is_admin_view?: boolean;
  insurance?: string | null;
  insurance_choice?: string | null;
  insurance_year?: number | string | null;
  user_club_traceability?: {
    birthday_show?: boolean | null;
    comment?: string | null;
    allMembers?: boolean | null;
    all_members?: boolean | null;
    createdAtUserUpdate?: string | null;
    dateConfirmation?: string | null;
    yearsConfirmation?: Years | null;
    yearsUserConfirmation?: Years | null;
  } | null;
  user_licence?: { id: number; licence?: string | null; organization?: (Ref & { name?: string }) | null; expirationDate?: string | null }[] | null;
  licenses?: { id: number; expiration_date?: string | null }[] | null;
  file_licence?: Record<string, { uniq?: string | null } | null> | null;
  organizations?: { id: number; name: string }[] | null;
  user_level?: { level?: Ref | null }[] | null;
  user_teaching?: { teaching?: Ref | null }[] | null;
  user_qualification?: { qualification?: Ref | null }[] | null;
  user_referee_judge?: { referee_judge?: Ref | null }[] | null;
  user_title_medal_other?: { title_medal_other?: Ref | null }[] | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** « 2026-12-31 » ou « 31/12/2026 » → « 31/12/2026 » ; '' si illisible. */
export function frDate(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // Date avec heure : jour local, comme le site VPDive (new Date + getDate).
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
/** Date du bloc général : les 10 premiers caractères, comme l'envoi testé sur une fiche. */
const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '';
};

/** Membre (et non Invité) d'après la fiche brute. */
export const rawIsMember = (u: RawMember) => !!(u.user_club_traceability?.allMembers ?? u.user_club_traceability?.all_members);

/** Saisons de la fiche (années de fin, 2027 = 2026/2027). */
export function rawSeasons(u: RawMember): number[] {
  const t = u.user_club_traceability ?? {};
  const y = t.yearsUserConfirmation?.length ? t.yearsUserConfirmation : (t.yearsConfirmation ?? []);
  return y.map(Number).filter((n) => Number.isInteger(n) && n > 1900);
}

/** Ce qu'on garde de la fiche avant d'écrire (journal du serveur) : de quoi tout remettre à la main. */
export const snapshot = (u: RawMember) => ({
  member: rawIsMember(u),
  seasons: rawSeasons(u),
  licences: (u.user_licence ?? []).map((l) => ({
    id: l.id,
    organization: l.organization?.name ?? '',
    licence: l.licence ?? '',
    expires: l.expirationDate ?? u.licenses?.find((x) => x.id === l.id)?.expiration_date ?? null,
  })),
  insurance: { choice: u.insurance_choice ?? '', other: u.insurance ?? '', year: u.insurance_year ?? null },
  capacities: currentCapacities(u),
});

/** Bloc général, recopié de la fiche, avec la saison en plus. */
export function generalEntries(u: RawMember, season: number): Entry[] {
  // Hors vue admin, VPDive n'attend pas all_members… et le retire quand même : on n'écrit pas.
  if (u.is_admin_view !== true) throw new WriteError('fiche lue sans la vue admin : écriture refusée (le statut Membre serait perdu)');
  const t = u.user_club_traceability ?? {};
  const c = String(u.civility ?? '').trim().toLowerCase();
  const civility = c === 'mme' ? 'mrs' : c === 'mlle' ? 'ms' : ['mr', 'mrs', 'ms'].includes(c) ? c : '';
  const years = [...new Set([...rawSeasons(u), season])].sort((a, b) => b - a);
  const out: Entry[] = [
    ['mobile_general_form[first_name]', String(u.first_name ?? '')],
    ['mobile_general_form[last_name]', String(u.last_name ?? '')],
    ['mobile_general_form[birthday]', day(u.birthday)],
    ['mobile_general_form[birthdayShow]', t.birthday_show ? '1' : '0'],
    ['mobile_general_form[email]', String(u.email ?? '')],
    ['mobile_general_form[civility]', civility],
    ['mobile_general_form[profession]', String(u.profession?.token ?? '')],
    ['mobile_general_form[username]', String(u.username ?? '')],
    ['mobile_general_form[comment]', String(t.comment ?? '')],
  ];
  if (rawIsMember(u)) out.push(['mobile_general_form[all_members]', '1']);
  out.push(['mobile_general_form[created_at_user_update]', day(t.createdAtUserUpdate ?? t.dateConfirmation)]);
  for (const y of years) out.push(['mobile_general_form[years][]', String(y)]);
  out.push(['mobile_general_form[picture]', String(u.profile_picture ?? '')]);
  return out;
}

export interface LicenceChange {
  /** Licence de la fiche dont la date de fin change (AAAA-MM-JJ). */
  extend?: { id: number; expires: string };
  /** Licence FFESSM à ajouter. */
  add?: { number: string; expires: string };
}

/** Bloc licences : toutes celles de la fiche, la date changée et / ou la licence ajoutée. */
export function licenceEntries(u: RawMember, change: LicenceChange): Entry[] {
  const list = u.user_licence ?? [];
  const k = (i: number, f: string) => `mobile_licence_form[user_licence][${i}][${f}]`;
  if (change.extend && !list.some((l) => l.id === change.extend!.id)) throw new WriteError('licence introuvable sur la fiche');
  const out: Entry[] = [];
  list.forEach((l, i) => {
    // Une organisation vide ferait perdre la licence : on ne devine pas.
    if (!l.organization?.id) throw new WriteError(`licence ${l.licence ?? ''} sans organisation sur la fiche : à corriger à la main`);
    const current = l.expirationDate ?? u.licenses?.find((x) => x.id === l.id)?.expiration_date ?? '';
    out.push([k(i, 'organization'), String(l.organization.id)], [k(i, 'licence'), String(l.licence ?? '')], [k(i, 'expiration_date'), change.extend?.id === l.id ? frDate(change.extend.expires) : frDate(current)]);
    const file = u.file_licence?.[String(l.id)]?.uniq;
    if (file) out.push([k(i, 'licence_file'), file]);
  });
  if (change.add) {
    const orgs = (u.organizations ?? []).filter((o) => /f\.?f\.?e\.?s\.?s\.?m/i.test(o.name));
    if (orgs.length !== 1) throw new WriteError('organisation FFESSM introuvable dans VPDive');
    const i = list.length;
    out.push([k(i, 'organization'), String(orgs[0]!.id)], [k(i, 'licence'), change.add.number], [k(i, 'expiration_date'), frDate(change.add.expires)]);
  }
  if (!out.length) throw new WriteError('rien à écrire');
  return out;
}

/** Bloc assurance : un libellé de la liste VPDive (« Assurance Loisir 1 »…) et son année. */
export const insuranceEntries = (choice: string, year: number): Entry[] => [
  ['mobile_insurance_form[insurance_year]', String(year)],
  ['mobile_insurance_form[insurance_choice]', choice],
  ['mobile_insurance_form[insurance]', ''],
];

const CAPACITY_LISTS = [
  ['user_level', 'level', 'l'],
  ['user_teaching', 'teaching', 't'],
  ['user_qualification', 'qualification', 'q'],
  ['user_referee_judge', 'referee_judge', 'rj'],
  ['user_title_medal_other', 'title_medal_other', 'tmo'],
] as const;

/** Niveaux de la fiche, sous la forme du référentiel (« l_125 », « t_3 »…). */
export function currentCapacities(u: RawMember): string[] {
  const out: string[] = [];
  for (const [list, field, prefix] of CAPACITY_LISTS) {
    for (const x of (u[list] ?? []) as Record<string, Ref | null | undefined>[]) {
      const id = x?.[field]?.id;
      if (id != null) out.push(`${prefix}_${id}`);
    }
  }
  return out;
}

/** Bloc niveaux : ceux de la fiche plus les nouveaux. */
export function capacityEntries(u: RawMember, add: string[], catalog: Set<string>): Entry[] {
  const now = currentCapacities(u);
  // Le site VPDive retire en silence un niveau absent du référentiel : on refuse plutôt.
  if (now.some((id) => !catalog.has(id))) throw new WriteError('la fiche a un niveau hors du référentiel du club : à faire à la main');
  if (add.some((id) => !catalog.has(id))) throw new WriteError('niveau inconnu du référentiel');
  return [...new Set([...now, ...add])].map((id): Entry => ['mobile_capacities_form[capacities][]', id]);
}

/** Ce que la fiche relue doit montrer après l'écriture. */
export interface Expect {
  season?: number;
  /** Licence FFESSM qui doit être là, valable jusqu'à la fin de la saison. */
  licence?: string;
  insurance?: string;
  /** Noms des niveaux ajoutés. */
  levels?: string[];
}

/**
 * Compare la fiche avant et après. `error` : quelque chose a été perdu ou n'a
 * pas été pris (on arrête le lot) ; `warning` : niveaux envoyés mais pas
 * encore visibles (validation du club en attente, peut-être).
 */
export function checkWrite(before: VpRecord, after: VpRecord, want: Expect, season: number): { error?: string; warning?: string } {
  if (after.member !== before.member) return { error: `statut ${after.member ? 'Membre' : 'Invité'} après l’écriture (avant : ${before.member ? 'Membre' : 'Invité'})` };
  if (after.licences.length < before.licences.length) return { error: 'une licence a disparu de la fiche' };
  if (before.seasons.some((s) => !after.seasons.includes(s))) return { error: 'une saison a disparu de la fiche' };
  const lostLevel = before.levels.find((l) => !after.levels.includes(l));
  if (lostLevel) return { error: `niveau perdu : ${lostLevel}` };
  if (want.season && !after.seasons.includes(String(want.season))) return { error: 'la saison n’apparaît pas sur la fiche relue' };
  if (want.licence) {
    const l = after.licences.find((x) => isFfessmLicence(x) && flatLicence(x.number) === flatLicence(want.licence!));
    if (!l) return { error: 'la licence n’apparaît pas sur la fiche relue' };
    if (!l.expires || l.expires < licenceEnd(season)) return { error: `licence encore ${l.expires ? `au ${l.expires.split('-').reverse().join('/')}` : 'sans date de fin'}` };
  }
  if (want.insurance && after.insurance !== want.insurance) return { error: `assurance relue : ${after.insurance || 'aucune'}` };
  const missing = (want.levels ?? []).filter((n) => !after.levels.includes(n));
  if (missing.length) return { warning: `pas encore visible : ${missing.join(', ')} (validation en attente ?)` };
  return {};
}
