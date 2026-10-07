/**
 * Ajustements manuels d'une proposition de palanquées, et passage des inscrits
 * VPDive aux plongeurs du moteur. Fonctions pures : chaque opération renvoie un
 * nouveau plan, l'écran revalide tout après chaque changement.
 */
import { aptitudesFromLabels, aptLabel, GUIDE_LABEL, KIND_LABEL, prerogativeLabel, type Depth, type Diver, type PalanqueeKind, type Plan, type Palanquee } from './palanquees';
import { rankByName } from './fuzzy';
import type { RosterEntry } from '../services/vpdiveApi';

/**
 * Niveau retenu à la main par le DP, quand VPDive n'en donne pas ou pour donner
 * un équivalent FFESSM à un brevet d'une autre école (PADI, SSI…). FN1 à FN4 :
 * en formation vers ce niveau ; le niveau actuel reste celui de VPDive.
 */
export const LEVEL_OVERRIDES = ['Débutant', 'PE12', 'N1', 'PA20', 'N2', 'PE40', 'PA40', 'N3', 'GP / N4', 'E1 · Initiateur', 'E2', 'MF1', 'MF2'] as const;
export const TRAINING_OPTIONS = ['FN1', 'FN2', 'FN3', 'FN4'] as const;

export interface DiverSettings {
  /** id → niveau retenu à la main (remplace ceux de VPDive, qui restent affichés) */
  levels?: Record<string, string>;
  /** id → formation en cours (FN1…FN4), en plus du niveau */
  training?: Record<string, string>;
}

/** Valeur unique du menu de niveau : la formation si elle est choisie, sinon le niveau retenu. */
export const levelChoice = (settings: DiverSettings, id: string) => settings.training?.[id] ?? settings.levels?.[id] ?? '';

/** Applique un choix du menu de niveau (un niveau, une formation FN#, ou '' pour revenir à VPDive). */
export function chooseLevel(settings: DiverSettings, id: string, value: string): DiverSettings {
  const levels = { ...(settings.levels ?? {}) };
  const training = { ...(settings.training ?? {}) };
  delete levels[id];
  delete training[id];
  if ((TRAINING_OPTIONS as readonly string[]).includes(value)) training[id] = value;
  else if (value) levels[id] = value;
  return { ...settings, levels, training };
}

export function rosterToDivers(roster: RosterEntry[], settings: DiverSettings = {}): Diver[] {
  return roster.map((r) => {
    const forced = settings.levels?.[r.id];
    const base = forced ? [forced] : r.levels;
    const fn = settings.training?.[r.id];
    // Les « prépas » VPDive comptent aussi : « Prépa N2 » vaut FN2.
    const labels = [...base, ...(fn ? [fn] : r.training)];
    return {
      id: r.id,
      name: r.name,
      firstname: r.firstname,
      lastname: r.lastname,
      labels: fn ? [...base, fn] : base,
      ...(forced ? { original: r.levels } : {}),
      minor: r.age !== null && r.age < 18,
      ...aptitudesFromLabels(labels),
    };
  });
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
    palanquees.push({
      id: newId(),
      kind: diver.guide ? 'guided' : 'autonomous',
      guide: diver.guide ? diver : null,
      extra: null,
      members: diver.guide ? [] : [diver],
    });
  } else {
    palanquees = palanquees.map((p) => (p.id === target ? { ...p, members: [...p.members, diver] } : p));
  }
  // Une palanquée vidée reste en place : le DP la remplit ou la supprime (deletePalanquee).
  return { palanquees, unassigned };
}

/**
 * Nouvelle palanquée vide, à remplir à la main. Sans composition encore (rien
 * de généré), tous ceux qui plongent partent de la liste des disponibles.
 */
export function addPalanquee(plan: Plan | null, available: Diver[], kind: PalanqueeKind = 'guided'): Plan {
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
    .map((p) => (p.id === palanqueeId ? { ...p, kind: p.kind === 'autonomous' ? ('guided' as const) : p.kind, guide: diver } : p));
  const unassigned = plan.unassigned.filter((u) => u.diver.id !== diver.id);
  if (previous) unassigned.push({ diver: previous, reason: 'Remplacé comme encadrant.' });
  return { palanquees, unassigned };
}

/**
 * Change le type d'une palanquée. En autonome, l'encadrant et le plongeur
 * supplémentaire redeviennent membres ; en encadrée ou formation, le plus
 * qualifié des membres devient encadrant s'il n'y en a pas.
 */
export function setKind(plan: Plan, palanqueeId: string, kind: PalanqueeKind): Plan {
  return mapPal(plan, palanqueeId, (p) => {
    if (kind === 'autonomous') {
      return { ...p, kind, guide: null, extra: null, members: [p.guide, p.extra, ...p.members].filter((d): d is Diver => !!d) };
    }
    if (p.guide) return { ...p, kind };
    const score = (d: Diver) => (kind === 'teaching' ? d.teach : d.guide ? 1 + d.pe / 100 : 0);
    const guide = [...p.members].filter((m) => score(m) > 0).sort((a, b) => score(b) - score(a))[0] ?? null;
    return { ...p, kind, guide, members: p.members.filter((m) => m !== guide) };
  });
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
    lines.push(`P${i + 1} · ${KIND_LABEL[p.kind]} · ${prerogativeLabel(p)}`);
    if (p.guide) lines.push(`  ${p.kind === 'teaching' ? 'Enseignant' : 'Encadrant'} : ${p.guide.name} (${p.guide.guide ? GUIDE_LABEL[p.guide.guide] : aptLabel(p.guide)})`);
    for (const m of p.members) lines.push(`  - ${m.name} (${aptLabel(m)})`);
    if (p.extra) lines.push(`  + ${p.extra.name} (GP suppl.)`);
    lines.push('');
  });
  if (plan.unassigned.length) {
    lines.push('Non placés :');
    for (const u of plan.unassigned) lines.push(`  - ${u.diver.name} : ${u.reason}`);
  }
  return lines.join('\n').trim();
}
