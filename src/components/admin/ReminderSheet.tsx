import { useState } from 'react';
import { Mail, MessageCircle, X } from 'lucide-react';
import { messaging } from '../../services/messaging';
import { shortDay } from '../../lib/dates';
import { bulkReminderText, reminderText, seasonOfOuting } from '../../lib/docsCheck';
import { message } from '../../lib/errors';
import { plural, type Me, type Row } from './relance';

/**
 * Relancer un membre (ou une sélection) : le message, prérempli d'après ses
 * documents en défaut et sa prochaine sortie, part par e-mail (le logiciel de
 * messagerie de l'appareil) ou dans la messagerie de VPDive, un envoi à la fois.
 */
export function ReminderSheet({
  rows,
  bulk,
  me,
  onClose,
  onBusy,
  onSessionLost,
}: {
  rows: Row[];
  bulk: boolean;
  me: Me;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const first = rows[0]!;
  const next = first.concerns[0]!;
  const [text, setText] = useState(() =>
    bulk
      ? bulkReminderText({ year: seasonOfOuting(next.outing.date), from: me.name })
      : reminderText({
          firstName: first.firstname,
          date: shortDay(next.outing.date),
          title: next.outing.title,
          kinds: first.issues.filter((i) => i.level !== 'muted').map((i) => i.kind),
          year: seasonOfOuting(next.outing.date),
          from: me.name,
        }),
  );
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ sent: number; errors: string[] } | null>(null);

  const withEmail = rows.filter((r) => r.email);
  const noEmail = rows.filter((r) => !r.email);
  const subject = bulk ? 'Ton dossier VPDive pour les prochaines sorties' : `Ton dossier VPDive pour la sortie du ${shortDay(next.outing.date)}`;
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const mailHref = bulk
    ? `mailto:?bcc=${withEmail.map((r) => encodeURIComponent(r.email)).join(',')}&${query}`
    : `mailto:${encodeURIComponent(first.email)}?${query}`;

  const sendInApp = async () => {
    const errors: string[] = [];
    let sent = 0;
    setResult(null);
    setSending({ done: 0, total: rows.length });
    onBusy(true);
    // Envois l'un après l'autre : la file du transport les espace.
    for (const [i, r] of rows.entries()) {
      if (!r.uct) {
        errors.push(`${r.name} : pas de compte d’adhérent connu`);
      } else {
        try {
          await messaging.writeTo(r.uct, text);
          sent++;
        } catch (e) {
          if (onSessionLost(e)) return;
          errors.push(`${r.name} : ${message(e)}`);
        }
      }
      setSending({ done: i + 1, total: rows.length });
    }
    onBusy(false);
    setSending(null);
    setResult({ sent, errors });
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="reminder-title" className="panel w-full sm:max-w-xl max-h-full overflow-y-auto rounded-b-none sm:rounded-xl p-5 flex flex-col gap-3 animate-sheet sm:animate-pop">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="reminder-title" className="text-lg font-semibold text-brand">
              {bulk ? `Relancer ${plural(rows.length, 'membre', 'membres')}` : `Relancer ${first.name}`}
            </h3>
            {!bulk && (
              <p className="text-sm text-muted">
                {shortDay(next.outing.date)} · {next.outing.title}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Fermer la relance" className="icon-btn -mr-2 -mt-1" disabled={!!sending}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {bulk && (
          <p className="text-sm text-muted">
            {rows
              .slice(0, 8)
              .map((r) => r.name)
              .join(', ')}
            {rows.length > 8 && ` et ${rows.length - 8} autres`}
          </p>
        )}

        <div>
          <label htmlFor="reminder-text" className="label block mb-1.5">
            Message
          </label>
          <textarea id="reminder-text" rows={11} value={text} onChange={(e) => setText(e.target.value)} className="field w-full h-auto py-2.5 text-base leading-relaxed" />
        </div>

        {noEmail.length > 0 && (
          <p className="text-sm text-muted">
            Sans e-mail : <span className="text-ink">{noEmail.map((r) => r.name).join(', ')}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 justify-end">
          {withEmail.length > 0 ? (
            <a href={mailHref} className="btn btn-quiet">
              <Mail className="w-4 h-4" /> Envoyer par e-mail
            </a>
          ) : (
            <button type="button" disabled className="btn btn-quiet">
              <Mail className="w-4 h-4" /> Envoyer par e-mail
            </button>
          )}
          {/* Une fois tout envoyé, le bouton ne renvoie pas une deuxième fois. */}
          <button type="button" onClick={sendInApp} disabled={!!sending || !text.trim() || (!!result && result.errors.length === 0)} className="btn btn-primary">
            <MessageCircle className="w-4 h-4" /> {sending ? `Envoi… ${sending.done}/${sending.total}` : result && result.errors.length === 0 ? 'Envoyé' : 'Envoyer dans l’appli'}
          </button>
        </div>

        {result && (
          <div aria-live="polite" className="text-sm">
            <p className={result.sent > 0 ? 'text-ok font-semibold' : 'text-muted'}>{plural(result.sent, 'message envoyé', 'messages envoyés')}</p>
            {result.errors.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-danger">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
