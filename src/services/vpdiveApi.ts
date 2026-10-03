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

export interface MaterialOption {
  id: number;
  name: string;
  price: number;
  maxQuantity: number;
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
  canRegister: boolean;
  /** Why VPDive refuses a registration, e.g. "registration too late". */
  refusalReasons: string[];
  canUnregister: boolean;
  /** The event asks extra questions we do not render: book on VPDive instead. */
  requiresExtraForm: boolean;
  /** The member's own cart for this event, when registered. */
  myCart: { amount: number; paid: boolean } | null;
}

export interface BookingRequest {
  eventToken: string;
  roleKey: string | null;
  tariffToken: string | null;
  people: number;
  comment: string;
  /** material id → quantity */
  materials: Record<number, number>;
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
const tag = (v: unknown): Tag | null => {
  const o = obj(v);
  return o && str(o.name) ? { token: str(o.token), name: str(o.name) } : null;
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

  private async request(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; auth?: boolean } = {}) {
    const { method = 'GET', body, auth = true } = init;
    const headers: Record<string, string> = { Accept: 'application/json' };

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
    if (o === null) {
      throw new VpDiveError(`Réponse VPDive inattendue (HTTP ${res.status}).`, res.status);
    }
    return o;
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
    };
    this.setSession(session);
    return session;
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
   */
  async register(b: BookingRequest): Promise<{ message: string; waitingList: boolean }> {
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

    try {
      const res = await this.request('/calendar/registration', { method: 'POST', body: f });
      const waitingList = obj(res.registration)?.inWaitingList === true;
      return {
        message: str(res.message) || (waitingList ? 'Vous êtes sur liste d’attente.' : 'Inscription enregistrée sur VPDive.'),
        waitingList,
      };
    } catch (e) {
      if (e instanceof VpDiveError && e.status === 409) {
        throw new VpDiveError('Vous êtes déjà inscrit à cette sortie.', 409);
      }
      throw e;
    }
  }

  async unregister(eventToken: string): Promise<void> {
    await this.request(`/calendar/unregistered/${eventToken}`);
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

  // list_material: [{ "<id>": { obj: { id, name }, tariff: "3.00", max_selectable_quantity } }, ...]
  const materials: MaterialOption[] = [];
  if (Array.isArray(data.list_material)) {
    for (const wrapper of data.list_material) {
      for (const m of Object.values(obj(wrapper) ?? {})) {
        const mo = obj(m);
        const item = obj(mo?.obj);
        const id = num(item?.id);
        const choices = mo?.choices;
        const hasChoices = Array.isArray(choices) ? choices.length > 0 : !!obj(choices) && Object.keys(obj(choices)!).length > 0;
        // Items with sub-choices (sizes…) need VPDive's own form: not offered here.
        if (id === null || hasChoices) continue;
        const max = num(mo?.max_selectable_quantity) ?? num(mo?.available_quantity) ?? 0;
        if (max <= 0) continue;
        materials.push({ id, name: str(item?.name).trim() || `Matériel ${id}`, price: num(mo?.tariff) ?? 0, maxQuantity: max });
      }
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
    requiresExtraForm,
    myCart: mine ? { amount: num(mine.amount) ?? 0, paid: mine.payed === true } : null,
  };
}

const REFUSAL_LABELS: Record<string, string> = {
  'registration too late': 'Les inscriptions sont closes.',
  'registration too early': 'Les inscriptions ne sont pas encore ouvertes.',
  full: 'La sortie est complète.',
};

export const vpdive = new VpDiveClient();
