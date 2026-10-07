/**
 * Constitution automatique des palanquées (plongée à l'air, milieu naturel,
 * exploration), d'après le Code du sport tel que l'applique la FFESSM :
 *
 *   Annexe III-14 b  brevets → aptitudes
 *       N1 = PE-20 (PA-12 si « incluant l'autonomie »), N2 = PE-40 + PA-20,
 *       N3 = PE-60 + PA-60
 *   Annexe III-15 b  encadrants
 *       E1 = Initiateur, E2 = Initiateur + GP, E3 = MF1, E4 = MF2, GP = N4
 *   Annexe III-16 b  exploration
 *       Espace   Encadrés     Encadrant          Effectif   Autonomes  Effectif
 *       0-6 m    débutants    E1 ou GP/P4        4 (*)      —          —
 *       0-12 m   PE-12        E2 ou GP/P4        4 (*)      PA-12      3
 *       0-20 m   PE-20        E2 ou GP/P4        4 (*)      PA-20      3
 *       0-40 m   PE-40        E3 ou GP/P4        4 (*)      PA-40      3
 *       0-60 m   PE-60        E4                 4          PA-60      3
 *       (*) un plongeur supplémentaire possible, au minimum GP/P4.
 *   Une palanquée autonome compte 2 ou 3 plongeurs majeurs.
 *
 * Sources : Code du sport, art. A322-77 et suivants, annexes III-14 à III-16
 * (arrêté du 6 avril 2012), tables vérifiées sur le texte officiel.
 *
 * Règles de pratique du club, en plus du Code :
 *   - un élève (FN#) impose une palanquée de formation ; il l'est ce jour-là
 *     même s'il est moniteur, et ne peut alors ni encadrer ni enseigner ;
 *   - enseignant minimum selon le niveau visé (MIN_TEACH_FOR_TRAINING) ; un
 *     N4/GP n'enseigne jamais ; le moins qualifié qui suffit est choisi ;
 *   - un encadrant d'exploration est au moins N4/GP, noté à sa plus haute
 *     prérogative ; un moniteur qui plonge en exploration prend celle de la
 *     palanquée (celle du moins formé) et compte dans l'effectif ;
 *   - en formation, un E1…E4 qui plonge garde son statut E# et un N4/GP qui
 *     assiste prend la prérogative de la palanquée ; ni l'un ni l'autre ne
 *     compte parmi les 4 élèves.
 *
 * Le module ne fait que proposer : le directeur de plongée reste seul
 * responsable de la composition finale (art. A322-72). Chaque palanquée est
 * revalidée à chaque modification manuelle (validate).
 */

export type Depth = 6 | 12 | 20 | 40 | 60;
export const DEPTHS: Depth[] = [6, 12, 20, 40, 60];

/** Profondeur maximale proposée automatiquement : la zone 40-60 m se décide toujours à la main. */
export const AUTO_MAX_DEPTH: Depth = 40;

/**
 * Qualification d'encadrement EN EXPLORATION, de la plus faible à la plus forte.
 * Pas de niveau E2 distinct ici : un E2 est Initiateur + GP (annexe III-15 b),
 * il encadre donc en exploration comme un GP, jusqu'à 40 m. En enseignement,
 * c'est `teach` qui compte (E2 = 20 m).
 */
export type GuideLevel = 'E1' | 'GP' | 'E3' | 'E4';
const GUIDE_RANK: Record<GuideLevel, number> = { E1: 1, GP: 2, E3: 3, E4: 4 };
/** Profondeur maximale qu'un encadrant peut faire atteindre à une palanquée en exploration. */
export const GUIDE_MAX_DEPTH: Record<GuideLevel, Depth> = { E1: 6, GP: 40, E3: 40, E4: 60 };

/**
 * Enseignement (annexe III-16 a) : niveau E de l'enseignant et zone où il peut
 * enseigner. E1 = Initiateur, E2 = Initiateur + GP, E3 = MF1, E4 = MF2.
 */
export type TeachLevel = 0 | 1 | 2 | 3 | 4;
export const TEACH_MAX_DEPTH: Record<Exclude<TeachLevel, 0>, Depth> = { 1: 6, 2: 20, 3: 40, 4: 60 };

/**
 * Formation en cours, notée FN# : FN1 = vers le N1, FN2 = vers le N2…
 * Profondeur visée par la formation (annexe III-16 a) : FN1 0-20 m (E2),
 * FN2 0-40 m (E3), FN3 et FN4 jusqu'à 60 m (E4, donc toujours à la main).
 */
export type TrainingLevel = 0 | 1 | 2 | 3 | 4;
export const TRAINING_TARGET: Record<Exclude<TrainingLevel, 0>, Depth> = { 1: 20, 2: 40, 3: 60, 4: 60 };
/**
 * Enseignant minimum selon le niveau visé (pratique du club) : FN1 → E2 (20 m),
 * FN2 à FN4 → E3 (40 m) ; au-delà de 40 m, E4, toujours à la main. Des
 * débutants sans FN (baptême, 0-6 m) : un E1 suffit.
 */
export const MIN_TEACH_FOR_TRAINING: Record<Exclude<TrainingLevel, 0>, TeachLevel> = { 1: 2, 2: 3, 3: 3, 4: 3 };

/**
 * Aptitude visée par une formation, quand le DP la précise : un niveau se
 * compose d'aptitudes (N2 = PE40 et PA20, passées séparément ; N3 = PA40,
 * PE60, PA60, dans l'ordre). « FPA20 » plutôt que « FN2 » pour un PE40 qui
 * passe son PA20 : la zone est 20 m, un E2 suffit au lieu de mobiliser un E3.
 */
export interface TrainingApt {
  kind: 'PE' | 'PA';
  depth: Depth;
}
export const TRAINING_APTS: readonly string[] = ['FPA20', 'FPE40', 'FPA40', 'FPE60', 'FPA60'];
/** Niveau dont relève une aptitude (PE20 et PA12 : N1 ; PA20 et PE40 : N2 ; au-delà : N3). */
const levelOfApt = (a: TrainingApt): TrainingLevel => (a.depth <= 12 || (a.kind === 'PE' && a.depth === 20) ? 1 : a.depth <= 20 || (a.kind === 'PE' && a.depth === 40) ? 2 : 3);

export interface Aptitudes {
  /** Profondeur max en palanquée encadrée (0 = aucune aptitude connue). */
  pe: Depth | 0;
  /** Profondeur max en autonomie (0 = pas autonome). */
  pa: Depth | 0;
  guide: GuideLevel | null;
  /** Prérogative d'enseignement (E1…E4), 0 si aucune. */
  teach: TeachLevel;
  /** En formation vers ce niveau (FN#), 0 sinon. Déduit de trainingApt quand l'aptitude est précisée. */
  training: TrainingLevel;
  /** Aptitude précise visée par la formation (FPA20, FPE40…), si le DP l'a indiquée. */
  trainingApt?: TrainingApt;
  /** Débutant ou baptême : 0-6 m, encadré. */
  beginner: boolean;
  /** Peut être ajouté comme plongeur supplémentaire (*) : GP/P4 au minimum. */
  canBeExtra: boolean;
  /**
   * Plongeur enfant (Bronze, Argent, Or) : les conditions de pratique enfants
   * (effectifs, profondeurs par âge) ne sont pas modélisées, l'admin le place à la main.
   */
  child: boolean;
}

export interface Diver extends Aptitudes {
  id: string;
  name: string;
  /** Niveaux tels que VPDive les affiche, montrés tels quels à l'admin. */
  labels: string[];
  /** Mineur, si on le sait : interdit en palanquée autonome. */
  minor?: boolean;
  /** Niveaux et diplômes tels que VPDive les écrit (DEJEPS, MF1, P2, PADI - AOW…). */
  display?: string[];
  /**
   * Quand le DP a retenu un équivalent à la main (brevet PADI ou SSI ramené à
   * une prérogative FFESSM…) : les niveaux VPDive d'origine, gardés en vue.
   */
  original?: string[];
  /** Pour la fiche de sécurité (colonnes NOM / PRÉNOM). */
  firstname?: string;
  lastname?: string;
}

/**
 * - guided      exploration encadrée (PE), par un GP/N4 ou un E
 * - autonomous  exploration autonome (PA), 2 ou 3 majeurs
 * - teaching    formation : l'enseignant (E1…E4) fixe la zone, les élèves sont FN#
 */
export type PalanqueeKind = 'guided' | 'autonomous' | 'teaching';

export interface Palanquee {
  id: string;
  kind: PalanqueeKind;
  /** Encadrant ou enseignant (palanquée encadrée ou de formation). */
  guide: Diver | null;
  /** Plongeur supplémentaire GP/P4 (*), jusqu'à 40 m. */
  extra: Diver | null;
  members: Diver[];
  /**
   * Profondeur maximale retenue par le DP pour cette palanquée, en mètres
   * (25 m…), jamais au-delà de sa prérogative. Absente : la prérogative,
   * plafonnée à 40 m (AUTO_MAX_DEPTH).
   */
  depth?: number;
}

export interface Plan {
  palanquees: Palanquee[];
  /** Plongeurs qui n'ont pas pu être placés, avec la raison. */
  unassigned: { diver: Diver; reason: string }[];
}

export interface PlanOptions {
  /** Profondeur prévue par le DP pour la sortie (défaut 40 m). */
  maxDepth?: Depth;
  /** Binômes souhaités : paires d'identifiants que l'on essaie de garder ensemble. */
  buddies?: [string, string][];
}

// ── Lecture des niveaux VPDive ───────────────────────────────────

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-_./]/g, ' ')
    .replace(/\b(pe|pa)\s+(12|20|40|60)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

const maxDepth = (a: Depth | 0, b: Depth | 0): Depth | 0 => (a >= b ? a : b);
const minDepth = (a: Depth, b: Depth): Depth => (a <= b ? a : b);
const higherGuide = (a: GuideLevel | null, b: GuideLevel | null) =>
  !a ? b : !b ? a : GUIDE_RANK[a] >= GUIDE_RANK[b] ? a : b;

/**
 * Aptitudes déduites des niveaux, brevets et qualifications d'un membre.
 * Plusieurs libellés se cumulent (on garde le plus élevé de chaque aptitude).
 * Un libellé inconnu est ignoré : l'admin le voit dans `labels` et ajuste.
 */
export function aptitudesFromLabels(labels: string[]): Aptitudes {
  let pe: Depth | 0 = 0;
  let pa: Depth | 0 = 0;
  let guide: GuideLevel | null = null;
  let beginner = false;
  let initiateur = false;
  let p4 = false;
  let child = false;
  let teach: TeachLevel = 0;
  let training: TrainingLevel = 0;
  let trainingApt: TrainingApt | undefined;

  for (const raw of labels) {
    const s = norm(raw);
    const has = (re: RegExp) => re.test(s);

    // Formation vers une aptitude précise : « FPA20 », « FPE40 »… (saisie du DP).
    const fapt = /\bf ?-?(pe|pa) ?-?(12|20|40|60)\b/.exec(s);
    if (fapt) {
      trainingApt = { kind: fapt[1]!.toUpperCase() as 'PE' | 'PA', depth: Number(fapt[2]) as Depth };
      training = Math.max(training, levelOfApt(trainingApt)) as TrainingLevel;
      continue;
    }

    // Formation en cours : « FN2 », « Formation N2 », « Prépa niveau 2 »… Le
    // niveau visé n'est pas encore acquis : ce libellé ne compte que comme FN#.
    const fn = /\bfn ?([1-4])\b|\b(?:formation|prepa(?:ration)?) (?:niveau |n ?|p ?)?([1-4])\b/.exec(s);
    if (fn) {
      training = Math.max(training, Number(fn[1] ?? fn[2])) as TrainingLevel;
      continue;
    }

    // Aptitudes explicites (PE-xx / PA-xx)
    for (const m of s.matchAll(/\b(pe|pa)(12|20|40|60)\b/g)) {
      const d = Number(m[2]) as Depth;
      if (m[1] === 'pe') pe = maxDepth(pe, d);
      else pa = maxDepth(pa, d);
    }

    // Brevets de plongeur (annexe III-14 b). VPDive les donne en code court
    // (P1, P2-ANMP, P1-PE20-FSGT…) ou en toutes lettres selon l'écran.
    if (has(/\b(n|p|niveau|plongeur niveau)\s?1\b/)) {
      pe = maxDepth(pe, 20);
      if (has(/autonom/)) pa = maxDepth(pa, 12);
    }
    if (has(/\b(n|p|niveau|plongeur niveau)\s?2\b/)) {
      pe = maxDepth(pe, 40);
      pa = maxDepth(pa, 20);
    }
    if (has(/\b(n|p|niveau|plongeur niveau)\s?3\b/)) {
      pe = maxDepth(pe, 60);
      pa = maxDepth(pa, 60);
    }
    // Plongeur CMAS 1★ = PE-20, 2★ = PE-20 + PA-12, 3★ = PE-40 + PA-20 (annexe III-14 b) :
    // un « 2 étoiles » n'est PAS un N2.
    const isInstructor = has(/moniteur|instructor|instructeur/);
    if (!isInstructor && has(/cmas|etoile|\*/)) {
      const stars = (s.match(/\*/g) ?? []).length || Number(/\b([123]) etoile/.exec(s)?.[1] ?? 0);
      if (stars >= 1) pe = maxDepth(pe, 20);
      if (stars >= 2) pa = maxDepth(pa, 12);
      if (stars >= 3) {
        pe = maxDepth(pe, 40);
        pa = maxDepth(pa, 20);
      }
    }
    // N4 / GP, et N5 / DP qui le supposent
    if (has(/\b(n|p|niveau)\s?[45]\b|guide de palanquee|\bgp\b|directeur de plongee/)) {
      p4 = true;
    }

    // Encadrement (annexe III-15 b) : codes E1…E4, noms longs « Enseignant 3 - … »,
    // MF1/MF2, moniteurs associés, brevets d'État, moniteurs CMAS.
    // Quand VPDive écrit « Enseignant N » dans le nom, c'est la prérogative, quel
    // que soit le diplôme (un DEJEPS est E3 ou E4 selon sa mention) : le nom du
    // diplôme ne sert qu'à défaut. Enseignant 5 (BEES 3) est traité en E4.
    const level = Math.min(Number(/\benseignant ([1-5])\b/.exec(s)?.[1] ?? 0), 4);
    const byDiploma = (re: RegExp) => !level && has(re);
    const teachAt = (n: TeachLevel) => {
      if (n > teach) teach = n;
    };
    if (has(/\binitiateur\b|\be1\b/) || level === 1) {
      initiateur = true;
      teachAt(1);
    }
    if (has(/\be2\b/) || byDiploma(/\bbpjeps\b/) || level === 2) {
      initiateur = true;
      p4 = true;
      teachAt(2);
    }
    if (has(/\bmf1\b|\be3\b|\bmf as\b|moniteur federal (1|1er|premier)/) || byDiploma(/\bbees ?1\b|\bdejeps\b/) || level === 3) {
      guide = higherGuide(guide, 'E3');
      teachAt(3);
    }
    if (has(/\bmf2\b|\be4\b|\bffm\b|moniteur federal (2|2e|second)/) || byDiploma(/\bbees ?[23]\b|\bdesjeps\b/) || level === 4) {
      guide = higherGuide(guide, 'E4');
      teachAt(4);
    }
    // Moniteur CMAS 1★ = E2, 2★ = E3 ; le 3★ n'a pas d'équivalent E4 dans l'annexe.
    const cmasMonitor = /moniteur(?: instructor)? ?([123]) ?\*/.exec(s);
    if (cmasMonitor) {
      if (cmasMonitor[1] === '1') {
        initiateur = true;
        p4 = true;
        teachAt(2);
      } else {
        guide = higherGuide(guide, 'E3');
        teachAt(3);
      }
    }


    if (has(/debutant|bapteme|pass decouverte|^p pp$|pass plongee/)) beginner = true;
    // Plongeurs enfants (Bronze, Argent, Or) : effectifs et profondeurs propres.
    if (has(/^(pbr|par|por)$|plongeur\(?s?e?\)? (de bronze|d argent|d or)\b/)) child = true;
  }

  if (p4) guide = higherGuide(guide, 'GP');
  if (initiateur) guide = higherGuide(guide, 'E1');
  // Un Initiateur est au moins N2 (prérequis du brevet) : PE40 / PA20 si rien d'autre n'est connu.
  if (initiateur && pe === 0) {
    pe = 40;
    pa = maxDepth(pa, 20);
  }
  // E2 = Initiateur + N4/GP, même quand les deux sont des libellés séparés.
  if (initiateur && p4 && teach < 2) teach = 2;
  // Tout encadrant à partir du GP est au moins N4 : autonome et encadré à 60 m.
  if (guide && GUIDE_RANK[guide] >= GUIDE_RANK.GP) {
    pe = 60;
    pa = 60;
  }
  // Une aptitude PA-xx suppose les aptitudes PE-xx (annexe III-14 a).
  pe = maxDepth(pe, pa);
  if (pe > 0) beginner = false;

  return { pe, pa, guide, teach, training, beginner, child, canBeExtra: !!guide && GUIDE_RANK[guide] >= GUIDE_RANK.GP, ...(trainingApt ? { trainingApt } : {}) };
}

// ── Règles d'une palanquée ───────────────────────────────────────

/** Profondeur à laquelle un plongeur peut être emmené en palanquée encadrée. */
const guidedDepthOf = (d: Diver): Depth | 0 => (d.pe > 0 ? d.pe : d.beginner ? 6 : 0);

/** Formation d'un plongeur telle qu'on l'écrit : « FPA20 » si l'aptitude est précisée, sinon « FN2 » ; vide s'il n'est pas en formation. */
export const trainingLabel = (d: Aptitudes): string => (d.trainingApt ? `F${d.trainingApt.kind}${d.trainingApt.depth}` : d.training ? `FN${d.training}` : '');

/** Profondeur visée par la formation : celle de l'aptitude si elle est précisée, sinon celle du niveau (TRAINING_TARGET). 0 hors formation. */
export const trainingTargetOf = (d: Aptitudes): Depth | 0 => (d.trainingApt ? d.trainingApt.depth : d.training ? TRAINING_TARGET[d.training] : 0);

/** Enseignant minimum pour cet élève : E2 jusqu'à 20 m, E3 au-delà (la zone fait le reste : E4 au-delà de 40 m) ; E1 pour un débutant sans FN. */
export const minTeachFor = (d: Aptitudes): TeachLevel => (d.trainingApt ? (d.trainingApt.depth <= 20 ? 2 : 3) : d.training ? MIN_TEACH_FOR_TRAINING[d.training] : 1);

/** Profondeur visée par un plongeur dans une palanquée de formation. */
const teachingDepthOf = (d: Diver): Depth | 0 => trainingTargetOf(d) || guidedDepthOf(d);

/**
 * Profondeur maximale réglementaire de la palanquée (sa prérogative), bornée
 * par `outingMax`. 0 si la palanquée ne peut pas plonger telle quelle.
 */
export function depthOf(p: Palanquee, outingMax: Depth = 60): Depth | 0 {
  let depth: Depth = outingMax;
  if (p.kind === 'teaching') {
    if (!p.guide?.teach) return 0;
    depth = minDepth(depth, TEACH_MAX_DEPTH[p.guide.teach]);
    for (const m of p.members) {
      const t = teachingDepthOf(m);
      if (!t) return 0;
      depth = minDepth(depth, t);
    }
    if (p.extra) depth = minDepth(depth, 40);
    return depth;
  }
  if (p.kind === 'guided') {
    if (!p.guide?.guide) return 0;
    depth = minDepth(depth, GUIDE_MAX_DEPTH[p.guide.guide]);
    for (const m of p.members) {
      const g = guidedDepthOf(m);
      if (!g) return 0;
      depth = minDepth(depth, g);
    }
    if (p.extra) depth = minDepth(depth, 40);
    return depth;
  }
  for (const m of p.members) {
    if (!m.pa) return 0;
    depth = minDepth(depth, m.pa);
  }
  return depth;
}

/**
 * Profondeur maximale à laquelle la palanquée plonge : celle fixée par le DP si
 * elle respecte la prérogative, sinon la prérogative plafonnée à 40 m. C'est un
 * paramètre de plongée, distinct de la prérogative (prerogativeLabel).
 */
export function chosenDepth(p: Palanquee): number {
  const legal = depthOf(p);
  if (!legal) return 0;
  return p.depth && p.depth <= legal ? Math.round(p.depth) : Math.min(legal, AUTO_MAX_DEPTH);
}

/**
 * Deux types de palanquée pour le DP : Formation ou Exploration. En exploration,
 * encadrée ou autonome n'est pas un choix : la palanquée est encadrée (PE) dès
 * qu'elle a un encadrant, autonome (PA) sinon (cf. settleKind).
 */
export type PalanqueeType = 'teaching' | 'exploration';
export const TYPE_LABEL: Record<PalanqueeType, string> = { teaching: 'Formation', exploration: 'Exploration' };
export const typeOf = (p: Palanquee): PalanqueeType => (p.kind === 'teaching' ? 'teaching' : 'exploration');
export const KIND_LABEL: Record<PalanqueeKind, string> = { teaching: 'Formation', guided: 'Exploration', autonomous: 'Exploration' };

/**
 * Objectif d'une formation, pour le DP et l'enseignant : ce que ses élèves
 * préparent (« FPA20 », « FN1 / FPA20 »). La formation n'a pas d'autre portée
 * que cet objectif ; les prérogatives de la palanquée en découlent. Vide hors
 * formation, ou sans élève en formation (débutants).
 */
export function objectiveLabel(p: Palanquee): string {
  if (p.kind !== 'teaching') return '';
  return [...new Set(studentsOf(p).map(trainingLabel).filter(Boolean))].join(' / ');
}

/** Type de la palanquée tel qu'il s'écrit en tête : « Exploration », « Formation », « Formation FPA20 ». */
export const kindLabel = (p: Palanquee): string => [KIND_LABEL[p.kind], objectiveLabel(p)].filter(Boolean).join(' ');

/** Une palanquée qui compte un élève en formation (FN#) est forcément une palanquée de formation. */
export const hasStudent = (p: Palanquee): boolean => p.members.some((m) => m.training > 0);

/** Encadrant d'exploration : N4/GP au minimum (un E1 seul n'encadre pas en exploration). */
export const canGuideExploration = (d: Aptitudes): boolean => !!d.guide && GUIDE_RANK[d.guide] >= GUIDE_RANK.GP;

/**
 * Ce qu'il faut pour enseigner à ces élèves : le niveau E minimum du niveau
 * visé (MIN_TEACH_FOR_TRAINING, E1 pour des débutants sans FN) et la zone à
 * couvrir (profondeur visée, plafonnée à outingMax ; 6 m sans élève).
 */
export function teachingNeed(students: Diver[], outingMax: Depth = AUTO_MAX_DEPTH): { minTeach: TeachLevel; depth: Depth } {
  const minTeach = Math.max(1, ...students.map(minTeachFor)) as TeachLevel;
  const depth = students.length ? minDepth(outingMax, Math.min(60, ...students.map((d) => teachingDepthOf(d) || 6)) as Depth) : 6;
  return { minTeach, depth };
}

/** Peut enseigner à ces élèves : niveau E suffisant, zone qui couvre, pas lui-même en formation. */
export function canTeach(d: Aptitudes, students: Diver[], outingMax: Depth = AUTO_MAX_DEPTH): boolean {
  if (!d.teach || d.training) return false;
  const need = teachingNeed(students, outingMax);
  return d.teach >= need.minTeach && TEACH_MAX_DEPTH[d.teach] >= need.depth;
}

/**
 * Enseignant le moins qualifié qui suffit pour ces élèves (un E2 pour des FN1
 * à 20 m, pas un E3). Undefined si personne ne convient : pas de repli sur un
 * enseignant trop juste, le DP tranche.
 */
export function lowestTeacher(candidates: Diver[], students: Diver[], outingMax: Depth = AUTO_MAX_DEPTH): Diver | undefined {
  return candidates.filter((t) => canTeach(t, students, outingMax)).sort((a, b) => a.teach - b.teach)[0];
}

/**
 * Passe une palanquée en formation. Il faut un enseignant (E1…E4) : un N4/GP
 * n'enseigne jamais, ni un moniteur lui-même en formation. L'encadrant en
 * place reste s'il suffit ; sinon le moins qualifié qui suffit, parmi tous,
 * enseigne, et les autres plongent (un ancien plongeur supplémentaire aussi :
 * pas de slot GP suppl. en formation). Sans enseignant possible : à revoir.
 */
export function toTeaching(p: Palanquee): Palanquee {
  const everyone = [p.guide, ...p.members, p.extra].filter((d): d is Diver => !!d);
  const students = everyone.filter((d) => d.training || !isInstructor(d));
  const teacher = (p.guide && canTeach(p.guide, students) ? p.guide : lowestTeacher(everyone, students)) ?? null;
  return { ...p, kind: 'teaching', guide: teacher, extra: null, members: everyone.filter((d) => d !== teacher) };
}

/**
 * Exploration : encadrée s'il y a un encadrant, autonome sinon. Sans encadrant,
 * un plongeur supplémentaire n'a plus lieu d'être : il redevient plongeur.
 * Avec un élève FN#, la palanquée passe en formation (toTeaching). Une
 * formation dont l'enseignant manque, ne convient plus ou qui a un plongeur
 * supplémentaire est recomposée de même.
 */
export function settleKind(p: Palanquee): Palanquee {
  if (p.kind === 'teaching') return p.guide && canTeach(p.guide, studentsOf(p)) && !p.extra ? p : toTeaching(p);
  if (hasStudent(p)) return toTeaching(p);
  if (p.guide) return p.kind === 'guided' ? p : { ...p, kind: 'guided' };
  return { ...p, kind: 'autonomous', extra: null, members: p.extra ? [...p.members, p.extra] : p.members };
}

/**
 * Prérogative de la palanquée, d'après les aptitudes de ceux qui la composent :
 * PE12, PE20, PA20, PE40, PA40, PE60, PA60 (PE pour une palanquée encadrée ou
 * de formation, PA pour une autonome), ou « Débutants 6 m ». La profondeur max
 * retenue par le DP (chosenDepth) ne la change pas : un PE40 à 25 m reste PE40.
 */
export function prerogativeLabel(p: Palanquee): string {
  const d = depthOf(p);
  if (!d) return 'À revoir';
  if (p.kind === 'autonomous') return `PA${d}`;
  const students = p.kind === 'teaching' ? studentsOf(p) : p.members;
  if (d === 6 && students.length > 0 && students.every((m) => m.beginner && !m.pe)) return 'Débutants 6 m';
  return `PE${d}`;
}

/**
 * Prérogative la plus haute d'un plongeur : E1…E4 pour un enseignant (zone
 * d'enseignement 6, 20, 40, 60 m), GP pour un guide de palanquée qui
 * n'enseigne pas, sinon ses aptitudes PE / PA. Le niveau ou le diplôme (MF1,
 * DEJEPS, N2…) s'affiche à côté, tel que VPDive l'écrit (Diver.display) :
 * on ne le déduit jamais de la prérogative (un E3 peut être MF1 ou DEJEPS).
 * Vide si aucune aptitude n'est connue.
 */
export function prerogativeCode(d: Aptitudes): string {
  if (d.teach) return `E${d.teach}`;
  if (d.guide === 'GP') return 'GP';
  if (d.pa && d.pe > d.pa) return `PE${d.pe} · PA${d.pa}`;
  if (d.pa) return `PA${d.pa}`;
  if (d.pe) return `PE${d.pe}`;
  if (d.beginner) return 'Débutant';
  return '';
}

/** Moniteur : GP/N4 ou E1…E4. */
export const isInstructor = (d: Aptitudes): boolean => !!d.guide || d.teach > 0;

/**
 * Encadrant ou enseignant tel qu'il est noté, à l'écran, sur la fiche (colonne
 * APT) et dans l'export : E# en formation ; en exploration sa plus haute
 * prérogative (un E4 qui guide reste E4, un E2 est E2, un N4 est GP).
 */
export function guideLabel(d: Aptitudes, p: Palanquee): string {
  if (d.teach) return `E${d.teach}`;
  return p.kind !== 'teaching' && d.guide === 'GP' ? 'GP' : '?';
}

/**
 * Plongeur (membre) tel qu'il est noté, mêmes trois endroits. Hors encadrant
 * ou enseignant, tout le monde porte l'aptitude la plus faible du groupe, qui
 * est la prérogative de la palanquée : des PE40 avec un PE20 sont tous PE20,
 * un N2 PA20 avec trois E4 autonomes, tous PA20, un N4/GP qui assiste une
 * formation n'a pas de statut N4. Seule exception, un enseignant (E1…E4) qui
 * plonge dans une formation sans l'enseigner garde son statut E#. La formation
 * d'un élève n'est qu'un objectif, écrit en tête de palanquée (objectiveLabel).
 * Si la palanquée ne peut pas plonger telle quelle, chacun montre sa propre
 * aptitude, pour voir d'où vient le problème.
 */
export function memberLabel(d: Diver, p: Palanquee): string {
  if (p.kind === 'teaching' && d.teach && !d.training) return `E${d.teach}`;
  if (depthOf(p)) return prerogativeLabel(p);
  if (p.kind === 'autonomous') return d.pa ? `PA${d.pa}` : 'pas PA';
  if (d.pe) return `PE${d.pe}`;
  return d.beginner || d.training === 1 ? 'Débutant' : '?';
}

/** Plongeur supplémentaire (GP/N4 en exploration encadrée) : la prérogative de la palanquée, pas de statut N4. */
export const extraLabel = (p: Palanquee): string => prerogativeLabel(p);

/** Élèves d'une palanquée de formation : les moniteurs qui plongent avec eux ne comptent pas. */
export const studentsOf = (p: Palanquee): Diver[] => p.members.filter((m) => m.training || !isInstructor(m));

/** Ce qui rend une palanquée non conforme. Liste vide = conforme. */
export function validate(p: Palanquee, outingMax: Depth = 60): string[] {
  const issues: string[] = [];
  if (p.depth && p.depth > (depthOf(p, outingMax) || 0)) {
    issues.push(`${p.depth} m dépasse la prérogative de la palanquée (${depthOf(p, outingMax) || 0} m).`);
  }
  for (const m of [p.guide, p.extra, ...p.members]) {
    if (m?.child) issues.push(`${m.name} : plongeur enfant, conditions de pratique enfants à vérifier.`);
  }
  if (p.kind === 'teaching') {
    const students = studentsOf(p);
    if (!p.guide) issues.push('Pas d’enseignant.');
    else if (!p.guide.teach) issues.push(`${p.guide.name} n’est pas enseignant (E1, E2, E3 ou E4) : un N4/GP n’encadre pas de formation.`);
    else if (p.guide.training) issues.push(`${p.guide.name} est en formation (${trainingLabel(p.guide)}) : ne peut pas enseigner.`);
    else {
      const demanding = students.filter((s) => s.training && minTeachFor(s) > p.guide!.teach).sort((a, b) => minTeachFor(b) - minTeachFor(a))[0];
      if (demanding) issues.push(`${trainingLabel(demanding)} demande un E${minTeachFor(demanding)} au minimum (${p.guide.name} est E${p.guide.teach}).`);
    }
    if (students.length === 0) issues.push('Aucun élève.');
    if (students.length > 4) issues.push(`${students.length} élèves : 4 au maximum.`);
    // Un GP/N4 qui assiste une formation est simplement plongeur : pas de slot « GP suppl. » ici.
    if (p.extra) issues.push(`${p.extra.name} : pas de plongeur supplémentaire en formation, placez-le comme plongeur.`);
    for (const m of p.members) if (!teachingDepthOf(m)) issues.push(`${m.name} : niveau inconnu, à vérifier.`);
  } else if (p.kind === 'guided') {
    if (!p.guide) issues.push('Pas d’encadrant.');
    else if (!p.guide.guide) issues.push(`${p.guide.name} n’a pas de qualification d’encadrant connue.`);
    else if (!canGuideExploration(p.guide)) issues.push(`${p.guide.name} : un encadrant d’exploration est au minimum N4/GP.`);
    else if (p.guide.training) issues.push(`${p.guide.name} est en formation (${trainingLabel(p.guide)}) : ne peut pas encadrer.`);
    if (p.members.length === 0) issues.push('Aucun plongeur encadré.');
    if (p.members.length > 4) issues.push(`${p.members.length} plongeurs encadrés : 4 au maximum.`);
    if (p.extra && !p.extra.canBeExtra) issues.push(`${p.extra.name} doit être au moins GP/N4 pour être plongeur supplémentaire.`);
    // Avec un plongeur supplémentaire, depthOf plafonne déjà la palanquée à 40 m : rien à signaler ici.
    for (const m of p.members) {
      if (!guidedDepthOf(m)) issues.push(`${m.name} : niveau inconnu, à vérifier.`);
      if (m.training) issues.push(`${m.name} est en formation (${trainingLabel(m)}) : palanquée de formation avec un enseignant.`);
    }
  } else {
    if (p.members.length < 2) issues.push('Une palanquée autonome compte au moins 2 plongeurs.');
    if (p.members.length > 3) issues.push(`${p.members.length} plongeurs autonomes : 3 au maximum.`);
    for (const m of p.members) {
      if (!m.pa) issues.push(`${m.name} n’est pas autonome (aucune aptitude PA).`);
      if (m.minor || m.child) issues.push(`${m.name} est mineur : pas d’autonomie.`);
      if (m.training) issues.push(`${m.name} est en formation (${trainingLabel(m)}) : palanquée de formation avec un enseignant.`);
    }
  }
  return issues;
}

// ── Proposition automatique ──────────────────────────────────────

let seq = 0;
const newId = () => `p${++seq}`;

/** Découpe une liste triée en `k` groupes de tailles équilibrées, en gardant l'ordre. */
function balancedChunks<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  let i = 0;
  for (let g = 0; g < k; g++) {
    const size = Math.ceil((items.length - i) / (k - g));
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out.filter((c) => c.length > 0);
}

const byName = (a: Diver, b: Diver) => a.name.localeCompare(b.name, 'fr');

/**
 * Ce que perd un plongeur, en part de la profondeur à laquelle il pouvait
 * aller : un N1 ramené de 20 à 6 m perd 70 % de sa plongée, un N2 ramené de
 * 40 à 20 m en perd 50 %. En mètres bruts ce serait l'inverse (14 m contre
 * 20 m), alors qu'une plongée à 6 m n'a plus grand intérêt pour un N1.
 */
const depthLoss = (wanted: Depth, got: Depth) => (wanted - got) / wanted;

const groupDepth = (group: Diver[], outingMax: Depth): Depth =>
  minDepth(outingMax, Math.min(...group.map((d) => guidedDepthOf(d) || 6)) as Depth);

/**
 * Plongeurs encadrés répartis en groupes de 4 au plus, du plus profond au moins
 * profond, chaque groupe ne mêlant que des plongeurs de même profondeur tant
 * qu'il y a assez d'encadrants. Sinon on fusionne les deux niveaux voisins qui
 * coûtent le moins (nombre de plongeurs × depthLoss), jusqu'à tenir dans le
 * nombre d'encadrants. Ce qui ne tient toujours pas reste en
 * fin de liste et sera signalé comme non placé.
 */
function guidedGroups(divers: Diver[], guideCount: number, outingMax: Depth, depthFn: (d: Diver) => Depth | 0 = guidedDepthOf): Diver[][] {
  const tierOf = (d: Diver) => minDepth(outingMax, (depthFn(d) || 6) as Depth);
  let tiers = DEPTHS.slice()
    .reverse()
    .map((depth) => ({ depth, divers: divers.filter((d) => tierOf(d) === depth).sort(byName) }))
    .filter((t) => t.divers.length > 0);

  const needed = (ts: typeof tiers) => ts.reduce((n, t) => n + Math.ceil(t.divers.length / 4), 0);
  while (needed(tiers) > guideCount && tiers.length > 1) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < tiers.length - 1; i++) {
      const merged = [...tiers.slice(0, i), { depth: tiers[i + 1]!.depth, divers: [...tiers[i]!.divers, ...tiers[i + 1]!.divers] }, ...tiers.slice(i + 2)];
      if (needed(merged) >= needed(tiers)) continue;
      const cost = tiers[i]!.divers.length * depthLoss(tiers[i]!.depth, tiers[i + 1]!.depth);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best < 0) break;
    tiers = [
      ...tiers.slice(0, best),
      { depth: tiers[best + 1]!.depth, divers: [...tiers[best]!.divers, ...tiers[best + 1]!.divers] },
      ...tiers.slice(best + 2),
    ];
  }

  // Assez d'encadrants : groupes équilibrés (3+3 plutôt que 4+2). Sinon, groupes
  // pleins, pour laisser le moins possible de plongeurs sans palanquée.
  const short = needed(tiers) > guideCount;
  return tiers.flatMap((t) =>
    short
      ? Array.from({ length: Math.ceil(t.divers.length / 4) }, (_, i) => t.divers.slice(i * 4, i * 4 + 4))
      : balancedChunks(t.divers, Math.ceil(t.divers.length / 4)),
  );
}

/**
 * Propose des palanquées pour les inscrits d'une sortie, dans l'ordre que suit un DP :
 *   1. Les autonomes qui ne sont pas encadrants (PA-xx majeurs) se regroupent par
 *      prérogative : les PA-60 entre eux, puis les PA-40, les PA-20… par 2 ou 3.
 *   2. Les formations (FN#, élèves ce jour-là même s'ils sont moniteurs)
 *      reçoivent l'enseignant le moins qualifié qui suffit (E2 pour FN1, E3
 *      au-delà ; MIN_TEACH_FOR_TRAINING), sinon restent non placés.
 *   3. Les plongeurs encadrés (PE-xx, débutants, mineurs) reçoivent un N4/GP au
 *      moins (un E1 ne prend que des débutants, 0-6 m, en formation). S'il manque des
 *      encadrants, on réunit des niveaux et la palanquée prend la prérogative du
 *      moins formé : un PE-40 plonge alors à 20 m avec des N1.
 *   4. Avec plusieurs encadrants, on fait des palanquées plus petites plutôt que
 *      d'en mettre plusieurs ensemble : les encadrants en trop dédoublent les
 *      palanquées encadrées, puis plongent en autonomie, un par palanquée autant
 *      que possible, avec les autonomes du plus haut niveau.
 *   5. Les binômes demandés sont réunis quand un échange garde tout conforme.
 */
export function proposePalanquees(divers: Diver[], opts: PlanOptions = {}): Plan {
  const outingMax = opts.maxDepth ?? AUTO_MAX_DEPTH;
  const unassigned: Plan['unassigned'] = [];
  const palanquees: Palanquee[] = [];

  const guides: Diver[] = [];
  const autonomous: Diver[] = [];
  const trainees: Diver[] = [];
  const guided: Diver[] = [];
  for (const d of divers) {
    if (d.child) unassigned.push({ diver: d, reason: 'Plongeur enfant : conditions de pratique enfants, à placer à la main.' });
    // Élève ce jour-là, moniteur ou non : il n'encadre pas.
    else if (d.training) trainees.push(d);
    else if (d.guide && !d.minor) guides.push(d);
    else if (d.pa && !d.minor) autonomous.push(d);
    else if (guidedDepthOf(d)) guided.push(d);
    else unassigned.push({ diver: d, reason: 'Niveau inconnu : à placer à la main.' });
  }
  guides.sort((a, b) => GUIDE_RANK[a.guide!] - GUIDE_RANK[b.guide!] || a.teach - b.teach);

  let free = assignTeaching(trainees, guides, outingMax, palanquees, unassigned);
  free = assignGuided(guided, free, outingMax, palanquees, unassigned);
  free = splitWithSpareInstructors(palanquees, free, outingMax);

  const spare: Diver[] = [];
  for (const g of free) {
    if (g.pa) spare.push(g);
    else unassigned.push({ diver: g, reason: 'Encadrant sans palanquée à encadrer et sans aptitude d’autonomie connue.' });
  }
  groupAutonomous(autonomous, spare, outingMax, palanquees, unassigned);

  for (const [a, b] of opts.buddies ?? []) joinBuddies(palanquees, a, b, outingMax);
  return { palanquees, unassigned };
}

/**
 * Plongeurs encadrés : par groupes de 4 au plus, chacun avec l'encadrant le
 * moins qualifié qui suffit (N4/GP au moins). Les débutants vont d'abord aux
 * E1, en palanquée de formation. Renvoie les encadrants qui restent.
 */
function assignGuided(divers: Diver[], guides: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']): Diver[] {
  const free = [...guides];
  if (!divers.length) return free;
  const isGp = (g: Diver) => GUIDE_RANK[g.guide!] >= GUIDE_RANK.GP;

  // Les E1 prennent d'abord les débutants (0-6 m), seuls, par 4 : en formation, un E1 n'encadre pas en exploration.
  let rest = [...divers];
  const beginners = rest.filter((d) => guidedDepthOf(d) === 6).sort(byName);
  for (const e1 of free.filter((g) => !isGp(g))) {
    const group = beginners.splice(0, 4);
    if (!group.length) break;
    free.splice(free.indexOf(e1), 1);
    rest = rest.filter((d) => !group.includes(d));
    out.push({ id: newId(), kind: 'teaching', guide: e1, extra: null, members: group });
  }
  if (!rest.length) return free;

  // Les autres avec un N4/GP au moins.
  const gp = free.filter(isGp);
  if (!gp.length) {
    for (const d of rest) unassigned.push({ diver: d, reason: 'Aucun encadrant N4/GP inscrit.' });
    return free;
  }
  guidedGroups(rest, gp.length, outingMax).forEach((group) => {
    const need = groupDepth(group, outingMax);
    const candidates = free.filter(isGp);
    const guide = candidates.find((g) => GUIDE_MAX_DEPTH[g.guide!] >= need) ?? candidates[candidates.length - 1];
    if (!guide) {
      for (const d of group) unassigned.push({ diver: d, reason: 'Pas assez d’encadrants N4/GP (4 plongeurs encadrés au maximum par encadrant).' });
      return;
    }
    free.splice(free.indexOf(guide), 1);
    out.push({ id: newId(), kind: 'guided', guide, extra: null, members: group });
  });
  return free;
}

/**
 * Encadrants en trop : plutôt que de les mettre ensemble en autonomie, ils
 * dédoublent les palanquées encadrées ou de formation de 2 plongeurs ou plus
 * (la plus grande d'abord). L'encadrant en place garde la moitié la plus
 * profonde, le nouveau prend l'autre s'il en a la prérogative.
 */
function splitWithSpareInstructors(out: Palanquee[], free: Diver[], outingMax: Depth): Diver[] {
  const spare = [...free];
  const isGp = (g: Diver) => GUIDE_RANK[g.guide!] >= GUIDE_RANK.GP;
  for (let changed = true; changed && spare.length; ) {
    changed = false;
    const candidates = out.filter((p) => p.kind !== 'autonomous' && p.guide && p.members.length >= 2).sort((a, b) => b.members.length - a.members.length);
    for (const p of candidates) {
      const depthFn = p.kind === 'teaching' ? teachingDepthOf : guidedDepthOf;
      const need = (g: Diver[]) => minDepth(outingMax, Math.min(...g.map((d) => depthFn(d) || 6)) as Depth);
      const fits = (ins: Diver, g: Diver[]) =>
        p.kind === 'teaching' ? canTeach(ins, g, outingMax) : isGp(ins) && !ins.training && GUIDE_MAX_DEPTH[ins.guide!] >= need(g);
      const sorted = [...p.members].sort((a, b) => (depthFn(b) || 0) - (depthFn(a) || 0) || byName(a, b));
      const [deep, shallow] = balancedChunks(sorted, 2) as [Diver[], Diver[]];
      const pick = spare.filter((i) => fits(i, shallow)).sort((a, b) => GUIDE_RANK[a.guide!] - GUIDE_RANK[b.guide!] || a.teach - b.teach)[0];
      if (!pick || !fits(p.guide!, deep)) continue;
      p.members = deep;
      out.push({ id: newId(), kind: p.kind, guide: pick, extra: null, members: shallow });
      spare.splice(spare.indexOf(pick), 1);
      changed = true;
      break;
    }
  }
  return spare;
}

/**
 * Palanquées autonomes. Sans encadrant en trop : par prérogative (PA-60,
 * PA-40, PA-20…), 2 ou 3 par palanquée. Avec des encadrants en trop : des
 * palanquées de 2 (une de 3 si le nombre est impair), avec au plus un encadrant
 * chacune quand c'est possible ; les encadrants vont avec les autonomes du plus
 * haut niveau, pour ne brider personne.
 */
function groupAutonomous(autos: Diver[], instructors: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']) {
  const tierOf = (d: Diver) => minDepth(outingMax, d.pa as Depth);
  const byTierDesc = (a: Diver, b: Diver) => tierOf(b) - tierOf(a) || byName(a, b);
  const A = [...autos].sort(byTierDesc);
  const I = [...instructors].sort(byTierDesc);
  const total = A.length + I.length;
  if (!I.length || total < 2) return groupByTier([...A, ...I], outingMax, out, unassigned);

  const k = Math.floor(total / 2);
  if (I.length >= k) {
    // Chaque palanquée a son encadrant ; les autonomes s'y répartissent, puis les encadrants restants.
    const groups: Diver[][] = Array.from({ length: k }, () => [I.shift()!]);
    A.forEach((a, i) => groups[i % k]!.push(a));
    const instructorsIn = (g: Diver[]) => g.filter((d) => d.guide).length;
    for (const ins of I) {
      const target = groups.find((g) => g.length < 2) ?? [...groups].filter((g) => g.length < 3).sort((a, b) => instructorsIn(a) - instructorsIn(b))[0]!;
      target.push(ins);
    }
    for (const g of groups) out.push({ id: newId(), kind: 'autonomous', guide: null, extra: null, members: g });
    return;
  }
  // Moins d'encadrants que de palanquées : chacun fait binôme avec un autonome du plus haut niveau.
  for (const ins of I) out.push({ id: newId(), kind: 'autonomous', guide: null, extra: null, members: [ins, A.shift()!] });
  groupByTier(A, outingMax, out, unassigned);
}

/**
 * Autonomes par prérogative (PA-60, PA-40, PA-20, PA-12, plafonnée à la
 * profondeur automatique), 2 ou 3 par palanquée. Un plongeur seul à son niveau
 * descend au niveau suivant : sa palanquée prend la prérogative la plus basse.
 */
function groupByTier(pool: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']) {
  const tierOf = (d: Diver) => minDepth(outingMax, d.pa as Depth);
  let carry: Diver[] = [];
  for (const depth of [60, 40, 20, 12] as Depth[]) {
    const list = [...carry, ...pool.filter((d) => tierOf(d) === depth).sort(byName)];
    carry = [];
    if (list.length === 1) carry = list;
    else if (list.length > 1) {
      for (const group of balancedChunks(list, Math.ceil(list.length / 3))) {
        out.push({ id: newId(), kind: 'autonomous', guide: null, extra: null, members: group });
      }
    }
  }
  const lone = carry[0];
  if (!lone) return;
  // Seul : il rejoint une palanquée autonome de 2 (de préférence sans la faire
  // descendre), sinon plongeur supplémentaire s'il est GP, sinon encadré s'il reste une place.
  const autos = out.filter((p) => p.kind === 'autonomous' && p.members.length < 3);
  const host = autos.find((p) => (depthOf(p, outingMax) || 0) <= lone.pa) ?? autos[0];
  if (host) {
    host.members.push(lone);
    return;
  }
  const extraHost = lone.canBeExtra && out.find((p) => p.kind === 'guided' && !p.extra && depthOf(p, outingMax) <= 40);
  if (extraHost) {
    extraHost.extra = lone;
    return;
  }
  // Un GP/N4 seul peut assister une formation comme plongeur : hors des 4 élèves, à la prérogative de la palanquée.
  const teachingHost = lone.canBeExtra && out.find((p) => p.kind === 'teaching');
  if (teachingHost) {
    teachingHost.members.push(lone);
    return;
  }
  const guidedHost = guidedDepthOf(lone) && out.find((p) => p.kind === 'guided' && p.members.length < 4);
  if (guidedHost) guidedHost.members.push(lone);
  else unassigned.push({ diver: lone, reason: 'Seul autonome : il faut au moins 2 plongeurs pour une palanquée autonome.' });
}

/**
 * Palanquées de formation : élèves FN# regroupés par profondeur visée, 4 par
 * enseignant, avec l'enseignant le moins qualifié qui suffit (un E2 pour des
 * FN1 à 20 m, un E3 pour des FN2 à 40 m ; MIN_TEACH_FOR_TRAINING). Sans
 * enseignant qui convienne, le groupe reste non placé avec la raison. Renvoie
 * les encadrants qui restent pour l'exploration.
 */
function assignTeaching(trainees: Diver[], guides: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']): Diver[] {
  const free = [...guides];
  if (!trainees.length) return free;
  const count = free.filter((g) => g.teach > 0 && !g.training).length;
  if (!count) {
    for (const d of trainees) unassigned.push({ diver: d, reason: `En formation (${trainingLabel(d)}) : aucun enseignant (E1, E2, E3, E4) inscrit.` });
    return free;
  }
  for (const group of guidedGroups(trainees, count, outingMax, teachingDepthOf)) {
    const teacher = lowestTeacher(free, group, outingMax);
    if (!teacher) {
      const need = teachingNeed(group, outingMax);
      for (const d of group) {
        unassigned.push({ diver: d, reason: `En formation (${trainingLabel(d)}) : aucun enseignant disponible (E${need.minTeach} au minimum, zone ${need.depth} m, 4 élèves par enseignant).` });
      }
      continue;
    }
    free.splice(free.indexOf(teacher), 1);
    out.push({ id: newId(), kind: 'teaching', guide: teacher, extra: null, members: group });
  }
  return free;
}

/** Réunit deux binômes par un échange, si tout reste conforme et que personne ne perd de profondeur. */
function joinBuddies(list: Palanquee[], idA: string, idB: string, outingMax: Depth) {
  const find = (id: string) => list.find((p) => p.members.some((m) => m.id === id));
  const pa = find(idA);
  const pb = find(idB);
  if (!pa || !pb || pa === pb) return;
  const b = pb.members.find((m) => m.id === idB)!;
  const before = depthOf(pa, outingMax) + depthOf(pb, outingMax);

  for (const c of pa.members) {
    if (c.id === idA) continue;
    const nextA = { ...pa, members: pa.members.map((m) => (m === c ? b : m)) };
    const nextB = { ...pb, members: pb.members.map((m) => (m === b ? c : m)) };
    if (validate(nextA, outingMax).length || validate(nextB, outingMax).length) continue;
    if (depthOf(nextA, outingMax) + depthOf(nextB, outingMax) < before) continue;
    pa.members = nextA.members;
    pb.members = nextB.members;
    return;
  }
}
