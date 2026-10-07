/**
 * Niveaux d'un membre tels que VPDive les enregistre, par famille (niveau,
 * enseignement, qualification, autonomie), chacun avec un code court et un nom
 * complet. Exemples réels (référentiel VPDive, octobre 2026) :
 *
 *   enseignement  E3       « P - Enseignant 3 - Moniteur Fédéral - 1 er degré »
 *   enseignement  DEJEPS - activité de plongée sub.
 *                          « P - Enseignant 3 - Diplôme d'Etat de la Jeunesse… »
 *   enseignement  DEJEPS - plongée sub.   « P - Enseignant 4 - Diplôme d'Etat… »
 *   enseignement  BPJEPS - avec scaphandre « P - Enseignant 2 - Brevet Prof… »
 *   niveau        P4       « P - Plongeur(se) Niveau 4 (P4-N4 - Guide de palanquée) »
 *
 * La prérogative d'enseignement (E1…E4) est celle que VPDive écrit dans le nom
 * (« Enseignant N ») : un DEJEPS est E3 ou E4 selon sa mention, un BPJEPS E2.
 * On ne la déduit jamais du diplôme. Le diplôme, lui, est affiché tel que VPDive
 * le nomme (DEJEPS, BPJEPS, MF-AS…), sauf quand son code n'est que la
 * prérogative (« E3 ») : on reprend alors le diplôme écrit dans le nom (MF1…).
 */

export type QualifFamily = 'level' | 'teaching' | 'qualification' | 'autonome';

export interface VpdiveQualif {
  family: QualifFamily;
  /** Code court (« abbreviation » dans VPDive). */
  code: string;
  /** Nom complet. */
  name: string;
}

/** Prérogative d'enseignement écrite par VPDive dans le nom du diplôme (Enseignant 5 = BEES 3 : traité en E4). */
export function teachingLevelOf(q: VpdiveQualif): 0 | 1 | 2 | 3 | 4 {
  if (q.family !== 'teaching') return 0;
  const n = Number(
    /enseignant\s*([1-5])/i.exec(q.name)?.[1] ?? // « P - Enseignant 3 - … »
      /(?:^|[\s(])E([1-4])\b/.exec(q.name)?.[1] ?? // « P - E3 Moniteur plongée Associé », « Moniteur Fédéral (E3) »
      /^E([1-4])\b/.exec(q.code)?.[1] ??
      0,
  );
  return Math.min(n, 4) as 0 | 1 | 2 | 3 | 4;
}

/** Plongée en scaphandre (« P - … ») : les diplômes d'apnée, de hockey… n'en font pas partie. */
const isScuba = (q: VpdiveQualif) => /^p\s?-/i.test(q.name) || /^(E[1-4]|MF|BEES|DEJEPS|DESJEPS|BPJEPS)/i.test(q.code);

/** Diplôme d'enseignement tel que VPDive le nomme, pour l'affichage. */
function teachingDiploma(q: VpdiveQualif): string {
  if (!/^E[1-4]( A)?$/.test(q.code.trim())) return q.code.split(' - ')[0]!.trim();
  // Code réduit à la prérogative (FFESSM, ANMP, FSGT) : le diplôme est dans le nom.
  const n = q.name.toLowerCase();
  if (/1\s?er degr|1er degr/.test(n)) return /associ/.test(n) ? 'MF1 associé' : 'MF1';
  if (/2\s?[èe]me degr/.test(n)) return /associ/.test(n) ? 'MF2 associé' : 'MF2';
  if (/initiateur\s*&|initiateur & p4|n4\/p4/.test(n)) return 'Initiateur + N4';
  if (/initiateur/.test(n)) return 'Initiateur';
  return q.code.trim();
}

/** Autres activités fédérales (apnée, orientation, hockey, pêche, archéologie, handisport…). */
const otherActivity = (q: VpdiveQualif) => /^(A|OS|NAP|NEV|H|PSP|PS|TIR|RS|AS|BIO|PSH|AUD|s)\s?-/.test(q.name.trim());

/**
 * Ce qui sert à juger les palanquées, sans le bruit (secourisme, nitrox, apnée…).
 * Les diplômes d'enseignement d'autres écoles (PADI, SSI…) restent affichés :
 * ils ne donnent pas de prérogative, mais le DP doit les voir.
 */
const relevantForDisplay = (q: VpdiveQualif) =>
  !otherActivity(q) &&
  (q.family === 'level' ||
    q.family === 'autonome' ||
    q.family === 'teaching' ||
    // Qualifications de plongée qui pèsent sur la palanquée : PE/PA, P5-DPE, GP…
    (q.family === 'qualification' && /^(PE|PA)[- ]?\d|^P\d\b|^GP\b|^N\d\b/i.test(q.code)));

/**
 * - labels  : ce que lit le moteur de palanquées (codes de niveau, et pour
 *             l'enseignement la prérogative « E3 » lue dans le nom)
 * - display : les niveaux et diplômes à montrer, tels que VPDive les écrit
 */
export function fromVpdive(qualifs: VpdiveQualif[]): { labels: string[]; display: string[] } {
  const labels: string[] = [];
  const display: string[] = [];
  for (const q of qualifs) {
    if (q.family === 'teaching') {
      const e = isScuba(q) ? teachingLevelOf(q) : 0;
      if (e) labels.push(`E${e}`);
    } else if (q.code) labels.push(q.code);
    if (relevantForDisplay(q)) display.push(q.family === 'teaching' ? teachingDiploma(q) : q.code);
  }
  return { labels: [...new Set(labels)], display: [...new Set(display)] };
}
