import { useState } from 'react';
import { AlertTriangle, ChevronDown, FileDown, MessageSquare, Printer } from 'lucide-react';
import { Menu } from '../Menu';
import { SectionTitle } from '../SectionTitle';
import { Spinner } from '../Spinner';
import { useConfirm } from '../../hooks/useConfirm';
import { chosenDepth, depthOf, kindLabel, prerogativeLabel } from '../../lib/palanquees';
import { diversInWater, parseDepth, sheetOf, type DiveParams, type Dive, type OutingDoc, type PalanqueeSheet, type SafetyHeader, guideNoteOf } from '../../lib/outing';
import { HEADER_FIELDS, PARAM_COLUMNS, PARAM_ROWS, firstNameOf, lastNameOf, missingHeader, noteText, paramApplies, printWarnings, sheetApt, sheetRows } from '../../lib/safetySheet';

interface Props {
  /** Titre de la sortie, repris sur le PDF. */
  title: string;
  doc: OutingDoc;
  dive: Dive;
  /** Un autre modifie la fiche : elle se lit, s'imprime, ne se change pas. */
  readOnly?: boolean;
  onHeader: (header: SafetyHeader) => void;
  onSheet: (palanqueeId: string, sheet: PalanqueeSheet) => void;
  onGas: (diverId: string, gas: string) => void;
}

/**
 * Fiche de sécurité d'une plongée (art. A322-72 du Code du sport), sur le
 * modèle ressourcedev/Fiche-securite-plongee.xlsx. Débloquée quand les
 * palanquées sont validées ; s'imprime seule (index.css, #print-sheet).
 */
export function SafetySheet({ title, doc, dive, readOnly = false, onHeader, onSheet, onGas }: Props) {
  const plan = dive.plan!;
  const header = doc.header;
  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'error'>('idle');
  const missing = missingHeader(header);
  const { confirm, confirmDialog } = useConfirm();

  /**
   * Avant le PDF ou l'impression : en-tête incomplet (DP, pilote, date, lieu) ou
   * profondeur prévue au-delà d'une prérogative, à confirmer explicitement.
   */
  const confirmPrint = async () => {
    const warnings = printWarnings(header, dive);
    if (!warnings.length) return true;
    return confirm({
      title: 'Imprimer quand même ?',
      message: (
        <>
          Avant d’imprimer la fiche :
          <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ),
      confirmLabel: 'Continuer',
    });
  };

  /** Le générateur de PDF n'est chargé qu'au premier clic. */
  const downloadPdf = async () => {
    if (!(await confirmPrint())) return;
    setPdfState('busy');
    try {
      const { downloadSafetySheetPdf } = await import('../../lib/safetySheetPdf');
      downloadSafetySheetPdf(doc, dive, title);
      setPdfState('idle');
    } catch {
      setPdfState('error');
    }
  };
  return (
    <div id="print-sheet" className="space-y-6">
      {/* Bandeau rose à l'écran ; à l'impression, texte marine et filet (section-title). */}
      <SectionTitle
        bleed
        actions={
          <div className="print:hidden flex flex-wrap items-center gap-2">
            {pdfState === 'error' && <span className="rounded-md bg-surface px-1.5 text-sm text-danger">PDF indisponible, réessayez</span>}
            <button
              type="button"
              onClick={() => void downloadPdf()}
              disabled={pdfState === 'busy'}
              aria-busy={pdfState === 'busy'}
              className="btn btn-primary sm:h-9 text-sm"
            >
              {pdfState === 'busy' ? <Spinner /> : <FileDown className="w-4 h-4" />} PDF
            </button>
            <button
              type="button"
              onClick={async () => {
                if (await confirmPrint()) window.print();
              }}
              className="btn btn-quiet sm:h-9 text-sm"
            >
              <Printer className="w-4 h-4" /> Imprimer
            </button>
          </div>
        }
      >
        Fiche de sécurité · {dive.label}
      </SectionTitle>

      {missing.length > 0 && (
        <p role="status" className="text-sm text-warn flex items-start gap-1.5 print:hidden">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> À renseigner avant d’imprimer : {missing.join(', ')}.
        </p>
      )}

      <fieldset disabled={readOnly} className="min-w-0 space-y-6">
      <section className="grid sm:grid-cols-2 gap-x-6 gap-y-3 print:grid-cols-3 print:gap-y-1">
        {HEADER_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className={`block label print:text-xs mb-1 print:mb-0 ${missing.includes(f.label) ? 'text-warn' : ''}`}>{f.label}</span>
            {f.options ? (
              <Menu
                ariaLabel={f.label}
                triggerClassName={`${fieldCls} inline-flex items-center justify-between w-full text-left`}
                trigger={
                  <>
                    {header[f.key] || '—'}
                    <ChevronDown className="w-4 h-4 opacity-60 print:hidden" />
                  </>
                }
                sections={[{ selected: header[f.key], onSelect: (v) => onHeader({ ...header, [f.key]: v }), options: f.options.map((o) => ({ value: o, label: o || '—' })) }]}
              />
            ) : (
              <input type={f.type ?? 'text'} value={header[f.key]} onChange={(e) => onHeader({ ...header, [f.key]: e.target.value })} className={fieldCls} />
            )}
          </label>
        ))}
        <div>
          <span className="block label print:text-xs mb-1 print:mb-0">Nb plongeurs</span>
          <span className="block h-11 leading-11 px-3.5 font-semibold tabular-nums print:h-auto print:leading-normal print:px-0">{diversInWater(dive)}</span>
        </div>
      </section>

      {/* Deux palanquées de front sur ordinateur, si chacune garde la largeur de ses paramètres (pas sur une tablette en paysage : une par ligne). */}
      <div className="@container">
      <div className="grid lg:@2xl:grid-cols-2 gap-4 print:grid-cols-3 print:gap-2">
        {plan.palanquees.map((p, i) => {
          const sheet = sheetOf(dive, p.id);
          const rows = sheetRows(p);
          const note = guideNoteOf(dive, p);
          // Profondeur prévue au-delà de la prérogative de la palanquée : signalée, à confirmer avant d'imprimer.
          const planned = parseDepth(sheet.planned.depth);
          const legal = depthOf(p);
          const tooDeep = planned !== undefined && planned > legal;
          return (
            <section key={p.id} className="card overflow-hidden break-inside-avoid print:rounded-none print:border-black">
              <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line print:bg-white print:border-black">
                <span className="font-semibold text-brand print:text-black">P{i + 1}</span>
                <span className="text-sm text-muted print:text-black">
                  {kindLabel(p)} · <span className="code print:text-black">{prerogativeLabel(p)}</span>
                </span>
              </header>
              {/* Sur téléphone, la table défile plutôt que d'être rognée ; à l'impression, rien ne change. */}
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-sm print:text-xs text-muted">
                      <th className="px-3 py-1.5 font-semibold w-24" />
                      <th className="py-1.5 font-semibold">Nom</th>
                      <th className="py-1.5 font-semibold">Prénom</th>
                      <th className="py-1.5 font-semibold">Apt</th>
                      <th className="py-1.5 pr-3 font-semibold w-20">Gaz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, n) => (
                      <tr key={n} className="border-t border-line print:border-black/30">
                        <th className="px-3 py-1.5 text-left text-sm print:text-xs font-semibold text-muted whitespace-nowrap">{r.label}</th>
                        <td className="py-1.5 pr-2 font-medium text-ink uppercase">{r.d ? lastNameOf(r.d) : ''}</td>
                        <td className="py-1.5 pr-2 text-ink">{r.d ? firstNameOf(r.d) : ''}</td>
                        <td className="py-1.5 pr-2 font-semibold tabular-nums">{r.d ? sheetApt(r.d, p, r.slot) : ''}</td>
                        <td className="py-1 pr-3">
                          {r.d && (
                            <input
                              value={dive.gas[r.d.id] ?? ''}
                              onChange={(e) => onGas(r.d!.id, e.target.value)}
                              placeholder="air"
                              aria-label={`Gaz de ${r.d.name}`}
                              className="field w-full sm:h-9 px-2 text-sm print:border-0 print:p-0"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/*
                Paramètres : la table Prévus / Réalisés (durée, profondeur, heure), puis une bande d'une seule
                ligne : la DTR prévue et les paliers à 3 m et à 6 m réalisés, en minutes sans le redire.
                Sur un téléphone très étroit, la table défile plutôt que de rogner ses champs.
              */}
              <div className="border-t-2 border-line print:border-black">
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left align-bottom text-sm print:text-xs text-muted">
                        <th className="pl-3 pr-2 py-1.5 font-semibold print:pl-2 print:pr-1">Paramètres</th>
                        {MAIN_PARAMS.map((c, n) => (
                          <th key={c.key} className={`py-1.5 pr-1.5 last:pr-3 font-semibold ${PARAM_SLOTS[n]!.share}`}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PARAM_ROWS.map((row) => (
                        <tr key={row.key} className="border-t border-line print:border-black/30">
                          <th className="pl-3 pr-2 py-1.5 text-left text-sm print:text-xs font-semibold text-muted print:pl-2 print:pr-1">{row.label}</th>
                          <ParamsCells
                            row={row}
                            columns={MAIN_PARAMS}
                            value={sheet[row.key]}
                            depthHint={row.key === 'planned' ? String(chosenDepth(p) || '') : ''}
                            depthAlert={row.key === 'planned' && tooDeep}
                            onChange={(v) => onSheet(p.id, { ...sheet, [row.key]: v })}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-2 px-3 py-2 border-t border-line print:border-black/30 print:px-2">
                  {BAND_PARAMS.map((c) => {
                    const row = c.only!;
                    return (
                      <label key={c.key} className="min-w-0">
                        <span className="block mb-1 text-sm print:text-xs font-semibold text-muted">{c.label}</span>
                        <input
                          value={sheet[row][c.key]}
                          onChange={(e) => onSheet(p.id, { ...sheet, [row]: { ...sheet[row], [c.key]: e.target.value } })}
                          inputMode="numeric"
                          className="field w-full sm:h-9 px-2 text-sm tabular-nums print:h-auto print:border-0 print:p-0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              {tooDeep && (
                <p role="alert" className="px-3 py-2 border-t border-line text-sm text-danger flex items-start gap-1.5 print:text-black">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {planned} m prévus : au-delà de la prérogative de la palanquée ({legal} m).
                </p>
              )}
              {note && (
                <p className="px-3 py-2 border-t border-line text-sm text-ink flex items-start gap-1.5 print:border-black/30">
                  <MessageSquare className="w-4 h-4 shrink-0 mt-0.5 text-muted print:hidden" />
                  <span>
                    <span className="text-muted">Encadrant : </span>
                    {noteText(note)}
                  </span>
                </p>
              )}
            </section>
          );
        })}
      </div>
      </div>
      </fieldset>
      {confirmDialog}
    </div>
  );
}

/** Durée, profondeur et heure : une ligne Prévus, une ligne Réalisés. */
const MAIN_PARAMS = PARAM_COLUMNS.filter((c) => !c.only);
/** La bande sous la table : DTR prévue, paliers à 3 m et à 6 m réalisés (un seul champ chacun). */
const BAND_PARAMS = PARAM_COLUMNS.filter((c) => c.only);

/**
 * Les trois colonnes d'une table de paramètres, par position : leur part de la table (le libellé
 * des lignes prend le reste) et la largeur minimale de leur champ — de quoi lire « 120 », « 40 max »
 * et une heure avec son horloge ; en dessous, la table défile plutôt que d'écraser ses champs.
 * Les mêmes dans les deux tables, pour que leurs colonnes tombent l'une sous l'autre ; le tout
 * tient dans la carte d'un téléphone de 360 px de large. À l'impression, la profondeur (« 18,5 m »)
 * prend un peu de la place de la durée.
 */
const PARAM_SLOTS = [
  { share: 'w-[22.5%] print:w-[19%]', min: 'min-w-11' },
  { share: 'w-[20.5%] print:w-[25%]', min: 'min-w-[4.125rem]' },
  { share: 'w-[28.5%]', min: 'min-w-[5.5rem]' },
];

/**
 * Les cases d'une ligne de paramètres (prévus ou réalisés) pour les colonnes d'une table.
 * Une colonne qui ne se remplit pas sur cette ligne (DTR en réalisés, paliers en prévus)
 * donne une case grisée, sans champ.
 */
function ParamsCells({
  row,
  columns,
  value,
  depthHint,
  depthAlert = false,
  onChange,
}: {
  row: (typeof PARAM_ROWS)[number];
  columns: typeof PARAM_COLUMNS;
  value: DiveParams;
  depthHint: string;
  depthAlert?: boolean;
  onChange: (v: DiveParams) => void;
}) {
  /** Saisie de chaque champ : tout est numérique, sauf l'heure. */
  const input: Record<keyof DiveParams, { type?: string; placeholder?: string; inputMode?: 'numeric' }> = {
    duration: { inputMode: 'numeric', placeholder: 'min' },
    depth: { inputMode: 'numeric', placeholder: depthHint ? `${depthHint} max` : 'm' },
    time: { type: 'time' },
    dtr: { inputMode: 'numeric', placeholder: 'min' },
    stop3: { inputMode: 'numeric', placeholder: 'min' },
    stop6: { inputMode: 'numeric', placeholder: 'min' },
  };

  return (
    <>
      {columns.map((c, n) => {
        const props = input[c.key];
        const width = PARAM_SLOTS[n]!.min;
        const alert = c.key === 'depth' && depthAlert;
        return (
          <td key={c.key} className="py-1 pr-1.5 last:pr-3">
            {paramApplies(c, row.key) ? (
              <input
                value={value[c.key]}
                onChange={(e) => onChange({ ...value, [c.key]: e.target.value })}
                aria-label={`${c.label}, ${row.label.toLowerCase()}`}
                aria-invalid={alert ? true : undefined}
                className={`field w-full ${width} sm:h-9 px-2 text-sm tabular-nums print:min-w-0 print:border-0 print:p-0 print:[&::-webkit-calendar-picker-indicator]:hidden ${alert ? 'border-danger text-danger' : ''}`}
                {...props}
              />
            ) : (
              <div aria-hidden className={`h-11 sm:h-9 ${width} rounded-lg bg-line/60 print:min-w-0 print:h-4 print:rounded-none print:bg-black/10`} />
            )}
          </td>
        );
      })}
    </>
  );
}

const fieldCls = 'field w-full text-base sm:text-sm print:h-auto print:border-0 print:px-0 print:font-semibold';
