/**
 * Agenda du club : sorties d'une période, détail d'une sortie et ses inscrits,
 * inscription et désinscription (la mienne, ou celle d'un autre pour un admin).
 * Formes relevées par `npm run probe` (fixtures/).
 */
import { fromVpdive, type VpdiveQualif } from '../../lib/vpdiveLevels';
import { isCancelledTitle, isoDateTime } from '../../lib/agenda';
import { french, REFUSAL_LABELS } from '../../lib/vpdiveLabels';
import { VpDiveError, type ReadOptions } from './transport';
import { obj, str, num, pictureUrl, type Json } from './parse';
import { getSession, request } from './auth';

/** Durée de vie des lectures en cache (transport.ts). */
const TTL = {
  /** Jeton de l'agenda du club : le même toute la session. */
  calendar: 12 * 3_600_000,
  /** Agenda d'une période. */
  events: 60_000,
  /** Détail d'une sortie (inscrits compris). */
  event: 30_000,
} as const;

export interface Tag {
  token: string;
  name: string;
}

export interface CalendarEvent {
  token: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  domain: Tag | null;
  activity: Tag | null;
  type: Tag | null;
  color: string;
  textColor: string;
  /** The logged-in member is registered on this event. */
  registered: boolean;
  registrationOpen: boolean;
  registeredCount: number;
  maxParticipants: number | null;
  availableSpots: number | null;
  hasWaitingList: boolean;
  waitingListCount: number;
  onWaitingList: boolean;
  /** Sortie annulée : « [ANNULÉE] » (ou « annul… ») dans le titre, convention du club (lib/agenda.ts). */
  cancelled: boolean;
}

export interface RoleOption {
  key: string;
  label: string;
}

export interface TariffOption {
  token: string;
  label: string;
  price: number;
}

export interface MaterialChoice {
  id: string;
  /** As the club named it in VPDive, e.g. "M" or "Taille M". */
  name: string;
  price: number;
}

export interface MaterialOption {
  id: number;
  name: string;
  price: number;
  maxQuantity: number;
  /** Variants set up by the club (usually sizes). Empty when the item has none. */
  choices: MaterialChoice[];
}

/** Someone registered on an outing, from the event detail's `user_registered`. */
export interface RosterEntry {
  /** VPDive user id (same as /user/me `id`). */
  id: string;
  name: string;
  firstname: string;
  lastname: string;
  /**
   * What the palanquées engine reads: level codes (P1, PE40…) and, for
   * teaching, the prerogative VPDive writes in the diploma's name (E3 for a
   * DEJEPS « Enseignant 3 »). See lib/vpdiveLevels.ts.
   */
  levels: string[];
  /** Levels and diplomas as VPDive names them (DEJEPS, MF1, P4, PADI - AOW…), for display. */
  display: string[];
  /** Club "prépas" the member belongs to (POLARIS, Prépa N2…). */
  training: string[];
  /** Outing roles from VPDive: "Directeur de plongée", "Enseignant/Encadrant", "Sécurité surface", "Pilote". */
  roles: string[];
  age: number | null;
  waitingList: boolean;
  comment: string;
  medical: { until: string | null; valid: boolean };
  /** Absolute URL of the member's own photo; empty when VPDive shows its default avatar. */
  picture?: string;
  /** E-mail du membre (relances). */
  email?: string;
  /** Jeton d'adhésion au club (uct), comme l'`id` de l'annuaire et des rôles. */
  uct?: string;
  /** Matériel réservé, tel que VPDive le libelle (« 1 Gilet stabilisateur », « 1 Pack complet (hors ordinateur) »). */
  material?: string[];
  /** Licences : numéro (FFESSM : « A-26-123456 »), fin de validité (AAAA-MM-JJ), validée par le club. */
  licences?: { number: string; until: string | null; valid: boolean }[];
  /** Plongeur hors VPDive, ajouté par le DP dans l'appli (lib/outing.ts, `guests`). */
  outside?: true;
  /** Membre VPDive ajouté par le DP sans s'être inscrit (lib/outing.ts, `members`). */
  added?: true;
  /**
   * Ce que les routes d'admin `registered/*` attendent comme `user` : `uct_socket`
   * pour un membre, `socket` pour un invité sans compte (comme le fait VPDive).
   */
  socket?: string;
}

/** Membre de l'équipe d'une sortie (DP, pilote, encadrant) qui n'est pas dans la liste des inscrits. */
export interface StaffEntry {
  id: string;
  name: string;
  picture: string;
  roles: string[];
}

export interface EventDetail {
  token: string;
  title: string;
  start: string;
  end: string;
  location: string;
  description: string;
  pricing: string;
  roles: RoleOption[];
  tariffs: TariffOption[];
  materials: MaterialOption[];
  multipleBooking: boolean;
  alreadyRegistered: boolean;
  /** Inscrit, mais sur la liste d'attente (`waitingList` de mon entrée dans user_registered). */
  onWaitingList: boolean;
  canRegister: boolean;
  /** Why VPDive refuses a registration, e.g. "registration too late". */
  refusalReasons: string[];
  canUnregister: boolean;
  /**
   * The member may change their registration (role, gear, message): a per-outing
   * club setting in VPDive (« Modification d'inscription », with a time window).
   */
  canModify: boolean;
  /** The member's current registration, to pre-fill the form when changing it. */
  myRegistration: MyRegistration | null;
  /** The event asks extra questions we do not render: book on VPDive instead. */
  requiresExtraForm: boolean;
  /** The member's own cart for this event, when registered. */
  myCart: { amount: number; paid: boolean } | null;
}

export interface MyRegistration {
  /** Key in `roles` (« diver » or a role token), null when none matches. */
  roleKey: string | null;
  tariffToken: string | null;
  people: number;
  comment: string;
  /** Rented gear, matched to `materials` by name (VPDive lists it as « 1 Combinaison »). */
  gear: { id: number; choiceId: string | null }[];
  /** Registered on the waiting list, not (yet) on the outing. */
  waitingList: boolean;
}

export interface BookingRequest {
  eventToken: string;
  roleKey: string | null;
  tariffToken: string | null;
  people: number;
  comment: string;
  /** material id → quantity, for items without variants */
  materials: Record<number, number>;
  /** `${materialId}_${choiceId}` → quantity, for items with variants (sizes) */
  choices: Record<string, number>;
}

const tag = (v: unknown): Tag | null => {
  const o = obj(v);
  return o && str(o.name) ? { token: str(o.token), name: french(str(o.name)) } : null;
};

/** VPDive descriptions are HTML written by club admins: keep the text, drop the markup. */
function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Jeton de l'agenda du club, lu une fois par session (le transport le garde ; une autre session repart de zéro). */
async function getCalendarToken(): Promise<string> {
  const list = await request('/calendar/list', { ttl: TTL.calendar });
  const first = Array.isArray(list.calendars) ? obj(list.calendars[0]) : null;
  const token = str(list.default_token) || str(first?.token);
  if (!token) throw new VpDiveError('Aucun agenda n’est accessible avec votre compte.', 0);
  return token;
}

/** Events between two dates (YYYY-MM-DD, inclusive). */
export async function fetchEvents(start: string, end: string, opts: ReadOptions = {}): Promise<CalendarEvent[]> {
  const calToken = await getCalendarToken();
  const res = await request(`/calendar/events_refresh/${start}/${end}/${calToken}`, { ...opts, ttl: TTL.events });
  if (!Array.isArray(res.data)) throw new VpDiveError('Réponse VPDive inattendue pour l’agenda.', 0);
  return res.data
    .map((raw) => mapEvent(obj(raw)))
    .filter((e): e is CalendarEvent => e !== null && !!e.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export async function fetchEventDetail(eventToken: string, opts: ReadOptions = {}): Promise<EventDetail> {
  const res = await request(`/calendar/${eventToken}/event`, { ...opts, ttl: TTL.event });
  const data = obj(res.data);
  const ev = obj(data?.event);
  if (!data || !ev) throw new VpDiveError('Détail de la sortie introuvable sur VPDive.', 0);
  return mapDetail(eventToken, data, ev, getSession()?.userId ?? null);
}

/** Prices per tariff token for a given role (VPDive recomputes them server-side). */
export async function fetchPricesForRole(eventToken: string, roleKey: string | null): Promise<Record<string, number>> {
  const res = await request(`/calendar/event/${eventToken}/tariff-prices`, {
    method: 'POST',
    read: true,
    // Le formulaire d'inscription attend ce prix : devant les lectures en cours.
    priority: 'high',
    body: roleKey ? { roles: [roleKey] } : {},
  });
  const prices = obj(res.prices) ?? {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(prices)) {
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

/**
 * Register the logged-in member.
 *
 * Field names follow codehelp/docapi.txt (`front_calendarbundle_calendar_material`
 * with calendar / user / people / tariff_plan / comment / role_suggestion).
 * The encoding follows VPDive's own web app rather than the spec: a multipart
 * form with rental gear as `material_<id>` = quantity. The spec documents a
 * JSON body with `materials: [ids]`, which cannot express quantities, and the
 * web app's form is what VPDive serves to every member in production.
 *
 * Per the spec: 409 = already registered, 400 = incomplete form, and the 200
 * body says whether the member landed on the waiting list.
 *
 * Changing a registration is the same call (VPDive's web app re-posts the
 * whole form with action « or » when the outing allows modification).
 */
export async function register(b: BookingRequest, opts: { modification?: boolean } = {}): Promise<{ message: string; waitingList: boolean }> {
  const f = new FormData();
  const field = (name: string, value: string) =>
    f.append(`front_calendarbundle_calendar_material[${name}]`, value);

  f.append('_method', 'POST');
  field('action', 'or');
  field('calendar', b.eventToken);
  field('user', '');
  field('people', String(b.people));
  field('comment', b.comment);
  field('tariff_plan', b.tariffToken ?? '');
  if (b.roleKey) field('role_suggestion', b.roleKey);
  for (const [id, qty] of Object.entries(b.materials)) {
    if (qty > 0) field(`material_${id}`, String(qty));
  }
  // Sizes: VPDive's web app sends a chosen variant as choice_<material>_<choice>
  // instead of material_<material>.
  for (const [key, qty] of Object.entries(b.choices)) {
    if (qty > 0) field(`choice_${key}`, String(qty));
  }

  try {
    const res = await request('/calendar/registration', { method: 'POST', body: f, invalidates: ['/calendar/'] });
    const waitingList = obj(res.registration)?.inWaitingList === true;
    return {
      message: str(res.message) || (waitingList ? 'Vous êtes sur liste d’attente.' : 'Inscription enregistrée sur VPDive.'),
      waitingList,
    };
  } catch (e) {
    if (e instanceof VpDiveError && e.status === 409) {
      throw new VpDiveError(
        opts.modification ? 'VPDive refuse la modification : elle n’est peut-être plus ouverte pour cette sortie.' : 'Vous êtes déjà inscrit à cette sortie.',
        409,
      );
    }
    throw e;
  }
}

export async function unregister(eventToken: string): Promise<void> {
  // Un GET qui écrit : jamais partagé ni gardé.
  await request(`/calendar/unregistered/${eventToken}`, { read: false, invalidates: ['/calendar/'] });
}

/** Passe un inscrit de la liste d'attente à la liste principale (admin), même si la sortie est complète. */
export async function switchWaitingList(eventToken: string, socket: string): Promise<void> {
  const res = await request('/calendar/registered/switch-list', { method: 'POST', body: { event: eventToken, user: socket }, invalidates: ['/calendar/'] });
  if (res.success === false || res.error) throw new VpDiveError(str(res.message) || str(res.error) || 'VPDive a refusé le changement de liste.', 0);
}

/**
 * Supprime l'inscription d'un autre (admin) : « Supprimer l'inscription » de
 * VPDive. (`/calendar/unregistered/{event}/{user}` ne vaut que pour un compte rattaché.)
 */
export async function deleteRegistration(eventToken: string, socket: string): Promise<void> {
  const res = await request('/calendar/registered/delete', { method: 'POST', body: { event: eventToken, user: socket }, invalidates: ['/calendar/'] });
  if (res.success === false || res.error) throw new VpDiveError(str(res.message) || str(res.error) || 'VPDive a refusé la désinscription.', 0);
}

/**
 * Who is registered on an outing: `user_registered` of the event detail,
 * keyed by user id. Richer than the "booked equipment" page: first and last
 * name apart (safety sheet columns), age (minors), outing roles (DP, pilot,
 * surface safety) and levels grouped by family. Shapes recorded by
 * `npm run probe`, October 2026.
 */
export async function fetchRoster(eventToken: string, opts: ReadOptions = {}): Promise<RosterEntry[]> {
  return (await fetchRosterAndStaff(eventToken, opts)).roster;
}

/**
 * Inscrits, plus l'équipe de la sortie qui n'y est pas inscrite : VPDive peut
 * désigner un pilote, un DP ou un encadrant (`responsibles`) sans qu'il figure
 * dans la liste des inscrits. Ils comptent pour les rôles, pas comme plongeurs.
 */
export async function fetchRosterAndStaff(eventToken: string, opts: ReadOptions = {}): Promise<{ roster: RosterEntry[]; staff: StaffEntry[] }> {
  // Même lecture que fetchEventDetail : partagée avec elle.
  const res = await request(`/calendar/${eventToken}/event`, { ...opts, ttl: TTL.event });
  const roster = rosterFrom(res);
  const known = new Set(roster.map((r) => r.id));
  const responsibles = obj(res.data)?.responsibles;
  const staff = (Array.isArray(responsibles) ? responsibles : Object.values(obj(responsibles) ?? {}))
    .map(obj)
    .filter((r): r is Json => r !== null)
    .map((r) => ({
      id: String(r.user_id ?? ''),
      name: str(r.officialFullname).trim() || str(r.publicFullname).trim(),
      picture: pictureUrl(str(r.profilePicture)),
      roles: (Array.isArray(r.role) ? r.role : Object.values(obj(r.role) ?? {})).map((x) => str(obj(x)?.role)).filter(Boolean),
    }))
    .filter((r) => r.id && !known.has(r.id) && r.roles.length > 0);
  return { roster, staff };
}

/** Liste des inscrits d'une sortie, dans la réponse de /calendar/{jeton}/event. */
export function rosterFrom(res: Json): RosterEntry[] {
  const registered = obj(obj(res.data)?.user_registered);
  if (!registered) throw new VpDiveError('Liste des inscrits introuvable dans la réponse VPDive.', 0);
  const values = (v: unknown): Json[] => (Array.isArray(v) ? v : Object.values(obj(v) ?? {})).map(obj).filter((x): x is Json => x !== null);
  return Object.entries(registered)
    .map(([key, raw]) => {
      const u = obj(raw) ?? {};
      const qualifs: VpdiveQualif[] = (['level', 'teaching', 'qualification', 'autonome'] as const).flatMap((family) =>
        values(u[family]).map((q) => ({ family, code: str(q.abbreviation).trim(), name: str(q.name).trim() })),
      );
      const { labels, display } = fromVpdive(qualifs);
      const firstname = str(u.firstname).trim();
      const lastname = str(u.lastname).trim();
      const med = obj(u.medical_examination) ?? {};
      return {
        id: String(u.id ?? key),
        name: `${lastname.toUpperCase()} ${firstname}`.trim() || str(u.name).trim() || 'Sans nom',
        firstname,
        lastname,
        levels: labels,
        display,
        training: values(u.prepa).map((p) => str(p.name).trim()).filter(Boolean),
        roles: values(u.roles).map((r) => str(r.role)).filter(Boolean),
        age: num(u.age),
        waitingList: u.waitingList === true,
        comment: str(u.comment).trim(),
        medical: { until: str(obj(med.until)?.date).slice(0, 10) || null, valid: med.status === true },
        picture: pictureUrl(str(u.profile_picture)),
        email: str(u.email).trim(),
        uct: str(u.uct_token).trim(),
        socket: str(u.is_ghost === true || u.is_guest === true ? u.socket : u.uct_socket).trim(),
        material: (Array.isArray(u.material) ? u.material : []).map((m) => str(m).trim()).filter(Boolean),
        licences: values(u.licences).map((l) => ({
          number: str(l.licence).trim(),
          until: str(obj(l.until)?.date).slice(0, 10) || null,
          valid: l.status === true,
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// ── Mappers ──────────────────────────────────────────────────────

/** Une sortie de l'agenda (events_refresh) ; null si elle n'a pas de jeton. */
export function mapEvent(e: Json | null): CalendarEvent | null {
  if (!e) return null;
  // The list endpoints carry the event token under `id` (not `token`).
  const token = str(e.token) || str(e.id);
  if (!token) return null;
  const n = obj(e.nbr_registered) ?? {};
  const can = obj(e.can_registered);
  const max = num(n.max_participants);
  const title = str(e.title);

  return {
    token,
    title: title || '(Sans titre)',
    // ISO dans l'agenda relevé ; normalisé au cas où (Safari ne lit pas « 2026-10-10 08:15:00 »).
    start: isoDateTime(str(e.fromDate)),
    end: isoDateTime(str(e.toDate)),
    allDay: e.allDay === true,
    location: str(e.location),
    domain: tag(e.domain),
    activity: tag(e.activity),
    type: tag(e.type),
    color: str(e.color) || '#0a2747',
    textColor: str(e.textColor) || '#ffffff',
    registered: e.registered === true,
    registrationOpen: e.registration === true && can?.allow !== false,
    registeredCount: num(n.all) ?? 0,
    // `limit_participant` is a 0/1 flag in VPDive's payload; the capacity is `max_participants`.
    maxParticipants: n.has_limit === true && max ? max : null,
    availableSpots: n.has_limit === true ? num(n.available_spots) : null,
    hasWaitingList: n.has_waiting_list === true,
    waitingListCount: num(n.waiting_list_count) ?? 0,
    onWaitingList: n.current_user_on_waiting_list === true,
    cancelled: isCancelledTitle(title),
  };
}

/** Le détail d'une sortie (/calendar/{jeton}/event) : formules, rôles, matériel, mon inscription. */
export function mapDetail(token: string, data: Json, ev: Json, userId: number | null): EventDetail {
  const labels = obj(data.tariff_plans) ?? {};
  const prices = obj(data.price) ?? {};
  const tariffs: TariffOption[] = Object.keys(prices).map((t) => ({
    token: t,
    label: str(labels[t]) || 'Tarif',
    price: num(prices[t]) ?? 0,
  }));

  const roles: RoleOption[] = Object.entries(obj(data.available_roles) ?? {}).map(([key, label]) => ({
    key,
    label: str(label) || key,
  }));

  // list_material: [{ "<id>": { obj: { id, name }, tariff: "3.00", max_selectable_quantity,
  //                             choices: [{ "<choiceId>": { obj: { name }, tariff } }] } }, ...]
  // `choices` (sizes…) is read the way VPDive's own web app reads it: an array
  // or an object of maps keyed by choice id.
  const values = (v: unknown): unknown[] => (Array.isArray(v) ? v : obj(v) ? Object.values(obj(v)!) : []);
  const materials: MaterialOption[] = [];
  for (const wrapper of values(data.list_material)) {
    for (const [key, m] of Object.entries(obj(wrapper) ?? {})) {
      const mo = obj(m);
      const item = obj(mo?.obj);
      const id = num(item?.id) ?? num(key);
      if (id === null) continue;
      const price = num(mo?.tariff) ?? 0;
      const choices: MaterialChoice[] = [];
      for (const group of values(mo?.choices)) {
        for (const [choiceId, c] of Object.entries(obj(group) ?? {})) {
          const co = obj(c);
          const name = str(obj(co?.obj)?.name).trim();
          if (name) choices.push({ id: choiceId, name, price: num(co?.tariff) ?? price });
        }
      }
      const max = num(mo?.max_selectable_quantity) ?? num(mo?.available_quantity) ?? (choices.length ? 1 : 0);
      if (max <= 0) continue;
      materials.push({ id, name: str(item?.name).trim() || `Matériel ${id}`, price, maxQuantity: max, choices });
    }
  }

  const can = obj(data.can_register) ?? {};
  const refusalReasons = Object.entries(can)
    .filter(([k, v]) => k !== 'allow' && k !== 'already registered' && typeof v === 'string')
    .map(([, v]) => REFUSAL_LABELS[v as string] ?? (v as string));

  const forms = data.forms;
  const requiresExtraForm = Array.isArray(forms) ? forms.length > 0 : !!obj(forms) && Object.keys(obj(forms)!).length > 0;

  const carts = obj(data.carts) ?? {};
  const cart = userId !== null ? obj(carts[String(userId)]) : null;

  const place = str(ev.place);
  const city = str(ev.city);
  const mine = myRegistration(obj(obj(data.user_registered)?.[String(userId)]), roles, tariffs, materials);

  return {
    token,
    title: place || '(Sans titre)',
    start: isoDateTime(str(ev.fromDate)),
    end: isoDateTime(str(ev.toDate)),
    location: city,
    description: htmlToText(str(ev.comment)),
    pricing: str(ev.pricing),
    roles,
    tariffs,
    materials,
    multipleBooking: ev.multiple_booking === true,
    alreadyRegistered: data.already_registered === true,
    onWaitingList: !!mine?.waitingList,
    canRegister: can.allow === true,
    refusalReasons,
    canUnregister: data.can_unregister === true,
    canModify: data.can_modification === true,
    myRegistration: mine,
    requiresExtraForm,
    myCart: cart ? { amount: num(cart.amount) ?? 0, paid: cart.payed === true } : null,
  };
}

/**
 * The member's entry in `user_registered`: role token(s), tariff token, places,
 * message, and rented gear as display lines (« 1 Gilet stabilisateur »).
 */
export function myRegistration(u: Json | null, roles: RoleOption[], tariffs: TariffOption[], materials: MaterialOption[]): MyRegistration | null {
  if (!u) return null;
  const roleTokens = (Array.isArray(u.roles_token) ? u.roles_token : []).map((r) => str(obj(r)?.role_token)).filter(Boolean);
  // Un rôle que la sortie ne propose plus (DP attribué par le club, liste vide…) est
  // gardé tel quel : une modification le renvoie inchangé, jamais remplacé par « plongeur ».
  const roleKey = roles.find((r) => roleTokens.includes(r.key))?.key ?? roleTokens[0] ?? (roles.some((r) => r.key === 'diver') ? 'diver' : null);
  const tariff = str(u.tariff_plan_token);
  const flatName = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const gear: MyRegistration['gear'] = [];
  for (const line of Array.isArray(u.material) ? u.material : []) {
    // « 1 Combinaison », or with a variant « 1 Combinaison - M » / « 1 Combinaison (M) »
    const text = flatName(str(line).replace(/^\s*\d+\s*x?\s*/i, ''));
    const m = [...materials].sort((a, b) => b.name.length - a.name.length).find((x) => text.startsWith(flatName(x.name)));
    if (!m || gear.some((g) => g.id === m.id)) continue;
    // The variant is a whole word after the name: « M » must not match « XL - Medium ».
    const words = (x: string) => ` ${flatName(x).replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const rest = words(text.slice(flatName(m.name).length));
    const choice = [...m.choices].sort((a, b) => b.name.length - a.name.length).find((c) => rest.includes(words(c.name)));
    gear.push({ id: m.id, choiceId: choice?.id ?? null });
  }
  return {
    roleKey,
    tariffToken: tariffs.some((t) => t.token === tariff) ? tariff : null,
    people: Math.max(1, num(u.people) ?? 1),
    comment: str(u.comment),
    gear,
    // Même champ que la liste des inscrits (rosterFrom).
    waitingList: u.waitingList === true,
  };
}
