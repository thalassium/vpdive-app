/**
 * Les fiches de suivi de formation déjà tenues dans les classeurs Google du
 * club (« Fiche de Suivi Niveau 1 / 2 / 3 », un onglet par élève), avec leurs
 * valeurs : séances, évaluations, commentaires, cours théoriques, validations.
 *
 * Usage :
 *   npx tsx scripts/fiches-classeur.ts <classeur>…        un résumé par fiche, et le fichier imports/fiches-classeur.json
 *   npx tsx scripts/fiches-classeur.ts --json <classeur>… les fiches en JSON sur la sortie standard, rien d'écrit
 *   … --out <fichier.json>                                écrire ailleurs
 *
 * <classeur> : l'adresse ou l'identifiant d'un Google Sheet (lisible par
 * quiconque a le lien : il est téléchargé en .xlsx, sans compte), ou un
 * fichier .xlsx déjà téléchargé. Sans argument : ceux de FICHES_CLASSEURS
 * (séparés par des virgules), dans l'environnement ou dans .env.local.
 *
 * Le fichier produit se dépose dans l'appli : Admin → Formations → Nouvelle
 * fiche → « Reprendre une fiche du classeur ». On y choisit le membre VPDive
 * de chaque élève : le classeur ne connaît que son nom. Il contient des noms
 * et des évaluations : imports/ n'est pas versionné.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { sheetToFiche, type SheetExport, type SheetFiche } from '../src/lib/trainingSheets.js';

const ROOT = join(import.meta.dirname, '..');

/** FICHES_CLASSEURS dans .env.local, si l'environnement ne l'a pas déjà. */
function envSheets(): string[] {
  let value = process.env.FICHES_CLASSEURS ?? '';
  const file = join(ROOT, '.env.local');
  if (!value && existsSync(file)) value = /^FICHES_CLASSEURS\s*=\s*(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.replace(/^["']|["']\s*$/g, '') ?? '';
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Les fichiers d'une archive zip (un .xlsx en est une) : nom → contenu, lus depuis le répertoire central. */
function unzip(data: Buffer): Map<string, Buffer> {
  const eocd = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('ce n’est pas un fichier .xlsx');
  const files = new Map<string, Buffer>();
  let at = data.readUInt32LE(eocd + 16);
  for (let i = data.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
const texts = (xml: string) => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
/** « AB12 » → 27 (colonne A en 0). */
const column = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Les onglets d'un classeur .xlsx : nom, et lignes de cellules (texte ; un nombre ou une date tels que le tableur les garde). */
function sheetsOf(xlsx: Buffer): { name: string; rows: string[][] }[] {
  const files = unzip(xlsx);
  const xml = (path: string) => files.get(path)?.toString('utf8') ?? '';
  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const targets = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/\bId="([^"]+)"/.exec(m[0])?.[1] ?? '', /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  return [...xml('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = decode(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const target = targets.get(/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? '';
    const rows: string[][] = [];
    for (const row of xml(target.startsWith('/') ? target.slice(1) : `xl/${target}`).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+\d+)"/.exec(c[1]!)?.[1];
        if (!ref) continue;
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        const type = /\bt="([^"]+)"/.exec(c[1]!)?.[1];
        cells[column(ref)] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? texts(c[2] ?? '') : decode(v ?? '');
      }
      rows[Number(row[1]) - 1] = Array.from(cells, (v) => v ?? '');
    }
    return { name, rows: Array.from(rows, (r) => r ?? []) };
  });
}

/** Le classeur : un fichier .xlsx du disque, ou un Google Sheet téléchargé par son adresse ou son identifiant. */
async function load(source: string): Promise<Buffer> {
  if (existsSync(source)) return readFileSync(source);
  const id = /\/d\/([\w-]{20,})/.exec(source)?.[1] ?? (/^[\w-]{20,}$/.test(source) ? source : null);
  if (!id) throw new Error('ni un fichier, ni un Google Sheet');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !/spreadsheetml/.test(res.headers.get('content-type') ?? '')) throw new Error(`téléchargement refusé (HTTP ${res.status}) : le classeur doit être lisible par quiconque a le lien`);
  return Buffer.from(await res.arrayBuffer());
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args[outAt + 1] : undefined;
const named = args.filter((a, i) => !a.startsWith('--') && i !== outAt + 1);
const sources = named.length ? named : envSheets();
if (!sources.length || (outAt >= 0 && !out)) {
  console.error('Usage : npx tsx scripts/fiches-classeur.ts [--json] [--out fichier.json] <adresse ou identifiant Google Sheet | fichier.xlsx>…');
  process.exit(1);
}

const year = new Date().getFullYear();
const fiches: SheetFiche[] = [];
for (const source of sources) {
  try {
    for (const sheet of sheetsOf(await load(source))) {
      const fiche = sheetToFiche(sheet.name, sheet.rows, year);
      if (fiche) fiches.push(fiche);
    }
  } catch (e) {
    console.error(`${source} : ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
fiches.sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name, 'fr'));
const result: SheetExport = { generatedAt: new Date().toISOString(), fiches };

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const f of fiches) {
    const evals = f.sessions.reduce((n, s) => n + Object.keys(s.evals).length, 0);
    const valid = Object.keys(f.review.status);
    console.log(`\n${f.model.padEnd(4)}${f.name}  (onglet « ${f.tab} »)`);
    console.log(`    ${f.sessions.length} séance${f.sessions.length > 1 ? 's' : ''}, ${evals} évaluation${evals > 1 ? 's' : ''}${valid.length ? ` · validé : ${valid.join(', ')}` : ''}${f.review.responsable ? ` · responsable ${f.review.responsable}` : ''}`);
    for (const s of f.sessions) {
      console.log(`    ${String(s.number).padStart(2)}. ${s.date || 'sans date '} ${s.slot.padEnd(10)} ${s.teacher.padEnd(10)} ${[s.depth && `prof. ${s.depth}`, s.duration && `durée ${s.duration}`, s.weight && `lest ${s.weight}`].filter(Boolean).join(', ')}`);
    }
    for (const w of f.warnings) console.log(`    ⚠ ${w}`);
  }
  const file = out ?? join(ROOT, 'imports', 'fiches-classeur.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\n${fiches.length} fiche${fiches.length > 1 ? 's' : ''} → ${file}`);
}
