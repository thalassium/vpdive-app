import { useId, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { appApi } from '../../services/appApi';
import type { MemberMatch } from '../../services/vpdive';
import { MODELS, type FicheLevel } from '../../lib/training';
import { readSheetExport, type SheetFiche } from '../../lib/trainingSheets';
import { message } from '../../lib/errors';
import { Avatar } from '../Avatar';
import { Dialog, DialogHeader } from '../Dialog';
import { Spinner } from '../Spinner';
import { MemberSearch } from '../dp/MemberSearch';

const LEVELS: FicheLevel[] = ['N1', 'N2', 'N3', 'N4'];

/**
 * Nouvelle fiche de suivi, créée à la main par un admin : un membre de
 * l'annuaire et un niveau. Elle peut reprendre une fiche du classeur du club
 * (fichier produit par scripts/fiches-classeur.ts) avec ses séances, ses
 * évaluations et ses validations : le classeur ne connaît que le nom de
 * l'élève, on choisit ici son compte VPDive. Le fichier chargé reste ouvert
 * d'une fiche à l'autre, chaque fiche reprise sort de la liste.
 */
export function NewFiche({ onCreated, onClose, onSessionLost }: { onCreated: (id: string) => void; onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const titleId = useId();
  const file = useRef<HTMLInputElement>(null);
  const [sheets, setSheets] = useState<SheetFiche[] | null>(null);
  const [source, setSource] = useState<SheetFiche | null>(null);
  const [level, setLevel] = useState<FicheLevel>('N1');
  const [member, setMember] = useState<MemberMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const fiches = readSheetExport(JSON.parse(await f.text()));
      if (!fiches) throw new Error('forme inattendue');
      setSheets(fiches);
      setSource(null);
    } catch {
      setError('Fichier illisible : choisissez le fichier fiches-classeur.json.');
    }
  };
  const pick = (tab: string) => {
    setSource(sheets?.find((s) => s.tab === tab) ?? null);
    setMember(null);
    setDone(null);
  };

  const create = async () => {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      const content = source ? { model: source.model, sessions: source.sessions, theory: source.theory, general: source.general, review: source.review } : undefined;
      const { fiche } = await appApi.createFiche({ uct: member.id, name: member.name, ...(member.picture ? { picture: member.picture } : {}), level: source?.level ?? level, ...(content ? { content } : {}) });
      onCreated(fiche.id);
      const left = source ? (sheets ?? []).filter((s) => s !== source) : [];
      // Une fiche vide, ou la dernière du classeur : c'est fini. Sinon on passe à la suivante.
      if (!left.length) return onClose();
      setSheets(left);
      setSource(null);
      setMember(null);
      setDone(member.name);
    } catch (e) {
      if (!onSessionLost(e)) setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="nouvelle-fiche" onClose={onClose} canClose={() => !busy} onBackdrop={null} titleId={titleId} className="sm:max-w-lg h-dvh sm:h-auto sm:max-h-[92vh]" layer="z-[60]">
      <DialogHeader titleId={titleId} title="Nouvelle fiche" onClose={onClose} closeDisabled={busy} />
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5">
        {done && (
          <p role="status" className="p-3 rounded-xl bg-ok-soft text-ok">
            Fiche de {done} créée.
          </p>
        )}

        <div className="space-y-2">
          <input ref={file} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} onChange={(e) => void load(e.target.files?.[0]).then(() => (e.target.value = ''))} />
          {!sheets ? (
            <button type="button" onClick={() => file.current?.click()} className="btn btn-quiet w-full">
              <FileUp className="w-4 h-4" /> Reprendre une fiche du classeur
            </button>
          ) : (
            <label className="block">
              <span className="label block mb-1">Fiche du classeur</span>
              <select value={source?.tab ?? ''} onChange={(e) => pick(e.target.value)} className="field w-full">
                <option value="">Fiche vide</option>
                {sheets.map((s) => (
                  <option key={s.tab} value={s.tab}>
                    {s.name} · {MODELS[s.model]?.label ?? s.level} · {s.sessions.length} séance{s.sessions.length > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {source?.warnings.map((w) => (
            <p key={w} className="text-sm text-warn">
              {w}
            </p>
          ))}
        </div>

        {!source && (
          <div>
            <p id={`${titleId}-level`} className="label mb-1">
              Niveau
            </p>
            <div role="radiogroup" aria-labelledby={`${titleId}-level`} className="flex gap-1.5">
              {LEVELS.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)} className="tab-pill flex-1 border border-line">
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="label mb-1">Membre</p>
          {member ? (
            <div className="flex items-center gap-2.5">
              <Avatar name={member.name} picture={member.picture} size="sm" />
              <span className="flex-1 min-w-0 text-ink font-semibold">{member.name}</span>
              <button type="button" onClick={() => setMember(null)} disabled={busy} className="btn btn-quiet sm:h-9 text-sm">
                Changer
              </button>
            </div>
          ) : (
            // Le nom lu dans le classeur est cherché d'emblée dans l'annuaire.
            <MemberSearch key={source?.tab ?? ''} initial={source?.name ?? ''} onPick={setMember} />
          )}
        </div>

        {error && (
          <p role="alert" className="p-3 rounded-xl bg-danger-soft text-danger">
            {error}
          </p>
        )}
      </div>
      <footer className="shrink-0 border-t border-line px-4 sm:px-6 py-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] flex justify-end">
        <button type="button" onClick={() => void create()} disabled={!member || busy} aria-busy={busy} className="btn btn-primary max-sm:flex-1">
          {busy && <Spinner />} Créer
        </button>
      </footer>
    </Dialog>
  );
}
