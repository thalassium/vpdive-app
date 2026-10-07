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
    const level = Number(/\benseignant ([1-4])\b/.exec(s)?.[1] ?? 0);
    const teachAt = (n: TeachLevel) => {
      if (n > teach) teach = n;
    };
    if (has(/\binitiateur\b|\be1\b/) || level === 1) {
      initiateur = true;
      teachAt(1);
    }
    if (has(/\be2\b/) || level === 2) {
      initiateur = true;
      p4 = true;
      teachAt(2);
    }
    if (has(/\bmf1\b|\be3\b|\bmf as\b|moniteur federal (1|1er|premier)|\bbees ?1\b|\bdejeps\b|\bbpjeps\b/) || level === 3) {
      guide = higherGuide(guide, 'E3');
      teachAt(3);
    }
    if (has(/\bmf2\b|\be4\b|\bffm\b|moniteur federal (2|2e|second)|\bbees ?2\b|\bdesjeps\b/) || level === 4) {
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

    // Formation en cours : « FN2 », « Formation N2 », « Prépa niveau 2 »…
    const fn = /\bfn ?([1-4])\b|\b(?:formation|prepa(?:ration)?) (?:niveau |n ?|p ?)?([1-4])\b/.exec(s);
    if (fn) training = Math.max(training, Number(fn[1] ?? fn[2])) as TrainingLevel;

    if (has(/debutant|bapteme|pass decouverte|^p pp$|pass plongee/)) beginner = true;
    // Plongeurs enfants (Bronze, Argent, Or) : effectifs et profondeurs propres.
    if (has(/^(pbr|par|por)$|plongeur\(?s?e?\)? (de bronze|d argent|d or)\b/)) child = true;
  }

  if (p4) guide = higherGuide(guide, 'GP');
  if (initiateur) guide = higherGuide(guide, 'E1');
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

/** « PE 40 », « PA 20 », « Formation E3 · 40 m » : la prérogative sous laquelle la palanquée plonge. */
export function prerogativeLabel(p: Palanquee): string {
  const d = chosenDepth(p);
  if (!d) return 'À revoir';
  if (p.kind === 'teaching') return `Formation${p.guide?.teach ? ` E${p.guide.teach}` : ''} · ${d} m`;
  if (p.kind === 'guided') return d === 6 && p.members.every((m) => m.beginner) ? 'Débutants · 6 m' : `PE ${d}`;
  return `PA ${d}`;
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
const byAutonomyDesc = (a: Diver, b: Diver) => b.pa - a.pa || a.name.localeCompare(b.name, 'fr');

/**
 * Ce que perd un plongeur, en part de la profondeur à laquelle il pouvait
 * aller : un N1 ramené de 20 à 6 m perd 70 % de sa plongée, un N2 ramené de
 * 40 à 20 m en perd 50 %. En mètres bruts ce serait l'inverse (14 m contre
 * 20 m), alors qu'une plongée à 6 m n'a plus grand intérêt pour un N1.
 */
const depthLoss = (wanted: Depth, got: Depth) => (wanted - got) / wanted;
const UNPLACED_COST = 10;

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
 * Propose des palanquées pour les inscrits d'une sortie.
 *
 * Principe, dans l'ordre :
 *   1. Ceux qui ne sont pas autonomes (débutants, N1, PE-xx seuls) doivent être encadrés.
 *   2. Ceux dont l'autonomie est inférieure à la profondeur prévue (un N2 sur une
 *      sortie à 40 m) sont encadrés s'il y a assez d'encadrants, autonomes sinon.
 *   3. Les plongeurs encadrés sont regroupés par aptitude (4 au plus par encadrant)
 *      et chaque groupe reçoit l'encadrant le moins qualifié qui lui permet
 *      d'atteindre sa profondeur, pour garder les plus qualifiés aux plus profonds.
 *   4. Les autres forment des palanquées autonomes de 2 ou 3, par aptitude.
 *   5. Les binômes demandés sont réunis quand un échange garde tout conforme
 *      et ne fait perdre de profondeur à personne.
 */
export function proposePalanquees(divers: Diver[], opts: PlanOptions = {}): Plan {
  const outingMax = opts.maxDepth ?? 40;
  const unassigned: Plan['unassigned'] = [];

  const allGuides = divers.filter((d) => d.guide).sort((a, b) => GUIDE_RANK[a.guide!] - GUIDE_RANK[b.guide!] || a.teach - b.teach);
  const others = divers.filter((d) => !d.guide);
  const palanquees: Palanquee[] = [];

  // 1. Formations d'abord : elles demandent un enseignant (E1…E4), plus rare
  //    qu'un GP. Les enseignants restants encadrent ensuite les explorations.
  const trainees = others.filter((d) => d.training && !d.child);
  const guides = assignTeaching(trainees, allGuides, outingMax, palanquees, unassigned);

  const mustGuide: Diver[] = [];
  const optionalGuide: Diver[] = [];
  let autonomous: Diver[] = [];
  for (const d of others) {
    const wanted = minDepth(outingMax, (guidedDepthOf(d) || 6) as Depth);
    if (d.training && !d.child) continue;
    if (d.child) {
      unassigned.push({ diver: d, reason: 'Plongeur enfant : conditions de pratique enfants, à placer à la main.' });
    } else if (!d.pa || d.minor) {
      if (!guidedDepthOf(d)) unassigned.push({ diver: d, reason: 'Niveau inconnu : à placer à la main.' });
      else mustGuide.push(d);
    } else if (d.pa < wanted) optionalGuide.push(d);
    else autonomous.push(d);
  }

  // Encadrer ou non ceux qui ont le choix (un N2 sur une sortie à 40 m) : on
  // essaie de rendre à l'autonomie 0, 1, 2… d'entre eux, les plus autonomes
  // d'abord, et on garde la répartition où les plongeurs perdent le moins de
  // profondeur, en proportion de ce qu'ils pouvaient faire (cf. depthLoss).
  // Un plongeur laissé sans palanquée coûte plus que n'importe quelle perte.
  const wanted = (d: Diver) => minDepth(outingMax, (guidedDepthOf(d) || 6) as Depth);
  optionalGuide.sort((a, b) => a.pa - b.pa);
  let best: { cost: number; guided: Diver[]; back: Diver[]; groups: Diver[][] } | null = null;
  for (let k = 0; k <= optionalGuide.length; k++) {
    const guided = [...mustGuide, ...optionalGuide.slice(0, optionalGuide.length - k)];
    const back = optionalGuide.slice(optionalGuide.length - k);
    const groups = guides.length && guided.length ? guidedGroups(guided, guides.length, outingMax) : [];
    let cost = guides.length ? 0 : guided.length * UNPLACED_COST;
    groups.forEach((group, i) => {
      if (i >= guides.length) cost += group.length * UNPLACED_COST;
      else for (const d of group) cost += depthLoss(wanted(d), groupDepth(group, outingMax));
    });
    for (const d of back) cost += depthLoss(wanted(d), minDepth(outingMax, d.pa as Depth));
    if (!best || cost < best.cost) best = { cost, guided, back, groups };
  }
  const guided = best!.guided;
  autonomous.push(...best!.back);

  const freeGuides = [...guides];

  if (guided.length && !freeGuides.length) {
    for (const d of guided) unassigned.push({ diver: d, reason: 'Aucun encadrant inscrit.' });
  } else if (guided.length) {
    const groups = best!.groups;
    const placed = groups.slice(0, freeGuides.length);
    for (const d of groups.slice(freeGuides.length).flat()) {
      unassigned.push({ diver: d, reason: 'Pas assez d’encadrants (4 plongeurs encadrés au maximum par encadrant).' });
    }
    // Du plus profond au moins profond ; l'encadrant le moins qualifié qui suffit.
    for (const group of placed) {
      const need = groupDepth(group, outingMax);
      let idx = freeGuides.findIndex((g) => GUIDE_MAX_DEPTH[g.guide!] >= need);
      if (idx < 0) idx = freeGuides.length - 1; // le plus qualifié restant : profondeur réduite
      const [guide] = freeGuides.splice(idx, 1);
      palanquees.push({ id: newId(), kind: 'guided', guide: guide!, extra: null, members: group });
    }
  }

  // Encadrants non utilisés : ils plongent en autonomie avec les autres.
  autonomous = [...autonomous, ...freeGuides.filter((g) => g.pa > 0)];
  for (const g of freeGuides.filter((g) => !g.pa)) {
    unassigned.push({ diver: g, reason: 'Encadrant sans palanquée à encadrer et sans aptitude d’autonomie connue.' });
  }

  const auto = [...autonomous].sort(byAutonomyDesc);
  if (auto.length === 1) {
    const lone = auto[0]!;
    // Seul autonome : plongeur supplémentaire (*) s'il est GP/N4, sinon encadré s'il reste une place.
    const host =
      (lone.canBeExtra && palanquees.find((p) => p.kind === 'guided' && !p.extra && depthOf(p, outingMax) <= 40)) ||
      palanquees.find((p) => p.kind === 'guided' && p.members.length < 4);
    if (host && lone.canBeExtra && !host.extra && depthOf(host, outingMax) <= 40) host.extra = lone;
    else if (host && host.members.length < 4) host.members.push(lone);
    else unassigned.push({ diver: lone, reason: 'Seul autonome : il faut au moins 2 plongeurs pour une palanquée autonome.' });
  } else if (auto.length > 1) {
    for (const group of balancedChunks(auto, Math.ceil(auto.length / 3))) {
      palanquees.push({ id: newId(), kind: 'autonomous', guide: null, extra: null, members: group });
    }
  }

  for (const [a, b] of opts.buddies ?? []) joinBuddies(palanquees, a, b, outingMax);

  return { palanquees, unassigned };
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
