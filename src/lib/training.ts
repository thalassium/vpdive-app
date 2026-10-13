/**
 * Fiches de suivi de formation, côté écran : les grilles de compétences du club,
 * reprises des classeurs « Fiche de Suivi Niveau 1 / 2 / 3 » (onglets N1_Vierge,
 * N2_Vierge, N3_Vierge, et la fiche « niveau 2 lycéens »), et ce que l'écran
 * calcule sur une fiche. Les fiches elles-mêmes sont gardées par le serveur
 * (server/training.ts), qui range les évaluations par identifiant de compétence.
 */
import type { EvalCode, Fiche, FicheLevel, FicheSession, FicheSummary, ReviewStatus, TheoryCourse } from '../../server/training';

export type { EvalCode, Fiche, FicheLevel, FicheSession, FicheSummary, ReviewStatus, TheoryCourse };

export const EVAL_CODES: readonly EvalCode[] = ['NA', 'ECA', 'A', 'NE'];
export const EVAL_LABEL: Record<EvalCode, string> = { NA: 'Non acquis, à revoir', ECA: 'En cours d’acquisition', A: 'Acquis', NE: 'Non évalué' };
export const SLOTS = ['Matin', 'Après-midi', 'Nuit'] as const;

export interface Competence {
  id: string;
  label: string;
}
export interface Section {
  title: string;
  /** Intertitre posé au-dessus de la section (« Plongeur autonome 20 m : PA20 »). */
  group?: string;
  items: Competence[];
}
export interface FicheModel {
  id: string;
  /** Dans le choix de la grille : « Niveau 2 lycéens ». */
  label: string;
  title: string;
  /** Nombre de séances du forfait (0 : pas de forfait). */
  forfait: number;
  teacherLabel: string;
  sections: Section[];
  /** Cours théoriques : date et moniteur ; l'examen porte une note. */
  theory: { id: string; label: string; exam?: boolean }[];
  /** « Réservé aux responsables plongée » : ce qui se valide (ATTENTE / VALIDE). */
  review: { id: string; label: string }[];
  /** La fiche porte une date de validation de la théorie. */
  theoryDate: boolean;
}

/** « Stabilisation (20m, 40m) » → « stabilisation-20m-40m ». */
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Une section : son titre et ses compétences, dans l'ordre de la fiche.
 * L'identifiant d'une compétence vient du numéro de sa section et de son
 * libellé : pour corriger un libellé sans perdre les évaluations déjà saisies,
 * garder l'ancien identifiant en écrivant `{ id, label }` à la place du texte.
 */
function section(n: number, title: string, items: (string | Competence)[], group?: string): Section {
  return { title, ...(group ? { group } : {}), items: items.map((it) => (typeof it === 'string' ? { id: `${n}-${slug(it)}`.slice(0, 48), label: it } : it)) };
}

const ENVIRONNEMENT = ['Respect, impact, Chartes', 'Projet Polaris'];
const THEORIE = { id: 'theorie', label: 'Théorie' };
const PRATIQUE = { id: 'pratique', label: 'Pratique' };
const CERTIFICATION = { id: 'certification', label: 'Certification FFESSM' };
const COURS_N2 = [
  { id: 'reglementation', label: 'Réglementation' },
  { id: 'physique', label: 'Physique, Autonomie et Prévention des accidents' },
  { id: 'desaturation', label: 'Désaturation et Ordinateurs' },
];
const EXAMEN = { id: 'examen', label: 'Examen', exam: true };

const N1: FicheModel = {
  id: 'N1',
  label: 'Niveau 1',
  title: 'Fiche de suivi de formation niveau 1',
  forfait: 5,
  teacherLabel: 'Moniteur ou Initiateur',
  sections: [
    section(1, 'Utiliser son matériel', ['Gréer et dégréer le bloc', 'Vérifier son matériel', 'Entretien, rinçage et rangement']),
    section(2, 'Comportement en surface et évolution en milieu subaquatique', [
      'Mises à l’eau et retour bateau',
      'Palmage (ventral 50m/dorsal/sust.)',
      'Immersion (Coulée/Phoque/Canard)',
      'Equilibre',
      'REC 6m',
      'LRE (0,5m/10m/~20m)',
      'VDM (0,5m/10m/20m, partiel/complet)',
      'Stabilisation Poumon-Ballast',
      'Stabilisation Gilet et purges',
    ]),
    section(3, 'Evolution en palanquée guidée', [
      'Assurer sa sécurité en surface',
      'Communication et signes',
      'Surveiller son stock d’air',
      'Position GP (descente/fond/remontée)',
      'Palier (mouillage/pleine eau/parachute)',
    ]),
    section(4, 'Sécurité en plongée', [
      'Prévention accidents (Oreilles, SP)',
      'Signes (froid, essoufflement..)',
      'Panne d’air',
      'Donner de l’air (octopus)',
      'Échange d’embout (simulation)',
      'Perte de palanquée',
    ]),
    section(5, 'Environnement marin', ENVIRONNEMENT),
    section(6, 'Information théorique', ['Physique (comp. des gaz/flottabilité)', 'Accidents (Baros/ORL/SP/Sat/Add)', 'Réglementation (prérogatives/papier)']),
  ],
  theory: [],
  review: [CERTIFICATION],
  theoryDate: false,
};

const N2: FicheModel = {
  id: 'N2',
  label: 'Niveau 2',
  title: 'Fiche de suivi de formation niveau 2',
  forfait: 10,
  teacherLabel: 'Moniteur ou Initiateur',
  sections: [
    section(1, 'Utiliser son matériel', ['Le sien + check binôme', 'Ordinateur (Notice, Air/Nitrox, Palier profond)']),
    section(2, 'Comportement en surface et évolution en milieu subaquatique', [
      'Immersion (pleine eau)',
      'REC 10m (20m → 10m)',
      'LRE (20m)',
      'VDM (complet, 2 cycles, 20m)',
      'Stabilisation (20m, 40m)',
      'Ventilation (40m)',
      'Vitesse de remontée (remontée individuelle)',
    ]),
    section(3, 'Evolution en palanquée guidée à 40 m : PE40', ['Consignes du GP', 'Signes GP (air, paliers)', 'Gestion de l’air à 40m', 'Position GP (prof. max)', 'Comportement en palanquée à 40m']),
    section(4, 'Planification et organisation de plongée autonomie à 20m : PA20', [
      'Consignes du DP',
      'Briefing avant plongée (binômes & matos)',
      'Planification',
      'Profils de plongée',
      'Orientation',
      'Gestion de l’air à 20m',
      'Désaturation (ordis, paliers)',
    ]),
    section(5, 'Sécurité en plongée et assistances', [
      'Prévention des accidents PA20 (Baro, SP, froid)',
      'Prévention des accidents PE40 (ADD, Narcose, Ess)',
      'Communication et signes',
      'Panne d’air (en autonomie PA20)',
      'Panne d’air (encadré PE40)',
      'Donner de l’air (octopus)',
      'Échange d’embout (simulé)',
      'Paliers et Ordinateur (NoDec, Deco, Palier Sécu)',
      'Parachute',
      'Remontée Assistée (20m → 10m) (PA20)',
      'Remontée Assistée (20m → 5m, tour horiz) (PA20)',
      'Prévention et réaction à l’Essoufflement',
      'Syncope',
    ]),
    section(6, 'Environnement marin', ENVIRONNEMENT),
  ],
  theory: [...COURS_N2, EXAMEN],
  review: [THEORIE, PRATIQUE, CERTIFICATION],
  theoryDate: true,
};

const N2L: FicheModel = {
  ...N2,
  id: 'N2L',
  label: 'Niveau 2 lycéens',
  title: 'Fiche de suivi de formation niveau 2 lycéens',
  sections: [
    section(
      1,
      'Planification et organisation de plongée',
      ['Entretien avec son binôme (humain, matos, environnement)', 'Respect des consignes du DP', 'Choix de parcours / procédures / planification', 'Check matos avec binôme', 'Ordinateur (Notice, Air/Nitrox, Palier profond)'],
      'Plongeur autonome 20 m : PA20',
    ),
    section(2, 'Comportement en surface et évolution en milieu subaquatique', [
      'Choix du point d’entrée',
      'Immersion (pleine eau)',
      'Descente contrôlée',
      'Orientation',
      'Adaptation en fonction des conditions',
      'Communication / signes',
      'Gestion de l’air à 20m',
      'LRE (20m)',
      'VDM (complet, 2 cycles, 20m)',
      'Stabilisation (20m)',
      'Appuis et Ventilation (20m)',
      'Vitesse de remontée (remontée individuelle)',
      'Tenue d’un palier de sécurité',
      'Maîtrise du parachute',
      'Désaturation (ordis, paliers)',
      'Maîtrise de la remontée individuelle',
    ]),
    section(
      3,
      'Evolution en palanquée guidée à 40 m : PE40',
      [
        'Consignes du GP',
        'Check matos zone 40m',
        'Descente contrôlée 30-40m',
        'Gestion de la narcose (sur soi)',
        'Signes GP (air, paliers)',
        'Gestion de l’air à 40m',
        'Position GP (prof. max)',
        'Comportement en palanquée à 40m',
        'Désaturation (ordis, paliers)',
        'Communication / signes',
        'Tenir plusieurs paliers',
        'Remontée contrôlée',
      ],
      'Plongeur encadré 40 m : PE40',
    ),
    section(4, 'Sécurité en plongée et assistances', [
      'CAT et prévention PA20 (Baro, froid, ADD) soi + binôme',
      'CAT et Prév sur soi des accidents PE40 (Narcose, Ess)',
      'Panne d’air donner (en autonomie PA20)',
      'Panne d’air recevoir (en autonomie PA20)',
      'Panne d’air recevoir (encadré PE40)',
      'Gestion plongeur essoufflé (20m)',
      'Gestion plongeur inconscient (Syncope, 20m)',
      'Paliers et Ordinateur (NoDec, Deco, Palier Sécu)',
      'Utilisation parachute en urgence',
      'Assistances réactions aux signes / prises et décollage',
      'Remontée Assistée (20m → 10m) (PA20)',
      'Remontée Assistée (20m → 5m, tour horiz) (PA20)',
      'Prévention et réaction à l’Essoufflement',
      'Choix de sortie d’eau',
    ]),
    section(5, 'Environnement marin', ENVIRONNEMENT),
  ],
  theory: [...COURS_N2, { id: 'equipements', label: 'Equipements (autonomie + PE40)' }, EXAMEN],
};

const N3: FicheModel = {
  id: 'N3',
  label: 'Niveau 3',
  title: 'Fiche de suivi de formation niveau 3',
  forfait: 10,
  teacherLabel: 'Moniteur',
  sections: [
    section(1, 'Utiliser son matériel', ['Le sien + check binôme + spécifique au-delà de 40m', 'Ordinateur (Notice, Air/Nitrox, Palier profond)']),
    section(2, 'Comportement en surface et évolution en milieu subaquatique', [
      'Vérification des acquis N2',
      'Palmage (adapté à 40 m puis 60m)',
      'Immersion (efficace pour une plongée profonde)',
      'LRE (40m)',
      'VDM (complet, 2 cycles, 40m)',
      'Stabilisation (40m)',
      'Ventilation (40m)',
      'Vitesse de remontée (remontée individuelle)',
    ]),
    section(3, 'Planification et organisation de plongée autonomie à 60m : PA60 avec DP', [
      'Consignes DP (reformuler)',
      'Briefing avant plongée (binômes & matos)',
      'Planification (réserve d’air, Temps fond, Paliers, DTR)',
      'Profils de plongée (stock d’air et déco)',
      'Gestion de l’air à 40m puis 60m (stock d’air et déco)',
      'Désaturation et Ordinateur, modèles de désat, palier',
      'Orientation (avec et sans instruments)',
      'Comport. Palanquée à 60m',
      'Plongée en espace 40 - 60 m avec un E4',
    ]),
    section(4, 'Sécurité en plongée et assistances', [
      'Prévention des accidents PA60 (ADD, Narcose, froid)',
      'Communication et signes',
      'Panne d’air (40m)',
      'Donner de l’air (octopus)',
      'Échange d’embout (simulé)',
      'Paliers (NoDec, Deco/Sécu)',
      'Parachute',
      'RA (40m → 20m)',
      'RA (40m → 5m, tour horiz)',
      'Prévention et réaction à la Narcose',
      'Prévention et réaction à l’Essoufflement',
      'Prévention et réaction à la Syncope',
    ]),
    section(5, 'Planification et organisation de plongée autonomie à 40m : PA40 sans DP', ['Expérience des binômes', 'Choix du site et conditions de mer (météo, courant)', 'Sécurité (matos, sécu surface ..)']),
    section(6, 'Environnement marin', ENVIRONNEMENT),
  ],
  theory: [
    COURS_N2[0]!,
    { id: 'sans-dp', label: 'Organisation plongée sans DP' },
    COURS_N2[1]!,
    COURS_N2[2]!,
    EXAMEN,
    { id: 'rifap-theorie', label: 'RIFAP · Théorie' },
    { id: 'rifap-pratique', label: 'RIFAP · Pratique' },
  ],
  review: [THEORIE, { id: 'espace-40-60', label: 'Plongée en espace 40 - 60 m avec un E4' }, PRATIQUE, { id: 'rifap', label: 'RIFAP' }, CERTIFICATION],
  theoryDate: true,
};

/** Niveau 4 : le club n'a pas de grille ; la fiche garde les séances et leurs commentaires. */
const N4: FicheModel = {
  id: 'N4',
  label: 'Niveau 4',
  title: 'Fiche de suivi de formation niveau 4',
  forfait: 0,
  teacherLabel: 'Moniteur',
  sections: [],
  theory: [],
  review: [THEORIE, PRATIQUE, CERTIFICATION],
  theoryDate: true,
};

export const MODELS: Record<string, FicheModel> = { N1, N2, N2L, N3, N4 };
/** Les grilles qu'une fiche de ce niveau peut prendre ; la première est celle du niveau. */
export const VARIANTS: Record<FicheLevel, string[]> = { N1: ['N1'], N2: ['N2', 'N2L'], N3: ['N3'], N4: ['N4'] };

export const modelOf = (f: Pick<Fiche, 'level' | 'model'>): FicheModel => (f.model && VARIANTS[f.level].includes(f.model) ? MODELS[f.model]! : MODELS[f.level]!);

export type SessionState = 'filled' | 'ignored' | 'todo' | 'upcoming';
/** Remplie, mise de côté par un admin, à remplir, ou à venir (la plongée n'a pas encore eu lieu). `today` : AAAA-MM-JJ. */
export const sessionState = (s: { filled: unknown; ignored?: unknown; date: string }, today: string): SessionState =>
  s.filled ? 'filled' : s.ignored ? 'ignored' : s.date > today ? 'upcoming' : 'todo';

/** Séances à remplir aujourd'hui (les plongées à venir ne comptent pas) ; avec `ids`, seulement celles de cet encadrant. */
export function todoCount(f: Pick<FicheSummary, 'todo'>, today: string, ids?: string[]): number {
  return f.todo.filter((t) => t.date <= today && (!ids || ids.includes(t.teacher))).length;
}

/** Où en est chaque compétence : sa dernière évaluation, séance après séance (« non évalué » ne remplace pas une évaluation). */
export function latestEvals(sessions: FicheSession[], upTo?: string): Record<string, EvalCode> {
  const out: Record<string, EvalCode> = {};
  for (const s of sessions) {
    if (s.id === upTo) break;
    for (const [id, code] of Object.entries(s.evals)) if (code !== 'NE' || !out[id]) out[id] = code;
  }
  return out;
}

/** Compétences acquises sur le total de la grille. */
export function progress(f: Fiche): { acquired: number; total: number } {
  const latest = latestEvals(f.sessions);
  const items = modelOf(f).sections.flatMap((s) => s.items);
  return { acquired: items.filter((c) => latest[c.id] === 'A').length, total: items.length };
}

/** « ELEVE Anna » rangés par nom, sans tenir compte des accents ni de la casse. */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
