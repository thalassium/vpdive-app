/**
 * Lecture d'un onglet des classeurs du club (« Fiche de Suivi Niveau 1 / 2 / 3 »,
 * un onglet par élève) : la fiche qu'il contient, avec ses valeurs, à la forme
 * que l'appli reprend (server/training.ts, createFiche). Le téléchargement et
 * la lecture du fichier sont dans scripts/fiches-classeur.ts ; ici, seulement
 * le passage d'une grille de cellules à une fiche.
 *
 * L'onglet est lu par ses libellés de la colonne A (Date, Moniteur, Évaluation
 * des compétences, Cours Théoriques…), pas par numéros de ligne : la fiche
 * « lycéens » a deux lignes de plus que la fiche niveau 2. Les compétences
 * sont prises dans l'ordre de la grille ; si l'onglet n'a pas le nombre de
 * lignes attendu, elles sont rapprochées par leur libellé, et ce qui n'a pas
 * pu l'être est signalé (`warnings`).
 */
import { MODELS, type EvalCode, type FicheLevel, type ReviewStatus, type TheoryCourse } from './training';

export interface SheetSession {
  /** Numéro de la colonne « Séances » de l'onglet. */
  number: number;
  date: string;
  slot: string;
  teacher: string;
  depth: string;
  duration: string;
  weight: string;
  evals: Record<string, EvalCode>;
  comment: string;
}

/** Une fiche lue dans le classeur. */
export interface SheetFiche {
  /** Nom de l'onglet, tel quel, et le nom de l'élève qu'on en tire. */
  tab: string;
  name: string;
  level: FicheLevel;
  /** Grille de la fiche (N2L pour « niveau 2 lycéens »). */
  model: string;
  sessions: SheetSession[];
  theory: Record<string, TheoryCourse>;
  general: string;
  review: { status: Record<string, ReviewStatus>; theoryDate: string; certDate: string; responsable: string };
  /** Ce qui n'a pas pu être lu comme prévu. */
  warnings: string[];
}

/** Ce que le script écrit et que l'écran « Nouvelle fiche » relit. */
export interface SheetExport {
  generatedAt: string;
  fiches: SheetFiche[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const compact = (s: string) => norm(s).replace(/ /g, '');

/** « N1_Noé-SwynghedawV », « Sophie_HEUDE(ficheCD) », « Hilaire Barbot V » → le nom de l'élève. */
export function studentName(tab: string): string {
  return tab
    .replace(/\(.*?\)/g, ' ')
    .replace(/^N[1-4][_ ]+/i, '')
    .replace(/\[V\]/gi, ' ')
    .replace(/(\s+V|(?<=\p{Ll})V)\s*$/u, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Date d'une cellule : numéro de série du tableur, ou « 16/08 », « 16/8/26 » (année de `year` si absente). */
export function cellDate(value: string, year: number): string {
  const v = value.trim();
  if (/^\d{5}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000).toISOString().slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(v);
  if (!m) return '';
  const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
  const p = (n: string) => n.padStart(2, '0');
  return `${y}-${p(m[2]!)}-${p(m[1]!)}`;
}

/** Nombre tel que le tableur l'exporte (« 16.0 », « 19.5 ») → « 16 », « 19,5 » ; un texte reste tel quel. */
const cellText = (value: string): string => {
  const v = value.trim();
  if (/^-?\d+\.0+$/.test(v)) return v.replace(/\.0+$/, '');
  return /^-?\d+\.\d+$/.test(v) ? v.replace('.', ',') : v;
};

function evalCode(value: string): EvalCode | null {
  const v = compact(value);
  return v === 'a' ? 'A' : v === 'eca' ? 'ECA' : v === 'na' ? 'NA' : v === 'noneval' || v === 'ne' ? 'NE' : null;
}

const slot = (value: string) => (/^mat/.test(norm(value)) ? 'Matin' : /^apr/.test(norm(value)) ? 'Après-midi' : /^nui/.test(norm(value)) ? 'Nuit' : '');
const status = (value: string): ReviewStatus | null => (/valid/.test(norm(value)) ? 'VALIDE' : null);

/** Cours théorique d'après son libellé ; après la ligne « RIFAP », Théorie et Pratique sont les siens. */
function theoryKey(label: string, rifap: boolean): string | null {
  const l = norm(label);
  if (/^reglementation/.test(l)) return 'reglementation';
  if (/^organisation/.test(l)) return 'sans-dp';
  if (/^physique/.test(l)) return 'physique';
  if (/^desaturation/.test(l)) return 'desaturation';
  if (/^equipements/.test(l)) return 'equipements';
  if (/^examen/.test(l)) return 'examen';
  if (rifap && /^theorie/.test(l)) return 'rifap-theorie';
  if (rifap && /^pratique/.test(l)) return 'rifap-pratique';
  return null;
}

/**
 * La fiche d'un onglet. `rows` : ses lignes, chacune un tableau de cellules
 * (colonne A en 0), vides en ''. null si l'onglet n'est pas la fiche d'un
 * élève (instructions, fiche vierge).
 */
export function sheetToFiche(tab: string, rows: string[][], year: number): SheetFiche | null {
  const cell = (r: number, c: number) => (rows[r]?.[c] ?? '').trim();
  const label = (r: number) => norm(cell(r, 0));
  const title = norm(cell(0, 0));
  const lvl = /fiche de suivi de formation niveau ([1-4])/.exec(title)?.[1];
  if (!lvl || /vierge/i.test(tab)) return null;
  const level = `N${lvl}` as FicheLevel;
  const model = MODELS[/lyceen/.test(title) ? `${level}L` : level] ?? MODELS[level]!;
  const warnings: string[] = [];
  const general: string[] = [];
  const find = (re: RegExp, from = 0, to = rows.length) => {
    for (let r = from; r < to; r++) if (re.test(label(r))) return r;
    return -1;
  };

  const iSessions = find(/^seances/);
  const iEval = find(/^evaluation des competences/);
  if (iSessions < 0 || iEval < 0) return { tab, name: studentName(tab), level, model: model.id, sessions: [], theory: {}, general: '', review: { status: {}, theoryDate: '', certDate: '', responsable: '' }, warnings: ['Onglet illisible : lignes « Séances » ou « Évaluation des compétences » introuvables.'] };
  const iTheory = find(/^cours theoriques/, iEval);
  const iComments = find(/^commentaires de l enseignant/, iEval);
  const iReview = find(/^reserve aux responsables/, iEval);
  const end = (...candidates: number[]) => Math.min(...candidates.filter((i) => i >= 0), rows.length);

  // « Commentaire général: … » de la fiche lycéens.
  const iGeneral = find(/^commentaire general/, 0, iSessions);
  if (iGeneral >= 0) general.push([cell(iGeneral, 0).replace(/^[^:]*:?/, ''), ...(rows[iGeneral] ?? []).slice(1)].map((s) => s.trim()).filter(Boolean).join(' '));

  // Colonnes des séances : celles qui portent un numéro sur la ligne « Séances ».
  const columns = (rows[iSessions] ?? []).map((v, c) => ({ c, n: Number(v) })).filter(({ c, n }) => c > 0 && Number.isInteger(n) && n > 0);
  const head = (re: RegExp) => find(re, iSessions, iEval);
  const [iDate, iSlot, iTeacher, iDepth, iDuration, iWeight] = [/^date$/, /^matin/, /^moniteur/, /^profondeur/, /^duree$/, /^lestage/].map(head) as [number, number, number, number, number, number];

  // Compétences : dans l'ordre de la grille (intertitre, titre de section, puis ses compétences).
  const gridRows: number[] = [];
  for (let r = iEval + 1; r < end(iTheory, iComments, iReview); r++) if (cell(r, 0)) gridRows.push(r);
  const expected = model.sections.flatMap((s) => [...(s.group ? [null] : []), null, ...s.items.map((c) => c.id)]);
  const idOfRow = new Map<number, string>();
  if (gridRows.length === expected.length) {
    gridRows.forEach((r, i) => expected[i] && idOfRow.set(r, expected[i]!));
  } else {
    warnings.push(`${gridRows.length} lignes de compétences au lieu de ${expected.length} : rapprochées par leur libellé.`);
    const pool = model.sections.flatMap((s) => s.items).map((c) => ({ id: c.id, key: compact(c.label), used: false }));
    const titles = new Set(model.sections.flatMap((s) => [s.title, s.group ?? '']).map(compact));
    for (const r of gridRows) {
      const key = compact(cell(r, 0));
      const hit = pool.find((p) => !p.used && p.key === key);
      if (hit) {
        hit.used = true;
        idOfRow.set(r, hit.id);
      } else if (!titles.has(key) && columns.some(({ c }) => cell(r, c))) warnings.push(`Compétence non reconnue, évaluations laissées de côté : « ${cell(r, 0)} ».`);
    }
  }

  // Commentaires : « Séance 3 (LL) » → la colonne de la séance 3.
  const comments = new Map<number, string>();
  if (iComments >= 0) {
    for (let r = iComments + 1; r < end(iReview); r++) {
      const m = /^seance (\d+)(.*)$/.exec(label(r));
      const text = (rows[r] ?? []).slice(1).map((s) => s.trim()).filter(Boolean).join(' ');
      if (!m || !text) continue;
      const who = /\(([^)]*)\)/.exec(cell(r, 0))?.[1]?.trim() ?? '';
      comments.set(Number(m[1]), who && !/initiales/i.test(who) ? `(${who}) ${text}` : text);
    }
  }

  const sessions: SheetSession[] = [];
  for (const { c, n } of columns) {
    const evals: Record<string, EvalCode> = {};
    for (const [r, id] of idOfRow) {
      const raw = cell(r, c);
      if (!raw) continue;
      const code = evalCode(raw);
      if (code) evals[id] = code;
      else warnings.push(`Séance ${n} : évaluation « ${raw} » non reconnue (${cell(r, 0)}).`);
    }
    const at = (r: number) => (r >= 0 ? cell(r, c) : '');
    const rawDate = at(iDate);
    const session: SheetSession = {
      number: n,
      date: cellDate(rawDate, year),
      slot: slot(at(iSlot)),
      teacher: at(iTeacher),
      depth: cellText(at(iDepth)),
      duration: cellText(at(iDuration)),
      weight: cellText(at(iWeight)),
      evals,
      comment: comments.get(n) ?? '',
    };
    if (rawDate && !session.date) warnings.push(`Séance ${n} : date « ${rawDate} » illisible.`);
    // Un créneau seul (« Matin » déjà posé dans la fiche vierge) n'est pas une séance.
    if (rawDate || session.teacher || session.depth || session.weight || session.comment || Object.keys(evals).length) sessions.push(session);
  }

  // Cours théoriques : Date : | date | Moniteur : | nom | remarque ou « Note » | note.
  const theory: Record<string, TheoryCourse> = {};
  if (iTheory >= 0) {
    let rifap = false;
    for (let r = iTheory + 1; r < end(iComments, iReview); r++) {
      if (label(r) === 'rifap') {
        rifap = true;
        continue;
      }
      const key = theoryKey(cell(r, 0), rifap);
      if (!key) continue;
      const exam = key === 'examen';
      const course = { date: cellDate(cell(r, 2), year), teacher: cell(r, 4), note: exam ? cellText(cell(r, 6)) : '' };
      if (course.date || course.teacher || course.note) theory[key] = course;
      const remark = exam ? '' : cell(r, 5);
      if (remark) general.push(`${cell(r, 0)} : ${remark}`);
    }
  }

  // Réservé aux responsables plongée.
  const review: SheetFiche['review'] = { status: {}, theoryDate: '', certDate: '', responsable: '' };
  if (iReview >= 0) {
    for (let r = iReview + 1; r < rows.length; r++) {
      const l = label(r);
      const value = cell(r, 1);
      if (!l) continue;
      const key = /^theorie$/.test(l) ? 'theorie' : /^pratique$/.test(l) ? 'pratique' : /^rifap$/.test(l) ? 'rifap' : /^certification/.test(l) ? 'certification' : /^plongee en espace/.test(l) ? 'espace-40-60' : null;
      if (key) {
        if (status(value)) review.status[key] = 'VALIDE';
        const remark = cell(r, 2);
        if (remark && !/^(attente|valide)$/.test(norm(remark))) general.push(`${cell(r, 0)} : ${remark}`);
      } else if (/^date de validation/.test(l)) review.theoryDate = cellDate(value, year);
      else if (/^date de cert/.test(l)) review.certDate = cellDate(value, year);
      else if (/^responsable/.test(l)) review.responsable = value;
      // Une remarque écrite sous le bloc (« Conso air importante. »).
      else general.push((rows[r] ?? []).map((s) => s.trim()).filter(Boolean).join(' '));
    }
  }

  return { tab, name: studentName(tab), level, model: model.id, sessions, theory, general: general.filter(Boolean).join('\n'), review, warnings };
}

/** Le fichier du script relu par l'écran : les fiches qui ont la bonne forme, ou null si ce n'en est pas un. */
export function readSheetExport(json: unknown): SheetFiche[] | null {
  const fiches = (json as SheetExport | null)?.fiches;
  if (!Array.isArray(fiches)) return null;
  return fiches.filter((f) => f && typeof f.name === 'string' && /^N[1-4]$/.test(f.level) && Array.isArray(f.sessions));
}
