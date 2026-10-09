import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Package, RefreshCw, X } from 'lucide-react';
import { vpdive, type CalendarEvent, type RosterEntry } from '../../services/vpdive';
import { ymd, shortDay } from '../../lib/dates';
import { appApi } from '../../services/appApi';
import { BOTTLES } from '../../lib/gear';
import { aggregateMaterial, isUnknownSize, materialText, sortedSizes, BOTTLE_SHORT, type MaterialPerson } from '../../lib/material';
import { adoptRegistrations, divingIds, syncWithRoster, withGuests, type OutingDoc } from '../../lib/outing';
import { Avatar } from '../Avatar';
import { Menu } from '../Menu';
import { useConfirm } from '../../hooks/useConfirm';
import { useDialog } from '../../hooks/useDialog';
import { GabianLoader } from '../Gabian';
import { message } from '../../lib/errors';

/** « sam. 11 oct. » */
const timeLabel = (e: CalendarEvent) => (e.allDay ? 'Journée' : new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));

/**
 * Matériel (admin) : pour une sortie, tout ce qu'il faut préparer le jour même
 * d'après les inscriptions VPDive — matériel loué compté par taille, et une
 * bouteille par plongeur (12 L sauf demande contraire) : d'après la fiche de
 * sortie quand elle existe (palanquées, « Qui plonge ? »), sinon tous les
 * inscrits sauf pilote, sécurité surface et DP qui ne font que cela. La liste
 * d'attente est montrée à part, sans être comptée.
 */
export function MaterialPanel({ onClose, onSessionLost }: { onClose: () => void; onSessionLost: (e: unknown) => boolean }) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  /** Lit les sorties ; la liste est posée par les rappels de la promesse. */
  const fetchList = useCallback(() => {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    return vpdive.fetchEvents(ymd(from), ymd(to)).then(setEvents, (e: unknown) => {
      if (onSessionLost(e)) return;
      setListError(message(e));
    });
  }, [onSessionLost]);
  /** « Réessayer » : la liste repasse en lecture, puis est relue. */
  const loadList = () => {
    setListError(null);
    setEvents(null);
    void fetchList();
  };

  // À l'ouverture, la liste est déjà en lecture (null) : il n'y a qu'à la lire.
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const { ref: dialogRef } = useDialog({ onClose, label: 'material' });

  // Aujourd'hui et à venir d'abord (la plus proche en tête), puis les passées, la plus récente d'abord.
  const { upcoming, past } = useMemo(() => {
    const today = ymd(new Date());
    const all = events ?? [];
    return {
      upcoming: all.filter((e) => ymd(new Date(e.start)) >= today).sort((a, b) => a.start.localeCompare(b.start)),
      past: all.filter((e) => ymd(new Date(e.start)) < today).sort((a, b) => b.start.localeCompare(a.start)),
    };
  }, [events]);

  const selected = useMemo(
    () => [...upcoming, ...past].find((e) => e.token === selectedToken) ?? upcoming[0] ?? past[0] ?? null,
    [upcoming, past, selectedToken],
  );

  const sections = [
    { title: 'Aujourd’hui et à venir', list: upcoming },
    { title: 'Passées', list: past },
  ].filter((s) => s.list.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-title"
        className="relative bg-surface w-full sm:max-w-5xl h-dvh sm:h-[92vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        <header className="border-t-[3px] border-pink border-b border-line px-5 sm:px-6 py-3.5 shrink-0 flex items-center gap-3">
          <Package className="w-6 h-6 text-brand shrink-0" />
          <h2 id="material-title" className="text-xl font-semibold text-brand flex-1">
            Matériel
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="icon-btn -mr-2">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* Sorties, en colonne sur tablette et ordinateur */}
          <aside className="hidden md:flex flex-col w-72 shrink-0 border-r border-line overflow-y-auto overscroll-contain">
            {sections.map((s) => (
              <section key={s.title} className="py-2">
                <h3 className="sticky top-0 z-10 bg-surface px-4 pt-2 pb-1 label">{s.title}</h3>
                <ul>
                  {s.list.map((e) => (
                    <li key={e.token}>
                      <OutingButton event={e} active={selected?.token === e.token} onSelect={() => setSelectedToken(e.token)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {events && events.length === 0 && <p className="p-6 text-muted">Aucune sortie dans les semaines qui viennent.</p>}
          </aside>

          <main className="flex-1 min-w-0 flex flex-col overflow-y-auto overscroll-contain bg-canvas">
            <div className="p-4 sm:p-5 space-y-4">
              {!events && !listError && <GabianLoader label="Chargement des sorties…" />}
              {listError && <Failure text={listError} onRetry={loadList} />}
              {events && events.length === 0 && <p className="md:hidden py-10 text-center text-muted">Aucune sortie dans les semaines qui viennent.</p>}

              {/* Choix de la sortie sur téléphone */}
              {selected && (
                <div className="md:hidden">
                  <Menu
                    ariaLabel="Choisir la sortie"
                    triggerClassName="field w-full flex items-center gap-2 text-left text-base"
                    trigger={
                      <>
                        <span className="flex-1 min-w-0 truncate">
                          <span className="font-semibold text-brand">{shortDay(selected.start)}</span> · {selected.title}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted shrink-0" />
                      </>
                    }
                    sections={sections.map((s) => ({
                      title: s.title,
                      selected: selected.token,
                      onSelect: setSelectedToken,
                      options: s.list.map((e) => ({
                        value: e.token,
                        label: (
                          <span className="block truncate">
                            {shortDay(e.start)} · {e.title}
                          </span>
                        ),
                        hint: `${e.registeredCount}`,
                      })),
                    }))}
                  />
                </div>
              )}

              {selected && <OutingMaterial key={selected.token} event={selected} onSessionLost={onSessionLost} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function OutingButton({ event: e, active, onSelect }: { event: CalendarEvent; active: boolean; onSelect: () => void }) {
  const isToday = ymd(new Date(e.start)) === ymd(new Date());
  return (
    <button
      onClick={onSelect}
      aria-current={active || undefined}
      className={`w-full text-left pl-3 pr-4 py-2.5 flex items-center gap-3 border-l-4 transition-colors ${active ? 'bg-tint border-brand' : 'border-transparent hover:bg-raised'}`}
    >
      <span className="w-[5.75rem] shrink-0 whitespace-nowrap">
        <span className="block text-sm font-bold tabular-nums text-brand">{shortDay(e.start)}</span>
        <span className="block text-sm text-muted tabular-nums">
          {isToday ? <span className="alpha inline-block bg-pink text-on-pink pl-1.5 text-xs font-semibold">Aujourd’hui</span> : timeLabel(e)}
        </span>
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-base font-semibold text-ink truncate">{e.title}</span>
        <span className="block text-sm text-muted">
          {e.registeredCount} inscrit{e.registeredCount > 1 ? 's' : ''}
        </span>
      </span>
    </button>
  );
}

function Failure({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card p-4 flex flex-wrap items-center gap-3">
      <p className="flex-1 min-w-0 text-danger">{text}</p>
      <button type="button" onClick={onRetry} className="btn btn-quiet">
        <RefreshCw className="w-4 h-4" /> Réessayer
      </button>
    </div>
  );
}

function OutingMaterial({ event, onSessionLost }: { event: CalendarEvent; onSessionLost: (e: unknown) => boolean }) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  /** Fiche de sortie du DP, si elle existe : elle dit qui plonge réellement. */
  const [outing, setOuting] = useState<OutingDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  /** Lit les inscrits et la fiche de sortie ; elles sont posées par les rappels de la promesse. */
  const fetchMaterial = useCallback(
    () =>
      Promise.all([
        vpdive.fetchRoster(event.token),
        // Sans réponse du serveur de l'appli, on compte d'après les rôles VPDive.
        appApi.getOuting(event.token).then(
          (x) => x.doc,
          (e) => {
            if (onSessionLost(e)) throw e;
            return null;
          },
        ),
      ])
        .then(([r, saved]) => {
          setOuting(saved);
          setRoster(r);
        })
        .catch((e: unknown) => {
          if (onSessionLost(e)) return;
          setError(message(e));
        }),
    [event.token, onSessionLost],
  );
  /** « Réessayer » : tout repasse en lecture, puis est relu. */
  const load = () => {
    setError(null);
    setRoster(null);
    setOuting(null);
    void fetchMaterial();
  };

  // À l'ouverture (une par sortie : composant remonté à chaque sortie choisie), tout est déjà en lecture.
  useEffect(() => {
    void fetchMaterial();
  }, [fetchMaterial]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const summary = useMemo(() => {
    if (!roster) return null;
    if (!outing) return aggregateMaterial(roster);
    // La fiche rapprochée de la liste du jour (nouveaux inscrits, désinscrits), plongeurs hors VPDive compris.
    const adopted = adoptRegistrations(outing, roster);
    const people = withGuests(roster, adopted);
    const doc = syncWithRoster(adopted, people).doc;
    return aggregateMaterial(people, divingIds(doc, people));
  }, [roster, outing]);

  if (error) return <Failure text={error} onRetry={load} />;
  if (!summary) return <p className="py-10 text-center text-muted">Lecture des inscriptions sur VPDive…</p>;

  const title = `${shortDay(event.start)} · ${event.title}`;
  const copy = async () => {
    const text = materialText(summary, title);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Presse-papiers refusé (navigateur, page non sécurisée) : la liste est affichée, sélectionnée, à copier à la main.
      await confirm({ title: 'Copiez la liste', text, confirmLabel: 'Fermer', cancelLabel: null });
    }
  };
  const divers = summary.people.filter((p) => !p.noBottle).length;
  const bottlesDue = BOTTLES.filter((b) => summary.bottles[b] > 0)
    .map((b) => `${BOTTLE_SHORT[b]} × ${summary.bottles[b]}`)
    .join(', ');

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-ink truncate">{event.title}</h3>
          <p className="text-sm text-muted">
            {shortDay(event.start)} · {timeLabel(event)} · {divers} plongeur{divers > 1 ? 's' : ''}
            {summary.people.length > divers && ` · ${summary.people.length - divers} à bord sans plonger`}
            {summary.waiting.length > 0 && ` · ${summary.waiting.length} en liste d’attente`}
          </p>
          <p className="text-sm text-muted">{outing ? 'Bouteilles d’après la fiche de sortie du DP.' : 'Pas encore de fiche de sortie : bouteilles d’après les rôles VPDive.'}</p>
        </div>
        <button type="button" onClick={copy} className="btn btn-quiet">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copiée' : 'Copier la liste'}
        </button>
      </div>

      <section className="card border-l-4 border-l-brand p-4 sm:p-5">
        <h4 className="text-lg font-semibold text-brand mb-3">À préparer</h4>
        {summary.items.length === 0 ? (
          <p className="text-muted">
            {summary.people.length === 0
              ? 'Aucun inscrit pour cette sortie.'
              : `Aucun matériel demandé pour cette sortie. Les bouteilles restent à prévoir : ${bottlesDue}.`}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {summary.items.map((item) => (
              <li key={item.name} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex-1 min-w-[10rem] text-base text-ink font-medium">{item.name}</span>
                <span className="code text-lg w-8 text-right">{item.total}</span>
                {Object.keys(item.bySize).length > 0 && (
                  <span className="basis-full sm:basis-auto flex flex-wrap gap-1.5">
                    {sortedSizes(item.bySize).map(([size, n]) => (
                      <span key={size} className={`chip ${isUnknownSize(size) ? 'bg-warn-soft text-warn' : 'text-brand'}`}>
                        {size} × {n}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary.items.length > 0 && (
        <section className="card border-l-4 border-l-brand p-4 sm:p-5">
          <h4 className="text-lg font-semibold text-brand mb-3">Bouteilles</h4>
          <ul className="flex flex-wrap gap-x-8 gap-y-2">
            {BOTTLES.map((b) => (
              <li key={b} className={`flex items-baseline gap-2 ${summary.bottles[b] ? '' : 'text-muted'}`}>
                <span className="text-base">{b}</span>
                <span className={summary.bottles[b] ? 'code text-lg' : 'text-lg'}>{summary.bottles[b]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(summary.people.length > 0 || summary.waiting.length > 0) && (
        <section className="card border-l-4 border-l-brand p-4 sm:p-5">
          <h4 className="text-lg font-semibold text-brand mb-2">Par plongeur</h4>
          <PeopleList people={summary.people} />
          {summary.waiting.length > 0 && (
            <div className="mt-4 opacity-70">
              <h5 className="label mb-1">Liste d’attente (non compté)</h5>
              <PeopleList people={summary.waiting} />
            </div>
          )}
        </section>
      )}
      {confirmDialog}
    </>
  );
}

function PeopleList({ people }: { people: MaterialPerson[] }) {
  return (
    <ul className="divide-y divide-line">
      {people.map((p, i) => (
        <li key={`${p.name}-${i}`} className="py-2 flex items-start gap-3">
          <span className="w-7 shrink-0">
            <Avatar name={p.name} picture={p.picture} size="sm" initials={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base text-ink">{p.name}</span>
            <span className="flex flex-wrap gap-x-4 text-sm text-muted">
              {p.lines.length ? p.lines.map((line, j) => <span key={j}>{line}</span>) : 'Rien à louer'}
              {p.noBottle && <span className="text-warn">Pas de bouteille : {p.noBottle}</span>}
            </span>

          </span>
        </li>
      ))}
    </ul>
  );
}
