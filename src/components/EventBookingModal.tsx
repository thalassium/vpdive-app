import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, Check, CheckCircle2, AlertCircle, Calendar as CalendarIcon, ExternalLink, RefreshCw, MapPin, Clock, Pencil, Users } from 'lucide-react';
import { vpdive, type CalendarEvent, type EventDetail, type MaterialOption } from '../services/vpdiveApi';
import { ThemeToggle } from './ThemeToggle';
import { BuddyField } from './BuddyField';
import { BOTTLES, DEFAULT_BOTTLE, SIZES, SIZED_KINDS, SIZED_LABEL, composeComment, parseComment, sizedKinds, type Bottle, type Size, type SizedKind } from '../lib/gear';

const VPDIVE_EVENT_URL = (token: string) => `https://septentrion-env.vpdive.com/app/activities/${token}`;

interface Props {
  event: CalendarEvent;
  onClose: () => void;
  /** Called after a successful booking or cancellation so the agenda refreshes. */
  onChanged: () => void;
  /** Returns true when the error was an expired session (the app then shows the login page). */
  onSessionLost: (e: unknown) => boolean;
  /** Admin mode only: opens the palanquées screen for this outing. */
  onOpenPalanquees?: () => void;
}

type Status = { kind: 'idle' } | { kind: 'success'; text: string } | { kind: 'error'; text: string };

export function EventBookingModal({ event, onClose, onChanged, onSessionLost, onOpenPalanquees }: Props) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [tariffToken, setTariffToken] = useState<string | null>(null);
  const [gear, setGear] = useState<Record<number, boolean>>({});
  /** material id → VPDive choice id, for items with club-defined variants */
  const [choiceOf, setChoiceOf] = useState<Record<number, string>>({});
  /** standard size (XXS…3XL) per kind, for wetsuits and BCDs without VPDive variants */
  const [kindSize, setKindSize] = useState<Partial<Record<SizedKind, Size>>>({});
  /** Bouteille souhaitée : 12 L par défaut, écrite dans le message au club sinon. */
  const [bottle, setBottle] = useState<Bottle>(DEFAULT_BOTTLE);
  const [people, setPeople] = useState(1);
  const [comment, setComment] = useState('');
  const [buddy, setBuddy] = useState('');
  /** Changing an existing registration: the form is shown again, pre-filled. */
  const [editing, setEditing] = useState(false);

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
      setChoiceOf({});
      setKindSize({});
      setBottle(DEFAULT_BOTTLE);
      setPeople(1);
      setEditing(false);
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

  /** Opens the form on the member's current registration, as VPDive recorded it. */
  const startEdit = () => {
    const r = detail?.myRegistration;
    if (!detail || !r) return;
    const parsed = parseComment(r.comment);
    setTariffToken(r.tariffToken ?? detail.tariffs[0]?.token ?? null);
    setPeople(r.people);
    setGear(Object.fromEntries(r.gear.map((g) => [g.id, true])));
    setChoiceOf(Object.fromEntries(r.gear.filter((g) => g.choiceId).map((g) => [g.id, g.choiceId!])));
    setKindSize(parsed.sizes);
    setBottle(parsed.bottle);
    setComment(parsed.comment);
    setBuddy(parsed.buddy);
    setStatus({ kind: 'idle' });
    setEditing(true);
    if (r.roleKey) void chooseRole(r.roleKey);
    else setRoleKey(null);
  };

  /**
   * A checked item is rented once per place booked: one stab for a solo booking,
   * three for a booking of three — never more than VPDive has in stock.
   */
  const quantityFor = useCallback(
    (m: MaterialOption) => Math.min(m.maxQuantity, detail?.multipleBooking ? people : 1),
    [detail, people],
  );
  const checkedGear = useMemo(() => (detail?.materials ?? []).filter((m) => gear[m.id]), [detail, gear]);

  /**
   * Sizes to ask for. Items with club-defined variants in VPDive: one choice per
   * item, sent natively. Otherwise one size per kind (wetsuit, BCD), shared by
   * every checked item containing it (« Combinaison » and « Pack complet » ask
   * the wetsuit size once), sent in the message to the club.
   */
  const choiceGear = checkedGear.filter((m) => m.choices.length > 0);
  const neededKinds = SIZED_KINDS.filter((k) => checkedGear.some((m) => m.choices.length === 0 && sizedKinds(m.name).includes(k)));
  const sizeMissing =
    choiceGear.find((m) => !choiceOf[m.id])?.name ?? (neededKinds.find((k) => !kindSize[k]) ? SIZED_LABEL[neededKinds.find((k) => !kindSize[k])!].toLowerCase() : null);

  const booking = useMemo(() => {
    const materials: Record<number, number> = {};
    const choices: Record<string, number> = {};
    let gearTotal = 0;
    for (const m of checkedGear) {
      const qty = quantityFor(m);
      const choice = m.choices.find((c) => c.id === choiceOf[m.id]);
      if (choice) {
        choices[`${m.id}_${choice.id}`] = qty;
        gearTotal += choice.price * qty;
      } else {
        materials[m.id] = qty;
        gearTotal += m.price * qty;
      }
    }
    const commentSizes = neededKinds.filter((k) => kindSize[k]).map((k) => ({ label: SIZED_LABEL[k], size: kindSize[k]! }));
    return { materials, choices, commentSizes, gearTotal };
  }, [checkedGear, choiceOf, kindSize, neededKinds, quantityFor]);

  const tariffPrice = tariffToken != null ? (prices[tariffToken] ?? 0) : 0;
  const total = tariffPrice * people + booking.gearTotal;
  const roleRequired = (detail?.roles.length ?? 0) > 0 && !roleKey;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || roleRequired || sizeMissing || detail.requiresExtraForm) return;
    if (editing ? !detail.canModify : detail.alreadyRegistered || !detail.canRegister) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await vpdive.register(
        {
          eventToken: detail.token,
          roleKey,
          tariffToken,
          people,
          comment: composeComment(comment, booking.commentSizes, buddy, bottle),
          materials: booking.materials,
          choices: booking.choices,
        },
        { modification: editing },
      );
      setStatus({ kind: 'success', text: editing ? 'Votre inscription est modifiée sur VPDive.' : res.message });
      onChanged();
      await load(); // show the registered state as VPDive now reports it
    } catch (err) {
      if (onSessionLost(err)) return;
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : editing ? 'Modification impossible.' : 'Inscription impossible.' });
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
  const showForm = !!detail && !detail.requiresExtraForm && (editing ? detail.canModify : !detail.alreadyRegistered && detail.canRegister);
  let step = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="relative bg-surface w-full sm:max-w-xl h-dvh sm:h-auto sm:max-h-[92vh] sm:rounded-xl shadow-lift flex flex-col overflow-hidden animate-sheet sm:animate-pop"
      >
        {/* Header */}
        <header className="relative border-t-[3px] border-pink border-b border-line px-5 sm:px-6 pt-4 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {event.activity && <span className="label block mb-0.5">{event.activity.name}</span>}
              <h2 id="booking-title" className="text-xl font-semibold text-brand leading-snug">
                {title}
              </h2>
            </div>
            <div className="flex items-center gap-1 -mr-2 -mt-1 shrink-0">
              <ThemeToggle />
              <button onClick={onClose} disabled={busy} aria-label="Fermer" className="icon-btn">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="mt-1 space-y-1 text-sm text-muted">
            <p className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              <span className="first-letter:uppercase">{formatRange(start, end, event.allDay)}</span>
            </p>
            <p className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              {location || 'Lieu non précisé'}
            </p>
          </div>
          {onOpenPalanquees && (
            <button type="button" onClick={onOpenPalanquees} disabled={busy} className="btn btn-quiet h-9 text-sm mt-3.5">
              <Users className="w-4 h-4" /> Palanquées
            </button>
          )}
        </header>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 space-y-6">
            {!detail && !loadError && <p className="py-10 text-center text-muted">Chargement de la sortie depuis VPDive…</p>}
            {loadError && (
              <div role="alert" className="p-4 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2.5">
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
                {detail.description && <Description text={detail.description} />}

                <StatusBanner status={status} />

                {detail.alreadyRegistered && !editing ? (
                  <RegisteredPanel detail={detail} busy={busy} onCancel={cancel} onEdit={startEdit} />
                ) : detail.requiresExtraForm ? (
                  <Notice tone="info" title="Informations complémentaires demandées">
                    Cette sortie demande de remplir un formulaire spécifique. L’inscription se fait directement sur VPDive.{' '}
                    <a href={VPDIVE_EVENT_URL(detail.token)} target="_blank" rel="noreferrer" className="font-semibold underline">
                      S’inscrire sur VPDive
                    </a>
                  </Notice>
                ) : !detail.canRegister && !editing ? (
                  <Notice tone="warn" title="Inscription impossible">
                    {detail.refusalReasons.length ? detail.refusalReasons.join(' ') : 'VPDive n’autorise pas l’inscription à cette sortie pour le moment.'}
                  </Notice>
                ) : (
                  <>
                    {editing && (
                      <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-tint text-sm">
                        <span className="flex items-center gap-2 font-semibold text-brand">
                          <Pencil className="w-4 h-4" /> Modification de votre inscription
                        </span>
                        <button
                          type="button"
                          onClick={() => void load()}
                          disabled={busy}
                          className="font-semibold text-muted hover:text-ink underline underline-offset-2"
                        >
                          Annuler
                        </button>
                      </div>
                    )}

                    {/* Role */}
                    {detail.roles.length > 0 && (
                      <section>
                        <SectionTitle n={++step}>Votre rôle</SectionTitle>
                        <div role="radiogroup" aria-label="Votre rôle" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {detail.roles.map((r) => (
                            <ChoiceCard key={r.key} role="radio" selected={roleKey === r.key} onClick={() => chooseRole(r.key)}>
                              <span className="text-base font-medium">{r.label}</span>
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
                                  <span className={`text-base ${selected ? 'font-semibold text-brand' : 'text-ink'}`}>{t.label}</span>
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

                    {/* Rental gear: tap to check. The bottle is asked of everyone, rental or not. */}
                    <section>
                      <SectionTitle
                        n={++step}
                        hint={
                          detail.materials.length === 0
                            ? undefined
                            : detail.multipleBooking && people > 1
                              ? `Quantité alignée sur ${people} places`
                              : 'Touchez pour ajouter'
                        }
                      >
                        {detail.materials.length > 0 ? 'Location de matériel' : 'Matériel'}
                      </SectionTitle>
                      {detail.materials.length > 0 && (
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
                                <span className="block text-base font-medium leading-snug">{m.name}</span>
                                <span className={`block text-sm tabular-nums mt-1 ${checked ? 'text-brand font-semibold' : 'text-muted'}`}>
                                  {m.price > 0 ? `+${formatEuro(m.price)}` : 'Inclus'}
                                  {checked && qty > 1 ? ` × ${qty}` : ''}
                                  {checked && choiceOf[m.id] ? ` · ${m.choices.find((c) => c.id === choiceOf[m.id])?.name ?? ''}` : ''}
                                </span>
                              </ChoiceCard>
                            );
                          })}
                        </div>
                      )}

                      {choiceGear.map((m) => (
                        <SizePicker
                          key={m.id}
                          label={sizedKinds(m.name).length ? `${m.name} : votre taille` : `${m.name} : votre choix`}
                          options={m.choices.map((c) => ({ value: c.id, label: c.name }))}
                          value={choiceOf[m.id] ?? null}
                          onChange={(v) => setChoiceOf((prev) => ({ ...prev, [m.id]: v }))}
                        />
                      ))}
                      {neededKinds.map((k) => (
                        <SizePicker
                          key={k}
                          label={`Taille ${SIZED_LABEL[k].toLowerCase()}`}
                          options={SIZES.map((s) => ({ value: s, label: s }))}
                          value={kindSize[k] ?? null}
                          onChange={(v) => setKindSize((prev) => ({ ...prev, [k]: v as Size }))}
                        />
                      ))}
                      <SizePicker
                        label="Bouteille"
                        hint="12 L pour tous par défaut"
                        options={BOTTLES.map((b) => ({ value: b, label: b }))}
                        value={bottle}
                        onChange={(v) => setBottle(v as Bottle)}
                        className={detail.materials.length > 0 ? 'mt-4' : ''}
                      />
                    </section>

                    {/* People & comment */}
                    <section className="space-y-4">
                      {detail.multipleBooking && (
                        <div>
                          <label htmlFor="people" className="label block mb-1.5">
                            Nombre de places
                          </label>
                          <select
                            id="people"
                            value={people}
                            onChange={(e) => setPeople(Number(e.target.value))}
                            className="field w-full sm:w-48 text-base"
                          >
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n} personne{n > 1 ? 's' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <BuddyField value={buddy} onChange={setBuddy} onSessionLost={onSessionLost} />
                      <div>
                        <label htmlFor="comment" className="label block mb-1.5">
                          Message pour le club / le DP <span className="font-normal text-muted">(facultatif)</span>
                        </label>
                        <textarea
                          id="comment"
                          rows={2}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          className="field w-full h-auto py-2.5 text-base resize-none"
                        />
                      </div>
                    </section>

                    {event.availableSpots === 0 && !editing && (
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
                <span className="text-sm text-muted block">Total estimé</span>
                <span className="text-xl font-semibold tabular-nums text-brand leading-none">{formatEuro(total)}</span>
              </div>
              <button
                type="submit"
                disabled={busy || roleRequired || !!sizeMissing || pricesLoading}
                className="btn btn-primary h-11 flex-1 sm:flex-none sm:ml-auto px-6 text-base"
              >
                {busy
                  ? editing
                    ? 'Enregistrement…'
                    : 'Inscription…'
                  : roleRequired
                    ? 'Choisissez votre rôle'
                    : sizeMissing
                      ? `Choisir la taille : ${sizeMissing}`
                      : editing
                        ? 'Enregistrer les modifications'
                        : 'Confirmer l’inscription'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}


/** One row of choice chips under the gear grid: size of a checked wetsuit, BCD or item with club-defined variants, or the bottle. */
function SizePicker({
  label,
  hint,
  options,
  value,
  onChange,
  className = 'mt-4',
}: {
  label: string;
  hint?: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className={`label block ${hint ? '' : 'mb-2'}`}>
        {label} {!value && <span className="font-normal text-warn">· obligatoire</span>}
      </legend>
      {hint && <p className="text-sm text-muted mb-2">{hint}</p>}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`min-w-12 h-10 px-3 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
                selected ? 'border-2 border-brand bg-tint text-brand' : 'border border-field-border bg-field text-ink hover:border-brand/40'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
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
      className={`relative text-left min-h-[52px] px-3.5 py-3 rounded-xl transition-colors ${
        selected ? 'border-2 border-brand bg-tint text-brand' : 'border border-field-border bg-field text-ink hover:border-brand/30'
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

function RegisteredPanel({ detail, busy, onCancel, onEdit }: { detail: EventDetail; busy: boolean; onCancel: () => void; onEdit: () => void }) {
  const r = detail.myRegistration;
  // « Directeur de plongée (0€) » → « Directeur de plongée »
  const role = r?.roleKey ? detail.roles.find((x) => x.key === r.roleKey)?.label.replace(/\s*\(.*\)\s*$/, '') : null;
  const gear = (r?.gear ?? []).flatMap((g) => {
    const m = detail.materials.find((x) => x.id === g.id);
    const choice = m?.choices.find((c) => c.id === g.choiceId);
    return m ? [`${m.name.trim()}${choice ? ` (${choice.name})` : ''}`] : [];
  });
  const { sizes, buddy, bottle } = parseComment(r?.comment ?? '');
  const sizeText = SIZED_KINDS.filter((k) => sizes[k]).map((k) => `${SIZED_LABEL[k].toLowerCase()} ${sizes[k]}`);
  const canEdit = detail.canModify && !detail.requiresExtraForm && !!r;
  return (
    <div className="p-4 rounded-xl bg-ok-soft border border-green/40 text-base space-y-3">
      <p className="flex items-center gap-2 font-semibold text-base text-ok">
        <CheckCircle2 className="w-5 h-5" />
        Vous êtes inscrit à cette sortie
      </p>
      {r && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink">
          {role && <SummaryRow label="Rôle">{role}</SummaryRow>}
          <SummaryRow label="Matériel">
            {gear.length ? gear.join(', ') : 'aucune location'}
            {sizeText.length > 0 && <span className="text-muted"> · taille {sizeText.join(', ')}</span>}
            {bottle !== DEFAULT_BOTTLE && <span className="text-muted"> · bouteille {bottle}</span>}
          </SummaryRow>
          {buddy && <SummaryRow label="Binôme">{buddy}</SummaryRow>}
        </dl>
      )}
      {detail.myCart && (
        <p className="text-ink">
          Montant : <strong className="tabular-nums">{formatEuro(detail.myCart.amount)}</strong> ·{' '}
          {detail.myCart.paid ? 'réglé' : 'à régler sur VPDive'}
        </p>
      )}
      {(canEdit || detail.canUnregister) && (
        <div className="flex flex-col sm:flex-row gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              disabled={busy}
              className="btn btn-primary h-11 px-5"
            >
              <Pencil className="w-4 h-4" /> Modifier mon inscription
            </button>
          )}
          {detail.canUnregister && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="btn h-11 px-5 bg-surface text-danger border border-danger/30 hover:bg-danger-soft"
            >
              {busy ? 'Désinscription…' : 'Me désinscrire'}
            </button>
          )}
        </div>
      )}
      {!canEdit && <p className="text-muted">Le club n’a pas ouvert la modification d’inscription pour cette sortie.</p>}
      {!detail.canUnregister && <p className="text-muted">La désinscription n’est plus possible en ligne : contactez le club.</p>}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Description de la sortie : trois lignes, puis « Voir plus » quand elle est plus longue. */
function Description({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <section className="rounded-xl bg-raised px-4 py-3">
      <h3 className="text-base font-semibold text-brand mb-1.5">Description de la sortie</h3>
      <p ref={ref} className={`text-base leading-relaxed text-ink whitespace-pre-line ${open ? '' : 'line-clamp-3'}`}>
        {text}
      </p>
      {(long || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-sm font-semibold text-brand underline underline-offset-2"
        >
          {open ? 'Voir moins' : 'Voir plus…'}
        </button>
      )}
    </section>
  );
}

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  const ok = status.kind === 'success';
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={`p-3.5 rounded-xl text-base flex items-start gap-2 ${ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}
    >
      {ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
      <span className="font-semibold">{status.text}</span>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: 'info' | 'warn'; title: string; children: ReactNode }) {
  const cls = tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-tint text-brand';
  return (
    <div className={`p-4 rounded-xl text-base flex items-start gap-2.5 ${cls}`}>
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
      <h3 className="flex items-center gap-2.5 text-lg font-semibold text-brand">
        <span className="w-6 h-6 rounded-full bg-pink text-on-pink text-sm font-bold flex items-center justify-center">{n}</span>
        {children}
      </h3>
      {hint && <span className="text-sm text-muted text-right">{hint}</span>}
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
