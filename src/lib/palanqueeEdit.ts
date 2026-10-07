/**
 * Ajustements manuels d'une proposition de palanquées, et passage des inscrits
 * VPDive aux plongeurs du moteur. Fonctions pures : chaque opération renvoie un
 * nouveau plan, l'écran revalide tout après chaque changement.
 */
import { aptitudesFromLabels, aptLabel, GUIDE_LABEL, prerogativeLabel, type Depth, type Diver, type PalanqueeKind, type Plan, type Palanquee } from './palanquees';
import { rankByName } from './fuzzy';
import type { RosterEntry } from '../services/vpdiveApi';

/** Niveau choisi à la main par l'admin quand VPDive n'en donne pas, ou pour corriger. */
export const LEVEL_OVERRIDES = ['Débutant', 'PE12', 'N1', 'PA20', 'N2', 'PE40', 'N3', 'GP / N4', 'E1 · Initiateur', 'E2', 'MF1', 'MF2'] as const;
/** Formation en cours, notée FN# (FN1 = vers le N1…). */
export const TRAINING_OPTIONS = ['FN1', 'FN2', 'FN3', 'FN4'] as const;

export interface DiverSettings {
  /** id → niveau choisi à la main (remplace ceux de VPDive) */
  levels?: Record<string, string>;
  /** id → formation en cours (FN1…FN4) */
  training?: Record<string, string>;
}

export function rosterToDivers(roster: RosterEntry[], settings: DiverSettings = {}): Diver[] {
  return roster.map((r) => {
    const base = settings.levels?.[r.id] ? [settings.levels[r.id]!] : r.levels;
    const fn = settings.training?.[r.id];
    // Les « prépas » VPDive comptent aussi : « Prépa N2 » vaut FN2.
    const labels = [...base, ...(fn ? [fn] : r.training)];
    return {
      id: r.id,
      name: r.name,
      firstname: r.firstname,
      lastname: r.lastname,
      labels: fn ? [...base, fn] : base,
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

const isEmpty = (p: Palanquee) => !p.guide && !p.extra && p.members.length === 0;

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
  return { palanquees: palanquees.filter((p) => !isEmpty(p) || p.id === target), unassigned };
}

/** Fait d'un membre de la palanquée son encadrant ou enseignant (l'ancien redevient membre). */
export function setGuide(plan: Plan, palanqueeId: string, diverId: string): Plan {
  return mapPal(plan, palanqueeId, (p) => {
    const next = p.members.find((m) => m.id === diverId);
    if (!next) return p;
    const members = p.members.filter((m) => m.id !== diverId);
    return { ...p, kind: p.kind === 'autonomous' ? 'guided' : p.kind, guide: next, members: p.guide ? [p.guide, ...members] : members };
  });
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
    lines.push(`P${i + 1} · ${prerogativeLabel(p)}`);
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
