import { jsPDF } from 'jspdf';
import { autoTable, type CellInput, type RowInput } from 'jspdf-autotable';
import { KIND_LABEL, prerogativeLabel } from './palanquees';
import { diversInWater, emptySheet, type Dive, type OutingDoc } from './outing';
import { HEADER_FIELDS, SHEET_FOOTNOTE, firstNameOf, headerText, lastNameOf, sheetApt, sheetRows } from './safetySheet';

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

/** Les polices standard du PDF ne couvrent que le latin-1 : on remplace la typographie qui en sort. */
const pdfText = (s: string) =>
  s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/ᵉ/g, 'e').replace(/[  ]/g, ' ').replace(/[–—]/g, '-');

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
  pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY);
  pdf.text(pdfText('Art. A322-72 du code du sport et R4461-13 du code du travail'), PAGE.w - PAGE.margin, y, { align: 'right' });
  pdf.setFontSize(9).text(pdfText(title), PAGE.margin, y + 5);
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
  const widths = [17, 0, 0, 15, 11];
  const nameW = (colW - widths[0]! - widths[3]! - widths[4]!) / 2;
  widths[1] = nameW;
  widths[2] = nameW;
  let blockH = 0;
  const palanquees = plan?.palanquees ?? [];

  for (let row = 0; row * PER_ROW < palanquees.length; row++) {
    if (blockH && y + blockH > PAGE.h - PAGE.margin - 12) {
      pdf.addPage();
      y = PAGE.margin;
    }
    let bottom = y;
    palanquees.slice(row * PER_ROW, row * PER_ROW + PER_ROW).forEach((p, k) => {
      const i = row * PER_ROW + k;
      const sheet = dive.sheets[p.id] ?? emptySheet();
      const people: RowInput[] = sheetRows(p).map((r) => [
        pdfText(r.label),
        r.d ? pdfText(lastNameOf(r.d)) : '',
        r.d ? pdfText(firstNameOf(r.d)) : '',
        r.d ? pdfText(sheetApt(r.d, p, r.slot)) : '',
        r.d ? pdfText(dive.gas[r.d.id] ?? '') : '',
      ]);
      const sub = { fillColor: TINT, textColor: GREY, fontStyle: 'bold' as const, fontSize: 7 };
      const params: RowInput[] = [
        [
          { content: 'Paramètres', styles: sub },
          { content: 'Durée (min)', styles: sub },
          { content: 'Prof. (m)', styles: sub },
          { content: pdfText('H. mise à l’eau'), colSpan: 2, styles: sub },
        ],
        ...(['planned', 'actual'] as const).map((key): RowInput => {
          const v = { fontStyle: 'normal' as const };
          return [
            key === 'planned' ? 'Prévus' : 'Réalisés',
            { content: sheet[key].duration, styles: v },
            { content: sheet[key].depth, styles: v },
            { content: sheet[key].time, colSpan: 2, styles: v },
          ];
        }),
      ];
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
            { content: pdfText(`${KIND_LABEL[p.kind]} · ${prerogativeLabel(p)}`), colSpan: 4, styles: { halign: 'right' } },
          ],
          ['', 'Nom', 'Prénom', 'Apt', 'Gaz'].map((h) => ({ content: h, styles: sub })),
        ],
        body: [...people, ...params],
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1, minCellHeight: 5.2, valign: 'middle', overflow: 'ellipsize', lineColor: LINE, lineWidth: 0.2, textColor: 20 },
        headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
        columnStyles: {
          0: { cellWidth: widths[0], textColor: GREY, fontSize: 7 },
          1: { cellWidth: widths[1], fontStyle: 'bold' },
          2: { cellWidth: widths[2] },
          3: { cellWidth: widths[3], fontStyle: 'bold' },
          4: { cellWidth: widths[4] },
        },
      });
      bottom = Math.max(bottom, pdf.lastAutoTable?.finalY ?? y);
    });
    blockH = bottom - y + PAGE.gap;
    y = bottom + PAGE.gap;
  }

  // Note du modèle, puis pied de page sur chaque feuille
  pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GREY);
  const note = pdf.splitTextToSize(pdfText(SHEET_FOOTNOTE), width);
  if (y + note.length * 3 > PAGE.h - PAGE.margin - 5) {
    pdf.addPage();
    y = PAGE.margin;
  }
  pdf.text(note, PAGE.margin, y + 2);

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
