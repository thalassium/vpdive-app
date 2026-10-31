import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_CODES, MODELS, type Fiche, type FicheSession } from './training';
import { trainingPdf, trainingPdfFileName } from './trainingPdf';

const fiche = (model: string, sessions: number, comment: string): Fiche => {
  const items = MODELS[model]!.sections.flatMap((s) => s.items);
  return {
    id: 'x',
    student: '1',
    name: 'DUPONT Anna-Lise',
    level: model === 'N2L' ? 'N2' : (model as Fiche['level']),
    model,
    sessions: Array.from(
      { length: sessions },
      (_, i): FicheSession => ({
        id: `s${i}`,
        label: 'Plongée 1',
        date: `2026-0${1 + (i % 9)}-1${i % 10}`,
        slot: 'Après-midi',
        objective: 'FPA20',
        teacher: { id: '7', name: 'MARTIN Jean-Christophe' },
        depth: '18 m',
        duration: '45 min',
        weight: '4 kg',
        evals: Object.fromEntries(items.map((c, k) => [c.id, EVAL_CODES[(i + k) % 4]!])),
        comment,
        filled: { by: 'x', at: '2026-01-01' },
      }),
    ),
    theory: { examen: { date: '2026-03-01', teacher: 'Paul', note: '15/20' } },
    general: comment,
    review: { status: { theorie: 'VALIDE' }, theoryDate: '2026-03-01', certDate: '', responsable: 'Paul' },
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  };
};

test('trainingPdf : la fiche tient toujours sur une page', () => {
  const long = 'Bonne plongée, stabilisation à reprendre au gilet, palmage efficace. '.repeat(12);
  for (const [model, n, comment] of [
    ['N1', 3, 'RAS'],
    ['N2', 10, 'Bien'],
    ['N2L', 12, long],
    ['N3', 25, long],
    ['N4', 30, long],
    ['N3', 0, ''],
  ] as const) {
    const pdf = trainingPdf(fiche(model, n, comment), '2026-10-31');
    assert.equal(pdf.getNumberOfPages(), 1, `${model}, ${n} séances`);
  }
});

test('trainingPdfFileName : sans accents ni espaces', () => {
  assert.equal(trainingPdfFileName({ ...fiche('N2L', 0, ''), name: 'ÉLÈVE Zoé' }), 'Fiche-suivi_N2L_ELEVE-Zoe.pdf');
});
