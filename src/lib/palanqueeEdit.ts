/**
 * Ajustements manuels d'une proposition de palanquées, et passage des inscrits
 * VPDive aux plongeurs du moteur. Fonctions pures : chaque opération renvoie un
 * nouveau plan, l'écran revalide tout après chaque changement.
 */
import { aptitudesFromLabels, canGuideExploration, extraLabel, guideLabel, kindLabel, memberLabel, prerogativeLabel, settleKind, toTeaching, type Depth, type Diver, type PalanqueeKind, type PalanqueeType, type Plan, type Palanquee } from './palanquees';
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
export const TRAINING_HINT: Record<(typeof TRAINING_OPTIONS)[number], string> = {
  FN1: 'vers N1 · 20 m',
  FN2: 'vers N2 · 40 m',
  FN3: 'vers N3 · 40 m, au-delà à la main',
  FN4: 'vers N4 · 40 m, au-delà à la main',
  FPA20: 'autonomie 20 m (N2) · E2 suffit',
  FPE40: 'encadré 40 m (N2)',
  FPA40: 'autonomie 40 m (N3)',
  FPE60: 'encadré 60 m (N3) · au-delà de 40 m à la main',
  FPA60: 'autonomie 60 m (N3) · au-delà de 40 m à la main',
};
/** « Pas en formation » choisi par le DP : l'emporte sur une prépa VPDive. */
export const NO_TRAINING = 'none';

export interface DiverSettings {
  /** id → prérogative retenue à la main (remplace celle de VPDive, dont les niveaux restent affichés) */
  levels?: Record<string, string>;
  /** id → formation en cours (FN1…FN4), en plus de la prérogative */
  training?: Record<string, string>;
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
    // a choisi « Pas en formation » pour cette sortie (NO_TRAINING).
    const choice = settings.training?.[r.id];
    const fn = choice === NO_TRAINING ? undefined : choice;
    const labels = [...base, ...(fn ? [fn] : choice === NO_TRAINING ? [] : r.training)];
    return {
      id: r.id,
      name: r.name,
      firstname: r.firstname,
      lastname: r.lastname,
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

/**
 * Désigne l'encadrant (ou l'enseignant) d'une palanquée, qu'il vienne d'une
 * autre palanquée, des disponibles ou de la palanquée elle-même. L'ancien
 * encadrant redevient disponible. Une palanquée autonome devient encadrée.
 */
export function assignGuide(plan: Plan, palanqueeId: string, diver: Diver): Plan {
  const previous = plan.palanquees.find((p) => p.id === palanqueeId)?.guide;
  if (previous?.id === diver.id) return plan;
  const palanquees = plan.palanquees
    .map((p) => without(p, diver.id))
    .map((p) => (p.id === palanqueeId ? { ...p, guide: diver } : p))
    .map(settleKind);
  const unassigned = plan.unassigned.filter((u) => u.diver.id !== diver.id);
  if (previous) unassigned.push({ diver: previous, reason: 'Remplacé comme encadrant.' });
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

/** Profondeur retenue par le DP pour une palanquée (undefined : prérogative, 40 m au plus). */
export function setDepth(plan: Plan, palanqueeId: string, depth: Depth | undefined): Plan {
  return mapPal(plan, palanqueeId, (p) => ({ ...p, depth }));
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
