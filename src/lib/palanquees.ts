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
export const GUIDE_LABEL: Record<GuideLevel, string> = {
  E1: 'E1 · Initiateur',
  GP: 'GP / N4',
  E3: 'E3 · MF1',
  E4: 'E4 · MF2',
};

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

export interface Aptitudes {
  /** Profondeur max en palanquée encadrée (0 = aucune aptitude connue). */
  pe: Depth | 0;
  /** Profondeur max en autonomie (0 = pas autonome). */
  pa: Depth | 0;
  guide: GuideLevel | null;
  /** Prérogative d'enseignement (E1…E4), 0 si aucune. */
  teach: TeachLevel;
  /** En formation (FN#), 0 sinon. */
  training: TrainingLevel;
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
   * Profondeur retenue par le DP pour cette palanquée. Absente : la prérogative
   * maximale de la palanquée, plafonnée à 40 m (AUTO_MAX_DEPTH).
   */
  depth?: Depth;
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

  for (const raw of labels) {
    const s = norm(raw);
    const has = (re: RegExp) => re.test(s);

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

  return { pe, pa, guide, teach, training, beginner, child, canBeExtra: !!guide && GUIDE_RANK[guide] >= GUIDE_RANK.GP };
}

/**
 * Prérogative la plus haute d'un plongeur, telle qu'on l'écrit sur la fiche de
 * sécurité (colonne APT) : niveau E ou GP pour les encadrants, FN# pour un
 * élève, PA/PE pour les autres. Un N4 + MF1 est noté E3.
 */
export function aptLabel(d: Aptitudes): string {
  if (d.training) return `FN${d.training}`;
  if (d.teach >= 3) return `E${d.teach}`;
  if (d.guide === 'GP') return d.teach === 2 ? 'E2 / GP' : 'GP';
  if (d.teach === 1) return d.pa ? `E1 · PA${d.pa}` : 'E1';
  if (d.pa) return d.pe > d.pa ? `PA${d.pa} / PE${d.pe}` : `PA${d.pa}`;
  if (d.pe) return `PE${d.pe}`;
  if (d.beginner) return 'Débutant';
  return '?';
}

// ── Règles d'une palanquée ───────────────────────────────────────

/** Profondeur à laquelle un plongeur peut être emmené en palanquée encadrée. */
const guidedDepthOf = (d: Diver): Depth | 0 => (d.pe > 0 ? d.pe : d.beginner ? 6 : 0);

/** Profondeur visée par un plongeur dans une palanquée de formation. */
const teachingDepthOf = (d: Diver): Depth | 0 => (d.training ? TRAINING_TARGET[d.training] : guidedDepthOf(d));

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
 * Profondeur à laquelle la palanquée plonge : celle choisie par le DP si elle
 * respecte la prérogative, sinon la prérogative plafonnée à 40 m.
 */
export function chosenDepth(p: Palanquee): Depth | 0 {
  const legal = depthOf(p);
  if (!legal) return 0;
  return p.depth && p.depth <= legal ? p.depth : minDepth(legal, AUTO_MAX_DEPTH);
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
 * Exploration : encadrée s'il y a un encadrant, autonome sinon. Sans encadrant,
 * un plongeur supplémentaire n'a plus lieu d'être : il redevient plongeur.
 */
export function settleKind(p: Palanquee): Palanquee {
  if (p.kind === 'teaching') return p;
  if (p.guide) return p.kind === 'guided' ? p : { ...p, kind: 'guided' };
  return { ...p, kind: 'autonomous', extra: null, members: p.extra ? [...p.members, p.extra] : p.members };
}

/**
 * Prérogative sous laquelle la palanquée plonge : PE12, PE20, PA20, PE40,
 * PA40, PE60, PA60 (PE pour une palanquée encadrée ou de formation, PA pour une
 * autonome), ou « Débutants 6 m ».
 */
export function prerogativeLabel(p: Palanquee): string {
  const d = chosenDepth(p);
  if (!d) return 'À revoir';
  if (p.kind === 'autonomous') return `PA${d}`;
  if (d === 6 && p.members.every((m) => m.beginner && !m.pe)) return 'Débutants 6 m';
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

/** Ce qui rend une palanquée non conforme. Liste vide = conforme. */
export function validate(p: Palanquee, outingMax: Depth = 60): string[] {
  const issues: string[] = [];
  if (p.depth && p.depth > (depthOf(p, outingMax) || 0)) {
    issues.push(`${p.depth} m dépasse la prérogative de la palanquée (${depthOf(p, outingMax) || 0} m).`);
  }
  if (p.kind === 'teaching') {
    if (!p.guide) issues.push('Pas d’enseignant.');
    else if (!p.guide.teach) issues.push(`${p.guide.name} n’est pas enseignant (E1, E2, E3 ou E4).`);
    if (p.members.length === 0) issues.push('Aucun élève.');
    if (p.members.length > 4) issues.push(`${p.members.length} élèves : 4 au maximum.`);
    if (p.extra && !p.extra.canBeExtra) issues.push(`${p.extra.name} doit être au moins GP/N4 pour être plongeur supplémentaire.`);
    for (const m of p.members) if (!teachingDepthOf(m)) issues.push(`${m.name} : niveau inconnu, à vérifier.`);
    if (p.extra && depthOf(p, outingMax) > 40) issues.push('Pas de plongeur supplémentaire au-delà de 40 m.');
  } else if (p.kind === 'guided') {
    if (!p.guide) issues.push('Pas d’encadrant.');
    else if (!p.guide.guide) issues.push(`${p.guide.name} n’a pas de qualification d’encadrant connue.`);
    if (p.members.length === 0) issues.push('Aucun plongeur encadré.');
    if (p.members.length > 4) issues.push(`${p.members.length} plongeurs encadrés : 4 au maximum.`);
    if (p.extra && !p.extra.canBeExtra) issues.push(`${p.extra.name} doit être au moins GP/N4 pour être plongeur supplémentaire.`);
    for (const m of p.members) {
      if (!guidedDepthOf(m)) issues.push(`${m.name} : niveau inconnu, à vérifier.`);
      if (m.training) issues.push(`${m.name} est en formation (FN${m.training}) : palanquée de formation avec un enseignant.`);
    }
    const depth = depthOf(p, outingMax);
    if (p.extra && depth > 40) issues.push('Pas de plongeur supplémentaire au-delà de 40 m.');
  } else {
    if (p.members.length < 2) issues.push('Une palanquée autonome compte au moins 2 plongeurs.');
    if (p.members.length > 3) issues.push(`${p.members.length} plongeurs autonomes : 3 au maximum.`);
    for (const m of p.members) {
      if (!m.pa) issues.push(`${m.name} n’est pas autonome (aucune aptitude PA).`);
      if (m.minor || m.child) issues.push(`${m.name} est mineur : pas d’autonomie.`);
      if (m.training) issues.push(`${m.name} est en formation (FN${m.training}) : palanquée de formation avec un enseignant.`);
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
 *   2. Les formations (FN#) reçoivent un enseignant E1/E2/E3 dont la zone suffit.
 *   3. Les plongeurs encadrés (PE-xx, débutants, mineurs) reçoivent un N4/GP au
 *      moins (un E1 n'encadre que des débutants, 0-6 m). S'il manque des
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

  const guides = divers.filter((d) => d.guide).sort((a, b) => GUIDE_RANK[a.guide!] - GUIDE_RANK[b.guide!] || a.teach - b.teach);
  const autonomous: Diver[] = [];
  const trainees: Diver[] = [];
  const guided: Diver[] = [];
  for (const d of divers.filter((x) => !x.guide)) {
    if (d.child) unassigned.push({ diver: d, reason: 'Plongeur enfant : conditions de pratique enfants, à placer à la main.' });
    else if (d.training) trainees.push(d);
    else if (d.pa && !d.minor) autonomous.push(d);
    else if (guidedDepthOf(d)) guided.push(d);
    else unassigned.push({ diver: d, reason: 'Niveau inconnu : à placer à la main.' });
  }

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
 * moins qualifié qui suffit (N4/GP au moins ; un E1 seulement pour des
 * débutants). Renvoie les encadrants qui restent.
 */
function assignGuided(divers: Diver[], guides: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']): Diver[] {
  const free = [...guides];
  if (!divers.length) return free;
  const isGp = (g: Diver) => GUIDE_RANK[g.guide!] >= GUIDE_RANK.GP;

  // Les E1 prennent d'abord les débutants (0-6 m), seuls, par 4.
  let rest = [...divers];
  const beginners = rest.filter((d) => guidedDepthOf(d) === 6).sort(byName);
  for (const e1 of free.filter((g) => !isGp(g))) {
    const group = beginners.splice(0, 4);
    if (!group.length) break;
    free.splice(free.indexOf(e1), 1);
    rest = rest.filter((d) => !group.includes(d));
    out.push({ id: newId(), kind: 'guided', guide: e1, extra: null, members: group });
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
        p.kind === 'teaching'
          ? ins.teach > 0 && TEACH_MAX_DEPTH[ins.teach as 1] >= need(g)
          : (isGp(ins) || need(g) === 6) && GUIDE_MAX_DEPTH[ins.guide!] >= need(g);
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
  const extraHost = lone.canBeExtra && out.find((p) => p.kind !== 'autonomous' && !p.extra && depthOf(p, outingMax) <= 40);
  if (extraHost) {
    extraHost.extra = lone;
    return;
  }
  const guidedHost = guidedDepthOf(lone) && out.find((p) => p.kind === 'guided' && p.members.length < 4);
  if (guidedHost) guidedHost.members.push(lone);
  else unassigned.push({ diver: lone, reason: 'Seul autonome : il faut au moins 2 plongeurs pour une palanquée autonome.' });
}

/**
 * Palanquées de formation : élèves FN# regroupés par profondeur visée, 4 par
 * enseignant, avec l'enseignant le moins qualifié dont la zone suffit (un E2
 * pour des FN1 à 20 m, un E3 pour des FN2 à 40 m). Renvoie les encadrants
 * qui restent pour l'exploration.
 */
function assignTeaching(trainees: Diver[], guides: Diver[], outingMax: Depth, out: Palanquee[], unassigned: Plan['unassigned']): Diver[] {
  const free = [...guides];
  if (!trainees.length) return free;
  const teachers = () => free.filter((g) => g.teach > 0).sort((a, b) => a.teach - b.teach);
  const count = teachers().length;
  if (!count) {
    for (const d of trainees) unassigned.push({ diver: d, reason: `En formation (FN${d.training}) : aucun enseignant (E1, E2, E3) inscrit.` });
    return free;
  }
  const groups = guidedGroups(trainees, count, outingMax, teachingDepthOf);
  groups.forEach((group, i) => {
    if (i >= count) {
      for (const d of group) unassigned.push({ diver: d, reason: `En formation (FN${d.training}) : pas assez d’enseignants (4 élèves au maximum par enseignant).` });
      return;
    }
    const need = minDepth(outingMax, Math.min(...group.map((d) => teachingDepthOf(d) || 6)) as Depth);
    const list = teachers();
    const teacher = list.find((t) => TEACH_MAX_DEPTH[t.teach as 1] >= need) ?? list[list.length - 1]!;
    free.splice(free.indexOf(teacher), 1);
    out.push({ id: newId(), kind: 'teaching', guide: teacher, extra: null, members: group });
  });
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
