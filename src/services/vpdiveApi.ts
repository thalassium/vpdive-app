/**
 * VPDive API client.
 *
 * Every shape below comes from real responses recorded by `npm run probe`
 * (fixtures/), and the booking request mirrors what VPDive's own web app sends.
 *
 * Ground rules, each one a fix over the AI Studio version:
 *   - No fallback data. If VPDive does not answer, the caller gets an error and
 *     the UI says so. Showing a frozen copy of the agenda looks like it works
 *     while sending people to dives that may have moved or been cancelled.
 *   - A failed booking is reported as a failure. Never "success in demo mode".
 *   - The password is never stored. The JWT lasts 30 days (its own `exp` claim);
 *     when it expires the member logs in again.
 *   - Nothing invented: no default price, location or role.
 */

import { fromVpdive, type VpdiveQualif } from '../lib/vpdiveLevels';

const API_BASE = '/api/vpdive'; // Vite proxy → https://septentrion-env.vpdive.com/api
const SESSION_KEY = 'vpdive_session';
// Older AI Studio builds stored the password in clear text under this key.
const LEGACY_CREDENTIALS_KEY = 'vpdive_creds';

// ── Types ────────────────────────────────────────────────────────

export interface Session {
  token: string;
  /** Expiry in ms since epoch, read from the JWT `exp` claim. */
  expiresAt: number;
  traceability: string;
  userId: number | null;
  email: string;
  firstName: string;
  lastName: string;
  clubName: string;
  /** Club admin on VPDive (permission `member_view`). Absent on sessions saved before this field existed. */
  isAdmin?: boolean;
  /** The member's own photo (absolute URL), '' for VPDive's default avatar. Absent on sessions saved before this field existed. */
  picture?: string;
}

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

/** A club member found by name (VPDive's member picker search). */
export interface MemberMatch {
  /** Club membership token (UserClubTraceability), 43 characters. */
  id: string;
  name: string;
  /** Absolute URL of the member's own photo; empty when VPDive shows its default avatar. */
  picture: string;
}

const VPDIVE_ORIGIN = 'https://septentrion-env.vpdive.com';
/** VPDive returns site-relative paths; its default avatars live under /files/images/. */
const pictureUrl = (path: string) =>
  !path || path.startsWith('/files/images/') ? '' : path.startsWith('http') ? path : `${VPDIVE_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;

/**
 * Messagerie VPDive (la même que sur vpdive.com). Formes relevées dans le code
 * de l'application web de VPDive (octobre 2026), pas encore sur une réponse
 * réelle : la lecture est tolérante et ignore ce qu'elle ne reconnaît pas.
 */
export interface Conversation {
  /** Jeton de la conversation (contact ou groupe), celui des appels de détail et d'envoi. */
  token: string;
  kind: 'discussion' | 'group';
  name: string;
  /** URL absolue de la photo, '' pour l'avatar par défaut. */
  picture: string;
  /** Dernier message, tel que VPDive le résume. */
  last: string;
  /** Date du dernier message, telle que VPDive l'envoie (ISO ou « AAAA-MM-JJ HH:MM:SS »). */
  date: string;
  read: boolean;
}

export interface ChatMessage {
  token: string;
  /** Envoyé par le membre connecté. */
  mine: boolean;
  text: string;
  /** « AAAA-MM-JJ… », pour grouper par jour. */
  date: string;
  /** Heure telle que VPDive l'affiche (« 14:05 »). */
  time: string;
  /** Auteur, utile dans les groupes. */
  author: string;
  /** Pièces jointes (lecture seule). */
  files: { url: string; image: boolean }[];
}

export interface Thread {
  name: string;
  picture: string;
  messages: ChatMessage[];
  /** Faux quand la conversation n'accepte plus de réponse (fermée ou en lecture seule). */
  canRespond: boolean;
}

export interface MemberProfile {
  levels: string[];
  teaching: string[];
  qualifications: string[];
  email: string;
  phone: string;
  birthday: string;
  medicalUntil: string;
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
}

/** VPDive outing roles that keep someone out of the water by default. */
export const SURFACE_ROLES = /s[ée]curit[ée] surface|pilote/i;
export const DP_ROLE = /directeur de plong/i;

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

export interface MeteoSlot {
  hour: number;
  windSpeed_kt: number;
  windGusts_kt: number;
  windDir: string;
}

// ── Errors ───────────────────────────────────────────────────────

export class VpDiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'VpDiveError';
  }
}

export class SessionExpiredError extends VpDiveError {
  constructor() {
    super('Votre session VPDive a expiré. Merci de vous reconnecter.', 401);
    this.name = 'SessionExpiredError';
  }
}

// ── Small parsing helpers ────────────────────────────────────────

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/**
 * VPDive renvoie ses libellés de référence (activité, type de sortie, domaine,
 * catégories du calendrier) en anglais, en clés minuscules, même pour un club
 * français. On les remet en français ; un libellé inconnu passe tel quel.
 * Relevés dans fixtures/*.json (npm run probe).
 */
const FRENCH: Record<string, string> = {
  'diving leisure': 'Plongée loisir',
  'natural sea': 'Mer',
  'natural other': 'Autre milieu naturel',
  room: 'Salle',
  'practical courses': 'Cours pratique',
  'theoretical course': 'Cours théorique',
  'practical internship': 'Stage pratique',
  'initial internship': 'Stage initial',
  'final internship': 'Stage final',
  exam: 'Examen',
  outing: 'Sortie',
  training: 'Formation',
  meeting: 'Réunion',
  meal: 'Repas',
  medical: 'Médical',
  competition: 'Compétition',
  'life of the organization': 'Vie de l’organisation',
  'association life': 'Vie associative',
  children: 'Enfants',
  baptisms: 'Baptêmes',
  divee: 'Plongée',
  'sport diving': 'Plongée sportive',
  'teak diving': 'Plongée Tek',
  trimix: 'Trimix',
  nitrox: 'Nitrox',
  recycler: 'Recycleur',
  apnea: 'Apnée',
  handisub: 'Handisub',
  'swimming with fins': 'Nage avec palmes',
  'whitewater swimming': 'Nage en eau vive',
  'bio and environment': 'Bio et environnement',
  'visual audio': 'Audiovisuel',
};
const french = (name: string): string => FRENCH[name.trim().toLowerCase()] ?? name;

const tag = (v: unknown): Tag | null => {
  const o = obj(v);
  return o && str(o.name) ? { token: str(o.token), name: french(str(o.name)) } : null;
};

function decodeJwtExp(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** VPDive descriptions are HTML written by club admins: keep the text, drop the markup. */
function htmlToText(html: string): string {
  if (!html) return '';
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Permission check, same lookup as VPDive's own web app: `permissions` is
 * `{ user: {...}, club: {...}, user_club_traceability: {...} }` and a key may
 * sit at the top level or in any of those groups.
 */
function hasPermission(permissions: unknown, key: string): boolean {
  const p = obj(permissions);
  if (!p) return false;
  if (key in p) return p[key] === true;
  return Object.values(p).some((group) => obj(group)?.[key] === true);
}

/**
 * Club admin = may view member profiles. It is the permission VPDive itself
 * checks before opening the member directory and member profiles.
 */
const ADMIN_PERMISSION = 'member_view';

type RequestInit_ = { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean };

// ── Client ───────────────────────────────────────────────────────

class VpDiveClient {
  private session: Session | null = null;
  private calendarToken: string | null = null;

  constructor() {
    try {
      localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
      const raw = localStorage.getItem(SESSION_KEY);
      const stored = raw ? (JSON.parse(raw) as Session) : null;
      if (stored?.token && stored.traceability && stored.expiresAt > Date.now()) {
        this.session = stored;
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      this.session = null;
    }
  }

  getSession(): Session | null {
    if (this.session && this.session.expiresAt <= Date.now()) this.setSession(null);
    return this.session;
  }

  private setSession(session: Session | null) {
    this.session = session;
    this.calendarToken = null;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Private browsing: the session simply lasts as long as the tab.
    }
  }

  private async request(path: string, init: RequestInit_ = {}): Promise<Json> {
    const data = await this.call(path, init);
    const o = obj(data);
    if (o === null) throw new VpDiveError('Réponse VPDive inattendue.', 0);
    return o;
  }

  /** Same as request(), for the few endpoints that answer with a bare JSON array. */
  private async requestList(path: string, init: RequestInit_ = {}): Promise<unknown[]> {
    const data = await this.call(path, init);
    if (!Array.isArray(data)) throw new VpDiveError('Réponse VPDive inattendue.', 0);
    return data;
  }

  private async call(path: string, init: RequestInit_ = {}): Promise<unknown> {
    const { method = 'GET', body, auth = true } = init;
    // Les libellés VPDive (activité, type de sortie…) arrivent en anglais par défaut : on demande le français.
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'fr-FR,fr;q=0.9' };

    if (auth) {
      const s = this.getSession();
      if (!s) throw new SessionExpiredError();
      headers.Authorization = `Bearer ${s.token}`;
      headers.userClubTraceability = s.traceability;
    }

    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body; // the browser sets the multipart boundary itself
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
    } catch {
      throw new VpDiveError('Impossible de joindre VPDive. Vérifiez votre connexion internet.', 0);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (HTML error page from a proxy, etc.)
    }
    const o = obj(data);

    // VPDive sometimes reports errors with HTTP 200 and the real status in the
    // body — e.g. a wrong password is `200 {"error":"Invalid credentials","code":401}`,
    // although codehelp/docapi.txt documents a 401. Trust the body's code.
    const bodyCode = num(o?.code);
    const status = res.ok && bodyCode !== null && bodyCode >= 400 ? bodyCode : res.status;

    if (status === 401 && auth) {
      this.setSession(null);
      throw new SessionExpiredError();
    }

    if (status >= 400 || o?.success === false) {
      const base = str(o?.message) || str(o?.error) || `Erreur VPDive (HTTP ${status})`;
      // 400 responses list what is missing in `errors` (codehelp/docapi.txt).
      const details = Array.isArray(o?.errors) ? o.errors.filter((x): x is string => typeof x === 'string') : [];
      throw new VpDiveError(details.length ? `${base} : ${details.join(', ')}` : base, status);
    }
    if (data === null) {
      throw new VpDiveError(`Réponse VPDive inattendue (HTTP ${res.status}).`, res.status);
    }
    return data;
  }

  // ── Authentication ─────────────────────────────────────────────

  async login(email: string, password: string): Promise<Session> {
    let login: Json;
    try {
      login = await this.request('/login_check', { method: 'POST', body: { email, password }, auth: false });
    } catch (e) {
      if (e instanceof VpDiveError && e.status === 401) {
        throw new VpDiveError('E-mail ou mot de passe incorrect.', 401);
      }
      throw e;
    }

    const token = str(login.token);
    if (!token) {
      throw new VpDiveError(
        'VPDive n’a pas renvoyé de jeton de connexion. Si la double authentification est activée sur votre compte, elle n’est pas encore prise en charge.',
        0,
      );
    }

    // These two calls need the token but not yet the traceability header.
    const withToken = async (path: string): Promise<Json> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}${path}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        });
      } catch {
        throw new VpDiveError('Impossible de joindre VPDive. Vérifiez votre connexion internet.', 0);
      }
      const body = obj(await res.json().catch(() => null)) ?? {};
      const code = num(body.code);
      if (!res.ok || (code !== null && code >= 400)) {
        const status = res.ok ? code! : res.status;
        throw new VpDiveError(str(body.message) || str(body.error) || `Erreur VPDive (HTTP ${status}) sur ${path}`, status);
      }
      return body;
    };

    // Traceability (the club the member acts in) is mandatory: calendar calls
    // answer 403 without it, so a login without it is not a usable login.
    const trace = await withToken('/user/traceability');
    const traceability = str(trace.userClubTraceability);
    if (!traceability) {
      throw new VpDiveError('Votre compte VPDive n’est rattaché à aucun club actif.', 0);
    }
    const me = await withToken('/user/me');

    const session: Session = {
      token,
      expiresAt: decodeJwtExp(token) || Date.now() + 3_600_000,
      traceability,
      userId: num(me.id),
      email,
      firstName: str(me.first_name),
      lastName: str(me.last_name),
      clubName: str(obj(trace.club)?.name),
      isAdmin: hasPermission(trace.permissions, ADMIN_PERMISSION),
      picture: pictureUrl(str(me.profile_picture)),
    };
    this.setSession(session);
    return session;
  }

  /** The signed-in member's photo, read again from /user/me and kept in the session (sessions saved before `picture` existed). */
  async refreshPicture(): Promise<string> {
    const me = await this.request('/user/me');
    const picture = pictureUrl(str(me.profile_picture));
    const s = this.getSession();
    if (s) this.setSession({ ...s, picture });
    return picture;
  }

  logout() {
    const s = this.session;
    this.setSession(null);
    if (s) {
      // Revoke the JWT server-side; nothing to do if it fails.
      fetch(`${API_BASE}/logout`, { headers: { Authorization: `Bearer ${s.token}` } }).catch(() => {});
    }
  }

  // ── Calendar ───────────────────────────────────────────────────

  private async getCalendarToken(): Promise<string> {
    if (this.calendarToken) return this.calendarToken;
    const list = await this.request('/calendar/list');
    const first = Array.isArray(list.calendars) ? obj(list.calendars[0]) : null;
    const token = str(list.default_token) || str(first?.token);
    if (!token) throw new VpDiveError('Aucun agenda n’est accessible avec votre compte.', 0);
    this.calendarToken = token;
    return token;
  }

  /** Events between two dates (YYYY-MM-DD, inclusive). */
  async fetchEvents(start: string, end: string): Promise<CalendarEvent[]> {
    const calToken = await this.getCalendarToken();
    const res = await this.request(`/calendar/events_refresh/${start}/${end}/${calToken}`);
    if (!Array.isArray(res.data)) throw new VpDiveError('Réponse VPDive inattendue pour l’agenda.', 0);
    return res.data
      .map((raw) => mapEvent(obj(raw)))
      .filter((e): e is CalendarEvent => e !== null && !!e.start)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async fetchEventDetail(eventToken: string): Promise<EventDetail> {
    const res = await this.request(`/calendar/${eventToken}/event`);
    const data = obj(res.data);
    const ev = obj(data?.event);
    if (!data || !ev) throw new VpDiveError('Détail de la sortie introuvable sur VPDive.', 0);
    return mapDetail(eventToken, data, ev, this.session?.userId ?? null);
  }

  /** Prices per tariff token for a given role (VPDive recomputes them server-side). */
  async fetchPricesForRole(eventToken: string, roleKey: string | null): Promise<Record<string, number>> {
    const res = await this.request(`/calendar/event/${eventToken}/tariff-prices`, {
      method: 'POST',
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
  async register(b: BookingRequest, opts: { modification?: boolean } = {}): Promise<{ message: string; waitingList: boolean }> {
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
      const res = await this.request('/calendar/registration', { method: 'POST', body: f });
      const waitingList = obj(res.registration)?.inWaitingList === true;
      return {
        message: str(res.message) || (waitingList ? 'Vous êtes sur liste d’attente.' : 'Inscription enregistrée sur VPDive.'),
        waitingList,
      };
    } catch (e) {
      if (e instanceof VpDiveError && e.status === 409) {
        throw new VpDiveError(
          opts.modification ? 'VPDive refuse la modification : elle n’est peut-être plus ouverte pour cette sortie.' : 'Vous êtes déjà inscrit à cette sortie.',
          409,
        );
      }
      throw e;
    }
  }

  async unregister(eventToken: string): Promise<void> {
    await this.request(`/calendar/unregistered/${eventToken}`);
  }

  // ── Members ────────────────────────────────────────────────────

  /**
   * Club members whose name contains `query` — the search behind VPDive's own
   * member picker (`route: "assignment"`). Exact substrings only: see
   * lib/fuzzy.ts for typos.
   */
  async searchMembers(query: string): Promise<MemberMatch[]> {
    const list = await this.requestList('/search/user', { method: 'POST', body: { query, route: 'assignment' } });
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
   * A member's levels, teaching qualifications and other qualifications, by
   * their club token (the `id` of searchMembers). Same call as VPDive's own
   * member profile page; needs `member_view`.
   */
  async memberProfile(memberToken: string): Promise<MemberProfile> {
    const u = await this.request(`/user?uct_token=${encodeURIComponent(memberToken)}`);
    const names = (key: string, inner: string) =>
      (Array.isArray(u[key]) ? u[key] : []).map((x) => str(obj(obj(x)?.[inner])?.name).trim()).filter(Boolean);
    return {
      levels: names('user_level', 'level'),
      teaching: names('user_teaching', 'teaching'),
      qualifications: names('user_qualification', 'qualification'),
      email: str(u.email),
      phone: str(u.phone),
      birthday: str(u.birthday),
      medicalUntil: str(u.medical_examination).slice(0, 10),
    };
  }

  /** Same headers as VPDive calls, for the app's own API (/api/app), which checks them with VPDive. */
  authHeaders(): Record<string, string> {
    const s = this.getSession();
    if (!s) throw new SessionExpiredError();
    return { Authorization: `Bearer ${s.token}`, userClubTraceability: s.traceability };
  }

  /**
   * Club member directory. VPDive has no JSON endpoint listing members (its
   * own "Profil des membres" page is a legacy server-rendered page), but the
   * member search is not capped: searching each vowel and merging the answers
   * returns everyone whose name has a vowel — in practice the whole club
   * (one-letter search measured at 476 members, uncapped, October 2026).
   */
  async fetchMemberDirectory(): Promise<MemberMatch[]> {
    const lists = await Promise.all(['a', 'e', 'i', 'o', 'u', 'y'].map((v) => this.searchMembers(v)));
    const byId = new Map(lists.flat().map((m) => [m.id, m]));
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }

  /**
   * Who is registered on an outing: `user_registered` of the event detail,
   * keyed by user id. Richer than the "booked equipment" page: first and last
   * name apart (safety sheet columns), age (minors), outing roles (DP, pilot,
   * surface safety) and levels grouped by family. Shapes recorded by
   * `npm run probe`, October 2026.
   */
  async fetchRoster(eventToken: string): Promise<RosterEntry[]> {
    const res = await this.request(`/calendar/${eventToken}/event`);
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
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  // ── Messagerie ─────────────────────────────────────────────────

  /**
   * Conversations du membre : discussions et groupes, les plus récentes
   * d'abord. VPDive les range par catégories imbriquées (catégorie → section →
   * jeton → conversation) ; on les met à plat.
   */
  async fetchConversations(): Promise<Conversation[]> {
    const read = async (path: string, kind: Conversation['kind']) => {
      const data = await this.request(path);
      const out: Conversation[] = [];
      for (const level1 of Object.values(obj(data.messages) ?? {})) {
        for (const level2 of Object.values(obj(level1) ?? {})) {
          for (const [key, raw] of Object.entries(obj(level2) ?? {})) {
            const c = obj(raw);
            if (!c) continue;
            const token = str(c.token) || key;
            const name = str(c.fullname).trim() || str(c.title).trim() || str(c.name).trim();
            if (!token || !name) continue;
            out.push({
              token,
              kind,
              name,
              picture: pictureUrl(str(c.profilePicture) || str(c.profile_picture)),
              last: str(c.content).trim(),
              date: str(c.date),
              read: c.read !== false,
            });
          }
        }
      }
      return out;
    };
    const [discussions, groups] = await Promise.all([
      read('/messages/messages', 'discussion'),
      read('/messages/groups', 'group').catch(() => [] as Conversation[]),
    ]);
    const byToken = new Map([...discussions, ...groups].map((c) => [`${c.kind}:${c.token}`, c]));
    return [...byToken.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  }

  /** Fil d'une conversation, du plus ancien au plus récent. */
  async fetchThread(c: Pick<Conversation, 'token' | 'kind' | 'name' | 'picture'>): Promise<Thread> {
    const data = await this.request(`/messages/detail/${c.kind === 'group' ? 'groups' : 'messages'}/${encodeURIComponent(c.token)}`);
    const user = obj(data.user);
    const messages: ChatMessage[] = [];
    // Les messages sont rangés par jour (« AAAA-MM-JJ … » → jeton → message).
    for (const [bucket, day] of Object.entries(obj(data.messages) ?? {})) {
      for (const [key, raw] of Object.entries(obj(day) ?? {})) {
        const m = obj(raw);
        if (!m) continue;
        const text = str(m.message);
        const files = (Array.isArray(m.message_files) ? m.message_files : []).map(obj).filter((f): f is Json => !!f && !!str(f.path));
        if (!text && !files.length) continue;
        messages.push({
          token: str(m.token) || key,
          mine: m.sender === true || m.sender === 'true' || m.sender === 1,
          text,
          date: str(m.date) || bucket,
          time: str(m.time),
          author: str(m.fullname).trim() || str(m.username).trim(),
          files: files.map((f) => ({ url: pictureUrl(str(f.path)) || str(f.path), image: str(f.type) === 'image' })),
        });
      }
    }
    messages.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const name = user ? `${str(user.first_name)} ${str(user.last_name)}`.trim() : str(data.title).trim() || str(data.name).trim();
    return {
      name: name || c.name,
      picture: user ? pictureUrl(str(user.profile_picture)) : c.picture,
      messages,
      canRespond: data.can_respond !== false && data.is_close !== true,
    };
  }

  /** Envoie un message texte dans une conversation, comme le fait vpdive.com. */
  async sendMessage(c: Pick<Conversation, 'token' | 'kind'>, text: string): Promise<void> {
    const form = new FormData();
    form.append('message', text);
    form.append('type_flux', c.kind === 'group' ? 'groups' : 'discussion');
    form.append('message_token', c.token);
    const res = await this.request('/messages/new_message', { method: 'POST', body: form });
    if (res.success === false || 'error' in res) throw new VpDiveError(str(res.error) || str(res.message) || 'VPDive n’a pas accepté le message.', 0);
  }

  // ── Weather (Open-Meteo, no key needed) ────────────────────────

  async fetchMeteo(): Promise<Record<string, MeteoSlot[]>> {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + 14);
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=43.248&longitude=5.356' +
      `&start_date=${ymd(today)}&end_date=${ymd(end)}&timezone=Europe%2FParis` +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn';

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const hourly = obj((await res.json()).hourly);
    const times = Array.isArray(hourly?.time) ? (hourly.time as string[]) : [];
    const speed = (hourly?.wind_speed_10m as number[]) ?? [];
    const gusts = (hourly?.wind_gusts_10m as number[]) ?? [];
    const dir = (hourly?.wind_direction_10m as number[]) ?? [];

    const out: Record<string, MeteoSlot[]> = {};
    times.forEach((iso, i) => {
      const day = iso.slice(0, 10);
      (out[day] ??= []).push({
        hour: Number(iso.slice(11, 13)),
        windSpeed_kt: Math.round(speed[i] ?? 0),
        windGusts_kt: Math.round(gusts[i] ?? 0),
        windDir: WIND_DIRS[Math.round((((dir[i] ?? 0) % 360) / 360) * 16) % 16] ?? 'N',
      });
    });
    return out;
  }
}

const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Local-time YYYY-MM-DD (toISOString would shift to UTC and give the previous day in France). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Mappers ──────────────────────────────────────────────────────

function mapEvent(e: Json | null): CalendarEvent | null {
  if (!e) return null;
  // The list endpoints carry the event token under `id` (not `token`).
  const token = str(e.token) || str(e.id);
  if (!token) return null;
  const n = obj(e.nbr_registered) ?? {};
  const can = obj(e.can_registered);
  const max = num(n.max_participants);

  return {
    token,
    title: str(e.title) || '(Sans titre)',
    start: str(e.fromDate),
    end: str(e.toDate),
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
  };
}

function mapDetail(token: string, data: Json, ev: Json, userId: number | null): EventDetail {
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
  const mine = userId !== null ? obj(carts[String(userId)]) : null;

  const place = str(ev.place);
  const city = str(ev.city);

  return {
    token,
    title: place || '(Sans titre)',
    start: str(ev.fromDate),
    end: str(ev.toDate),
    location: city,
    description: htmlToText(str(ev.comment)),
    pricing: str(ev.pricing),
    roles,
    tariffs,
    materials,
    multipleBooking: ev.multiple_booking === true,
    alreadyRegistered: data.already_registered === true,
    canRegister: can.allow === true,
    refusalReasons,
    canUnregister: data.can_unregister === true,
    canModify: data.can_modification === true,
    myRegistration: myRegistration(obj(obj(data.user_registered)?.[String(userId)]), roles, tariffs, materials),
    requiresExtraForm,
    myCart: mine ? { amount: num(mine.amount) ?? 0, paid: mine.payed === true } : null,
  };
}

/**
 * The member's entry in `user_registered`: role token(s), tariff token, places,
 * message, and rented gear as display lines (« 1 Gilet stabilisateur »).
 */
export function myRegistration(u: Json | null, roles: RoleOption[], tariffs: TariffOption[], materials: MaterialOption[]): MyRegistration | null {
  if (!u) return null;
  const roleTokens = (Array.isArray(u.roles_token) ? u.roles_token : []).map((r) => str(obj(r)?.role_token)).filter(Boolean);
  const roleKey = roles.find((r) => roleTokens.includes(r.key))?.key ?? (roles.some((r) => r.key === 'diver') ? 'diver' : null);
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
  };
}

const REFUSAL_LABELS: Record<string, string> = {
  'registration too late': 'Les inscriptions sont closes.',
  'registration too early': 'Les inscriptions ne sont pas encore ouvertes.',
  full: 'La sortie est complète.',
};

export const vpdive = new VpDiveClient();
