import { useState } from 'react';
import { Check, MessageSquare, Pencil } from 'lucide-react';
import type { GuideNote } from '../../../lib/outing';

/**
 * Commentaire libre à côté de l'encadrant (stagiaire, consigne…) : le texte, qui
 * l'a écrit et quand. Se modifie aussi après validation des palanquées.
 */
export function GuideNoteRow({ note, onNote }: { note?: GuideNote; onNote?: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note?.text ?? '');
  if (editing && onNote) {
    const save = () => {
      onNote(text);
      setEditing(false);
    };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          maxLength={500}
          placeholder="Commentaire sur l’encadrant (stagiaire, consigne…)"
          aria-label="Commentaire sur l’encadrant"
          className="field flex-1 min-w-[12rem] sm:h-9 px-2.5 text-sm"
          autoFocus
        />
        <button type="button" onClick={save} className="btn btn-primary sm:h-9 text-sm">
          <Check className="w-4 h-4" /> Enregistrer
        </button>
        <button
          type="button"
          onClick={() => {
            setText(note?.text ?? '');
            setEditing(false);
          }}
          className="btn btn-quiet sm:h-9 text-sm"
        >
          Annuler
        </button>
      </div>
    );
  }
  if (!note) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setText('');
            setEditing(true);
          }}
          className="inline-flex items-center gap-1.5 max-sm:min-h-11 text-sm text-muted hover:text-brand"
        >
          <MessageSquare className="w-4 h-4" /> Commenter
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-sm">
      <MessageSquare className="w-4 h-4 shrink-0 mt-0.5 text-muted" />
      <span className="flex-1 min-w-0">
        <span className="text-ink break-words">{note.text}</span>
        <span className="block text-muted">
          par {note.by} le {new Date(note.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </span>
      {onNote && (
        <button
          type="button"
          onClick={() => {
            setText(note.text);
            setEditing(true);
          }}
          aria-label="Modifier le commentaire"
          className="icon-btn relative w-8 h-8 max-sm:before:absolute max-sm:before:-inset-1.5"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
