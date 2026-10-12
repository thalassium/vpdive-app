/**
 * Fiches de suivi de formation, sur le modèle des classeurs du club (« Fiche de
 * Suivi Niveau 1 / 2 / 3 ») : une fiche par élève et par niveau préparé, une
 * séance par plongée de formation.
 *
 * Une séance naît d'une sortie : dès que les palanquées d'une plongée sont
 * validées, chaque élève (FN#, FPA20…) d'une palanquée de formation reçoit une
 * séance « à remplir » par son enseignant — et sa fiche, si c'est sa première
 * (outingSessions, applyOutingSessions). Une séance pas encore remplie suit la
 * sortie (palanquées refaites, plongée rouverte : elle change ou disparaît) ;
 * une séance remplie ne bouge plus.
 *
 * Module sans aucun import : ses types sont lus aussi par l'appli
 * (`import type`, src/lib/training.ts), qui porte les grilles de compétences.
 * Le serveur ne connaît pas ces grilles : il range les évaluations par
 * identifiant de compétence, sans les interpréter.
 */

export type FicheLevel = 'N1' | 'N2' | 'N3' | 'N4';
/** NA = non acquis, à revoir ; ECA = en cours d'acquisition ; A = acquis ; NE = non évalué. */
export type EvalCode = 'NA' | 'ECA' | 'A' | 'NE';
export const EVAL_CODES: readonly EvalCode[] = ['NA', 'ECA', 'A', 'NE'];
export const SLOTS: readonly string[] = ['Matin', 'Après-midi', 'Nuit'];
export type ReviewStatus = 'ATTENTE' | 'VALIDE';

export interface FicheSession {
  /** « <sortie>:<plongée> » pour une séance née d'une sortie, « m-… » pour une séance ajoutée à la main. */
  id: string;
  /** Jeton de la sortie et identifiant de la plongée ; absents sur une séance ajoutée à la main. */
  event?: string;
  dive?: string;
  /** « Plongée 2 » : le nom de la plongée dans la sortie. */
  label: string;
  /** AAAA-MM-JJ. */
  date: string;
  /** Matin, Après-midi, Nuit, ou vide. */
  slot: string;
  /** Ce que l'élève préparait ce jour-là : FN2, FPA20… */
  objective: string;
  /** Moniteur ou initiateur : identifiant d'inscrit (vide s'il a été saisi à la main) et nom. */
  teacher: { id: string; name: string };
  /** Profondeur max atteinte, durée, lestage : texte libre (« 18 m », « 3 puis 4 »). */
  depth: string;
  duration: string;
  weight: string;
  /** Identifiant de compétence → évaluation. */
  evals: Record<string, EvalCode>;
  comment: string;
  /** Qui a rempli la séance, et quand ; null : à remplir. */
  filled: { by: string; at: string } | null;
}

/** Un cours théorique (ou l'examen : `note`). */
export interface TheoryCourse {
  date: string;
  teacher: string;
  note: string;
}

/** « Réservé aux responsables plongée ». */
export interface FicheReview {
  /** Théorie, pratique, certification… → ATTENTE ou VALIDE (absent : ATTENTE). */
  status: Record<string, ReviewStatus>;
  theoryDate: string;
  certDate: string;
  responsable: string;
}

export interface Fiche {
  id: string;
  /** Identifiant d'inscrit de l'élève (celui des palanquées). */
  student: string;
  /** Jeton d'adhésion au club, quand on le connaît : ouvre sa fiche membre. */
  uct?: string;
  name: string;
  picture?: string;
  level: FicheLevel;
  /** Variante de grille (« N2L » : niveau 2 lycéens) ; absente : celle du niveau. */
  model?: string;
  sessions: FicheSession[];
  theory: Record<string, TheoryCourse>;
  /** Commentaire général. */
  general: string;
  review: FicheReview;
  /** Créée à la main par un admin : elle reste, même sans séance. */
  manual?: true;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Ce que la liste des fiches montre d'une fiche, sans l'ouvrir. */
export interface FicheSummary {
  id: string;
  student: string;
  uct?: string;
  name: string;
  picture?: string;
  level: FicheLevel;
  model?: string;
  /** Nombre de séances. */
  sessions: number;
  /** Séances pas encore remplies : date et identifiant de l'enseignant. */
  todo: { id: string; date: string; teacher: string }[];
  /** Identifiants des enseignants de ses séances : eux voient la fiche. */
  teachers: string[];
  /** Date de la dernière séance. */
  last: string;
  certified: boolean;
  updatedAt: string;
}
export type FicheIndex = Record<string, FicheSummary>;

/** Refus d'une opération sur une fiche, avec le code HTTP à rendre. */
export class FicheError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const FICHE_ID = /^N[1-4]\.[\w-]{1,90}$/;
export const MAX_SESSIONS = 80;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z0-9-]{1,48}$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const date = (v: unknown): string => (DATE.test(str(v, 10)) ? str(v, 10) : '');

export const ficheIdOf = (student: string, level: FicheLevel): string => `${level}.${student.replace(/[^\w-]/g, '_')}`;

/**
 * Sous quel identifiant une personne est connue des fiches : « uct:<jeton
 * d'adhésion> » dès que la sortie le donne (c'est aussi celui d'une fiche créée
 * à la main depuis l'annuaire), sinon son identifiant d'inscrit.
 */
function personKey(d: Record<string, unknown> | null): string {
  const id = str(d?.id, 90);
  const uct = str(d?.uct, 80);
  return id.startsWith('uct:') || !/^[\w-]+$/.test(uct) ? id : `uct:${uct}`;
}

/** Sous quels identifiants l'appelant peut figurer comme enseignant d'une séance (personKey). */
export const callerIds = (id: number | string, uct: string): string[] => [String(id), `uct:${uct}`];

const SLOT_RANK: Record<string, number> = { Matin: 0, 'Après-midi': 1, Nuit: 2 };
/** Dans l'ordre où elles ont eu lieu : date, créneau, puis nom de la plongée. */
export function sortSessions(sessions: FicheSession[]): FicheSession[] {
  return [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || (SLOT_RANK[a.slot] ?? 1) - (SLOT_RANK[b.slot] ?? 1) || a.label.localeCompare(b.label, 'fr', { numeric: true }) || a.id.localeCompare(b.id),
  );
}

/** Créneau d'après l'heure de mise à l'eau (« 14:30 », « 9h15 ») ; à défaut celui de la sortie. */
function slotOf(time: string, creneau: string): string {
  const hour = /^(\d{1,2})\s?[:h]/i.exec(time)?.[1];
  if (hour !== undefined) return Number(hour) < 13 ? 'Matin' : Number(hour) < 19 ? 'Après-midi' : 'Nuit';
  return SLOTS.includes(creneau) ? creneau : '';
}

export interface OutingSession {
  student: { id: string; name: string; uct?: string; picture?: string };
  level: FicheLevel;
  session: FicheSession;
}

/**
 * Les séances de formation qu'une fiche de sortie donne : une par élève et par
 * plongée dont les palanquées sont validées. Est élève le plongeur en formation
 * (FN#, FPA20…) d'une palanquée de formation ; un débutant sans formation
 * indiquée (baptême) n'a pas de fiche, un plongeur hors VPDive (« ext-… ») non
 * plus : rien ne le relie d'une sortie à l'autre. La profondeur et la durée
 * viennent des paramètres réalisés de la fiche de sécurité, s'ils sont saisis.
 * La fiche de sortie est lue telle qu'elle est enregistrée, sans rien supposer.
 */
export function outingSessions(event: string, doc: unknown): OutingSession[] {
  const d = rec(doc);
  const header = rec(d?.header);
  const out: OutingSession[] = [];
  for (const rawDive of arr(d?.dives)) {
    const dive = rec(rawDive);
    const diveId = str(dive?.id, 40);
    if (!dive || !diveId || !dive.validated) continue;
    const sheets = rec(dive.sheets);
    for (const rawPalanquee of arr(rec(dive.plan)?.palanquees)) {
      const p = rec(rawPalanquee);
      if (!p || p.kind !== 'teaching') continue;
      const guide = rec(p.guide);
      const sheet = rec(sheets?.[str(p.id, 40)]);
      const actual = rec(sheet?.actual);
      const time = str(actual?.time, 10) || str(rec(sheet?.planned)?.time, 10);
      for (const rawMember of arr(p.members)) {
        const m = rec(rawMember);
        const id = personKey(m);
        const training = Number(m?.training);
        if (!m || !/^[\w:-]+$/.test(id) || id.startsWith('ext-') || ![1, 2, 3, 4].includes(training)) continue;
        const level = `N${training}` as FicheLevel;
        const sessionId = `${event}:${diveId}`;
        if (out.some((o) => o.student.id === id && o.level === level && o.session.id === sessionId)) continue;
        const apt = rec(m.trainingApt);
        const uct = id.startsWith('uct:') ? id.slice(4) : '';
        const picture = str(m.picture, 500);
        out.push({
          student: { id, name: str(m.name, 120), ...(uct ? { uct } : {}), ...(picture ? { picture } : {}) },
          level,
          session: {
            id: sessionId,
            event,
            dive: diveId,
            label: str(dive.label, 40),
            date: date(header?.date),
            slot: slotOf(time, str(header?.creneau, 20)),
            objective: apt && (apt.kind === 'PE' || apt.kind === 'PA') && Number(apt.depth) ? `F${apt.kind}${Number(apt.depth)}` : `FN${training}`,
            teacher: { id: personKey(guide), name: str(guide?.name, 120) },
            depth: str(actual?.depth, 30),
            duration: str(actual?.duration, 30),
            weight: '',
            evals: {},
            comment: '',
            filled: null,
          },
        });
      }
    }
  }
  return out;
}

export function newFiche(student: OutingSession['student'], level: FicheLevel, by: string, now: string): Fiche {
  return {
    id: ficheIdOf(student.id, level),
    student: student.id,
    ...(student.uct ? { uct: student.uct } : {}),
    name: student.name,
    ...(student.picture ? { picture: student.picture } : {}),
    level,
    sessions: [],
    theory: {},
    general: '',
    review: { status: {}, theoryDate: '', certDate: '', responsable: '' },
    createdAt: now,
    updatedAt: now,
    updatedBy: by,
  };
}

/**
 * La fiche mise d'accord avec ce que la sortie `event` lui donne maintenant
 * (`wanted` : ses séances pour cet élève, aucune s'il n'y est plus en
 * formation). Une séance remplie reste telle quelle ; une séance à remplir
 * prend la forme actuelle (enseignant, date, profondeur réalisée) ou disparaît
 * si la sortie ne la donne plus. Les séances des autres sorties, et celles
 * ajoutées à la main, ne sont pas touchées.
 */
export function applyOutingSessions(fiche: Fiche, event: string, wanted: FicheSession[]): Fiche {
  const fresh = new Map(wanted.map((s) => [s.id, s]));
  const kept = fiche.sessions.flatMap((s) => {
    if (s.event !== event) return [s];
    const now = fresh.get(s.id);
    fresh.delete(s.id);
    if (s.filled) return [s];
    return now ? [now] : [];
  });
  return { ...fiche, sessions: sortSessions([...kept, ...fresh.values()]) };
}

/** Une fiche sans rien dedans (sa seule séance a disparu avec la plongée rouverte) : elle n'a plus lieu d'être. */
export function isEmptyFiche(f: Fiche): boolean {
  return (
    !f.manual &&
    f.sessions.length === 0 &&
    Object.keys(f.theory).length === 0 &&
    !f.general &&
    !f.review.theoryDate &&
    !f.review.certDate &&
    !f.review.responsable &&
    !Object.values(f.review.status).includes('VALIDE')
  );
}

export function summarize(f: Fiche): FicheSummary {
  return {
    id: f.id,
    student: f.student,
    ...(f.uct ? { uct: f.uct } : {}),
    name: f.name,
    ...(f.picture ? { picture: f.picture } : {}),
    level: f.level,
    ...(f.model ? { model: f.model } : {}),
    sessions: f.sessions.length,
    todo: f.sessions.filter((s) => !s.filled).map((s) => ({ id: s.id, date: s.date, teacher: s.teacher.id })),
    teachers: [...new Set(f.sessions.map((s) => s.teacher.id).filter(Boolean))],
    last: f.sessions.reduce((max, s) => (s.date > max ? s.date : max), ''),
    certified: f.review.status.certification === 'VALIDE',
    updatedAt: f.updatedAt,
  };
}

/** L'appelant enseigne à cet élève : il est l'enseignant d'au moins une de ses séances. */
export const teachesIn = (teachers: string[], ids: string[]): boolean => teachers.some((t) => ids.includes(t));

/** Les évaluations telles qu'on les garde : identifiants de compétence connus de forme, codes connus ; une valeur vide retire l'évaluation. */
function cleanEvals(input: unknown): Record<string, EvalCode> {
  const out: Record<string, EvalCode> = {};
  for (const [k, v] of Object.entries(rec(input) ?? {}).slice(0, 200)) {
    if (KEY.test(k) && EVAL_CODES.includes(v as EvalCode)) out[k] = v as EvalCode;
  }
  return out;
}

const cleanCourse = (input: unknown): TheoryCourse => {
  const c = rec(input);
  return { date: date(c?.date), teacher: str(c?.teacher, 120), note: str(c?.note, 40) };
};
const emptyCourse = (c: TheoryCourse) => !c.date && !c.teacher && !c.note;

/** Les validations telles qu'on les garde : seul VALIDE s'écrit (absent : ATTENTE). */
function cleanReview(input: unknown): FicheReview {
  const r = rec(input);
  const status: Record<string, ReviewStatus> = {};
  for (const [k, v] of Object.entries(rec(r?.status) ?? {}).slice(0, 20)) if (KEY.test(k) && v === 'VALIDE') status[k] = 'VALIDE';
  return { status, theoryDate: date(r?.theoryDate), certDate: date(r?.certDate), responsable: str(r?.responsable, 120) };
}

/** Variante de grille demandée, ou rien si c'est celle du niveau. */
const cleanModel = (input: unknown, level: FicheLevel): string => (/^[A-Z0-9]{2,8}$/.test(str(input, 8)) && str(input, 8) !== level ? str(input, 8) : '');

/**
 * Fiche créée à la main par un admin pour un membre de l'annuaire :
 * `{uct, name, picture?, level, content?}`. `content` reprend une fiche tenue
 * ailleurs (le classeur du club, lu par scripts/fiches-classeur.ts) : grille,
 * séances déjà faites, cours théoriques, commentaire général, validations.
 * Ces séances sont des séances ajoutées à la main, déjà remplies.
 */
export function createFiche(input: Record<string, unknown> | null, who: string, now: string): Fiche {
  const uct = str(input?.uct, 80);
  const name = str(input?.name, 120);
  const level = str(input?.level, 2) as FicheLevel;
  if (!/^[\w-]{20,80}$/.test(uct) || !name) throw new FicheError(400, 'Membre inconnu.');
  if (!['N1', 'N2', 'N3', 'N4'].includes(level)) throw new FicheError(400, 'Niveau inconnu.');
  const picture = str(input?.picture, 500);
  const fiche: Fiche = { ...newFiche({ id: `uct:${uct}`, name, uct, ...(picture ? { picture } : {}) }, level, who, now), manual: true };
  const content = rec(input?.content);
  if (!content) return fiche;
  const model = cleanModel(content.model, level);
  const sessions = arr(content.sessions)
    .slice(0, MAX_SESSIONS)
    .map(rec)
    .filter((s): s is Record<string, unknown> => !!s)
    .map((s, i): FicheSession => ({
      id: `m-${i + 1}-${Date.parse(now).toString(36)}`,
      label: '',
      date: date(s.date),
      slot: SLOTS.includes(str(s.slot, 20)) ? str(s.slot, 20) : '',
      objective: '',
      teacher: { id: '', name: str(s.teacher, 120) },
      depth: str(s.depth, 30),
      duration: str(s.duration, 30),
      weight: str(s.weight, 60),
      evals: cleanEvals(s.evals),
      comment: str(s.comment, 2000),
      filled: { by: who, at: now },
    }));
  const theory: Record<string, TheoryCourse> = {};
  for (const [k, v] of Object.entries(rec(content.theory) ?? {}).slice(0, 30)) if (KEY.test(k) && !emptyCourse(cleanCourse(v))) theory[k] = cleanCourse(v);
  return { ...fiche, ...(model ? { model } : {}), sessions: sortSessions(sessions), theory, general: str(content.general, 2000), review: cleanReview(content.review) };
}

export interface FicheActor {
  admin: boolean;
  /** Identifiants d'inscrit de l'appelant (callerIds). */
  ids: string[];
  /** Son nom, pour « rempli par ». */
  who: string;
  now: string;
}

/**
 * Une opération sur une fiche : la fiche d'après, ou null si elle est supprimée.
 * Refus : FicheError.
 *
 *   session         {session, patch}   remplir ou corriger une séance : son enseignant, ou un admin
 *   add_session     {date, slot, teacher?}   séance ajoutée à la main (rattrapage d'une fiche papier)
 *   remove_session  {session}          retirer une séance ajoutée à la main
 *   theory          {key, date, teacher, note}   un cours théorique, ou l'examen
 *   general         {text?, model?}    commentaire général, variante de grille
 *   review          {status, theoryDate, certDate, responsable}   réservé aux admins
 *   delete                             réservé aux admins
 */
export function applyFicheOp(fiche: Fiche, op: string, body: Record<string, unknown> | null, actor: FicheActor): Fiche | null {
  const stamp = { updatedAt: actor.now, updatedBy: actor.who };
  const own = (s: FicheSession) => actor.admin || actor.ids.includes(s.teacher.id);
  const find = () => {
    const s = fiche.sessions.find((x) => x.id === str(body?.session, 200));
    if (!s) throw new FicheError(404, 'Séance introuvable.');
    if (!own(s)) throw new FicheError(403, 'Séance d’un autre encadrant.');
    return s;
  };
  switch (op) {
    case 'session': {
      const s = find();
      const patch = rec(body?.patch) ?? {};
      const next: FicheSession = {
        ...s,
        slot: 'slot' in patch ? (SLOTS.includes(str(patch.slot, 20)) ? str(patch.slot, 20) : '') : s.slot,
        depth: 'depth' in patch ? str(patch.depth, 30) : s.depth,
        duration: 'duration' in patch ? str(patch.duration, 30) : s.duration,
        weight: 'weight' in patch ? str(patch.weight, 60) : s.weight,
        comment: 'comment' in patch ? str(patch.comment, 2000) : s.comment,
        evals: 'evals' in patch ? cleanEvals(patch.evals) : s.evals,
        filled: { by: actor.who, at: actor.now },
      };
      // Une séance née d'une sortie garde la date et l'enseignant de la sortie.
      if (!s.event) {
        if (date(patch.date)) next.date = date(patch.date);
        const name = str(patch.teacher, 120);
        if (actor.admin && name && name !== s.teacher.name) next.teacher = { id: '', name };
      }
      return { ...fiche, sessions: sortSessions(fiche.sessions.map((x) => (x === s ? next : x))), ...stamp };
    }
    case 'add_session': {
      if (fiche.sessions.length >= MAX_SESSIONS) throw new FicheError(413, 'Trop de séances sur cette fiche.');
      if (!date(body?.date)) throw new FicheError(400, 'Date manquante.');
      const name = str(body?.teacher, 120);
      const session: FicheSession = {
        id: `m-${Date.parse(actor.now).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label: '',
        date: date(body?.date),
        slot: SLOTS.includes(str(body?.slot, 20)) ? str(body?.slot, 20) : '',
        objective: '',
        teacher: actor.admin && name && name !== actor.who ? { id: '', name } : { id: actor.ids[0] ?? '', name: actor.who },
        depth: '',
        duration: '',
        weight: '',
        evals: {},
        comment: '',
        filled: null,
      };
      return { ...fiche, sessions: sortSessions([...fiche.sessions, session]), ...stamp };
    }
    case 'remove_session': {
      const s = find();
      if (s.event) throw new FicheError(400, 'Cette séance vient d’une sortie : elle suit ses palanquées.');
      return { ...fiche, sessions: fiche.sessions.filter((x) => x !== s), ...stamp };
    }
    case 'theory': {
      const key = str(body?.key, 48);
      if (!KEY.test(key)) throw new FicheError(400, 'Cours inconnu.');
      const course = cleanCourse(body);
      const theory = { ...fiche.theory };
      if (emptyCourse(course)) delete theory[key];
      else theory[key] = course;
      if (Object.keys(theory).length > 30) throw new FicheError(413, 'Trop de cours sur cette fiche.');
      return { ...fiche, theory, ...stamp };
    }
    case 'general': {
      const next = { ...fiche, ...stamp };
      if (body && 'text' in body) next.general = str(body.text, 2000);
      if (body && 'model' in body) {
        const model = cleanModel(body.model, fiche.level);
        if (model) next.model = model;
        else delete next.model;
      }
      return next;
    }
    case 'review':
      if (!actor.admin) throw new FicheError(403, 'Réservé aux responsables plongée.');
      return { ...fiche, review: cleanReview(body), ...stamp };
    case 'delete':
      if (!actor.admin) throw new FicheError(403, 'Réservé aux responsables plongée.');
      return null;
    default:
      throw new FicheError(400, 'Opération inconnue.');
  }
}
