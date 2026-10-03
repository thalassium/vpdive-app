/**
 * VPDive API probe — records the REAL shape of the responses we build on.
 *
 * Read-only: it never registers, unregisters or edits anything.
 * (tariff-prices is a POST but only computes a price preview.)
 *
 * Usage:  1. copy .env.example to .env.local and fill VPDIVE_EMAIL / VPDIVE_PASSWORD
 *         2. npm run probe
 * Output: fixtures/*.json (raw responses, gitignored) + fixtures/_summary.txt (shapes only)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'fixtures');
const MAX_EVENTS = 5;

loadEnv(join(ROOT, '.env.local'));
const EMAIL = process.env.VPDIVE_EMAIL ?? '';
const PASSWORD = process.env.VPDIVE_PASSWORD ?? '';
const API = process.env.VPDIVE_API_BASE ?? 'https://septentrion-env.vpdive.com/api';
const FALLBACK_CAL_TOKEN =
  process.env.VPDIVE_CALENDAR_TOKEN ?? 'mwLfoKcBUFeaQ0MJ1kVPHInyjbl346hrCWitv2X5qN8';

if (!EMAIL || !PASSWORD) {
  console.error('❌ Set VPDIVE_EMAIL and VPDIVE_PASSWORD in .env.local (see .env.example).');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const summary: string[] = [];
let jwt = '';
let traceability = '';

type Result = { status: number; body: unknown };

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (traceability) headers.userClubTraceability = traceability;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Keep raw text (HTML error page, CSV…)
  }
  return { status: res.status, body: parsed };
}

/**
 * `requestBody` is recorded so a POST probe can be checked against what it
 * sent. Without it, a tariff-prices call that returns the default prices is
 * indistinguishable from one that sent a token the server ignored.
 * Never passed for /login_check — that body holds the password.
 */
function save(name: string, method: string, path: string, r: Result, requestBody?: unknown) {
  writeFileSync(
    join(OUT, `${name}.json`),
    JSON.stringify(
      { request: `${method} ${path}`, requestBody: requestBody ?? null, status: r.status, body: r.body },
      null,
      2,
    ),
  );
  summary.push(`\n### ${name}  —  ${method} ${path}  →  HTTP ${r.status}`);
  if (requestBody !== undefined) summary.push(`sent: ${JSON.stringify(requestBody)}`);
  summary.push(shape(r.body));
  console.log(`${r.status >= 200 && r.status < 300 ? '✅' : '⚠️ '} ${r.status}  ${method} ${path}`);
}

async function probe(name: string, method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await call(method, path, body);
  save(name, method, path, r, body);
  return r;
}

// ── 1. Authentication ─────────────────────────────────────────
const login = await call('POST', '/login_check', { email: EMAIL, password: PASSWORD });
const loginBody = asObj(login.body);
const token = typeof loginBody?.token === 'string' ? loginBody.token : '';
save('01_login_check', 'POST', '/login_check', {
  status: login.status,
  body: loginBody ? { ...loginBody, token: token ? `${token.slice(0, 12)}…(redacted)` : undefined } : login.body,
});

if (!token) {
  console.error('\n❌ No JWT in login response. If 2FA is enabled, fixtures/01_login_check.json shows the challenge.');
  finish();
  process.exit(1);
}
jwt = token;
writeFileSync(join(OUT, '01_jwt_payload.json'), JSON.stringify(decodeJwt(jwt), null, 2));

await probe('02_check_auth', 'GET', '/check_auth');
await probe('03_user_me', 'GET', '/user/me');
const trace = await probe('04_user_traceability', 'GET', '/user/traceability');
const traceValue = asObj(trace.body)?.userClubTraceability;
traceability = typeof traceValue === 'string' ? traceValue : '';
if (!traceability) console.warn('⚠️  No userClubTraceability — calendar calls will probably fail.');

// ── 2. Calendars & events ─────────────────────────────────────
const list = await probe('05_calendar_list', 'GET', '/calendar/list');
const listBody = asObj(list.body);
const firstCal = Array.isArray(listBody?.calendars) ? asObj(listBody.calendars[0]) : null;
// Provenance is tracked, not inferred by comparing values: this club's
// default_token is identical to the apps-script fallback, so a value check
// reports "fallback" for a token that actually came from the API.
let calToken = FALLBACK_CAL_TOKEN;
let calTokenFrom = 'fallback from apps-script';
if (typeof listBody?.default_token === 'string' && listBody.default_token) {
  calToken = listBody.default_token;
  calTokenFrom = '/calendar/list default_token';
} else if (typeof firstCal?.token === 'string' && firstCal.token) {
  calToken = firstCal.token;
  calTokenFrom = '/calendar/list calendars[0].token';
}
console.log(`   calendar token used: ${calTokenFrom}`);

const now = new Date();
const start = ymd(now);
const end = ymd(new Date(now.getFullYear(), now.getMonth() + 2, 0)); // end of next month

const refresh = await probe('06_events_refresh', 'GET', `/calendar/events_refresh/${start}/${end}/${calToken}`);
const events = await probe('07_events', 'GET', `/calendar/events/${calToken}?start=${start}&end=${end}`);
await probe('08_new_index', 'GET', `/calendar/new_index/${now.getFullYear()}/${now.getMonth() + 1}/${calToken}`);

// ── 3. Per-event details ──────────────────────────────────────
const upcoming = collectEventTokens(refresh.body, events.body).slice(0, MAX_EVENTS);
console.log(`   probing ${upcoming.length} upcoming events`);

for (const [i, evToken] of upcoming.entries()) {
  const n = `1${i}`;
  const detail = await probe(`${n}a_event_detail`, 'GET', `/calendar/${evToken}/event`);
  await probe(`${n}b_material_view`, 'GET', `/calendar/material/${evToken}/view`);
  await probe(`${n}c_tariff_prices_default`, 'POST', `/calendar/event/${evToken}/tariff-prices`, {});

  const roleTokens = findRoleTokens(detail.body);
  if (roleTokens.length > 0) {
    await probe(`${n}d_tariff_prices_role`, 'POST', `/calendar/event/${evToken}/tariff-prices`, {
      roles: [roleTokens[0]],
    });
  }
}

// ── 4. Done ───────────────────────────────────────────────────
await call('GET', '/logout'); // revoke the probe's JWT
finish();

// ── helpers ───────────────────────────────────────────────────
function finish() {
  writeFileSync(join(OUT, '_summary.txt'), summary.join('\n') + '\n');
  console.log(`\nFixtures written to ${OUT}`);
}

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m?.[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function decodeJwt(t: string): unknown {
  try {
    return JSON.parse(Buffer.from(t.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Event tokens from both list endpoints, upcoming first, de-duplicated.
 *
 * The list endpoints carry the event token under `id`, not `token`: it is the
 * same 43-char opaque string the per-event routes expect, not a numeric id.
 * `token` is still read first in case the API ever grows one.
 */
function collectEventTokens(...bodies: unknown[]): string[] {
  const seen = new Map<string, number>();
  for (const b of bodies) {
    const arr = Array.isArray(b) ? b : (asObj(b)?.data ?? asObj(b)?.events);
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const ev = asObj(raw);
      const tok = ev?.token ?? ev?.id;
      const startStr = ev?.start ?? ev?.fromDate ?? ev?.startDate;
      if (typeof tok !== 'string' || seen.has(tok)) continue;
      const t = typeof startStr === 'string' ? Date.parse(startStr) : NaN;
      if (!Number.isNaN(t) && t < Date.now()) continue;
      seen.set(tok, Number.isNaN(t) ? Infinity : t);
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([tok]) => tok);
}

/**
 * Role tokens of an event detail payload.
 *
 * `data.event.roles` is the authoritative list: an array of bare 43-char token
 * strings, not objects. Walking every array under a role-ish key looking for
 * `item.token` — the first attempt here — found 19 unrelated tokens on one event
 * and none at all on three others that did have roles. The mistake was invisible
 * because tariff-prices answers a non-role token with the default prices
 * unchanged, so the probe looked like it had proven roles don't affect pricing.
 * The walk is kept only as a fallback for payloads shaped differently.
 */
function findRoleTokens(body: unknown): string[] {
  const roles = asObj(asObj(asObj(body)?.data)?.event)?.roles;
  if (Array.isArray(roles)) {
    const strings = roles.filter((r): r is string => typeof r === 'string');
    if (strings.length > 0) return strings;
    const nested = roles
      .map((r) => asObj(r)?.token)
      .filter((t): t is string => typeof t === 'string');
    if (nested.length > 0) return nested;
  }

  const found: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) {
      if (/role|responsib|suggest/i.test(key)) {
        for (const item of v) {
          const tok = asObj(item)?.token;
          if (typeof tok === 'string') found.push(tok);
        }
      }
      v.forEach((item) => walk(item, key));
    } else if (asObj(v)) {
      for (const [k, child] of Object.entries(v as object)) walk(child, k);
    }
  };
  walk(body, '');
  return found;
}

/** Type outline of a JSON value, without the values themselves. */
function shape(v: unknown, indent = '', depth = 0): string {
  if (depth > 6) return `${indent}…`;
  if (Array.isArray(v)) {
    if (v.length === 0) return `${indent}[] (empty)`;
    return `${indent}[${v.length}] of:\n${shape(v[0], indent + '  ', depth + 1)}`;
  }
  const o = asObj(v);
  if (o) {
    const keys = Object.keys(o);
    if (keys.length === 0) return `${indent}{} (empty)`;
    return keys
      .map((k) => {
        const c = o[k];
        if (Array.isArray(c) || asObj(c)) return `${indent}${k}:\n${shape(c, indent + '  ', depth + 1)}`;
        return `${indent}${k}: ${c === null ? 'null' : typeof c}`;
      })
      .join('\n');
  }
  if (typeof v === 'string') return `${indent}string (${v.length} chars${v.trimStart().startsWith('<') ? ', looks like HTML' : ''})`;
  return `${indent}${v === null ? 'null' : typeof v}`;
}
