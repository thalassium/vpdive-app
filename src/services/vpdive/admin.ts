/**
 * Administration du club (permission `member_view`) : documents à valider,
 * statut et fiche complète d'un membre, écriture d'une fiche (gestion des
 * adhésions), référentiel des niveaux.
 */
import type { Capacity, VpRecord } from '../../lib/membership';
import type { RawMember } from '../../lib/memberWrite';
import { VpDiveError, type CallPace, type ReadOptions } from './transport';
import { obj, str, num, pictureUrl, VPDIVE_ORIGIN, type Json } from './parse';
import { request } from './auth';
import { infoOf, profileOf, MEMBER_TTL, type MemberInfo } from './members';

/** Référentiel des niveaux du club : change rarement, gardé une heure dans l'onglet. */
const CAPACITIES_TTL = 3_600_000;
/** Les lectures qu'une écriture sur la fiche d'un membre rend périmées. */
const memberPaths = (uct: string) => [`/user?uct_token=${encodeURIComponent(uct)}`, `/user/member/${encodeURIComponent(uct)}`];

/** Un document ou une déclaration d'un membre, en attente de validation par le club (validation_tracking). */
export interface PendingValidation {
  /** medical_examination, licence, year_confirmation, level, qualification… */
  type: string;
  /** « CACI », « Licence », « Année(s) d'inscription »… */
  typeLabel: string;
  /** Jeton d'adhésion du membre (uct). */
  member: string;
  memberName: string;
  picture: string;
  /** Ce qui est déclaré : date de fin du CACI, n° de licence, saison, niveau… */
  detail: string;
  files: { label: string; url: string }[];
  entityId: number;
}

/**
 * Compte au statut « Membre » du club (et non « Invité ») ? C'est le drapeau
 * allMembers de son adhésion : is_member_of_club vaut vrai pour les invités aussi.
 */
export async function isClubMember(uct: string, opts: ReadOptions = {}): Promise<boolean> {
  const res = await request(`/user/member/${encodeURIComponent(uct)}`, { ...opts, ttl: MEMBER_TTL });
  const data = obj(obj(res)?.data) ?? obj(res);
  return obj(data?.user_club_traceability)?.allMembers === true;
}

/**
 * Documents et déclarations des membres en attente de validation (écran
 * « Suivi des validations » de VPDive). Tant qu'ils ne sont pas validés,
 * VPDive n'en tient pas compte (licence, CACI, saison, niveaux).
 */
export async function pendingValidations(): Promise<PendingValidation[]> {
  const res = await request('/validation_tracking/pending');
  return (Array.isArray(res.pending) ? res.pending : [])
    .map(obj)
    .filter((x): x is Json => x !== null)
    .map((x) => {
      const u = obj(x.user) ?? {};
      const who = obj(u.user) ?? {};
      return {
        type: str(x.type),
        typeLabel: str(x.type_label) || str(x.type),
        member: str(u.token),
        memberName: `${str(who.last_name).trim().toUpperCase()} ${str(who.first_name).trim()}`.trim(),
        picture: pictureUrl(str(who.profile_picture)),
        detail: str(x.detail).trim(),
        files: (Array.isArray(x.document_files) ? x.document_files : [])
          .map(obj)
          .filter((f): f is Json => f !== null && !!str(f.url))
          .map((f) => ({ label: str(f.label) || 'Document', url: str(f.url).startsWith('http') ? str(f.url) : `${VPDIVE_ORIGIN}${str(f.url)}` })),
        entityId: num(x.entity_id) ?? 0,
      };
    })
    .filter((x) => x.member && x.type);
}

/** Valide ou refuse un document en attente, comme le bouton de VPDive. */
export async function decideValidation(v: PendingValidation, decision: 'approve' | 'reject'): Promise<void> {
  const res = await request(`/validation_tracking/${decision}`, {
    method: 'POST',
    // Validé : la fiche du membre et les listes d'inscrits (certificat, licence) changent.
    invalidates: ['/validation_tracking/', '/calendar/', ...memberPaths(v.member)],
    body: { token: v.member, type: v.type, entity_id: v.entityId, to_check: false },
  });
  if (res.success === false || res.error) throw new VpDiveError(str(res.message) || str(res.error) || 'VPDive a refusé l’opération.', 0);
}

/** Référentiel des niveaux du club, par activité et fédération (« PLONGEE SCAPHANDRE (F.F.E.S.S.M.) - Pratique » → noms). */
export async function capacityNames(): Promise<{ group: string; names: string[] }[]> {
  const res = await request('/user/settings/capacities', { ttl: CAPACITIES_TTL, persist: true });
  return Object.entries(res)
    .map(([group, v]) => ({ group, names: Object.keys(obj(v) ?? {}) }))
    .filter((g) => g.names.length > 0);
}

/** Référentiel des niveaux avec leurs identifiants (« l_125 »…), ceux qu'attend le bloc niveaux d'une fiche. */
export async function capacities(): Promise<Capacity[]> {
  const res = await request('/user/settings/capacities', { ttl: CAPACITIES_TTL, persist: true });
  const groups = obj(obj(res.data)?.capacities) ?? obj(res.capacities) ?? res;
  return Object.entries(groups).flatMap(([group, v]) =>
    Object.entries(obj(v) ?? {})
      .filter(([, id]) => typeof id === 'string' && !!id)
      .map(([name, id]) => ({ group, name, id: id as string })),
  );
}

/** Fiche complète telle que l'écran d'édition VPDive la lit (GET /user/member/{uct}), pour la réécrire : toujours relue. */
export async function memberForm(uct: string, opts: CallPace = {}): Promise<RawMember> {
  const res = await request(`/user/member/${encodeURIComponent(uct)}`, { ...opts, fresh: true, ttl: MEMBER_TTL });
  const u = obj(res.data);
  if (!u) throw new VpDiveError('Fiche VPDive illisible.', 0);
  return u as RawMember;
}

/** Envoie un bloc de la fiche (voir lib/memberWrite : un bloc par envoi). */
export async function updateMember(uct: string, entries: [string, string][], opts: CallPace = {}): Promise<void> {
  const form = new FormData();
  for (const [k, v] of entries) form.append(k, v);
  await request(`/user/member/${encodeURIComponent(uct)}/update`, { ...opts, method: 'POST', body: form, invalidates: memberPaths(uct) });
}

/** Fait relire à VPDive une licence vérifiée FFESSM ; true si VPDive l'a mise à jour. */
export async function refreshFfessmLicence(uct: string, licenceId: number, opts: CallPace = {}): Promise<boolean> {
  const res = await request(`/user/licence/ffessm/refresh?user_licence_id=${licenceId}&uct_token=${encodeURIComponent(uct)}`, {
    ...opts,
    method: 'POST',
    invalidates: memberPaths(uct),
  });
  return res.applied === true || obj(res.data)?.applied === true;
}

/** Fiche d'un membre pour la gestion des adhésions : saisons, licences, assurance, statut Membre, e-mail, naissance. */
export async function memberRecord(uct: string, opts: ReadOptions = {}): Promise<VpRecord> {
  const res = await request(`/user?uct_token=${encodeURIComponent(uct)}`, { ...opts, ttl: MEMBER_TTL });
  const u = obj(res.data) ?? res;
  const info = infoOf(u);
  return {
    email: info.email,
    birthday: info.birthday,
    seasons: info.seasons,
    // L'identifiant et la vérification FFESSM viennent de la fiche brute : ils disent si VPDive sait actualiser la licence.
    licences: (Array.isArray(u.licenses) ? u.licenses : [])
      .map(obj)
      .filter((l): l is Json => !!l && !!str(l.number))
      .map((l) => ({
        number: str(l.number).trim(),
        organization: str(obj(l.organization)?.name).trim(),
        expires: str(l.expiration_date).slice(0, 10),
        id: num(l.id) ?? undefined,
        verified: l.ffessm_verified === true,
      })),
    insurance: info.insurance,
    insuranceYear: info.insuranceYear,
    member: obj(u.user_club_traceability)?.allMembers === true,
    levels: (({ levels, teaching, qualifications }) => [...teaching, ...levels, ...qualifications])(profileOf(u)),
  };
}

/**
 * Adhésion et licences d'un membre, pour le suivi des documents (admins,
 * permission `member_view`) : saisons confirmées et licences avec leur
 * fédération, lues sur sa fiche (/user?uct_token=…). Même lecture que
 * memberRecord, partagée avec elle par le transport.
 */
export async function memberStatus(uct: string, opts: ReadOptions = {}): Promise<Pick<MemberInfo, 'seasons' | 'licences'>> {
  const res = await request(`/user?uct_token=${encodeURIComponent(uct)}`, { ...opts, ttl: MEMBER_TTL });
  const { seasons, licences } = infoOf(obj(res.data) ?? res);
  return { seasons, licences };
}
