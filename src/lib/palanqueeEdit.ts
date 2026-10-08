/**
 * Ajustements manuels d'une proposition de palanquées, et passage des inscrits
 * VPDive aux plongeurs du moteur. Fonctions pures : chaque opération renvoie un
 * nouveau plan, l'écran revalide tout après chaque changement.
 */
import { aptitudesFromLabels, canGuideExploration, canTeach, extraLabel, guideLabel, isInstructor, kindLabel, memberLabel, prerogativeLabel, settleKind, studentsOf, toTeaching, type Aptitudes, type Diver, type PalanqueeKind, type PalanqueeType, type Plan, type Palanquee } from './palanquees';
import { rankByName } from './fuzzy';
import type { RosterEntry } from '../services/vpdiveApi';

/**
 * Prérogative retenue à la main par le DP. Indispensable pour un brevet d'une
 * autre école (PADI, SSI…), qui n'en donne aucune : c'est elle qui place le
 * plongeur dans les palanquées. Le niveau VPDive d'origine reste affiché.
 */
export const PREROGATIVE_OPTIONS = {
  divers: ['Débutant', 'PE12', 'PE20', 'PA20', 'PE40', 'PE40 · PA20', 'PA40', 'PE60', 'PA60'],
  instructors: ['GP', 'E1', 'E2', 'E3', 'E4'],
} as const;

/**
 * Formation en cours, en plus de la prérogative : vers un niveau (un Open Water
 * retenu PE20 qui prépare son niveau 2 est FN2, palanquée de formation PE40),
 * ou vers une aptitude précise quand on la connaît (FPA20 pour un PE40 qui
 * passe son PA20 : zone 20 m, un E2 suffit).
 */
export const TRAINING_OPTIONS = ['FN1', 'FN2', 'FN3', 'FN4', 'FPA20', 'FPE40', 'FPA40', 'FPE60', 'FPA60'] as const;
/** Le menu Formation : par niveau, le niveau entier puis ses aptitudes, dans l'ordre où elles se passent. */
export const TRAINING_MENU: { title: string; options: { value: (typeof TRAINING_OPTIONS)[number]; label: string }[] }[] = [
  { title: 'Niveau 1', options: [{ value: 'FN1', label: 'Niveau 1' }] },
  { title: 'Niveau 2', options: [{ value: 'FN2', label: 'Niveau 2' }, { value: 'FPA20', label: 'PA20' }, { value: 'FPE40', label: 'PE40' }] },
  { title: 'Niveau 3', options: [{ value: 'FN3', label: 'Niveau 3' }, { value: 'FPA40', label: 'PA40' }, { value: 'FPE60', label: 'PE60' }, { value: 'FPA60', label: 'PA60' }] },
  { title: 'Niveau 4', options: [{ value: 'FN4', label: 'Niveau 4' }] },
];
type Training = (typeof TRAINING_OPTIONS)[number];

/**
 * Ordre des formations, par bloc de prérequis :
 * N1 · PA20 = PE40 · N2 · PA40 · PE60 = PA60 · N3 · N4.
 */
const TRAINING_RANK: Record<Training, number> = { FN1: 1, FPA20: 2, FPE40: 2, FN2: 3, FPA40: 4, FPE60: 5, FPA60: 5, FN3: 6, FN4: 7 };

/** Ce que la prérogative du plongeur lui donne déjà : inutile de s'y former. */
function holds(t: Training, a: Pick<Aptitudes, 'pe' | 'pa' | 'guide'>): boolean {
  switch (t) {
    case 'FN1':
      return a.pe >= 20;
    case 'FPA20':
      return a.pa >= 20;
    case 'FPE40':
      return a.pe >= 40;
    case 'FN2':
      return a.pe >= 40 && a.pa >= 20;
    case 'FPA40':
      return a.pa >= 40;
    case 'FPE60':
      return a.pe >= 60;
    case 'FPA60':
      return a.pa >= 60;
    case 'FN3':
      return a.pe >= 60 && a.pa >= 60;
    case 'FN4':
      return a.guide === 'GP' || a.guide === 'E3' || a.guide === 'E4';
  }
}

/**
 * Formations proposées à un plongeur : celles qu'il n'a pas encore, à partir
 * de son niveau — un PA20 ne voit ni le Niveau 1, ni le PA20, mais voit le
 * PE40 (même bloc) et la suite. Sans niveau connu : toutes.
 */
export function trainingMenuFor(a: Pick<Aptitudes, 'pe' | 'pa' | 'guide'>): typeof TRAINING_MENU {
  const rank = Math.max(0, ...TRAINING_OPTIONS.filter((t) => holds(t, a)).map((t) => TRAINING_RANK[t]));
  return TRAINING_MENU.map((g) => ({ ...g, options: g.options.filter((o) => !holds(o.value, a) && TRAINING_RANK[o.value] >= rank) })).filter((g) => g.options.length > 0);
}

/** « N2 », « PA20 » : la formation telle qu'on la lit sur le bouton. */
export const trainingShort = (value: string): string => (value.startsWith('FN') ? `N${value.slice(2)}` : value.slice(1));
/** « Pas en formation » choisi par le DP : l'emporte sur une prépa VPDive. */
export const NO_TRAINING = 'none';

export interface DiverSettings {
  /** id → prérogative retenue à la main (remplace celle de VPDive, dont les niveaux restent affichés) */
  levels?: Record<string, string>;
  /** id → formation en cours (FN1…FN4, FPA20…), en plus de la prérogative */
  training?: Record<string, string>;
  /** Liste des plongeurs validée par le DP : prérogatives connues, formations indiquées. Débloque les palanquées. */
  confirmed?: boolean;
  /** En liste d'attente sur VPDive, mais pris quand même par le DP (coché dans « Qui plonge ? »). */
  fromWaitingList?: string[];
}

/** Fixe (ou efface avec '') la prérogative retenue ou la formation d'un plongeur, sans toucher à l'autre. */
export function setDiverChoice(settings: DiverSettings, kind: 'levels' | 'training', id: string, value: string): DiverSettings {
  const next = { ...(settings[kind] ?? {}) };
  if (value) next[id] = value;
  else delete next[id];
  return { ...settings, [kind]: next };
}

export function rosterToDivers(roster: RosterEntry[], settings: DiverSettings = {}): Diver[] {
  return roster.map((r) => {
    const forced = settings.levels?.[r.id];
    const base = forced ? [forced] : r.levels;
    // Les « prépas » VPDive comptent aussi (« Prépa N2 » vaut FN2), sauf si le DP
    // a choisi « Pas en formation » pour cette sortie (NO_TRAINING). Un encadrant
    // n'est jamais en formation : ni F#, ni prépa.
    const instructor = isInstructor(aptitudesFromLabels(base));
    const choice = instructor ? NO_TRAINING : settings.training?.[r.id];
    const fn = choice === NO_TRAINING ? undefined : choice;
    const labels = [...base, ...(fn ? [fn] : choice === NO_TRAINING ? [] : r.training)];
    return {
      id: r.id,
      name: r.name,
      firstname: r.firstname,
      lastname: r.lastname,
      ...(r.picture ? { picture: r.picture } : {}),
      labels: fn ? [...base, fn] : base,
      display: r.display,
      ...(forced ? { original: r.display } : {}),
      minor: r.age !== null && r.age < 18,
      ...aptitudesFromLabels(labels),
    };
  });
}

/**
 * Remet à jour les plongeurs d'une composition avec leurs réglages actuels
 * (prérogative retenue, formation…), à leur place. Sans cela, un choix fait
 * après la génération ne se verrait qu'en refaisant les palanquées. Un plongeur
 * passé en formation (FN#) fait passer sa palanquée en formation (settleKind).
 */
export function refreshDivers(plan: Plan, divers: Diver[]): Plan {
  const byId = new Map(divers.map((d) => [d.id, d]));
  const fresh = <T extends Diver | null>(d: T): T => (d ? ((byId.get(d.id) ?? d) as T) : d);
  return {
    palanquees: plan.palanquees.map((p) => settleKind({ ...p, guide: fresh(p.guide), extra: fresh(p.extra), members: p.members.map(fresh) })),
    unassigned: plan.unassigned.map((u) => ({ ...u, diver: fresh(u.diver) })),
  };
}

/** « Binôme souhaité : Jean Dupond » écrit à l'inscription (lib/gear.ts), rapproché des inscrits. */
export function buddyPairs(roster: RosterEntry[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const r of roster) {
    const m = /Binôme souhaité\s*:\s*(.+)/i.exec(r.comment);
    if (!m) continue;
    const others = roster.filter((o) => o.id !== r.id);
    const best = rankByName(m[1]!.trim(), others, (o) => o.name, 0.75)[0];
    if (best && !pairs.some(([a, b]) => (a === best.item.id && b === r.id) || (a === r.id && b === best.item.id))) {
      pairs.push([r.id, best.item.id]);
    }
  }
  return pairs;
}

const without = (p: Palanquee, id: string): Palanquee => ({
  ...p,
  guide: p.guide?.id === id ? null : p.guide,
  extra: p.extra?.id === id ? null : p.extra,
  members: p.members.filter((m) => m.id !== id),
});

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${++seq}`;

/** Déplace un plongeur vers une palanquée, une nouvelle palanquée, ou les non placés. */
export function moveDiver(plan: Plan, diver: Diver, target: string | 'new' | 'unassigned'): Plan {
  let palanquees = plan.palanquees.map((p) => without(p, diver.id));
  const unassigned = plan.unassigned.filter((u) => u.diver.id !== diver.id);

  if (target === 'unassigned') unassigned.push({ diver, reason: 'Retiré à la main.' });
  else if (target === 'new') {
    // Une nouvelle palanquée d'exploration : son encadrant s'il peut l'être (N4/GP au moins, pas en formation), sinon un premier plongeur.
    const leads = canGuideExploration(diver) && !diver.training;
    palanquees.push({ id: newId(), kind: 'autonomous', guide: leads ? diver : null, extra: null, members: leads ? [] : [diver] });
  } else {
    palanquees = palanquees.map((p) => (p.id === target ? { ...p, members: [...p.members, diver] } : p));
  }
  // Une palanquée vidée reste en place : le DP la remplit ou la supprime (deletePalanquee).
  return { palanquees: palanquees.map(settleKind), unassigned };
}

/**
 * Nouvelle palanquée vide, à remplir à la main. Sans composition encore (rien
 * de généré), tous ceux qui plongent partent de la liste des disponibles.
 */
export function addPalanquee(plan: Plan | null, available: Diver[], kind: PalanqueeKind = 'autonomous'): Plan {
  const base: Plan = plan ?? { palanquees: [], unassigned: available.map((diver) => ({ diver, reason: 'À placer.' })) };
  return { ...base, palanquees: [...base.palanquees, { id: newId(), kind, guide: null, extra: null, members: [] }] };
}

/** Supprime une palanquée : encadrant, plongeur supplémentaire et plongeurs redeviennent disponibles. */
export function deletePalanquee(plan: Plan, palanqueeId: string): Plan {
  const gone = plan.palanquees.find((p) => p.id === palanqueeId);
  if (!gone) return plan;
  const freed = [gone.guide, gone.extra, ...gone.members].filter((d): d is Diver => !!d);
  return {
    palanquees: plan.palanquees.filter((p) => p.id !== palanqueeId),
    unassigned: [...plan.unassigned, ...freed.map((diver) => ({ diver, reason: 'Palanquée supprimée.' }))],
  };
}

/** Peut prendre la tête de cette palanquée : jamais un élève ; en formation un enseignant qui suffit à ses élèves, en exploration un N4/GP au moins. */
const canLead = (d: Diver, p: Palanquee): boolean => !d.training && (p.kind === 'teaching' ? canTeach(d, studentsOf(p)) : canGuideExploration(d));

/**
 * Désigne l'encadrant (ou l'enseignant) d'une palanquée, qu'il vienne d'une
 * autre palanquée, des disponibles ou de la palanquée elle-même. Une
 * palanquée autonome devient encadrée. S'il encadrait une autre palanquée,
 * l'ancien encadrant d'ici prend sa place là-bas quand il le peut (deux E3
 * échangent leurs palanquées en un seul déplacement) ; sinon il redevient
 * disponible (un E2 ne reprend pas une formation FN3).
 */
export function assignGuide(plan: Plan, palanqueeId: string, diver: Diver): Plan {
  const previous = plan.palanquees.find((p) => p.id === palanqueeId)?.guide;
  if (previous?.id === diver.id) return plan;
  const origin = plan.palanquees.find((p) => p.id !== palanqueeId && p.guide?.id === diver.id);
  const swap = previous && origin && canLead(previous, { ...origin, guide: null }) ? { to: origin.id, guide: previous } : null;
  const palanquees = plan.palanquees
    .map((p) => without(p, diver.id))
    .map((p) => (p.id === palanqueeId ? { ...p, guide: diver } : swap && p.id === swap.to ? { ...p, guide: swap.guide } : p))
    .map(settleKind);
  const unassigned = plan.unassigned.filter((u) => u.diver.id !== diver.id);
  if (previous && !swap) unassigned.push({ diver: previous, reason: 'Remplacé comme encadrant.' });
  return { palanquees, unassigned };
}

/**
 * Change le type d'une palanquée : Formation ou Exploration. En formation, il
 * faut un enseignant : l'encadrant s'il suffit, sinon le moins qualifié qui
 * suffit parmi tous (toTeaching). En exploration, elle est encadrée ou
 * autonome selon qu'elle a un encadrant (settleKind).
 */
export function setType(plan: Plan, palanqueeId: string, type: PalanqueeType): Plan {
  return mapPal(plan, palanqueeId, (p) => (type === 'exploration' ? settleKind({ ...p, kind: p.guide ? 'guided' : 'autonomous' }) : toTeaching(p)));
}

/** Retire l'encadrant : il redevient disponible, la palanquée d'exploration devient autonome. */
export function removeGuide(plan: Plan, palanqueeId: string): Plan {
  const p = plan.palanquees.find((x) => x.id === palanqueeId);
  if (!p?.guide) return plan;
  return {
    palanquees: plan.palanquees.map((x) => (x.id === palanqueeId ? settleKind({ ...x, guide: null }) : x)),
    unassigned: [...plan.unassigned, { diver: p.guide, reason: 'Retiré comme encadrant.' }],
  };
}

/**
 * Plongeur supplémentaire d'une exploration encadrée (GP/N4 au moins, la
 * palanquée reste à 40 m au plus) : le plongeur quitte sa place actuelle ;
 * celui qui tenait le slot redevient disponible.
 */
export function setExtra(plan: Plan, palanqueeId: string, diver: Diver): Plan {
  const previous = plan.palanquees.find((p) => p.id === palanqueeId)?.extra;
  if (previous?.id === diver.id) return plan;
  const palanquees = plan.palanquees
    .map((p) => without(p, diver.id))
    .map((p) => (p.id === palanqueeId ? { ...p, extra: diver } : p))
    .map(settleKind);
  const unassigned = plan.unassigned.filter((u) => u.diver.id !== diver.id);
  if (previous) unassigned.push({ diver: previous, reason: 'Remplacé comme plongeur supplémentaire.' });
  return { palanquees, unassigned };
}

/** Profondeur maximale retenue par le DP pour une palanquée, en mètres (undefined : prérogative, 40 m au plus). */
export function setDepth(plan: Plan, palanqueeId: string, depth: number | undefined): Plan {
  return mapPal(plan, palanqueeId, (p) => ({ ...p, depth: depth && depth > 0 ? Math.round(depth) : undefined }));
}

function mapPal(plan: Plan, id: string, fn: (p: Palanquee) => Palanquee): Plan {
  return { ...plan, palanquees: plan.palanquees.map((p) => (p.id === id ? fn(p) : p)) };
}

/** Version texte, à coller dans un message au groupe. */
export function planToText(title: string, plan: Plan): string {
  const lines = [`Palanquées — ${title}`, ''];
  plan.palanquees.forEach((p, i) => {
    lines.push(`P${i + 1} · ${kindLabel(p)} · ${prerogativeLabel(p)}`);
    if (p.guide) lines.push(`  ${p.kind === 'teaching' ? 'Enseignant' : 'Encadrant'} : ${p.guide.name} (${guideLabel(p.guide, p)})`);
    for (const m of p.members) lines.push(`  - ${m.name} (${memberLabel(m, p)})`);
    if (p.extra) lines.push(`  + ${p.extra.name} (GP suppl., ${extraLabel(p)})`);
    lines.push('');
  });
  if (plan.unassigned.length) {
    lines.push('Non placés :');
    for (const u of plan.unassigned) lines.push(`  - ${u.diver.name} : ${u.reason}`);
  }
  return lines.join('\n').trim();
}
