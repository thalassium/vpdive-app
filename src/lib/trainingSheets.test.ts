import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS } from './training';
import { cellDate, readSheetExport, sheetToFiche, studentName, withTeachers } from './trainingSheets';

/** Un onglet comme ceux du classeur : en-tête, grille de la fiche (titres de section compris), commentaires, bloc des responsables. */
function tab(modelId: string, columns: Record<string, string[]>, extra: { theory?: string[][]; review?: string[][]; drop?: number } = {}): string[][] {
  const model = MODELS[modelId]!;
  const row = (label: string, key?: string) => [label, ...(key ? (columns[key] ?? []) : [])];
  const grid = model.sections.flatMap((s) => [...(s.group ? [[s.group.toUpperCase()]] : []), [s.title], ...s.items.map((c) => row(c.label, c.id))]);
  if (extra.drop !== undefined) grid.splice(extra.drop, 1);
  return [
    [`Fiche de suivi de formation niveau ${modelId[1]}${modelId === 'N2L' ? ' lycéens' : ''}`],
    ...(modelId === 'N2L' ? [['Commentaire général: Conso à surveiller']] : []),
    ['Séances (Forfait 5)', '1.0', '2.0', '3.0'],
    row('Date', 'date'),
    row('Matin / Aprés-midi', 'slot'),
    row('Moniteur ou Initiateur', 'teacher'),
    row('Profondeur max atteinte', 'depth'),
    ...(modelId === 'N2L' ? [row('Durée', 'duration')] : []),
    row('Lestage (initial puis si variation)', 'weight'),
    ['Évaluation des compétences (NA = Non Acquis à revoir ECA = en cours d\'aquisition, en progrès A = Acquis)'],
    ...grid,
    ...(extra.theory ? [['Cours Théoriques'], ...extra.theory] : []),
    ['Commentaires de l\'enseignant et exercices complémentaires'],
    ['Séance 1 (LL)', 'Très à l’aise'],
    ['Séance 2 (initiales du formateur)', '(Ray) gestes fluides'],
    ['Séance 3 (initiales du formateur)'],
    [],
    ['Réservé aux responsables plongée'],
    ...(extra.review ?? [['Certification FFESSM', 'ATTENTE'], ['Date de certfification'], ['Responsable']]),
  ];
}

test('sheetToFiche : séances, évaluations, commentaires et validations d’une fiche niveau 1', () => {
  const [a, b, c] = MODELS.N1!.sections[0]!.items;
  const last = MODELS.N1!.sections.at(-1)!.items.at(-1)!;
  const rows = tab(
    'N1',
    {
      date: ['46208.0', '16/08', ''],
      slot: ['Matin', 'Aprés-midi', 'Matin'],
      teacher: ['Lucas', 'Raymond '],
      depth: ['6m', '19.5'],
      weight: ['4.0'],
      [a!.id]: ['ECA', 'A'],
      [b!.id]: ['NON EVAL', 'NA'],
      [c!.id]: ['', 'a'],
      [last.id]: ['', 'A'],
    },
    { review: [['Certification FFESSM', 'VALIDE', 'Attente'], ['Date de certfification', '46228.0'], ['Responsable', 'Fred'], ['Conso air importante.']] },
  );
  const fiche = sheetToFiche('N1_Prénom-NomV', rows, 2026)!;
  assert.deepEqual([fiche.name, fiche.level, fiche.model, fiche.warnings], ['Prénom-Nom', 'N1', 'N1', []]);
  assert.deepEqual(
    fiche.sessions.map((s) => [s.number, s.date, s.slot, s.teacher, s.depth, s.weight, s.comment]),
    [
      [1, '2026-07-05', 'Matin', 'Lucas', '6m', '4', '(LL) Très à l’aise'],
      [2, '2026-08-16', 'Après-midi', 'Raymond', '19,5', '', '(Ray) gestes fluides'],
    ],
    'la colonne 3 n’a qu’un créneau prérempli : pas une séance',
  );
  assert.deepEqual(fiche.sessions[0]!.evals, { [a!.id]: 'ECA', [b!.id]: 'NE' });
  assert.deepEqual(fiche.sessions[1]!.evals, { [a!.id]: 'A', [b!.id]: 'NA', [c!.id]: 'A', [last.id]: 'A' });
  assert.deepEqual(fiche.review, { status: { certification: 'VALIDE' }, theoryDate: '', certDate: '2026-07-25', responsable: 'Fred' });
  assert.equal(fiche.general, 'Conso air importante.');
});

test('sheetToFiche : fiche lycéens (deux lignes de plus), cours théoriques, onglets qui ne sont pas des fiches', () => {
  const first = MODELS.N2L!.sections[0]!.items[0]!;
  const rows = tab(
    'N2L',
    { date: ['46305.0'], teacher: ['Lucas'], duration: ['46.0'], [first.id]: ['ECA'] },
    {
      theory: [
        ['Réglementation', 'Date :', '46257.0', 'Moniteur :', 'FH', 'Séance de synthèse'],
        ['Physique, Autonomie et Prévention des accidents', 'Date :', '', 'Moniteur :'],
        ['Examen ', 'Date :', '46258.0', 'Moniteur :', 'FH', 'Note', '17/20'],
      ],
      review: [['Théorie', 'VALIDE'], ['Date de validation de la théorie', '46259.0'], ['Pratique', 'ATTENTE'], ['Certification FFESSM', 'ATTENTE'], ['Date de certfification'], ['Responsable']],
    },
  );
  const fiche = sheetToFiche('Prénom_NOM(ficheCD)', rows, 2026)!;
  assert.deepEqual([fiche.name, fiche.level, fiche.model, fiche.warnings], ['Prénom NOM', 'N2', 'N2L', []]);
  assert.deepEqual([fiche.sessions[0]!.duration, fiche.sessions[0]!.evals], ['46', { [first.id]: 'ECA' }]);
  assert.deepEqual(fiche.theory, { reglementation: { date: '2026-08-23', teacher: 'FH', note: '' }, examen: { date: '2026-08-24', teacher: 'FH', note: '17/20' } });
  assert.deepEqual(fiche.review, { status: { theorie: 'VALIDE' }, theoryDate: '2026-08-25', certDate: '', responsable: '' });
  assert.equal(fiche.general, 'Conso à surveiller\nRéglementation : Séance de synthèse');

  assert.equal(sheetToFiche('N1_Vierge', tab('N1', {}), 2026), null);
  assert.equal(sheetToFiche('Instructions', [['', '', '', 'Instructions  : Fiche de suivi de formation niveau 1']], 2026), null);
});

test('sheetToFiche : un onglet dont une ligne manque est rapproché par les libellés, et le dit', () => {
  const [a, b] = MODELS.N1!.sections[1]!.items;
  // La première compétence de la fiche a été supprimée de l'onglet : tout est décalé d'une ligne.
  const fiche = sheetToFiche('Prénom Nom', tab('N1', { date: ['46208.0'], [a!.id]: ['A'], [b!.id]: ['zz'] }, { drop: 1 }), 2026)!;
  assert.deepEqual(fiche.sessions[0]!.evals, { [a!.id]: 'A' });
  assert.equal(fiche.warnings.length, 2);
  assert.match(fiche.warnings[0]!, /33 lignes de compétences au lieu de 34/);
  assert.match(fiche.warnings[1]!, /évaluation « zz » non reconnue/);
});

test('withTeachers : un moniteur reconnu prend son nom de membre et son jeton, les autres sont signalés', () => {
  const first = MODELS.N2!.sections[0]!.items[0]!;
  const rows = tab('N2', { date: ['46208.0', '46209.0', '46210.0'], teacher: ['ab', 'Zoé', ''], [first.id]: ['A', 'A', 'A'] }, { theory: [['Réglementation', 'Date :', '46257.0', 'Moniteur :', 'AB']] });
  const fiche = withTeachers(sheetToFiche('Prénom Nom', rows, 2026)!, { AB: { uct: 'jeton-ab', name: 'Alix BERNARD' } });
  assert.deepEqual(
    fiche.sessions.map((s) => [s.teacher, s.teacherUct]),
    [
      ['Alix BERNARD', 'jeton-ab'],
      ['Zoé', undefined],
      ['', undefined],
    ],
  );
  assert.equal(fiche.theory.reglementation!.teacher, 'Alix BERNARD');
  assert.deepEqual(fiche.warnings, ['Moniteur « Zoé » : pas de membre connu, repris tel quel.']);
});

test('studentName, cellDate, readSheetExport', () => {
  assert.deepEqual(['Prénom Nom V', 'Prénom Nom [V]', 'N2_Jean_Du Pont ', 'Yves'].map(studentName), ['Prénom Nom', 'Prénom Nom', 'Jean Du Pont', 'Yves']);
  assert.deepEqual(['46263.0', '16/8/26', '20/09', '10/10/2026', 'hier', ''].map((v) => cellDate(v, 2026)), ['2026-08-29', '2026-08-16', '2026-09-20', '2026-10-10', '', '']);
  assert.equal(readSheetExport({ rien: 1 }), null);
  assert.equal(readSheetExport({ fiches: [{ name: 'A', level: 'N1', sessions: [] }, { name: 'B', level: 'X', sessions: [] }, null] })!.length, 1);
});
