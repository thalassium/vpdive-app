import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { KIND_LABEL, chosenDepth, prerogativeLabel, type Diver, type Palanquee } from '../../lib/palanquees';
import { diversInWater, emptySheet, type DiveParams, type Dive, type OutingDoc, type PalanqueeSheet, type SafetyHeader } from '../../lib/outing';

interface Props {
  doc: OutingDoc;
  dive: Dive;
  onHeader: (header: SafetyHeader) => void;
  onSheet: (palanqueeId: string, sheet: PalanqueeSheet) => void;
  onGas: (diverId: string, gas: string) => void;
}

/**
 * Colonne APT de la fiche (note 5 du modèle) : aptitude PE/PA pour les
 * plongeurs, niveau pour les encadrants, E2 en enseignement mais GP/P4 en
 * exploration, FN# pour un élève.
 */
function sheetApt(d: Diver, p: Palanquee, slot: 'guide' | 'member' | 'extra'): string {
  if (slot === 'extra') return 'GP / P4';
  if (slot === 'guide') {
    if (p.kind === 'teaching') return d.teach ? `E${d.teach}` : '?';
    return d.guide === 'GP' ? 'GP / P4' : d.guide ? (d.teach >= 3 ? `E${d.teach}` : d.guide) : '?';
  }
  if (d.training && p.kind === 'teaching') return `FN${d.training}`;
  if (p.kind === 'autonomous') return d.pa ? `PA${d.pa}` : '?';
  if (d.beginner && !d.pe) return 'Débutant';
  return d.pe ? `PE${d.pe}` : '?';
}

const HEADER_FIELDS: { key: keyof SafetyHeader; label: string; type?: string; options?: string[] }[] = [
  { key: 'etablissement', label: 'Nom de l’établissement d’APS' },
  { key: 'reference', label: 'Référence (n° de club, RCS…)' },
  { key: 'bateau', label: 'Bateau' },
  { key: 'pilote', label: 'Pilote' },
  { key: 'dp', label: 'Directeur de plongée' },
  { key: 'securite', label: 'Sécurité de surface' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'creneau', label: 'Matin / Après-midi / Nuit', options: ['', 'Matin', 'Après-midi', 'Nuit'] },
  { key: 'lieu', label: 'Lieu de plongée' },
];

/**
 * Fiche de sécurité d'une plongée (art. A322-72 du Code du sport), sur le
 * modèle ressourcedev/Fiche-securite-plongee.xlsx. Débloquée quand les
 * palanquées sont validées ; s'imprime seule (index.css, #print-sheet).
 */
export function SafetySheet({ doc, dive, onHeader, onSheet, onGas }: Props) {
  const plan = dive.plan!;
  const header = doc.header;
  return (
    <div id="print-sheet" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-brand print:text-black">Fiche de sécurité · {dive.label}</h3>
          <p className="text-xs text-muted">Art. A322-72 du code du sport et R4461-13 du code du travail</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="print:hidden inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-line bg-surface text-sm font-medium text-ink hover:border-brand/40 hover:text-brand"
        >
          <Printer className="w-4 h-4" /> Imprimer
        </button>
      </div>

      <section className="grid sm:grid-cols-2 gap-x-6 gap-y-3 print:grid-cols-3 print:gap-y-1">
        {HEADER_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-xs font-semibold text-muted mb-1 print:mb-0">{f.label}</span>
            {f.options ? (
              <select value={header[f.key]} onChange={(e) => onHeader({ ...header, [f.key]: e.target.value })} className={fieldCls}>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o || '—'}
                  </option>
                ))}
              </select>
            ) : (
              <input type={f.type ?? 'text'} value={header[f.key]} onChange={(e) => onHeader({ ...header, [f.key]: e.target.value })} className={fieldCls} />
            )}
          </label>
        ))}
        <div>
          <span className="block text-xs font-semibold text-muted mb-1 print:mb-0">Nb plongeurs</span>
          <span className="block h-10 leading-10 px-3 font-semibold tabular-nums print:h-auto print:leading-normal print:px-0">{diversInWater(dive)}</span>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-3 print:gap-2">
        {plan.palanquees.map((p, i) => {
          const sheet = dive.sheets[p.id] ?? emptySheet();
          const rows: { label: string; d: Diver | null; slot: 'guide' | 'member' | 'extra' }[] = [
            { label: p.kind === 'teaching' ? 'Enseignant' : 'Encadrant', d: p.kind === 'autonomous' ? null : p.guide, slot: 'guide' },
            ...[0, 1, 2, 3].map((n) => ({
              label: `Plongeur ${n + 1}`,
              d: (p.kind === 'autonomous' ? [p.guide, ...p.members].filter(Boolean) : p.members)[n] ?? null,
              slot: 'member' as const,
            })),
            { label: 'GP suppl.', d: p.extra, slot: 'extra' },
          ];
          return (
            <section key={p.id} className="rounded-xl border border-line overflow-hidden break-inside-avoid print:rounded-none print:border-black">
              <header className="flex items-center justify-between gap-2 px-3 py-2 bg-raised print:bg-white print:border-b print:border-black">
                <span className="font-semibold text-brand print:text-black">P{i + 1}</span>
                <span className="text-sm font-semibold text-muted print:text-black">{KIND_LABEL[p.kind]} · {prerogativeLabel(p)}</span>
              </header>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
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
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted whitespace-nowrap">{r.label}</th>
                      <td className="py-1.5 pr-2 font-medium text-ink uppercase">{r.d ? (r.d.lastname ?? r.d.name) : ''}</td>
                      <td className="py-1.5 pr-2 text-ink">{r.d?.firstname ?? ''}</td>
                      <td className="py-1.5 pr-2 font-semibold tabular-nums">{r.d ? sheetApt(r.d, p, r.slot) : ''}</td>
                      <td className="py-1 pr-3">
                        {r.d && (
                          <input
                            value={dive.gas[r.d.id] ?? ''}
                            onChange={(e) => onGas(r.d!.id, e.target.value)}
                            placeholder="air"
                            aria-label={`Gaz de ${r.d.name}`}
                            className="w-full h-8 rounded-md border border-line bg-surface px-1.5 text-sm print:border-0 print:p-0"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full text-sm border-t-2 border-line print:border-black">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-3 py-1.5 font-semibold w-24">Paramètres</th>
                    <th className="py-1.5 font-semibold">Durée (min)</th>
                    <th className="py-1.5 font-semibold">Profondeur (m)</th>
                    <th className="py-1.5 pr-3 font-semibold">H. mise à l’eau</th>
                  </tr>
                </thead>
                <tbody>
                  {(['planned', 'actual'] as const).map((k) => (
                    <tr key={k} className="border-t border-line print:border-black/30">
                      <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted">{k === 'planned' ? 'Prévus' : 'Réalisés'}</th>
                      <ParamsCells
                        value={sheet[k]}
                        depthHint={k === 'planned' ? String(chosenDepth(p) || '') : ''}
                        onChange={(v) => onSheet(p.id, { ...sheet, [k]: v })}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      <Footnote>
        Le non-respect des paramètres prévus par le DP engage potentiellement la responsabilité de l’encadrant de palanquée ou des plongeurs
        autonomes. Gaz : laisser vide pour une plongée à l’air. Aptitudes PE/PA pour les plongeurs, niveau pour les encadrants (GP/P4, E1, E2,
        E3…) : E2 en enseignement (20 m), GP/P4 en exploration.
      </Footnote>
    </div>
  );
}

function ParamsCells({ value, depthHint, onChange }: { value: DiveParams; depthHint: string; onChange: (v: DiveParams) => void }) {
  const cell = (key: keyof DiveParams, props: { type?: string; placeholder?: string; inputMode?: 'numeric' }) => (
    <td className="py-1 pr-2 last:pr-3">
      <input
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        className="w-full h-8 rounded-md border border-line bg-surface px-1.5 text-sm tabular-nums print:border-0 print:p-0"
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

function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted leading-relaxed">{children}</p>;
}

const fieldCls =
  'w-full h-10 rounded-lg border border-line bg-surface px-3 text-base sm:text-sm focus:outline-none focus:border-brand print:h-auto print:border-0 print:px-0 print:font-semibold';
