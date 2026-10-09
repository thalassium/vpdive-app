/**
 * Restauration d'une sauvegarde du stockage partagé (voir server/backup.ts).
 *
 * Usage :
 *   npx tsx scripts/restore.ts <fichier.json>            essai à blanc depuis un fichier téléchargé
 *   npx tsx scripts/restore.ts --bucket [nom|latest]     essai à blanc depuis le bucket Supabase
 *   … --match 'club:*:outing:*'                          seulement les clés de ce motif
 *   … --apply                                            écrire pour de bon
 *
 * Par défaut rien n'est écrit : le script dit, clé par clé, ce qui serait
 * créé, remplacé, laissé tel quel, ou pas recréé parce qu'expiré depuis.
 * Seules les clés `club:*` sont restaurées ; les clés présentes mais absentes
 * de la sauvegarde ne sont pas touchées. N'affiche que des noms de clés,
 * jamais leur contenu.
 *
 * Cible : la base Upstash si ses variables sont dans l'environnement ou dans
 * .env.local (comme sur Vercel : KV_REST_API_URL / KV_REST_API_TOKEN), sinon
 * le fichier local .data/app-store.json. Le bucket demande SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY et SUPABASE_BACKUP_BUCKET.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyRestore, downloadBackup, listBackups, parseBackup, planRestore, supabaseConfig, type BackupFile } from '../server/backup.js';
import { getStore } from '../server/store.js';

const ROOT = join(import.meta.dirname, '..');
loadEnv(join(ROOT, '.env.local'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : '') : null;
};
const match = flag('--match') || 'club:*';
const bucket = flag('--bucket');
const file = args.find((a, i) => !a.startsWith('--') && !['--match', '--bucket'].includes(args[i - 1] ?? ''));

if (bucket === null && !file) {
  console.error('Usage : npx tsx scripts/restore.ts <fichier.json> | --bucket [nom|latest]  [--match motif] [--apply]');
  process.exit(1);
}

const backup = await load();
const usesRedis = Object.keys(process.env).some((k) => /(KV_REST_API|UPSTASH_REDIS_REST|REDIS_REST_API|REDIS_REST)_URL$/.test(k) && process.env[k]?.startsWith('https://'));
console.log(`Sauvegarde du ${backup.at} : ${backup.count} clés.`);
console.log(`Cible : ${usesRedis ? 'base Upstash Redis (production ?)' : 'fichier local .data/app-store.json'} ; motif : ${match}`);

const store = getStore();
const plan = planRestore(backup, await store.exportEntries(match), match);
const labels = { new: 'créée', changed: 'remplacée', same: 'identique', expired: 'expirée depuis : non recréée' } as const;
for (const step of plan) console.log(`  ${step.key.padEnd(60)} ${labels[step.status]}`);
const count = (s: keyof typeof labels) => plan.filter((p) => p.status === s).length;
console.log(`\n${count('new')} à créer, ${count('changed')} à remplacer, ${count('same')} identiques, ${count('expired')} expirées.`);

if (!apply) {
  console.log('Essai à blanc : rien n’a été écrit. Relancez avec --apply pour restaurer.');
} else {
  const written = await applyRestore(store, plan);
  console.log(`${written} clés écrites.`);
}

async function load(): Promise<BackupFile> {
  if (file) return parseBackup(readFileSync(file, 'utf8'));
  const cfg = supabaseConfig();
  if (!cfg) {
    console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et SUPABASE_BACKUP_BUCKET sont nécessaires pour lire le bucket.');
    process.exit(1);
  }
  const names = await listBackups(cfg);
  const name = !bucket || bucket === 'latest' ? names.at(-1) : bucket;
  if (!name || !names.includes(name)) {
    console.error(`Sauvegarde introuvable dans le bucket. Disponibles : ${names.join(', ') || 'aucune'}`);
    process.exit(1);
  }
  console.log(`Lecture de ${name} dans le bucket ${cfg.bucket}.`);
  return downloadBackup(cfg, name);
}

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m?.[1] && process.env[m[1]] === undefined) process.env[m[1]] = (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
}
