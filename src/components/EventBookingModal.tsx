import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, Check, CheckCircle2, AlertCircle, Calendar as CalendarIcon, ExternalLink, RefreshCw, MapPin, Clock, Pencil, Users } from 'lucide-react';
import { vpdive, type CalendarEvent, type EventDetail, type MaterialOption, type RoleOption } from '../services/vpdive';
import { BuddyField } from './BuddyField';
import { useConfirm } from '../hooks/useConfirm';
import { useDialog } from '../hooks/useDialog';
import { GabianLoader } from './Gabian';
import { BOTTLES, DEFAULT_BOTTLE, SIZES, SIZED_KINDS, SIZED_LABEL, composeComment, parseComment, sizedKinds, type Bottle, type Size, type SizedKind } from '../lib/gear';
import { asksFor, canSupervise, classifyRoles, cleanRoleLabel, entryFromRole, roleKeyFor, volunteerTotal, type Entry, type InstructorMode } from '../lib/registration';
import { isCancelledTitle } from '../lib/agenda';

const VPDIVE_EVENT_URL = (token: string) => `https://septentrion-env.vpdive.com/app/activities/${token}`;

/**
 * Sorties où le membre est DP, gardées une heure par App (« dp-events:<id> ») pour
 * le menu Gestion de sortie : une inscription ou une désinscription peut les
 * changer, le cache est effacé pour être relu à la prochaine visite.
 */
function forgetDpEvents() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('dp-events:')) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Stockage interdit : il n'y a pas de cache à effacer.
  }
}

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

  /** Étape « Je viens comme… » : plongeur, encadrant (et s'il encadre ou plonge pour lui), bénévole (et son poste). */
  const [entry, setEntry] = useState<Entry | null>(null);
  const [mode, setMode] = useState<InstructorMode | null>(null);
  const [post, setPost] = useState<string | null>(null);
  /** Modification : rôle gardé tel quel (DP attribué par le club, ou rôle que la sortie ne propose plus). */
  const [fixedRole, setFixedRole] = useState<RoleOption | null>(null);
  /** Modification d'une inscription déjà encadrant : la carte reste ouverte quel que soit le niveau lu. */
  const [keepInstructor, setKeepInstructor] = useState(false);
  /** Mes niveaux (P4, E3…) : undefined = en cours de lecture, null = non lus sur VPDive. */
  const [labels, setLabels] = useState<string[] | null | undefined>(undefined);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  /** Rôle dont les tarifs sont affichés (undefined : aucun). L'envoi attend qu'il soit celui choisi. */
  const [pricedKey, setPricedKey] = useState<string | null | undefined>(undefined);
  /** Relance du calcul des tarifs après un échec. */
  const [priceAttempt, setPriceAttempt] = useState(0);
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
  /** Levels are read once per opening of the modal, not again after a booking reloads the outing. */
  const labelsAsked = useRef(false);
  /** Role key whose prices are shown; the detail's own prices are those of the default role. */
  const quotedKey = useRef<string | null>(null);

  const cls = useMemo(() => classifyRoles(detail?.roles ?? []), [detail]);

  /**
   * Reads the outing into the form (no state reset first: see `load`). The form is
   * filled in the promise's callbacks, never synchronously by the caller.
   */
  const fetchDetail = useCallback(() => {
    // Only the latest load may touch the form. Otherwise an earlier answer shows
    // the form, the member starts ticking items, and a later answer (React dev
    // mode runs effects twice; a reload after booking does too) wipes the ticks.
    const id = ++loadRequest.current;
    const fill = (d: EventDetail) => {
      if (id !== loadRequest.current) return;
      setDetail(d);
      setPrices(Object.fromEntries(d.tariffs.map((t) => [t.token, t.price])));
      setTariffToken(d.tariffs[0]?.token ?? null);
      const roles = classifyRoles(d.roles);
      // Same default as VPDive: plain "diver" when offered, otherwise no role pre-chosen.
      setEntry(roles.diver ? 'diver' : null);
      setMode(null);
      setPost(null);
      setFixedRole(null);
      setKeepInstructor(false);
      quotedKey.current = roles.diver?.key ?? null;
      // Les tarifs de la fiche sont ceux du rôle par défaut.
      setPricedKey(roles.diver?.key ?? null);
      if (roles.instructor && !labelsAsked.current) {
        labelsAsked.current = true;
        vpdive.myAptitudeLabels().then(setLabels, (e) => {
          if (!onSessionLost(e)) setLabels(null);
        });
      }
      setGear({});
      setChoiceOf({});
      setKindSize({});
      setBottle(DEFAULT_BOTTLE);
      setPeople(1);
      setEditing(false);
    };
    // .catch after .then: a failure while filling the form shows as a load error too.
    return vpdive
      .fetchEventDetail(event.token, { priority: 'high' })
      .then(fill)
      .catch((e: unknown) => {
        if (id !== loadRequest.current || onSessionLost(e)) return;
        setLoadError(e instanceof Error ? e.message : 'Impossible de charger la sortie.');
      });
  }, [event.token, onSessionLost]);
  /** Reload (retry, after booking): back to the loading state, then read again. */
  const load = useCallback(async () => {
    setLoadError(null);
    setDetail(null);
    await fetchDetail();
  }, [fetchDetail]);

  // On opening, the form is already in its loading state: just read.
  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  // Échap, bouton Retour, focus et verrou de défilement : hooks/useDialog. Pas de fermeture pendant un envoi.
  const { ref: dialogRef } = useDialog({ onClose, canClose: () => !busy, label: 'inscription' });
  const { confirm, confirmDialog } = useConfirm();

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
    // The role as VPDive recorded it; a DP (or a role the outing no longer offers) is kept as is.
    const pre = entryFromRole(r.roleKey, cls);
    const chosen = pre && 'entry' in pre ? pre : null;
    setFixedRole(pre && 'fixed' in pre ? pre.fixed : null);
    setEntry(chosen?.entry ?? null);
    setMode(chosen?.mode ?? null);
    setPost(chosen?.post ?? null);
    setKeepInstructor(chosen?.entry === 'instructor');
  };

  const pick = (e: Entry) => {
    if (e === entry) return;
    setEntry(e);
    setMode(null);
    // A single surface post needs no further choice.
    setPost(e === 'volunteer' && cls.volunteers.length === 1 ? (cls.volunteers[0]?.key ?? null) : null);
  };

  const instructorOk = keepInstructor || (!!labels && canSupervise(labels));
  const instructorHint = instructorOk ? null : labels === undefined ? '…' : labels === null ? 'Niveau non lu sur VPDive' : 'Réservé aux N4 et E1 à E4';

  /**
   * A checked item is rented once per place booked: one stab for a solo booking,
   * three for a booking of three — never more than VPDive has in stock.
   */
  const quantityFor = useCallback(
    (m: MaterialOption) => Math.min(m.maxQuantity, detail?.multipleBooking ? people : 1),
    [detail, people],
  );
  /** What the form asks for: everything of a diver, no buddy of who supervises, nothing of a volunteer. */
  const asks = asksFor(entry, mode);
  const checkedGear = useMemo(() => (asks.gear ? (detail?.materials ?? []).filter((m) => gear[m.id]) : []), [asks.gear, detail, gear]);

  /**
   * Sizes to ask for. Items with club-defined variants in VPDive: one choice per
   * item, sent natively. Otherwise one size per kind (wetsuit, BCD), shared by
   * every checked item containing it (« Combinaison » and « Pack complet » ask
   * the wetsuit size once), sent in the message to the club.
   */
  const choiceGear = checkedGear.filter((m) => m.choices.length > 0);
  const neededKinds = useMemo(() => SIZED_KINDS.filter((k) => checkedGear.some((m) => m.choices.length === 0 && sizedKinds(m.name).includes(k))), [checkedGear]);
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

  const tariffPrice = asks.tariff && tariffToken != null ? (prices[tariffToken] ?? 0) : 0;
  const total = tariffPrice * people + booking.gearTotal;
  const volunteerPost = entry === 'volunteer' && post ? cls.volunteers.find((v) => v.key === post) : null;
  const volunteer = volunteerPost ? volunteerTotal(volunteerPost.label) : null;
  const hasRoles = (detail?.roles.length ?? 0) > 0;
  /** Entry chosen and its sub-choice complete, unless the role is kept as VPDive recorded it. */
  const roleRequired = hasRoles && !fixedRole && (!entry || (entry === 'instructor' && !mode) || (entry === 'volunteer' && !post));
  const roleKeyToSend = fixedRole ? fixedRole.key : hasRoles ? roleKeyFor(entry, mode, post, cls) : null;
  /** Sortie annulée (« [ANNULÉE] » dans le titre) : plus d'inscription ni de modification, la désinscription reste. */
  const cancelled = event.cancelled || (!!detail && isCancelledTitle(detail.title));
  const showForm = !!detail && !cancelled && !detail.requiresExtraForm && (editing ? detail.canModify : !detail.alreadyRegistered && detail.canRegister);
  /** Le tarif affiché n'est pas (encore) celui du rôle choisi : pas d'envoi à un prix faux. */
  const priceStale = showForm && asks.tariff && (detail?.tariffs.length ?? 0) > 0 && !roleRequired && pricedKey !== roleKeyToSend;

  // Prices depend on the role (an instructor often dives for free): quoted again whenever the role to send changes.
  useEffect(() => {
    if (!detail || !showForm || roleRequired || roleKeyToSend === quotedKey.current) return;
    quotedKey.current = roleKeyToSend;
    const id = ++priceRequest.current;
    setPricesLoading(true);
    vpdive
      .fetchPricesForRole(detail.token, roleKeyToSend)
      .then(
        (p) => {
          if (id !== priceRequest.current) return;
          setPrices(p);
          setPricedKey(roleKeyToSend);
          setStatus((s) => (s.kind === 'error' && s.text.startsWith(PRICE_ERROR) ? { kind: 'idle' } : s));
        },
        (e) => {
          if (onSessionLost(e)) return;
          quotedKey.current = null;
          if (id === priceRequest.current) {
            setStatus({ kind: 'error', text: `${PRICE_ERROR} : ${e instanceof Error ? e.message : e}` });
          }
        },
      )
      .finally(() => {
        if (id === priceRequest.current) setPricesLoading(false);
      });
  }, [detail, showForm, roleRequired, roleKeyToSend, onSessionLost, priceAttempt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || roleRequired || sizeMissing || detail.requiresExtraForm || cancelled || priceStale || pricesLoading) return;
    if (editing ? !detail.canModify : detail.alreadyRegistered || !detail.canRegister) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      const res = await vpdive.register(
        {
          eventToken: detail.token,
          roleKey: roleKeyToSend,
          // A volunteer: no tariff, one place, no gear (booking is already empty), no buddy.
          tariffToken: asks.tariff ? tariffToken : null,
          people: asks.tariff ? people : 1,
          comment: composeComment(comment, booking.commentSizes, asks.buddy ? buddy : null, asks.gear ? bottle : DEFAULT_BOTTLE),
          materials: booking.materials,
          choices: booking.choices,
        },
        { modification: editing },
      );
      setStatus({
        kind: 'success',
        text: res.waitingList
          ? editing
            ? 'Votre inscription est modifiée. Vous êtes toujours sur liste d’attente.'
            : 'Vous êtes sur liste d’attente : le club vous préviendra si une place se libère.'
          : editing
            ? 'Votre inscription est modifiée sur VPDive.'
            : res.message,
      });
      forgetDpEvents();
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
    if (!(await confirm({ title: 'Confirmer la désinscription ?', message: `« ${detail.title} »`, confirmLabel: 'Me désinscrire', danger: true }))) return;
    setBusy(true);
    setStatus({ kind: 'idle' });
    try {
      await vpdive.unregister(detail.token);
      setStatus({ kind: 'success', text: 'Vous êtes désinscrit de cette sortie.' });
      forgetDpEvents();
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
  /** Section numbers, in the order the sections show (some are conditional). */
  const nextStep = stepCounter();

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center justify-center sm:p-4 bg-scrim animate-fade"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
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
            <button type="button" onClick={onOpenPalanquees} disabled={busy} className="btn btn-quiet sm:h-9 text-sm mt-3.5">
              <Users className="w-4 h-4" /> Palanquées
            </button>
          )}
        </header>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5 space-y-6">
            {!detail && !loadError && <GabianLoader label="Chargement de la sortie depuis VPDive…" />}
            {loadError && (
              <div role="alert" className="p-4 rounded-xl bg-danger-soft text-danger text-base flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <div className="flex-1">
                  <span className="font-semibold block">Impossible de charger cette sortie</span>
                  <span>{loadError}</span>
                </div>
                <button type="button" onClick={load} className="inline-flex items-center gap-1 max-sm:min-h-11 font-semibold underline underline-offset-2">
                  <RefreshCw className="w-4 h-4" /> Réessayer
                </button>
              </div>
            )}

            {detail && (
              <>
                {detail.description && <Description text={detail.description} />}

                <StatusBanner status={status} />

                {cancelled && (
                  <Notice tone="warn" title="Sortie annulée">
                    {detail.alreadyRegistered
                      ? 'Le club a annulé cette sortie. Vous pouvez vous désinscrire ci-dessous.'
                      : 'Le club a annulé cette sortie : les inscriptions sont fermées.'}
                  </Notice>
                )}
                {detail.alreadyRegistered && !editing ? (
                  <RegisteredPanel detail={detail} busy={busy} cancelled={cancelled} onCancel={cancel} onEdit={startEdit} />
                ) : cancelled ? null : detail.requiresExtraForm ? (
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
                          className="max-sm:min-h-11 font-semibold text-muted hover:text-ink underline underline-offset-2"
                        >
                          Annuler
                        </button>
                      </div>
                    )}

                    {/* Entry: diver, instructor (N4/E1…E4 only), volunteer on a surface post. The DP is never offered. */}
                    {hasRoles && !fixedRole && (
                      <section>
                        <SectionTitle n={nextStep()}>Je viens comme…</SectionTitle>
                        <div role="radiogroup" aria-label="Je viens comme" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <ChoiceCard role="radio" selected={entry === 'diver'} onClick={() => pick('diver')}>
                            <span className="text-base font-medium">Plongeur</span>
                          </ChoiceCard>
                          {cls.instructor && (
                            <ChoiceCard role="radio" selected={entry === 'instructor'} disabled={!instructorOk} onClick={() => pick('instructor')}>
                              <span className="text-base font-medium">Encadrant</span>
                              {instructorHint && <span className="block text-sm text-muted mt-0.5">{instructorHint}</span>}
                            </ChoiceCard>
                          )}
                          {cls.volunteers.length > 0 && (
                            <ChoiceCard role="radio" selected={entry === 'volunteer'} onClick={() => pick('volunteer')}>
                              <span className="text-base font-medium">Bénévole</span>
                            </ChoiceCard>
                          )}
                        </div>
                        {entry === 'instructor' && (
                          <Chips
                            label="Encadrant"
                            options={[
                              { value: 'supervise', label: 'J’encadre' },
                              { value: 'dive', label: 'Je plonge pour moi' },
                            ]}
                            value={mode}
                            onChange={(v) => setMode(v as InstructorMode)}
                          />
                        )}
                        {entry === 'volunteer' && (
                          <Chips label="Poste" options={cls.volunteers.map((v) => ({ value: v.key, label: cleanRoleLabel(v.label) }))} value={post} onChange={setPost} />
                        )}
                      </section>
                    )}
                    {fixedRole && (
                      <section>
                        <SectionTitle n={nextStep()}>Votre rôle</SectionTitle>
                        <p className="text-base text-ink">
                          {cleanRoleLabel(fixedRole.label) || 'Rôle'} <span className="text-muted">(attribué par le club)</span>
                        </p>
                      </section>
                    )}

                    {/* Tariff */}
                    {asks.tariff && detail.tariffs.length > 0 && (
                      <section>
                        <SectionTitle n={nextStep()} hint={pricesLoading ? 'Mise à jour des tarifs…' : undefined}>
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

                    {/* Rental gear: tap to check. The bottle is asked of every diver, rental or not. */}
                    {asks.gear && (
                      <section>
                        <SectionTitle
                          n={nextStep()}
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
                                  <span className="block text-base font-medium leading-snug break-words hyphens-auto">{m.name}</span>
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
                            label={sizedKinds(m.name).length ? `${m.name} : votre taille` : `${m.name} : votre choix`}
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
                    )}

                    {/* People & comment */}
                    <section className="space-y-4">
                      {asks.tariff && detail.multipleBooking && (
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
                      {asks.buddy && <BuddyField value={buddy} onChange={setBuddy} onSessionLost={onSessionLost} />}
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
                    href={googleCalendarUrl(title, start, end, location, event.allDay)}
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
              <div className="shrink-0">
                {/* A volunteer's post: the price hint VPDive writes in the role name; the exact amount follows in the cart. */}
                <span className="text-sm text-muted block">{volunteer && !('zero' in volunteer && volunteer.zero) ? 'Selon VPDive' : 'Total estimé'}</span>
                <span className="text-xl font-semibold tabular-nums text-brand leading-none">
                  {!volunteer ? formatEuro(total) : 'unknown' in volunteer ? '—' : volunteer.zero ? '0 €' : `dès ${formatEuro(volunteer.from)}`}
                </span>
              </div>
              {priceStale && !pricesLoading && !busy ? (
                // Tarif du rôle choisi non recalculé (VPDive n'a pas répondu) : on le redemande avant tout envoi.
                <button
                  type="button"
                  onClick={() => {
                    quotedKey.current = null;
                    setPriceAttempt((n) => n + 1);
                  }}
                  className="btn btn-primary h-auto min-h-11 py-2 min-w-0 whitespace-normal leading-tight text-center flex-1 sm:flex-none sm:ml-auto px-6 text-base"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" /> Recalculer le tarif
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={busy || roleRequired || !!sizeMissing || pricesLoading || priceStale}
                  className="btn btn-primary h-auto min-h-11 py-2 min-w-0 whitespace-normal leading-tight text-center flex-1 sm:flex-none sm:ml-auto px-6 text-base"
                >
                  {busy
                    ? editing
                      ? 'Enregistrement…'
                      : 'Inscription…'
                    : roleRequired
                      ? 'Choisissez votre rôle'
                      : sizeMissing
                        ? `Choisir la taille : ${sizeMissing}`
                        : pricesLoading
                          ? 'Calcul du tarif…'
                          : editing
                            ? 'Enregistrer les modifications'
                            : 'Confirmer l’inscription'}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
      {confirmDialog}
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
              className={`min-w-12 h-11 sm:h-10 px-3 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
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

/** Sub-choice under the entry cards (« J’encadre » / « Je plonge pour moi », or the surface post): a segmented control that wraps on phones. */
function Chips({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap max-w-full gap-0.5 rounded-lg border border-field-border bg-surface p-1 mt-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`h-11 sm:h-9 px-3 rounded-md text-sm font-medium transition-colors ${selected ? 'bg-tint text-brand' : 'text-muted hover:text-brand'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Selectable card used for the entry (single choice) and rental gear (toggle). Disabled: greyed, with the reason as its content. */
function ChoiceCard({
  selected,
  onClick,
  children,
  role,
  label,
  disabled = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  role?: 'radio';
  label?: string;
  disabled?: boolean;
}) {
  const a11y = role === 'radio' ? { role: 'radio', 'aria-checked': selected } : { 'aria-pressed': selected };
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      aria-disabled={disabled || undefined}
      {...a11y}
      className={`relative text-left min-h-[52px] px-3.5 py-3 rounded-xl transition-colors ${
        selected
          ? 'border-2 border-brand bg-tint text-brand'
          : disabled
            ? 'border border-field-border bg-field text-ink opacity-50 cursor-not-allowed'
            : 'border border-field-border bg-field text-ink hover:border-brand/30'
      }`}
    >
      <span className="block pr-6">{children}</span>
      <span
        className={`absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
          selected ? 'bg-fill text-on-fill' : 'border-2 border-line'
        }`}
      >
        {selected && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

function RegisteredPanel({
  detail,
  busy,
  cancelled,
  onCancel,
  onEdit,
}: {
  detail: EventDetail;
  busy: boolean;
  /** Sortie annulée : on peut encore se désinscrire, plus modifier. */
  cancelled: boolean;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const r = detail.myRegistration;
  const roleOption = r?.roleKey ? detail.roles.find((x) => x.key === r.roleKey) : undefined;
  const role = roleOption ? cleanRoleLabel(roleOption.label) : null;
  // A volunteer (surface post) rents nothing: no gear line.
  const volunteer = !!roleOption && classifyRoles(detail.roles).volunteers.some((v) => v.key === roleOption.key);
  const gear = (r?.gear ?? []).flatMap((g) => {
    const m = detail.materials.find((x) => x.id === g.id);
    const choice = m?.choices.find((c) => c.id === g.choiceId);
    return m ? [`${m.name.trim()}${choice ? ` (${choice.name})` : ''}`] : [];
  });
  const { sizes, buddy, bottle } = parseComment(r?.comment ?? '');
  const sizeText = SIZED_KINDS.filter((k) => sizes[k]).map((k) => `${SIZED_LABEL[k].toLowerCase()} ${sizes[k]}`);
  const canEdit = detail.canModify && !detail.requiresExtraForm && !!r && !cancelled;
  const waiting = detail.onWaitingList;
  return (
    <div className={`p-4 rounded-xl border text-base space-y-3 ${waiting ? 'bg-warn-soft border-warn/40' : 'bg-ok-soft border-ok/40'}`}>
      {waiting ? (
        <div className="text-warn">
          <p className="flex items-center gap-2 font-semibold text-base">
            <Clock className="w-5 h-5" />
            Sur liste d’attente
          </p>
          <p className="text-ink mt-1">La sortie est complète : le club vous préviendra si une place se libère.</p>
        </div>
      ) : (
        <p className="flex items-center gap-2 font-semibold text-base text-ok">
          <CheckCircle2 className="w-5 h-5" />
          Vous êtes inscrit à cette sortie
        </p>
      )}
      {r && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink">
          {role && <SummaryRow label="Rôle">{role}</SummaryRow>}
          {!volunteer && (
            <SummaryRow label="Matériel">
              {gear.length ? gear.join(', ') : 'aucune location'}
              {sizeText.length > 0 && <span className="text-muted"> · taille {sizeText.join(', ')}</span>}
              {bottle !== DEFAULT_BOTTLE && <span className="text-muted"> · bouteille {bottle}</span>}
            </SummaryRow>
          )}
          {buddy && <SummaryRow label="Binôme">{buddy}</SummaryRow>}
        </dl>
      )}
      {detail.myCart && (
        <p className="text-ink">
          Montant : <strong className="tabular-nums">{formatEuro(detail.myCart.amount)}</strong> ·{' '}
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
      {!canEdit && !cancelled && <p className="text-muted">Le club n’a pas ouvert la modification d’inscription pour cette sortie.</p>}
      {!detail.canUnregister && <p className="text-muted">La désinscription n’est plus possible en ligne : contactez le club.</p>}
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
          className="mt-1 max-sm:min-h-11 text-sm font-semibold text-brand underline underline-offset-2"
        >
          {open ? 'Voir moins' : 'Voir plus…'}
        </button>
      )}
    </section>
  );
}

/** Début du message d'échec du recalcul des tarifs (effacé quand un recalcul réussit). */
const PRICE_ERROR = 'Tarifs non mis à jour pour ce rôle';

function StatusBanner({ status }: { status: Status }) {
  const ref = useRef<HTMLDivElement>(null);
  // Sur téléphone, le bandeau peut être loin au-dessus du bouton d'envoi : on le ramène à la vue.
  useEffect(() => {
    if (status.kind !== 'idle') ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [status]);
  if (status.kind === 'idle') return null;
  const ok = status.kind === 'success';
  return (
    <div
      ref={ref}
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

/** Numbers each section of the form as it renders: 1, 2, 3… */
function stepCounter(): () => number {
  let n = 0;
  return () => ++n;
}

function formatEuro(n: number): string {
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

function googleCalendarUrl(title: string, start: string, end: string, location: string, allDay = false): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  // Journée entière : dates seules, la fin étant le lendemain (convention Google).
  const day = (iso: string, plus = 0) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + plus);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, location });
  if (start) params.set('dates', allDay ? `${day(start)}/${day(end || start, 1)}` : `${fmt(start)}/${fmt(end || start)}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}
