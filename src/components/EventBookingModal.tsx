import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, Check, CheckCircle2, AlertCircle, Calendar as CalendarIcon, ExternalLink, RefreshCw, MapPin, Clock, ChevronDown } from 'lucide-react';
import { vpdive, type CalendarEvent, type EventDetail, type MaterialOption } from '../services/vpdiveApi';

const VPDIVE_EVENT_URL = (token: string) => `https://septentrion-env.vpdive.com/app/activities/${token}`;

interface Props {
  event: CalendarEvent;
  onClose: () => void;
  /** Called after a successful booking or cancellation so the agenda refreshes. */
  onChanged: () => void;
  /** Returns true when the error was an expired session (the app then shows the login page). */
  onSessionLost: (e: unknown) => boolean;
}

type Status = { kind: 'idle' } | { kind: 'success'; text: string } | { kind: 'error'; text: string };

export function EventBookingModal({ event, onClose, onChanged, onSessionLost }: Props) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [tariffToken, setTariffToken] = useState<string | null>(null);
  const [gear, setGear] = useState<Record<number, boolean>>({});
  const [people, setPeople] = useState(1);
  const [comment, setComment] = useState('');

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const priceRequest = useRef(0);
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    // Only the latest load may touch the form. Otherwise an earlier answer shows
    // the form, the member starts ticking items, and a later answer (React dev
    // mode runs effects twice; a reload after booking does too) wipes the ticks.
    const id = ++loadRequest.current;
    setLoadError(null);
    setDetail(null);
    try {
      const d = await vpdive.fetchEventDetail(event.token);
      if (id !== loadRequest.current) return;
      setDetail(d);
      setPrices(Object.fromEntries(d.tariffs.map((t) => [t.token, t.price])));
      setTariffToken(d.tariffs[0]?.token ?? null);
      // Same default as VPDive: plain "diver" when offered, otherwise no role pre-chosen.
      setRoleKey(d.roles.some((r) => r.key === 'diver') ? 'diver' : null);
      setGear({});
      setPeople(1);
    } catch (e) {
      if (id !== loadRequest.current || onSessionLost(e)) return;
      setLoadError(e instanceof Error ? e.message : 'Impossible de charger la sortie.');
    }
  }, [event.token, onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes; the page behind does not scroll while the dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  // Prices depend on the role (a dive director or instructor often dives for free).
  const chooseRole = async (key: string) => {
    setRoleKey(key);
    if (!detail) return;
    const id = ++priceRequest.current;
    setPricesLoading(true);
    try {
      const p = await vpdive.fetchPricesForRole(detail.token, key);
      if (id === priceRequest.current) setPrices(p);
    } catch (e) {
      if (onSessionLost(e)) return;
      if (id === priceRequest.current) {
        setStatus({ kind: 'error', text: `Tarifs non mis à jour pour ce rôle : ${e instanceof Error ? e.message : e}` });
      }
    } finally {
      if (id === priceRequest.current) setPricesLoading(false);
    }
  };

  /**
   * A checked item is rented once per place booked: one stab for a solo booking,
   * three for a booking of three — never more than VPDive has in stock.
   */
  const quantityFor = useCallback(
    (m: MaterialOption) => Math.min(m.maxQuantity, detail?.multipleBooking ? people : 1),
    [detail, people],
  );
  const gearQuantities = useMemo(() => {
    const q: Record<number, number> = {};
    for (const m of detail?.materials ?? []) if (gear[m.id]) q[m.id] = quantityFor(m);
    return q;
  }, [detail, gear, quantityFor]);

  const tariffPrice = tariffToken != null ? (prices[tariffToken] ?? 0) : 0;
  const gearTotal = (detail?.materials ?? []).reduce((sum, m) => sum + m.price * (gearQuantities[m.id] ?? 0), 0);
  const total = tariffPrice * people + gearTotal;
  const roleRequired = (detail?.roles.length ?? 0) > 0 && !roleKey;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || roleRequired || detail.alreadyRegistered || !detail.canRegister || detail.requiresExtraForm) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await vpdive.register({
        eventToken: detail.token,
        roleKey,
        tariffToken,
        people,
        comment: comment.trim(),
        materials: gearQuantities,
      });
      setStatus({ kind: 'success', text: res.message });
      onChanged();
      await load(); // show the registered state as VPDive now reports it
    } catch (err) {
      if (onSessionLost(err)) return;
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Inscription impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    if (!window.confirm(`Confirmer la désinscription de « ${detail.title} » ?`)) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      await vpdive.unregister(detail.token);
      setStatus({ kind: 'success', text: 'Vous êtes désinscrit de cette sortie.' });
      onChanged();
      await load();
    } catch (err) {
      if (onSessionLost(err)) return;
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Désinscription impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const title = detail?.title || event.title;
  const start = detail?.start || event.start;
  const end = detail?.end || event.end;
  const location = detail?.location || event.location;
  const showForm = !!detail && !detail.alreadyRegistered && !detail.requiresExtraForm && detail.canRegister;
  let step = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-black/55 backdrop-blur-[3px] animate-fade"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="relative bg-surface w-full sm:max-w-xl h-dvh sm:h-auto sm:max-h-[92vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        {/* Header */}
        <div className="bg-band text-white px-5 sm:px-6 pt-4 sm:pt-5 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {event.activity && (
                <span className="text-xs font-semibold uppercase tracking-wider text-pink block mb-1">{event.activity.name}</span>
              )}
              <h2 id="booking-title" className="text-xl sm:text-2xl font-semibold leading-snug">
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={busy}
              aria-label="Fermer"
              className="w-10 h-10 -mr-2 -mt-1 shrink-0 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-surface/10"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="mt-3 space-y-1 text-sm text-white/85">
            <p className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-pink shrink-0 mt-0.5" />
              <span className="first-letter:uppercase">{formatRange(start, end, event.allDay)}</span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-pink shrink-0 mt-0.5" />
              {location || 'Lieu non précisé'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 space-y-6">
            {!detail && !loadError && <p className="py-10 text-center text-muted">Chargement de la sortie depuis VPDive…</p>}
            {loadError && (
              <div role="alert" className="p-4 rounded-xl bg-danger-soft text-danger text-sm flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="flex-1">
                  <span className="font-semibold block">Impossible de charger cette sortie</span>
                  <span>{loadError}</span>
                </div>
                <button type="button" onClick={load} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                  <RefreshCw className="w-4 h-4" /> Réessayer
                </button>
              </div>
            )}

            {detail && (
              <>
                {detail.description && (
                  <details className="group rounded-xl bg-raised px-4 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-brand select-none list-none flex items-center justify-between">
                      Description de la sortie
                      <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 font-serif text-[15px] text-ink/90 whitespace-pre-line leading-relaxed">{detail.description}</p>
                  </details>
                )}

                <StatusBanner status={status} />

                {detail.alreadyRegistered ? (
                  <RegisteredPanel detail={detail} busy={busy} onCancel={cancel} />
                ) : detail.requiresExtraForm ? (
                  <Notice tone="info" title="Informations complémentaires demandées">
                    Cette sortie demande de remplir un formulaire spécifique. L’inscription se fait directement sur VPDive.{' '}
                    <a href={VPDIVE_EVENT_URL(detail.token)} target="_blank" rel="noreferrer" className="font-semibold underline">
                      S’inscrire sur VPDive
                    </a>
                  </Notice>
                ) : !detail.canRegister ? (
                  <Notice tone="warn" title="Inscription impossible">
                    {detail.refusalReasons.length ? detail.refusalReasons.join(' ') : 'VPDive n’autorise pas l’inscription à cette sortie pour le moment.'}
                  </Notice>
                ) : (
                  <>
                    {/* Role */}
                    {detail.roles.length > 0 && (
                      <section>
                        <SectionTitle n={++step}>Votre rôle</SectionTitle>
                        <div role="radiogroup" aria-label="Votre rôle" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {detail.roles.map((r) => (
                            <ChoiceCard key={r.key} role="radio" selected={roleKey === r.key} onClick={() => chooseRole(r.key)}>
                              <span className="text-base sm:text-sm font-medium">{r.label}</span>
                            </ChoiceCard>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Tariff */}
                    {detail.tariffs.length > 0 && (
                      <section>
                        <SectionTitle n={++step} hint={pricesLoading ? 'Mise à jour des tarifs…' : undefined}>
                          Formule
                        </SectionTitle>
                        <div className={`rounded-xl border border-line divide-y divide-line ${pricesLoading ? 'opacity-60' : ''}`}>
                          {detail.tariffs.map((t) => {
                            const selected = tariffToken === t.token;
                            return (
                              <label
                                key={t.token}
                                className={`flex items-center justify-between gap-3 px-4 py-3.5 sm:py-3 cursor-pointer transition-colors first:rounded-t-xl last:rounded-b-xl ${
                                  selected ? 'bg-tint' : 'hover:bg-raised'
                                }`}
                              >
                                <span className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name="tariff_plan"
                                    checked={selected}
                                    onChange={() => setTariffToken(t.token)}
                                    className="appearance-none w-5 h-5 shrink-0 rounded-full border-2 border-muted/50 bg-surface checked:border-[6px] checked:border-fill transition-all cursor-pointer"
                                  />
                                  <span className={`text-base sm:text-sm ${selected ? 'font-semibold text-brand' : 'text-ink'}`}>{t.label}</span>
                                </span>
                                <span className={`text-base tabular-nums shrink-0 ${selected ? 'font-semibold text-brand' : 'text-muted'}`}>
                                  {formatEuro(prices[t.token] ?? t.price)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Rental gear: tap to check */}
                    {detail.materials.length > 0 && (
                      <section>
                        <SectionTitle
                          n={++step}
                          hint={detail.multipleBooking && people > 1 ? `Quantité alignée sur ${people} places` : 'Touchez pour ajouter'}
                        >
                          Location de matériel
                        </SectionTitle>
                        <div role="group" aria-label="Location de matériel" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {detail.materials.map((m) => {
                            const checked = !!gear[m.id];
                            const qty = quantityFor(m);
                            return (
                              <ChoiceCard
                                key={m.id}
                                selected={checked}
                                onClick={() => setGear((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                                label={`${m.name}, ${m.price > 0 ? formatEuro(m.price) : 'inclus'}`}
                              >
                                <span className="block text-[15px] sm:text-sm font-medium leading-tight">{m.name}</span>
                                <span className={`block text-sm tabular-nums mt-1 ${checked ? 'text-brand font-semibold' : 'text-muted'}`}>
                                  {m.price > 0 ? `+${formatEuro(m.price)}` : 'Inclus'}
                                  {checked && qty > 1 ? ` × ${qty}` : ''}
                                </span>
                              </ChoiceCard>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* People & comment */}
                    <section className="space-y-4">
                      {detail.multipleBooking && (
                        <div>
                          <label htmlFor="people" className="block text-sm font-semibold text-brand mb-1.5">
                            Nombre de places
                          </label>
                          <select
                            id="people"
                            value={people}
                            onChange={(e) => setPeople(Number(e.target.value))}
                            className="w-full sm:w-48 bg-surface border border-line rounded-lg px-3 py-2.5 text-base focus:outline-none focus:border-brand"
                          >
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n} personne{n > 1 ? 's' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label htmlFor="comment" className="block text-sm font-semibold text-brand mb-1.5">
                          Message pour le club / le DP <span className="font-normal text-muted">(facultatif)</span>
                        </label>
                        <textarea
                          id="comment"
                          rows={2}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          className="w-full bg-surface border border-line rounded-lg px-3.5 py-2.5 text-base resize-none focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
                        />
                      </div>
                    </section>

                    {event.availableSpots === 0 && (
                      <Notice tone="warn" title="Sortie complète">
                        {event.hasWaitingList ? 'Votre demande sera placée sur liste d’attente.' : 'VPDive indique qu’il ne reste plus de place.'}
                      </Notice>
                    )}
                  </>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
                  <a
                    href={googleCalendarUrl(title, start, end, location)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand font-medium underline underline-offset-2"
                  >
                    <CalendarIcon className="w-4 h-4" /> Ajouter à mon agenda
                  </a>
                  <a
                    href={VPDIVE_EVENT_URL(detail.token)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted hover:text-brand"
                  >
                    Voir sur VPDive <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </>
            )}
          </div>

          {/* Sticky footer: total + confirm, always within thumb reach */}
          {showForm && (
            <div className="shrink-0 border-t border-line bg-surface px-5 sm:px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] flex items-center gap-4">
              <div className="min-w-0">
                <span className="text-xs text-muted block">Total estimé</span>
                <span className="text-2xl font-semibold text-brand tabular-nums leading-none">{formatEuro(total)}</span>
              </div>
              <button
                type="submit"
                disabled={busy || roleRequired || pricesLoading}
                className="flex-1 sm:flex-none sm:ml-auto px-6 py-3.5 rounded-xl bg-fill hover:bg-fill-hover active:scale-[0.99] text-white text-base font-semibold transition-colors disabled:opacity-50"
              >
                {busy ? 'Inscription…' : roleRequired ? 'Choisissez votre rôle' : 'Confirmer l’inscription'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

/** Selectable card used for roles (single choice) and rental gear (toggle). */
function ChoiceCard({
  selected,
  onClick,
  children,
  role,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  role?: 'radio';
  label?: string;
}) {
  const a11y = role === 'radio' ? { role: 'radio', 'aria-checked': selected } : { 'aria-pressed': selected };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      {...a11y}
      className={`relative text-left min-h-[52px] px-3.5 py-3 rounded-xl border-2 transition-colors ${
        selected ? 'border-brand bg-tint text-brand' : 'border-line bg-surface text-ink hover:border-brand/30'
      }`}
    >
      <span className="block pr-6">{children}</span>
      <span
        className={`absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          selected ? 'bg-fill text-white' : 'border-2 border-line'
        }`}
      >
        {selected && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

function RegisteredPanel({ detail, busy, onCancel }: { detail: EventDetail; busy: boolean; onCancel: () => void }) {
  return (
    <div className="p-4 rounded-xl bg-ok-soft border border-green/40 text-sm space-y-3">
      <p className="flex items-center gap-2 font-semibold text-base text-ok">
        <CheckCircle2 className="w-5 h-5" />
        Vous êtes inscrit à cette sortie
      </p>
      {detail.myCart && (
        <p className="text-ink">
          Montant : <strong className="tabular-nums">{formatEuro(detail.myCart.amount)}</strong> ·{' '}
          {detail.myCart.paid ? 'réglé' : 'à régler sur VPDive'}
        </p>
      )}
      {detail.canUnregister ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-surface text-danger border border-danger/30 hover:bg-danger-soft font-semibold disabled:opacity-50 transition-colors"
        >
          {busy ? 'Désinscription…' : 'Me désinscrire'}
        </button>
      ) : (
        <p className="text-muted">La désinscription n’est plus possible en ligne : contactez le club.</p>
      )}
    </div>
  );
}

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  const ok = status.kind === 'success';
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={`p-3.5 rounded-xl text-sm flex items-start gap-2 ${ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}
    >
      {ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
      <span className="font-semibold">{status.text}</span>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: 'info' | 'warn'; title: string; children: ReactNode }) {
  const cls = tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-tint text-brand';
  return (
    <div className={`p-4 rounded-xl text-sm flex items-start gap-2.5 ${cls}`}>
      <AlertCircle className="w-5 h-5 shrink-0" />
      <div>
        <span className="font-semibold block">{title}</span>
        <span className="leading-relaxed text-ink">{children}</span>
      </div>
    </div>
  );
}

function SectionTitle({ children, n, hint }: { children: ReactNode; n: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h3 className="flex items-center gap-2.5 text-base font-semibold text-brand">
        <span className="w-6 h-6 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">{n}</span>
        {children}
      </h3>
      {hint && <span className="text-xs text-muted text-right">{hint}</span>}
    </div>
  );
}

export function formatEuro(n: number): string {
  if (n === 0) return 'Gratuit';
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 });
}

function formatRange(start: string, end: string, allDay: boolean): string {
  if (!start) return 'Date non précisée';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const day = s.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (allDay) return day;
  const t = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = e && e.toDateString() === s.toDateString();
  return e ? `${day}, ${t(s)} – ${sameDay ? t(e) : `${e.toLocaleDateString('fr-FR')} ${t(e)}`}` : `${day}, ${t(s)}`;
}

function googleCalendarUrl(title: string, start: string, end: string, location: string): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, location });
  if (start) params.set('dates', `${fmt(start)}/${fmt(end || start)}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}
