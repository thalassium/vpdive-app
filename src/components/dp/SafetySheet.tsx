import { useState } from 'react';
import { AlertTriangle, ChevronDown, FileDown, MessageSquare, Printer } from 'lucide-react';
import { Menu } from '../Menu';
import { Spinner } from '../Spinner';
import { useConfirm } from '../../hooks/useConfirm';
import { chosenDepth, depthOf, kindLabel, prerogativeLabel } from '../../lib/palanquees';
import { diversInWater, emptySheet, parseDepth, type DiveParams, type Dive, type OutingDoc, type PalanqueeSheet, type SafetyHeader } from '../../lib/outing';
import { HEADER_FIELDS, firstNameOf, lastNameOf, missingHeader, noteText, printWarnings, sheetApt, sheetRows } from '../../lib/safetySheet';

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-brand print:text-black">Fiche de sécurité · {dive.label}</h3>
        </div>
        <div className="print:hidden flex flex-wrap items-center gap-2">
          {pdfState === 'error' && <span className="text-sm text-danger">PDF indisponible, réessayez</span>}
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
      </div>

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

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-3 print:gap-2">
        {plan.palanquees.map((p, i) => {
          const sheet = dive.sheets[p.id] ?? emptySheet();
          const rows = sheetRows(p);
          const note = dive.notes?.[p.id];
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
                    {rows.map((r) => (
                      <tr key={r.label} className="border-t border-line print:border-black/30">
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
              {/* Même chose pour les paramètres : sur un téléphone étroit, la table défile au lieu de rogner ses champs. */}
              <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full text-sm border-t-2 border-line print:border-black">
                <thead>
                  <tr className="text-left text-sm print:text-xs text-muted">
                    <th className="px-3 py-1.5 font-semibold w-24">Paramètres</th>
                    <th className="py-1.5 font-semibold">Durée (min)</th>
                    <th className="py-1.5 font-semibold">Profondeur (m)</th>
                    <th className="py-1.5 pr-3 font-semibold">H. mise à l’eau</th>
                  </tr>
                </thead>
                <tbody>
                  {(['planned', 'actual'] as const).map((k) => (
                    <tr key={k} className="border-t border-line print:border-black/30">
                      <th className="px-3 py-1.5 text-left text-sm print:text-xs font-semibold text-muted">{k === 'planned' ? 'Prévus' : 'Réalisés'}</th>
                      <ParamsCells
                        value={sheet[k]}
                        depthHint={k === 'planned' ? String(chosenDepth(p) || '') : ''}
                        depthAlert={k === 'planned' && tooDeep}
                        onChange={(v) => onSheet(p.id, { ...sheet, [k]: v })}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
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
      </fieldset>
      {confirmDialog}
    </div>
  );
}

function ParamsCells({ value, depthHint, depthAlert = false, onChange }: { value: DiveParams; depthHint: string; depthAlert?: boolean; onChange: (v: DiveParams) => void }) {
  const cell = (key: keyof DiveParams, props: { type?: string; placeholder?: string; inputMode?: 'numeric' }) => (
    <td className="py-1 pr-2 last:pr-3">
      <input
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        aria-invalid={key === 'depth' && depthAlert ? true : undefined}
        className={`field w-full sm:h-9 px-2 text-sm tabular-nums print:border-0 print:p-0 ${key === 'depth' && depthAlert ? 'border-danger text-danger' : ''}`}
        {...props}
      />
    </td>
  );

  return (
    <>
      {cell('duration', { inputMode: 'numeric', placeholder: 'min' })}
      {cell('depth', { inputMode: 'numeric', placeholder: depthHint ? `${depthHint} max` : 'm' })}
      {cell('time', { type: 'time' })}
    </>
  );
}

const fieldCls = 'field w-full text-base sm:text-sm print:h-auto print:border-0 print:px-0 print:font-semibold';
