import { jsPDF } from 'jspdf';
import { autoTable, type CellInput, type RowInput } from 'jspdf-autotable';
import { kindLabel, prerogativeLabel } from './palanquees';
import { diversInWater, sheetOf, type Dive, type OutingDoc, guideNoteOf } from './outing';
import { HEADER_FIELDS, PARAM_COLUMNS, PARAM_ROWS, firstNameOf, headerText, lastNameOf, noteText, paramApplies, sheetApt, sheetRows } from './safetySheet';
import { pdfText } from './pdfText';

/**
 * Fiche de sécurité d'une plongée en PDF (A4 paysage, trois palanquées par
 * ligne comme le modèle Excel) : même contenu que l'écran (lib/safetySheet).
 * Chargé à la demande, pour ne pas alourdir l'application.
 */

const PAGE = { w: 297, h: 210, margin: 10, gap: 5 };
const PER_ROW = 3;
const LABEL_W = 44;
const NAVY: [number, number, number] = [8, 36, 92];
const GREY: [number, number, number] = [110, 116, 128];
const LINE: [number, number, number] = [190, 196, 206];
const TINT: [number, number, number] = [236, 240, 247];
/** Case de paramètre sans objet (DTR réalisée, paliers prévus) : grisée, on n'y écrit rien. */
const OFF: [number, number, number] = [222, 225, 231];

/**
 * Grille d'une palanquée, en mm (somme : la largeur d'une palanquée, 89). Les personnes
 * (Nom 23, Prénom 23, Apt 15, Gaz 11) et les six paramètres (Durée 11,5, Prof. 11,5,
 * Mise à l'eau 16, DTR 10,5, Palier 3 m 11,5, Palier 6 m 11) n'ont pas les mêmes colonnes :
 * la grille est la réunion des deux, chaque case couvre les colonnes qu'il lui faut.
 */
const GRID = [17, 11.5, 11.5, 16, 7, 3.5, 11.5, 11];
/** Colonnes couvertes après le libellé : Nom, Prénom, Apt, Gaz ; puis les six paramètres. */
const PEOPLE_SPAN = [2, 2, 2, 1];
const PARAM_SPAN = [1, 1, 1, 2, 1, 1];
const CELL_PAD = 1;

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

export function safetySheetPdf(outing: OutingDoc, dive: Dive, title: string): jsPDF {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as Doc;
  const plan = dive.plan;
  const width = PAGE.w - 2 * PAGE.margin;
  pdf.setProperties({ title: pdfText(`Fiche de sécurité · ${title} · ${dive.label}`), creator: 'VPDive app' });

  // Titre
  let y = PAGE.margin + 5;
  pdf.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...NAVY);
  pdf.text(pdfText(`Fiche de sécurité · ${dive.label}`), PAGE.margin, y);
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  pdf.text(pdfText(title), PAGE.margin, y + 5);
  y += 9;

  // En-tête : trois colonnes « libellé : valeur »
  const fields = [
    ...HEADER_FIELDS.map((f) => ({ label: f.label, value: headerText(f.key, outing.header[f.key]) })),
    { label: 'Nb plongeurs', value: String(diversInWater(dive)) },
  ];
  const headerRows: RowInput[] = [];
  for (let i = 0; i < fields.length; i += 3) {
    headerRows.push(fields.slice(i, i + 3).flatMap((f): CellInput[] => [pdfText(f.label), pdfText(f.value || '')]));
  }
  autoTable(pdf, {
    startY: y,
    margin: { left: PAGE.margin, right: PAGE.margin },
    body: headerRows,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1, bottom: 1, left: 1.5, right: 2 }, overflow: 'linebreak', textColor: 20 },
    columnStyles: {
      0: { textColor: GREY, cellWidth: LABEL_W },
      1: { fontStyle: 'bold', cellWidth: width / 3 - LABEL_W },
      2: { textColor: GREY, cellWidth: LABEL_W },
      3: { fontStyle: 'bold', cellWidth: width / 3 - LABEL_W },
      4: { textColor: GREY, cellWidth: LABEL_W },
      5: { fontStyle: 'bold', cellWidth: width / 3 - LABEL_W },
    },
    didDrawCell: (c) => {
      // Trait sous chaque valeur, comme une ligne à remplir
      if (c.section === 'body' && c.column.index % 2 === 1) {
        pdf.setDrawColor(...LINE).setLineWidth(0.2).line(c.cell.x, c.cell.y + c.cell.height, c.cell.x + c.cell.width - 3, c.cell.y + c.cell.height);
      }
    },
  });
  y = (pdf.lastAutoTable?.finalY ?? y) + 6;

  // Palanquées, trois par ligne
  const colW = (width - (PER_ROW - 1) * PAGE.gap) / PER_ROW;
  const palanquees = plan?.palanquees ?? [];
  /** Largeur de la n-ième case de paramètre. */
  const paramWidth = (n: number) => {
    const from = 1 + PARAM_SPAN.slice(0, n).reduce((a, b) => a + b, 0);
    return GRID.slice(from, from + PARAM_SPAN[n]!).reduce((a, b) => a + b, 0);
  };
  /** Corps d'une valeur saisie : réduit si elle dépasse sa case (« 20 m max »), plutôt que tronquée ; au-delà, elle est abrégée. */
  const fitSize = (text: string, cellW: number) => {
    pdf.setFont('helvetica', 'normal');
    return [8, 7, 6].find((size) => pdf.setFontSize(size).getTextWidth(text) <= cellW - 2 * CELL_PAD) ?? 6;
  };
  // Hauteur d'une ligne de tableau (minCellHeight) et des en-têtes, pour prévoir le saut de page avant de dessiner.
  const ROW_H = 5.2;
  const HEAD_H = 6.5;

  for (let row = 0; row * PER_ROW < palanquees.length; row++) {
    const trio = palanquees.slice(row * PER_ROW, row * PER_ROW + PER_ROW);
    // Les trois tableaux d'une rangée ont le même nombre de lignes : colonnes alignées, hauteur connue d'avance.
    const lines = Math.max(...trio.map((p) => sheetRows(p).length));
    // Commentaire sur l'encadrant : une ligne de plus sous les paramètres (deux s'il est long).
    const noteH = trio.some((p) => guideNoteOf(dive, p)) ? 2 * ROW_H : 0;
    const blockH = (lines + 3) * ROW_H + 2 * HEAD_H + PAGE.gap + noteH;
    if (y + blockH > PAGE.h - PAGE.margin - 12) {
      pdf.addPage();
      y = PAGE.margin;
    }
    let bottom = y;
    trio.forEach((p, k) => {
      const i = row * PER_ROW + k;
      const sheet = sheetOf(dive, p.id);
      const rows = sheetRows(p);
      /** Nom, Prénom, Apt, Gaz : chacun sur ses colonnes de la grille ; Nom et Apt en gras. */
      const person = (texts: string[]): CellInput[] => texts.map((t, c) => ({ content: pdfText(t), colSpan: PEOPLE_SPAN[c]!, styles: { fontStyle: c % 2 ? 'normal' : 'bold' } }));
      const people: RowInput[] = [
        ...rows.map((r): RowInput => [
          // « Encadrant suppl. » dépasse la colonne des libellés : écrit un peu plus petit plutôt que tronqué.
          r.slot === 'extra' ? { content: pdfText(r.label), styles: { fontSize: 6, cellPadding: { top: 1, bottom: 1, left: 1, right: 0 } } } : pdfText(r.label),
          ...person(r.d ? [lastNameOf(r.d), firstNameOf(r.d), sheetApt(r.d, p, r.slot), dive.gas[r.d.id] ?? ''] : ['', '', '', '']),
        ]),
        ...Array.from({ length: lines - rows.length }, (): RowInput => ['', ...person(['', '', '', ''])]),
      ];
      const sub = { fillColor: TINT, textColor: GREY, fontStyle: 'bold' as const, fontSize: 7 };
      const params: RowInput[] = [
        [{ content: 'Paramètres', styles: sub }, ...PARAM_COLUMNS.map((c, n): CellInput => ({ content: pdfText(c.short), colSpan: PARAM_SPAN[n]!, styles: sub }))],
        ...PARAM_ROWS.map((row): RowInput => [
          row.label,
          ...PARAM_COLUMNS.map((c, n): CellInput => {
            // Sans objet sur cette ligne (DTR réalisée, paliers prévus) : case grisée, rien n'y est imprimé.
            if (!paramApplies(c, row.key)) return { content: '', colSpan: PARAM_SPAN[n]!, styles: { fillColor: OFF } };
            const text = pdfText(sheet[row.key][c.key]);
            return { content: text, colSpan: PARAM_SPAN[n]!, styles: { fontStyle: 'normal', fontSize: fitSize(text, paramWidth(n)) } };
          }),
        ]),
      ];
      const note = guideNoteOf(dive, p);
      if (note) params.push([{ content: pdfText(`Encadrant : ${noteText(note)}`), colSpan: GRID.length, styles: { fontSize: 7, fontStyle: 'normal', overflow: 'linebreak' } }]);

      const x = PAGE.margin + k * (colW + PAGE.gap);
      autoTable(pdf, {
        startY: y,
        margin: { left: x },
        tableWidth: colW,
        pageBreak: 'avoid',
        theme: 'grid',
        head: [
          [
            { content: `P${i + 1}`, styles: { fontSize: 10 } },
            { content: pdfText(`${kindLabel(p)} · ${prerogativeLabel(p)}`), colSpan: GRID.length - 1, styles: { halign: 'right' } },
          ],
          [{ content: '', styles: sub }, ...['Nom', 'Prénom', 'Apt', 'Gaz'].map((h, c) => ({ content: h, colSpan: PEOPLE_SPAN[c]!, styles: sub }))],
        ],
        body: [...people, ...params],
        styles: { font: 'helvetica', fontSize: 8, cellPadding: CELL_PAD, minCellHeight: ROW_H, valign: 'middle', overflow: 'ellipsize', lineColor: LINE, lineWidth: 0.2, textColor: 20 },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: Object.fromEntries(GRID.map((w, c) => [c, c ? { cellWidth: w } : { cellWidth: w, textColor: GREY, fontSize: 7 }])),
      });
      bottom = Math.max(bottom, pdf.lastAutoTable?.finalY ?? y);
    });
    y = bottom + PAGE.gap;
  }

  // Pied de page sur chaque feuille
  const validated = dive.validated
    ? `Palanquées validées par ${dive.validated.by} le ${new Date(dive.validated.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
    : '';
  const pages = pdf.getNumberOfPages();
  for (let n = 1; n <= pages; n++) {
    pdf.setPage(n);
    pdf.setFontSize(7).setTextColor(...GREY);
    if (validated) pdf.text(pdfText(validated), PAGE.margin, PAGE.h - 5);
    pdf.text(`${n} / ${pages}`, PAGE.w - PAGE.margin, PAGE.h - 5, { align: 'right' });
  }
  return pdf;
}

/** Nom de fichier : « Fiche-securite_2026-10-08_Pointe-Rouge_Plongee-1.pdf ». */
export function safetySheetFileName(outing: OutingDoc, dive: Dive): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return ['Fiche-securite', outing.header.date, outing.header.lieu, dive.label].map(slug).filter(Boolean).join('_') + '.pdf';
}

export function downloadSafetySheetPdf(outing: OutingDoc, dive: Dive, title: string) {
  safetySheetPdf(outing, dive, title).save(safetySheetFileName(outing, dive));
}
