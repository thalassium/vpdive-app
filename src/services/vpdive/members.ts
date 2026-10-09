/**
 * Membres du club : recherche et annuaire, fiche d'un membre (niveaux), et ma
 * propre fiche (« Mon profil » : informations, documents, contact d'urgence).
 */
import { fromVpdive, OTHER_ACTIVITY, type VpdiveQualif } from '../../lib/vpdiveLevels';
import { searchFragments } from '../../lib/fuzzy';
import { SessionExpiredError, type ReadOptions } from './transport';
import { obj, str, num, pictureUrl, VPDIVE_ORIGIN, type Json } from './parse';
import { getSession, request, requestList } from './auth';

/** Durée de vie des lectures en cache (transport.ts). */
const TTL = {
  /** Ma fiche (« Mon profil ») : je peux la changer sur vpdive.com à côté. */
  myFile: 30_000,
  /** Recherche de membres, annuaire. */
  search: 5 * 60_000,
} as const;
/** Fiche d'un autre membre (/user?uct_token, /user/member) : lectures en lot des admins, partagées entre écrans. */
export const MEMBER_TTL = 5 * 60_000;

/** A club member found by name (VPDive's member picker search). */
export interface MemberMatch {
  /** Club membership token (UserClubTraceability), 43 characters. */
  id: string;
  name: string;
  /** Absolute URL of the member's own photo; empty when VPDive shows its default avatar. */
  picture: string;
}

/** Mes informations, telles que la fiche « Mon profil » de VPDive les donne. Chaînes vides si non renseignées. */
export interface MemberInfo {
  /** « M. », « Mme » */
  civility: string;
  firstName: string;
  lastName: string;
  birthName: string;
  alias: string;
  email: string;
  phone: string;
  address: string;
  zipCode: string;
  city: string;
  country: string;
  /** AAAA-MM-JJ */
  birthday: string;
  birthPlace: string;
  insurance: string;
  insuranceYear: number | null;
  /** Contrôle d'honorabilité validé le (AAAA-MM-JJ) */
  honorabilityAt: string;
  /** Adhésion au club confirmée le (AAAA-MM-JJ) */
  memberSince: string;
  /** Saisons d'adhésion (« 2026 », « 2025 »…), la plus récente d'abord. */
  seasons: string[];
  licences: { number: string; organization: string; expires: string; expired: boolean; validated: boolean }[];
  /** Ce que VPDive montre aux autres membres. */
  shows: { phone: boolean; birthday: boolean };
}

/** Personne à contacter en cas d'urgence, comme la page « Mon profil » de VPDive la saisit. */
export interface EmergencyContact {
  firstName: string;
  lastName: string;
  phone: string;
  cellphone: string;
  /** Lien avec le membre : « conjoint », « mère »… */
  link: string;
}

/** Un document déposé par le membre sur VPDive (certificat, licence, adhésion, qualification…). */
export interface MemberDocument {
  /** Ce que c'est : « Certificat médical », « Licence », le type de document du club… */
  label: string;
  /** Détail : nom du fichier, commentaire, validité. */
  detail: string;
  /** Lien de téléchargement sur vpdive.com. */
  url: string;
  kind: 'pdf' | 'image' | 'file';
}

export interface MemberProfile {
  /** Ce que lit le moteur des palanquées : codes de niveau (P4, PE40…) et prérogative E1…E4 (lib/vpdiveLevels.ts). */
  labels: string[];
  levels: string[];
  teaching: string[];
  qualifications: string[];
  email: string;
  phone: string;
  birthday: string;
  medicalUntil: string;
}

/** Fiche membre VPDive → niveaux, enseignement, qualifications, certificat. */
export function profileOf(u: Json): MemberProfile {
  const entries = (key: string, inner: string): Json[] =>
    (Array.isArray(u[key]) ? u[key] : []).map((x) => obj(obj(x)?.[inner])).filter((q): q is Json => q !== null);
  const names = (key: string, inner: string) => entries(key, inner).map((q) => str(q.name).trim()).filter(Boolean);
  // La fiche (/user/member, /user?uct_token) ne donne souvent que le nom, sans code
  // court : à défaut, le nom complet d'un diplôme de plongée (« P-Plongeur Niveau 4
  // (P4-N4) »), que le moteur des palanquées sait lire. Les autres activités
  // (un initiateur apnée…) ne donnent aucune prérogative en scaphandre.
  const qualifs: VpdiveQualif[] = (
    [
      ['user_level', 'level', 'level'],
      ['user_teaching', 'teaching', 'teaching'],
      ['user_qualification', 'qualification', 'qualification'],
    ] as const
  ).flatMap(([key, inner, family]) =>
    entries(key, inner).flatMap((q) => {
      const name = str(q.name).trim();
      const code = str(q.abbreviation).trim() || (OTHER_ACTIVITY.test(name) ? '' : name);
      return code ? [{ family, code, name }] : [];
    }),
  );
  return {
    labels: fromVpdive(qualifs).labels,
    levels: names('user_level', 'level'),
    teaching: names('user_teaching', 'teaching'),
    qualifications: names('user_qualification', 'qualification'),
    email: str(u.email),
    phone: str(u.phone),
    birthday: str(u.birthday),
    medicalUntil: str(u.medical_examination).slice(0, 10),
  };
}

/** Code pays ISO (« FR ») → nom en français ; tel quel si inconnu. */
const countryName = (code: string): string => {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames(['fr'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Fiche membre VPDive → mes informations personnelles et d'adhésion. */
export function infoOf(u: Json): MemberInfo {
  const day = (v: unknown) => str(v).slice(0, 10);
  const uct = obj(u.user_club_traceability) ?? {};
  const civ = str(u.civility).toLowerCase();
  const birthCity = str(u.city_of_birth).trim();
  const birthZip = str(u.zip_code_of_birth).trim();
  const birthCountry = countryName(str(u.country_of_birth).trim());
  return {
    civility: civ === 'mr' || civ === 'm' ? 'M.' : civ === 'mme' || civ === 'mrs' || civ === 'ms' ? 'Mme' : '',
    firstName: str(u.first_name).trim(),
    lastName: str(u.last_name).trim(),
    birthName: str(u.name_of_birth).trim(),
    alias: str(u.alias).trim(),
    email: str(u.email).trim(),
    phone: str(u.phone).trim(),
    address: str(u.address).trim(),
    zipCode: str(u.zip_code).trim(),
    city: str(u.city).trim(),
    country: countryName(str(u.country).trim()),
    birthday: day(u.birthday),
    birthPlace: [birthCity && (birthZip ? `${birthCity} (${birthZip})` : birthCity), birthCountry].filter(Boolean).join(', '),
    // Comme le site VPDive : le choix de la liste (« Assurance Loisir 1 »…) d'abord, le texte libre sinon (« Autre »).
    insurance: (str(u.insurance_choice).trim() && str(u.insurance_choice).trim() !== 'Autre' ? str(u.insurance_choice) : str(u.insurance)).trim(),
    insuranceYear: num(u.insurance_year),
    honorabilityAt: day(u.honorability_authorized_at),
    memberSince: day(uct.dateConfirmation) || day(uct.createdAt),
    seasons: (Array.isArray(uct.yearsConfirmation) ? uct.yearsConfirmation.map(String) : []).sort().reverse(),
    licences: (Array.isArray(u.licenses) ? u.licenses : []).map(obj).filter((l): l is Json => !!l && !!str(l.number)).map((l) => ({
      number: str(l.number).trim(),
      organization: str(obj(l.organization)?.name).trim(),
      expires: day(l.expiration_date),
      expired: l.is_expired === true,
      validated: str(l.status) === 'validated',
    })),
    shows: { phone: uct.phone_show === true || uct.cellphone_show === true, birthday: uct.birthday_show === true },
  };
}

/**
 * Les documents d'une fiche membre : certificat médical, licences, documents
 * par type (adhésion…), documents partagés avec le club (qualifications). Les
 * fichiers sont sous /uploads/documents/ ; les icônes génériques (/files/images/)
 * ne sont pas des documents.
 */
export function documentsOf(u: Json): MemberDocument[] {
  const out: MemberDocument[] = [];
  const kindOf = (name: string, type = ''): MemberDocument['kind'] =>
    /pdf/i.test(type) || /\.pdf$/i.test(name) ? 'pdf' : /image|jpe?g|png|webp|heic/i.test(type) || /\.(jpe?g|png|webp|heic)$/i.test(name) ? 'image' : 'file';
  const url = (path: string) => (path.startsWith('/uploads/') ? `${VPDIVE_ORIGIN}${path}` : path.startsWith('http') ? path : '');
  const push = (label: string, detail: string, path: string, name = '', type = '') => {
    const link = url(path);
    if (link && !out.some((d) => d.url === link)) out.push({ label, detail, url: link, kind: kindOf(name || path, type) });
  };

  const med = obj(u.file_medical_examination);
  if (med) {
    const until = str(u.medical_examination).slice(0, 10);
    push('Certificat médical', until ? `valable jusqu’au ${until.split('-').reverse().join('/')}` : str(med.name), str(med.link), str(med.name), str(med.type));
  }
  const licences = Array.isArray(u.user_licence) ? u.user_licence.map(obj) : [];
  for (const [id, raw] of Object.entries(obj(u.file_licence) ?? {})) {
    const f = obj(raw);
    if (!f) continue;
    const lic = licences.find((l) => l && String(l.id) === id);
    const org = str(obj(lic?.organization)?.name);
    push(org ? `Licence ${org}` : 'Licence', str(lic?.licence) || str(f.name), str(f.link), str(f.name), str(f.type));
  }
  for (const raw of Object.values(obj(u.type_document) ?? {})) {
    const f = obj(raw);
    if (!f || !str(f.filePath)) continue;
    const label = str(f.name).trim();
    push(label ? label.charAt(0).toUpperCase() + label.slice(1) : 'Document', str(f.fileName), str(f.filePath), str(f.fileName), str(f.fileType));
  }
  for (const raw of Array.isArray(u.document_shared) ? u.document_shared : []) {
    const f = obj(raw);
    if (!f) continue;
    const name = str(obj(f.userClubDocuments)?.name).trim();
    push(name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Document partagé', str(f.comment).trim() || str(f.document_file), str(f.document_link), str(f.document_file));
  }
  return out;
}

/**
 * Club members whose name contains `query` — the search behind VPDive's own
 * member picker. Exact substrings only: see lib/fuzzy.ts for typos.
 * Route « assignment » : `id` = jeton d'adhésion (fiches, rôles) ; route « messages » :
 * `id` = jeton utilisateur, celui des destinataires de la messagerie VPDive.
 */
export async function searchMembers(query: string, route: 'assignment' | 'messages' = 'assignment', opts: ReadOptions = {}): Promise<MemberMatch[]> {
  const list = await requestList('/search/user', { ...opts, method: 'POST', read: true, body: { query, route }, ttl: TTL.search });
  return list
    .map((raw) => {
      const o = obj(raw);
      // `id` is the member's 43-character club token (UserClubTraceability),
      // not a number: it opens the member profile (memberProfile below).
      const id = str(o?.id) || (num(o?.id) !== null ? String(o?.id) : '');
      const name = str(o?.value).trim() || `${str(o?.first_name)} ${str(o?.last_name)}`.trim() || str(o?.username);
      return id && name ? { id, name, picture: pictureUrl(str(o?.profile_picture)) } : null;
    })
    .filter((m): m is MemberMatch => m !== null);
}

/**
 * Club member directory. VPDive has no JSON endpoint listing members (its
 * own "Profil des membres" page is a legacy server-rendered page), but the
 * member search is not capped: searching each vowel and merging the answers
 * returns everyone whose name has a vowel — in practice the whole club
 * (one-letter search measured at 476 members, uncapped, October 2026).
 */
export async function fetchMemberDirectory(route: 'assignment' | 'messages' = 'assignment', opts: ReadOptions = {}): Promise<MemberMatch[]> {
  // Une voyelle après l'autre (la file du transport les espace), pas six recherches d'un coup.
  const byId = new Map<string, MemberMatch>();
  for (const v of ['a', 'e', 'i', 'o', 'u', 'y']) {
    for (const m of await searchMembers(v, route, opts)) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/**
 * Membres dont le nom approche ce qui est tapé : VPDive ne trouvant que des
 * sous-chaînes exactes, une recherche par fragment (lib/fuzzy.ts), l'une après
 * l'autre, réponses fusionnées. Le classement est laissé à l'écran (rankByName).
 */
export async function searchByName(typed: string, opts: ReadOptions = {}): Promise<MemberMatch[]> {
  const byId = new Map<string, MemberMatch>();
  for (const f of searchFragments(typed)) {
    for (const m of await searchMembers(f, 'assignment', opts)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

/**
 * A member's levels, teaching qualifications and other qualifications, by
 * their club token (the `id` of searchMembers). Same call as VPDive's own
 * member profile page; needs `member_view`.
 */
export async function memberProfile(memberToken: string, opts: ReadOptions = {}): Promise<MemberProfile> {
  return profileOf(await request(`/user?uct_token=${encodeURIComponent(memberToken)}`, { ...opts, ttl: MEMBER_TTL }));
}

/**
 * Mon contact d'urgence, lu sur le profil complet (GET /user, celui de la
 * page « Mon profil »). Champs vides si VPDive ne les renvoie pas.
 */
export async function myEmergencyContact(): Promise<EmergencyContact> {
  const res = await request('/user');
  const u = obj(res.data) ?? res;
  return {
    firstName: str(u.first_name_emergency).trim(),
    lastName: str(u.last_name_emergency).trim(),
    phone: str(u.phone_emergency).trim(),
    cellphone: str(u.cellphone_emergency).trim(),
    link: str(u.link_emergency).trim(),
  };
}

/** Enregistre mon contact d'urgence sur VPDive, exactement comme sa page « Mon profil » (POST /user). */
export async function saveEmergencyContact(c: EmergencyContact): Promise<void> {
  const form = new FormData();
  form.append('mobile_urgency_form[first_name_emergency]', c.firstName.trim());
  form.append('mobile_urgency_form[last_name_emergency]', c.lastName.trim());
  form.append('mobile_urgency_form[phone_emergency]', c.phone.trim());
  form.append('mobile_urgency_form[cellphone_emergency]', c.cellphone.trim());
  form.append('mobile_urgency_form[link_emergency]', c.link.trim());
  await request('/user', { method: 'POST', body: form });
}

/**
 * Ma fiche, telle que la page « Mon profil » de VPDive la lit (/user/member/<mon
 * jeton d'adhésion>) : niveaux, et les documents que j'ai déposés.
 */
export async function myFile(uct: string): Promise<{ profile: MemberProfile; documents: MemberDocument[]; info: MemberInfo }> {
  const res = await request(`/user/member/${encodeURIComponent(uct)}`, { ttl: TTL.myFile });
  const u = obj(res.data) ?? res;
  return { profile: profileOf(u), documents: documentsOf(u), info: infoOf(u) };
}

/**
 * Mes niveaux tels que le moteur des palanquées les lit (P4, E3…), pour savoir
 * si je peux m'inscrire comme encadrant : ma fiche (/user/member/<uct>), à
 * défaut la fiche membre (/user?uct_token=). Gardés 6 h dans l'onglet. Null si
 * VPDive ne les donne pas ; une session expirée reste une erreur.
 */
export async function myAptitudeLabels(): Promise<string[] | null> {
  const s = getSession();
  if (!s) throw new SessionExpiredError();
  const uct = s.traceability;
  const key = `my-labels:${uct}`;
  try {
    const cached = obj(JSON.parse(sessionStorage.getItem(key) ?? 'null'));
    const at = num(cached?.at) ?? 0;
    if (Array.isArray(cached?.labels) && at + 6 * 3_600_000 > Date.now()) {
      return cached.labels.filter((l): l is string => typeof l === 'string');
    }
  } catch {
    // Stockage indisponible ou illisible : on redemande à VPDive.
  }
  let labels: string[];
  try {
    labels = (await myFile(uct)).profile.labels;
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    try {
      labels = (await memberProfile(uct)).labels;
    } catch (e2) {
      if (e2 instanceof SessionExpiredError) throw e2;
      return null;
    }
  }
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), labels }));
  } catch {
    // Navigation privée : simplement pas de cache.
  }
  return labels;
}
