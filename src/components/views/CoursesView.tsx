import type { CalendarEvent } from '../../services/vpdiveApi';
import { Cromagnon } from '../Cromagnon';

/**
 * Cours de plongée du club. Ils viendront d'une base propre au club (pas des
 * sorties VPDive) : tant qu'elle n'existe pas, l'écran est vide.
 */
export function CoursesView(_: { onOpenEvent: (ev: CalendarEvent) => void; onSessionLost: (e: unknown) => boolean }) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl font-semibold text-brand">Cours</h1>
      <div aria-hidden className="isobath bg-line mt-2 mb-5" />
      <div className="card px-6 py-10 text-center">
        <Cromagnon className="w-40 mx-auto mb-5 text-field-border" />
        <p className="font-medium text-ink">Aucun cours pour l’instant.</p>
        <p className="mt-1 text-sm text-muted">Les cours théoriques et pratiques du club apparaîtront ici dès qu’ils seront programmés.</p>
      </div>
    </div>
  );
}
