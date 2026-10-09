/**
 * Sauvegarde quotidienne du stockage partagé vers Supabase Storage.
 *
 * Vercel Cron appelle GET /api/backup chaque jour (vercel.json) avec l'en-tête
 * `Authorization: Bearer ${CRON_SECRET}`. Toutes les clés `club:*` (sans les
 * verrous ; le jeton HelloAsso `app:*` n'y est jamais) sont exportées en un
 * fichier JSON daté, `gabian-AAAA-MM-JJ.json`, envoyé dans le bucket
 * SUPABASE_BACKUP_BUCKET par l'API REST de Supabase Storage (clé
 * SUPABASE_SERVICE_ROLE_KEY, qui ne quitte jamais le serveur). Les fichiers de
 * plus de 90 jours sont supprimés. Sans ces variables : rien n'est fait (journal + 200).
 *
 * Restauration : scripts/restore.ts (essai à blanc par défaut, --apply pour écrire).
 */
import { timingSafeEqual } from 'node:crypto';
import { errorFields, log } from './log.js';
import { getStore, globToRegExp, type Store, type StoreEntry } from './store.js';

export const BACKUP_PATTERN = 'club:*';
export const KEEP_DAYS = 90;
const FILE_RE = /^gabian-(\d{4}-\d{2}-\d{2})\.json$/;
const TIMEOUT_MS = 20_000;

export interface BackupFile {
  app: 'gabian';
  version: 1;
  /** Date de l'export (ISO). */
  at: string;
  count: number;
  entries: Record<string, StoreEntry>;
}

export interface SupabaseConfig {
  url: string;
  key: string;
  bucket: string;
}

export function supabaseConfig(env: Record<string, string | undefined> = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_BACKUP_BUCKET;
  return url && key && bucket ? { url, key, bucket } : null;
}

export const backupName = (d: Date) => `gabian-${d.toISOString().slice(0, 10)}.json`;

/** Appel à l'API Storage de Supabase, borné dans le temps ; l'erreur ne contient jamais la clé. */
async function storage(cfg: SupabaseConfig, path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key, ...(rest.headers as Record<string, string> | undefined) };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${cfg.url}/storage/v1${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Supabase Storage : HTTP ${res.status} sur ${path.split('/').slice(0, 3).join('/')}`);
  return res;
}

/** Noms des sauvegardes présentes dans le bucket, de la plus ancienne à la plus récente. */
export async function listBackups(cfg: SupabaseConfig): Promise<string[]> {
  const res = await storage(cfg, `/object/list/${encodeURIComponent(cfg.bucket)}`, {
    method: 'POST',
    json: { prefix: '', limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } },
  });
  const rows = (await res.json()) as { name?: string }[];
  return rows
    .map((r) => String(r.name ?? ''))
    .filter((n) => FILE_RE.test(n))
    .sort();
}

/** Contenu d'une sauvegarde du bucket. */
export async function downloadBackup(cfg: SupabaseConfig, name: string): Promise<BackupFile> {
  if (!FILE_RE.test(name)) throw new Error(`Nom de sauvegarde inattendu : ${name}`);
  const res = await storage(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${name}`);
  return parseBackup(await res.text());
}

export function parseBackup(text: string): BackupFile {
  const data = JSON.parse(text) as Partial<BackupFile>;
  if (data.app !== 'gabian' || data.version !== 1 || !data.entries || typeof data.entries !== 'object') throw new Error('Ce fichier n’est pas une sauvegarde de Gabian.');
  return data as BackupFile;
}

export type BackupResult = { status: 'skipped'; reason: string } | { status: 'done'; file: string; keys: number; bytes: number; deleted: string[] };

/** Exporte, envoie, puis retire les sauvegardes de plus de KEEP_DAYS jours. */
export async function runBackup(store: Store, env: Record<string, string | undefined> = process.env, now = new Date()): Promise<BackupResult> {
  const cfg = supabaseConfig(env);
  if (!cfg) {
    const reason = 'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_BACKUP_BUCKET manquant : sauvegarde non faite';
    log('warn', { action: 'backup', status: 200, message: reason });
    return { status: 'skipped', reason };
  }
  const all = await store.exportEntries(BACKUP_PATTERN);
  const entries = Object.fromEntries(Object.entries(all).filter(([k]) => !k.endsWith(':lock')));
  const file: BackupFile = { app: 'gabian', version: 1, at: now.toISOString(), count: Object.keys(entries).length, entries };
  const body = JSON.stringify(file);
  const name = backupName(now);
  await storage(cfg, `/object/${encodeURIComponent(cfg.bucket)}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': 'no-store' },
    body,
  });

  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = (await listBackups(cfg)).filter((n) => FILE_RE.exec(n)![1]! < cutoff);
  if (old.length) await storage(cfg, `/object/${encodeURIComponent(cfg.bucket)}`, { method: 'DELETE', json: { prefixes: old } });

  const bytes = Buffer.byteLength(body);
  log('info', { action: 'backup', status: 200, message: 'Sauvegarde envoyée', file: name, keys: file.count, bytes, deleted: old.length });
  return { status: 'done', file: name, keys: file.count, bytes, deleted: old };
}

/** Comparaison en temps constant de l'en-tête avec le secret attendu. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** GET /api/backup, appelé par Vercel Cron. */
export async function handleBackup(request: Request, store: () => Store = getStore): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log('error', { action: 'backup', status: 503, message: 'CRON_SECRET manquant : sauvegarde refusée' });
    return reply({ error: 'Sauvegarde non configurée.' }, 503);
  }
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    log('warn', { action: 'backup', status: 401, message: 'Appel de la sauvegarde sans le bon secret' });
    return reply({ error: 'Non autorisé.' }, 401);
  }
  try {
    return reply(await runBackup(store()));
  } catch (e) {
    log('error', { action: 'backup', status: 500, ...errorFields(e) });
    return reply({ error: 'Sauvegarde échouée.' }, 500);
  }
}

// ── Restauration (scripts/restore.ts) ──

export type RestoreStatus = 'new' | 'changed' | 'same' | 'expired';
export interface RestoreStep {
  key: string;
  status: RestoreStatus;
  entry: StoreEntry;
}

const content = (e: StoreEntry | undefined) => (e ? JSON.stringify(e.type === 'list' ? ['list', e.items] : ['value', e.value]) : '');

/**
 * Ce que la restauration ferait, clé par clé (seulement les clés `club:*` du
 * motif) ; la durée de vie restante tient compte du temps écoulé depuis la
 * sauvegarde : une clé qui aurait expiré entre-temps n'est pas recréée.
 */
export function planRestore(backup: BackupFile, current: Record<string, StoreEntry>, match = BACKUP_PATTERN, now = Date.now()): RestoreStep[] {
  const re = globToRegExp(match);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(backup.at)) / 1000));
  return Object.entries(backup.entries)
    .filter(([k]) => k.startsWith('club:') && !k.endsWith(':lock') && re.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, saved]) => {
      const entry: StoreEntry = { ...saved };
      if (saved.ttl) {
        const ttl = saved.ttl - elapsed;
        if (ttl <= 0) return { key, status: 'expired', entry };
        entry.ttl = ttl;
      }
      const status: RestoreStatus = !current[key] ? 'new' : content(current[key]) === content(saved) ? 'same' : 'changed';
      return { key, status, entry };
    });
}

/** Écrit les clés nouvelles ou différentes ; renvoie leur nombre. */
export async function applyRestore(store: Store, plan: RestoreStep[]): Promise<number> {
  let written = 0;
  for (const step of plan) {
    if (step.status !== 'new' && step.status !== 'changed') continue;
    await store.importEntry(step.key, step.entry);
    written++;
  }
  return written;
}
