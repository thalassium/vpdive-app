import { jsPDF } from 'jspdf';
import { autoTable, type CellInput, type RowInput } from 'jspdf-autotable';
import { modelOf, progress, type EvalCode, type Fiche } from './training';
import { frDate } from './dates';
import { pdfText } from './pdfText';

/**
 * Fiche de suivi de formation d'un élève en PDF, sur une seule page A4
 * portrait : en-tête, grille des compétences séance par séance, séances,
 * cours théoriques, commentaire général et partie des responsables plongée.
 * Si le contenu dépasse, tout est redessiné un peu plus petit, puis les
 * commentaires sont raccourcis, jusqu'à tenir sur la page.
 * Chargé à la demande, pour ne pas alourdir l'application.
 */

const PAGE = { w: 210, h: 297, margin: 10 };
const NAVY: [number, number, number] = [8, 36, 92];
const GREY: [number, number, number] = [110, 116, 128];
const LINE: [number, number, number] = [190, 196, 206];
const TINT: [number, number, number] = [236, 240, 247];
const EVAL_STYLE: Record<EvalCode, { fill: [number, number, number]; text: [number, number, number] }> = {
  A: { fill: [214, 240, 222], text: [22, 110, 58] },
  ECA: { fill: [252, 236, 204], text: [150, 90, 10] },
  NA: { fill: [250, 218, 218], text: [170, 30, 30] },
  NE: { fill: [255, 255, 255], text: [140, 146, 158] },
};

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

/** Corps des textes (1 : taille normale) et longueur maximale des commentaires (0 : entiers). */
interface Fit {
  scale: number;
  clip: number;
}

const FITS: Fit[] = [
  ...[1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.55].map((scale) => ({ scale, clip: 0 })),
  ...[400, 250, 150, 90, 50].map((clip) => ({ scale: 0.55, clip })),
];

const clipText = (s: string, max: number) => (max && s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s);

function draw(fiche: Fiche, today: string, { scale, clip }: Fit): Doc {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as Doc;
  const model = modelOf(fiche);
  const width = PAGE.w - 2 * PAGE.margin;
  const fs = (n: number) => n * scale;
  const pad = Math.max(0.5, 1 * scale);
  const gap = 4 * scale;
  const done = progress(fiche);
  const sessions = fiche.sessions;
  pdf.setProperties({ title: pdfText(`${model.title} · ${fiche.name}`), creator: 'VPDive app' });

  // Titre
  let y = PAGE.margin + fs(5);
  pdf.setFont('helvetica', 'bold').setFontSize(fs(15)).setTextColor(...NAVY);
  pdf.text(pdfText(fiche.name), PAGE.margin, y);
  pdf.setFont('helvetica', 'normal').setFontSize(fs(9)).setTextColor(...GREY);
  const facts = [
    model.title,
    `Séances : ${sessions.length}${model.forfait > 0 ? ` / ${model.forfait}` : ''}`,
    ...(done.total > 0 ? [`Acquis : ${done.acquired} / ${done.total}`] : []),
  ];
  pdf.text(pdfText(facts.join('  ·  ')), PAGE.margin, y + fs(5));
  y += fs(5) + gap + 1;

  const base = { font: 'helvetica' as const, fontSize: fs(7.5), cellPadding: pad, lineColor: LINE, lineWidth: 0.2, textColor: 20, valign: 'middle' as const };
  const headStyles = { fillColor: NAVY, textColor: 255, fontStyle: 'bold' as const, fontSize: fs(8) };
  const sub = { fillColor: TINT, textColor: NAVY, fontStyle: 'bold' as const };
  // En bas, la place du pied de page.
  const margin = { left: PAGE.margin, right: PAGE.margin, top: PAGE.margin, bottom: 8 };
  const after = () => (pdf.lastAutoTable?.finalY ?? y) + gap;

  // Grille des compétences : une ligne par compétence, une colonne par séance.
  if (model.sections.length > 0 && sessions.length > 0) {
    // Colonnes des séances de 12 mm au plus ; le libellé prend le reste (60 mm au moins).
    const colW = Math.min(12, (width - 60) / sessions.length);
    const labelW = width - sessions.length * colW;
    const body: RowInput[] = [];
    for (const sec of model.sections) {
      if (sec.group) body.push([{ content: pdfText(sec.group), colSpan: sessions.length + 1, styles: { ...sub, fillColor: [255, 255, 255], textColor: GREY } }]);
      body.push([{ content: pdfText(sec.title), colSpan: sessions.length + 1, styles: sub }]);
      for (const c of sec.items) {
        body.push([
          pdfText(c.label),
          ...sessions.map((s): CellInput => {
            const code = s.evals[c.id];
            if (!code) return '';
            return { content: code, styles: { fillColor: EVAL_STYLE[code].fill, textColor: EVAL_STYLE[code].text, fontStyle: 'bold' } };
          }),
        ]);
      }
    }
    // Les codes doivent tenir dans leur colonne (« ECA » sur une colonne étroite).
    pdf.setFont('helvetica', 'bold');
    const markSize = Math.min(fs(7), [7, 6, 5, 4].find((n) => pdf.setFontSize(n).getTextWidth('ECA') <= colW - 0.6) ?? 4);
    autoTable(pdf, {
      startY: y,
      margin,
      theme: 'grid',
      head: [[{ content: 'Compétences', styles: { halign: 'left' } }, ...sessions.map((_, i) => String(i + 1))]],
      body,
      styles: { ...base, overflow: 'ellipsize', halign: 'center' },
      headStyles: { ...headStyles, halign: 'center' },
      columnStyles: Object.fromEntries([[0, { cellWidth: labelW, halign: 'left' }], ...sessions.map((_, i) => [i + 1, { cellWidth: colW, fontSize: markSize, cellPadding: 0.3 }])]),
    });
    y = after();
  }

  // Séances
  if (sessions.length > 0) {
    autoTable(pdf, {
      startY: y,
      margin,
      theme: 'grid',
      head: [['N°', 'Date', model.teacherLabel, 'Objectif', 'Prof.', 'Durée', 'Lestage', 'Commentaire'].map(pdfText)],
      body: sessions.map((s, i): RowInput => [
        String(i + 1),
        pdfText([s.date ? frDate(s.date) : '', s.slot].filter(Boolean).join(' · ')),
        pdfText(s.teacher.name),
        pdfText(s.objective),
        pdfText(s.depth),
        pdfText(s.duration),
        pdfText(s.weight),
        pdfText(clipText(s.comment.replace(/\s*\n\s*/g, ' '), clip)),
      ]),
      styles: { ...base, overflow: 'linebreak' },
      headStyles,
      columnStyles: {
        0: { cellWidth: 7, halign: 'center', fontStyle: 'bold', textColor: NAVY },
        1: { cellWidth: 26 * Math.max(scale, 0.75) },
        2: { cellWidth: 28 },
        3: { cellWidth: 14 },
        4: { cellWidth: 11 },
        5: { cellWidth: 12 },
        6: { cellWidth: 14 },
      },
    });
    y = after();
  }

  // Cours théoriques
  if (model.theory.length > 0) {
    autoTable(pdf, {
      startY: y,
      margin,
      theme: 'grid',
      head: [['Cours théoriques', 'Date', 'Moniteur', 'Note'].map(pdfText)],
      body: model.theory.map((t): RowInput => {
        const c = fiche.theory[t.id];
        return [pdfText(t.label), c?.date ? frDate(c.date) : '', pdfText(c?.teacher ?? ''), t.exam ? pdfText(c?.note ?? '') : { content: '', styles: { fillColor: TINT } }];
      }),
      styles: { ...base, overflow: 'linebreak' },
      headStyles,
      columnStyles: { 1: { cellWidth: 28 }, 2: { cellWidth: 50 }, 3: { cellWidth: 18 } },
    });
    y = after();
  }

  // Commentaire général
  if (fiche.general.trim()) {
    autoTable(pdf, {
      startY: y,
      margin,
      theme: 'grid',
      head: [['Commentaire général']],
      body: [[pdfText(clipText(fiche.general.trim(), clip * 2))]],
      styles: { ...base, overflow: 'linebreak' },
      headStyles,
    });
    y = after();
  }

  // Réservé aux responsables plongée
  const review = fiche.review;
  const rows: RowInput[] = model.review.map((r) => {
    const valid = review.status[r.id] === 'VALIDE';
    return [pdfText(r.label), { content: valid ? 'VALIDE' : 'ATTENTE', styles: { fontStyle: 'bold', textColor: valid ? EVAL_STYLE.A.text : GREY } }];
  });
  const dates: [string, string][] = [
    ...(model.theoryDate ? [['Validation de la théorie', review.theoryDate ? frDate(review.theoryDate) : ''] as [string, string]] : []),
    ['Certification', review.certDate ? frDate(review.certDate) : ''],
    ['Responsable', review.responsable],
  ];
  // Deux colonnes côte à côte : les statuts à gauche, les dates et le responsable à droite.
  const lines = Math.max(rows.length, dates.length);
  autoTable(pdf, {
    startY: y,
    margin,
    theme: 'grid',
    head: [[{ content: 'Réservé aux responsables plongée', colSpan: 4 }]],
    body: Array.from({ length: lines }, (_, i): RowInput => [
      ...((rows[i] as CellInput[] | undefined) ?? ['', '']),
      pdfText(dates[i]?.[0] ?? ''),
      { content: pdfText(dates[i]?.[1] ?? ''), styles: { fontStyle: 'bold' } },
    ]),
    styles: { ...base, overflow: 'ellipsize' },
    headStyles,
    columnStyles: { 0: { cellWidth: width / 2 - 22 }, 1: { cellWidth: 22 }, 2: { cellWidth: 40, textColor: GREY }, 3: { cellWidth: width / 2 - 40 } },
  });

  // Pied de page
  pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GREY);
  pdf.text(pdfText(`Édité le ${frDate(today)} · A : acquis · ECA : en cours d'acquisition · NA : non acquis, à revoir · NE : non évalué`), PAGE.margin, PAGE.h - 5);
  return pdf;
}

/** La fiche sur une page : la plus grande taille de texte qui tient. `today` : AAAA-MM-JJ. */
export function trainingPdf(fiche: Fiche, today: string): jsPDF {
  let pdf: Doc | null = null;
  for (const fit of FITS) {
    pdf = draw(fiche, today, fit);
    if (pdf.getNumberOfPages() === 1) return pdf;
  }
  return pdf!;
}

/** Nom de fichier : « Fiche-suivi_N2_DUPONT-Anna.pdf ». */
export function trainingPdfFileName(fiche: Fiche): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return ['Fiche-suivi', modelOf(fiche).id, fiche.name].map(slug).filter(Boolean).join('_') + '.pdf';
}

export function downloadTrainingPdf(fiche: Fiche, today: string) {
  trainingPdf(fiche, today).save(trainingPdfFileName(fiche));
}
