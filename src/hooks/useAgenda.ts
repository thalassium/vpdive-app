import { useCallback, useEffect, useRef, useState } from 'react';
import { vpdive, type CalendarEvent } from '../services/vpdive';
import { gridRange } from '../lib/agenda';
import { ymd } from '../lib/dates';
import { message } from '../lib/errors';

const thisMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1);

/** L'agenda du mois affiché : sorties lues sur VPDive à chaque changement de mois. */
export function useAgenda(onSessionLost: (e: unknown) => boolean) {
  const [month, setMonth] = useState<Date>(thisMonth);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadId = useRef(0);

  /** `fresh` : relecture demandée (bouton Actualiser), sans le cache court du transport. */
  const loadEvents = useCallback(
    async (fresh = false) => {
      const id = ++loadId.current; // ignore answers for a month the member already left
      const [start, end] = gridRange(month);
      setIsLoading(true);
      setError(null);
      try {
        const list = await vpdive.fetchEvents(ymd(start), ymd(end), { fresh, priority: 'high' });
        if (id === loadId.current) setEvents(list);
      } catch (e) {
        if (id !== loadId.current || onSessionLost(e)) return;
        setEvents([]);
        setError(message(e));
      } finally {
        if (id === loadId.current) setIsLoading(false);
      }
    },
    [month, onSessionLost],
  );

  useEffect(() => {
    // Nouveau mois : l'indicateur de chargement s'allume tout de suite, c'est voulu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);

  return { month, setMonth, events, isLoading, error, loadEvents };
}
