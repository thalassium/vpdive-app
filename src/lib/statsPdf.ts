import { jsPDF } from 'jspdf';
import { pdfText } from './pdfText';
import { dateFr, monthSeries, monthShort, type Stats } from './stats';

/**
 * Statistiques en PDF (A4 portrait) : les mêmes chiffres et graphiques que
 * l'écran Stats, sur une page quand ils y tiennent. Chargé à la demande.
 */

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

// Couleurs du thème clair (index.css).
const NAVY = hex('#012362');
const INK = hex('#1a2233');
const MUTED = hex('#5c6577');
const LINE = hex('#e1e5ec');
const CHART = hex('#a9b9d3');
const PINK = hex('#f393a8');
const WARN = hex('#9a4800');
const SEA = ['#9bd6ea', '#66bde0', '#3b97cd', '#1f68a7', '#0d3b78'].map(hex);
const ACTIVITY_COLORS = ['#012362', '#3b97cd', '#9bd6ea', '#a9b9d3', '#7f98c2', '#c9d5e7', '#e1e5ec'].map(hex);

const PAGE = { w: 210, h: 297, margin: 14 };
const WIDTH = PAGE.w - 2 * PAGE.margin;
const GAP = 8;
/** Points → mm, pour placer une ligne de texte sous la précédente. */
const PT = 0.3528;

const nf = new Intl.NumberFormat('fr-FR');
const n = (x: number) => nf.format(x);
const plural = (x: number, one: string, many: string) => `${n(x)} ${x > 1 ? many : one}`;

export interface StatsPdfOptions {
  from: string;
  to: string;
  /** Lecture des inscrits inachevée : dit en tête du PDF. */
  partial?: string | null;
}

export function statsPdf(stats: Stats, { from, to, partial }: StatsPdfOptions): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const today = new Date();
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const period = `Du ${dateFr(from, true)} au ${dateFr(to, true)}`;
  pdf.setProperties({ title: pdfText(`Statistiques du club · ${period}`), creator: 'VPDive app' });

  const font = (size: number, color: RGB, bold = false) => pdf.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color);
  const text = (s: string, x: number, y: number, opts?: { align?: 'left' | 'right' | 'center' }) => pdf.text(pdfText(s), x, y, opts);
  /** Coupe un texte trop long pour sa colonne, avec « ... ». */
  const fit = (s: string, w: number) => {
    let t = pdfText(s);
    if (pdf.getTextWidth(t) <= w) return t;
    while (t.length > 1 && pdf.getTextWidth(`${t}...`) > w) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  const box = (x: number, y: number, w: number, h: number, color: RGB) => {
    if (w <= 0 || h <= 0) return;
    pdf.setFillColor(...color).rect(x, y, w, h, 'F');
  };
  const rounded = (x: number, y: number, w: number, h: number, r: number, color: RGB) => {
    if (w <= 0 || h <= 0) return;
    pdf.setFillColor(...color).roundedRect(x, y, w, h, Math.min(r, w / 2, h / 2), Math.min(r, w / 2, h / 2), 'F');
  };

  let y = PAGE.margin;
  /** Nouvelle page si le bloc ne tient plus. */
  const ensure = (h: number) => {
    if (y + h <= PAGE.h - PAGE.margin - 6) return;
    pdf.addPage();
    y = PAGE.margin;
  };

  /** Titre de bloc, et à droite ce qu'on compte ; renvoie le haut du contenu. */
  const heading = (title: string, x: number, top: number, w: number, aside?: string) => {
    font(11.5, NAVY, true);
    text(title, x, top + 4);
    if (aside) {
      font(8.5, MUTED);
      text(aside, x + w, top + 4, { align: 'right' });
    }
    return top + 8;
  };

  /** Barres verticales légendées (mois, âges, jours) ; renvoie le bas du bloc. */
  const columns = (x: number, top: number, w: number, h: number, items: { label: string; value: number; color: RGB }[]) => {
    const max = Math.max(1, ...items.map((i) => i.value));
    const slot = w / Math.max(1, items.length);
    const barW = Math.min(slot * 0.72, 10);
    const base = top + h;
    items.forEach((it, i) => {
      const cx = x + slot * i + slot / 2;
      const bh = it.value ? Math.max(0.8, ((h - 5) * it.value) / max) : 0;
      rounded(cx - barW / 2, base - bh, barW, bh, 0.8, it.color);
      if (it.value) {
        font(7.5, INK, true);
        text(n(it.value), cx, base - bh - 1.2, { align: 'center' });
      }
    });
    pdf.setDrawColor(...LINE).setLineWidth(0.25).line(x, base + 0.6, x + w, base + 0.6);
    font(7, MUTED);
    items.forEach((it, i) => text(it.label, x + slot * i + slot / 2, base + 4, { align: 'center' }));
    return base + 6;
  };

  /** Barre empilée et sa légende en ligne ; renvoie le bas du bloc. */
  const stacked = (x: number, top: number, w: number, parts: { label: string; count: number; color: RGB }[]) => {
    const total = Math.max(1, parts.reduce((s, p) => s + p.count, 0));
    let cx = x;
    for (const p of parts) {
      const pw = (w * p.count) / total;
      box(cx, top, pw, 3.2, p.color);
      cx += pw;
    }
    let lx = x;
    let ly = top + 8;
    for (const p of parts) {
      font(8.5, INK, true);
      const num = pdfText(n(p.count));
      const numW = pdf.getTextWidth(num);
      font(8.5, MUTED);
      const label = pdfText(p.label);
      const itemW = 3.6 + numW + 1.2 + pdf.getTextWidth(label) + 5;
      if (lx > x && lx + itemW > x + w) {
        lx = x;
        ly += 5;
      }
      box(lx, ly - 2.4, 2.4, 2.4, p.color);
      font(8.5, INK, true);
      pdf.text(num, lx + 3.6, ly);
      font(8.5, MUTED);
      pdf.text(label, lx + 3.6 + numW + 1.2, ly);
      lx += itemW;
    }
    return ly + 3;
  };

  /** Paragraphe en coupant aux mots ; les morceaux `bold` en gras bleu. Renvoie le bas. */
  const rich = (parts: { text: string; bold?: boolean }[], x: number, top: number, w: number, size: number) => {
    const words = parts.flatMap((p) => pdfText(p.text).split(/(?<= )/).map((t) => ({ t, bold: !!p.bold })));
    const lh = size * PT * 1.35;
    let cx = x;
    let cy = top + size * PT;
    for (const word of words) {
      font(size, word.bold ? NAVY : INK, word.bold);
      const ww = pdf.getTextWidth(word.t);
      if (cx > x && cx + pdf.getTextWidth(word.t.trimEnd()) > x + w) {
        cx = x;
        cy += lh;
      }
      pdf.text(word.t, cx, cy);
      cx += ww;
    }
    return cy + lh - size * PT;
  };

  // ── En-tête ──────────────────────────────────────────────────────
  box(PAGE.margin, y, WIDTH, 0.9, PINK);
  y += 8;
  font(18, NAVY, true);
  text('Statistiques du club', PAGE.margin, y);
  font(8.5, MUTED);
  text(`Édité le ${dateFr(todayYmd, true)}`, PAGE.margin + WIDTH, y, { align: 'right' });
  y += 6;
  font(10, MUTED);
  text(period, PAGE.margin, y);
  y += 5;

  y = rich(
    [
      { text: plural(stats.diveOutings, 'sortie', 'sorties'), bold: true },
      { text: ' de plongée, ' },
      { text: plural(stats.places, 'place', 'places'), bold: true },
      { text: ' réservées et ' },
      { text: plural(stats.divers, 'plongeur', 'plongeurs'), bold: true },
      { text: ' différents.' },
    ],
    PAGE.margin,
    y,
    WIDTH,
    14,
  );
  const others = stats.outings - stats.diveOutings;
  const more = [
    others > 0 && `${plural(others, 'autre événement', 'autres événements')} (réunions, cours théoriques…).`,
    stats.fill !== null && `Remplissage moyen ${Math.round(stats.fill * 100)} %.`,
    stats.waiting > 0 && `${plural(stats.waiting, 'inscription', 'inscriptions')} en liste d’attente.`,
  ]
    .filter(Boolean)
    .join(' ');
  if (more) {
    y += 2;
    font(9.5, MUTED);
    const lines = pdf.splitTextToSize(pdfText(more), WIDTH) as string[];
    pdf.text(lines, PAGE.margin, y + 3.4);
    y += lines.length * 4.4;
  }
  if (partial) {
    y += 1.5;
    font(9.5, WARN, true);
    text(partial, PAGE.margin, y + 3.4);
    y += 4.4;
  }
  y += 6;

  // ── Niveaux (gauche) · Saison et âges (droite) ──────────────────
  const leftW = 100;
  const rightX = PAGE.margin + leftW + GAP;
  const rightW = WIDTH - leftW - GAP;
  const rowTop = y;

  // Niveaux
  let ly = heading('Niveaux', PAGE.margin, rowTop, leftW, plural(stats.divers, 'plongeur', 'plongeurs'));
  const g = stats.groups;
  ly = stacked(
    PAGE.margin,
    ly,
    leftW,
    [
      { label: 'plongeurs', count: g.divers, color: SEA[2]! },
      { label: 'encadrants', count: g.staff, color: NAVY },
      { label: 'brevet d’une autre école', count: g.otherSchool, color: CHART },
      { label: 'sans niveau dans VPDive', count: g.none, color: hex('#c3cad6') },
    ].filter((p) => p.count > 0),
  );
  ly += 4;
  // Plongeurs à gauche, encadrement à droite, comme à l'écran.
  const subTop = ly;
  const staffW = 32;
  const diversW = leftW - staffW - GAP;
  const staffX = PAGE.margin + diversW + GAP;
  font(9, INK, true);
  text('Plongeurs', PAGE.margin, ly + 3);
  text('Encadrement', staffX, ly + 3);
  ly += 6;
  const labelW = 22;
  const levelMax = Math.max(1, ...stats.levels.map((l) => l.count));
  const levelBarW = diversW - labelW - 8;
  stats.levels.forEach((l, i) => {
    const tint = SEA[Math.min(SEA.length - 1, Math.floor((i / Math.max(1, stats.levels.length - 1)) * (SEA.length - 1)))]!;
    font(8.5, NAVY, true);
    pdf.text(fit(l.label, labelW - 2), PAGE.margin, ly + 3.1);
    const bw = Math.max(1.5, (levelBarW * l.count) / levelMax);
    rounded(PAGE.margin + labelW, ly, bw, 4.2, 0.8, tint);
    font(8.5, INK, true);
    text(n(l.count), PAGE.margin + labelW + bw + 1.5, ly + 3.1);
    ly += 5.4;
  });
  if (stats.otherSchools.length) {
    font(8, MUTED);
    const lines = pdf.splitTextToSize(pdfText(`Autres écoles : ${stats.otherSchools.map((x) => `${x.label} ${n(x.count)}`).join(', ')}.`), diversW) as string[];
    pdf.text(lines, PAGE.margin, ly + 3);
    ly += lines.length * 3.6 + 1;
  }
  let sy = subTop + 6;
  const staffMax = Math.max(1, ...stats.staff.map((x) => x.count));
  const staffTrack = staffW - 8 - 7;
  for (const s of stats.staff) {
    font(8.5, NAVY, true);
    text(s.level, staffX, sy + 3.1);
    rounded(staffX + 8, sy + 1.4, staffTrack, 1.8, 0.9, LINE);
    rounded(staffX + 8, sy + 1.4, (staffTrack * s.count) / staffMax, 1.8, 0.9, NAVY);
    font(8.5, INK);
    text(n(s.count), staffX + staffW, sy + 3.1, { align: 'right' });
    sy += 5.4;
  }
  ly = Math.max(ly, sy);
  if (stats.training.length) {
    ly += 2;
    font(9, INK);
    const lines = pdf.splitTextToSize(pdfText(`En formation : ${stats.training.map((t) => `${n(t.count)} vers le ${t.label}`).join(', ')}.`), leftW) as string[];
    pdf.text(lines, PAGE.margin, ly + 3);
    ly += lines.length * 4;
  }

  // Saison
  let ry = heading('Saison', rightX, rowTop, rightW, 'sorties par mois');
  const months = monthSeries(stats.months, from, to);
  const monthMax = Math.max(0, ...months.map((m) => m.outings));
  const peaks = months.filter((m) => m.outings === monthMax);
  const peak = peaks.length === 1 && monthMax > 0 ? peaks[0] : null;
  ry = columns(
    rightX,
    ry,
    rightW,
    30,
    // Sur plus de douze mois, une lettre par mois.
    months.map((m) => ({ label: months.length > 12 ? monthShort(m.key).slice(0, 1) : monthShort(m.key), value: m.outings, color: m === peak ? PINK : NAVY })),
  );
  ry += 5;

  // Âges
  const { bins, median, minors, known } = stats.ages;
  ry = heading('Âges', rightX, ry, rightW, median !== null ? `âge médian ${median} ans` : undefined);
  if (known === 0) {
    font(9, MUTED);
    text('Âges pas encore lus.', rightX, ry + 3);
    ry += 6;
  } else {
    const medianBin = median === null ? -1 : bins.findIndex((b, i) => median >= b.from && median < (bins[i + 1]?.from ?? Infinity));
    ry = columns(rightX, ry, rightW, 22, bins.map((b, i) => ({ label: b.label, value: b.count, color: i === medianBin ? NAVY : CHART })));
    if (minors > 0) {
      font(8, MUTED);
      text(`${plural(minors, 'mineur', 'mineurs')} sur ${n(known)}`, rightX, ry + 3);
      ry += 5;
    }
  }

  // Événements, sous les niveaux
  ly = heading('Événements', PAGE.margin, ly + 7, leftW, `${n(stats.outings)} au total`);
  const total = Math.max(1, stats.outings);
  let cx = PAGE.margin;
  stats.activities.forEach((a, i) => {
    const w = (leftW * a.count) / total;
    box(cx, ly, w, 3.2, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]!);
    cx += w;
  });
  ly += 7.5;
  const half = (leftW - GAP) / 2;
  stats.activities.forEach((a, i) => {
    const x = PAGE.margin + (i % 2) * (half + GAP);
    const rowY = ly + Math.floor(i / 2) * 4.4;
    box(x, rowY - 2.4, 2.4, 2.4, ACTIVITY_COLORS[i % ACTIVITY_COLORS.length]!);
    font(8.5, INK);
    pdf.text(fit(a.label, half - 12), x + 3.6, rowY);
    font(8.5, MUTED);
    text(n(a.count), x + half, rowY, { align: 'right' });
  });
  ly += Math.ceil(stats.activities.length / 2) * 4.4;

  // Jours de plongée, sous les âges
  ry = heading('Jours de plongée', rightX, ry + 5, rightW);
  ry = columns(rightX, ry, rightW, 18, stats.weekdays.map((c, i) => ({ label: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'][i]!, value: c, color: NAVY })));

  y = Math.max(ly, ry) + 7;

  // ── Classements ─────────────────────────────────────────────────
  const colW = (WIDTH - 2 * GAP) / 3;
  const rankings: { title: string; rows: Stats['regulars']; note?: string }[] = [
    { title: 'Directeurs de plongée', rows: stats.directors, note: `DP connu pour ${plural(stats.dpKnown.known, 'sortie', 'sorties')} sur ${n(stats.dpKnown.of)}.` },
    { title: 'Encadrants', rows: stats.instructors },
    { title: 'Les plus assidus', rows: stats.regulars },
  ];
  const rankH = 14 + Math.max(1, ...rankings.map((r) => r.rows.length)) * 6.2 + 8;
  ensure(rankH);
  font(8.5, MUTED);
  text('Classements en nombre de sorties', PAGE.margin, y + 3);
  y += 6;
  let bottom = y;
  rankings.forEach((r, i) => {
    const x = PAGE.margin + i * (colW + GAP);
    let cy = heading(r.title, x, y, colW);
    if (r.rows.length === 0) {
      font(9, MUTED);
      text('Personne pour l’instant.', x, cy + 3);
      cy += 6;
    }
    const max = Math.max(1, ...r.rows.map((p) => p.count));
    r.rows.forEach((p, k) => {
      font(8.5, MUTED);
      text(`${k + 1}`, x + 3, cy + 3, { align: 'right' });
      font(8.5, INK);
      pdf.text(fit(p.name, colW - 14), x + 5, cy + 3);
      font(8.5, INK, true);
      text(n(p.count), x + colW, cy + 3, { align: 'right' });
      rounded(x + 5, cy + 4.2, colW - 5, 0.8, 0.4, LINE);
      rounded(x + 5, cy + 4.2, ((colW - 5) * p.count) / max, 0.8, 0.4, NAVY);
      cy += 6.2;
    });
    if (r.note) {
      font(7.5, MUTED);
      const lines = pdf.splitTextToSize(pdfText(r.note), colW) as string[];
      pdf.text(lines, x, cy + 2.6);
      cy += lines.length * 3.4 + 1;
    }
    bottom = Math.max(bottom, cy);
  });
  y = bottom;


  // ── Pied de page ────────────────────────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    font(7.5, MUTED);
    text(`Statistiques du club · ${period}`, PAGE.margin, PAGE.h - 8);
    if (pages > 1) text(`${p} / ${pages}`, PAGE.margin + WIDTH, PAGE.h - 8, { align: 'right' });
  }
  return pdf;
}

export function downloadStatsPdf(stats: Stats, opts: StatsPdfOptions) {
  statsPdf(stats, opts).save(`statistiques-${opts.from}-${opts.to}.pdf`);
}
