import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import { vpdive, ymd, type CalendarEvent, type MemberProfile, type RosterEntry, type Session } from '../../services/vpdiveApi';
import type { Me } from '../../services/appApi';
import { Avatar } from '../Avatar';
import { ThemeToggle } from '../ThemeToggle';
import { EventRow } from '../StandardCalendar';

const VPDIVE_URL = 'https://septentrion-env.vpdive.com/';

/** Niveaux, prérogatives et certificat médical, quelle que soit leur source. */
interface Quals {
  groups: { label: string; items: string[] }[];
  training: string[];
  medical: { until: string | null; valid: boolean } | null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
/** « 2027-03-12 » → « 12/03/2027 ». */
const frDate = (d: string) => d.split('-').reverse().join('/');

const hasAny = (q: Quals | null): q is Quals => !!q && (q.groups.some((g) => g.items.length > 0) || q.training.length > 0 || !!q.medical);

/** Fiche membre VPDive (permission `member_view`) : niveaux, enseignement et qualifications séparés. */
function fromProfile(p: MemberProfile): Quals {
  const until = p.medicalUntil || null;
  return {
    groups: [
      { label: 'Niveaux', items: p.levels },
      { label: 'Enseignement', items: p.teaching },
      { label: 'Qualifications', items: p.qualifications },
    ],
    training: [],
    medical: until ? { until, valid: until >= ymd(new Date()) } : null,
  };
}

/** Liste des inscrits d'une sortie : niveaux et diplômes mêlés, prépas, certificat. */
function fromRoster(r: RosterEntry): Quals {
  return {
    groups: [{ label: 'Niveaux et diplômes', items: r.display }],
    training: r.training,
    medical: r.medical.until || r.medical.valid ? r.medical : null,
  };
}

export function ProfileView({
  session,
  me,
  picture,
  onOpenEvent,
  onLogout,
  onSessionLost,
}: {
  session: Session;
  me: Me | null;
  picture?: string;
  onOpenEvent: (ev: CalendarEvent) => void;
  onLogout: () => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [upcoming, setUpcoming] = useState<CalendarEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  /** undefined : en cours ; null : rien trouvé. */
  const [quals, setQuals] = useState<Quals | null | undefined>(undefined);
  const [qualsError, setQualsError] = useState<string | null>(null);
  const request = useRef(0);

  const meUct = me?.uct ?? null;
  const userId = session.userId;

  const load = useCallback(async () => {
    const id = ++request.current;
    const stale = () => id !== request.current;
    setUpcoming(null);
    setEventsError(null);
    setQuals(undefined);
    setQualsError(null);

    // 1. Mes inscriptions à venir.
    let mine: CalendarEvent[] = [];
    let eventsFailed: string | null = null;
    try {
      const to = new Date();
      to.setDate(to.getDate() + 90);
      const events = await vpdive.fetchEvents(ymd(new Date()), ymd(to));
      if (stale()) return;
      mine = events.filter((ev) => ev.registered);
      setUpcoming(mine);
    } catch (e) {
      if (stale() || onSessionLost(e)) return;
      eventsFailed = errorText(e);
      setEventsError(eventsFailed);
    }

    // 2. Niveaux : la fiche membre si VPDive l'ouvre (admins), sinon la liste des inscrits d'une sortie.
    let found: Quals | null = null;
    if (meUct) {
      try {
        found = fromProfile(await vpdive.memberProfile(meUct));
      } catch (e) {
        // Refusée aux simples membres (403) : on passe à la liste des inscrits.
        if (stale() || onSessionLost(e)) return;
      }
    }
    const first = mine[0];
    if (!hasAny(found) && first && userId !== null) {
      try {
        const roster = await vpdive.fetchRoster(first.token);
        const entry = roster.find((r) => r.id === String(userId));
        if (entry) found = fromRoster(entry);
      } catch (e) {
        if (stale() || onSessionLost(e)) return;
        setQualsError(errorText(e));
        return;
      }
    }
    if (stale()) return;
    if (!hasAny(found) && eventsFailed) {
      setQualsError(eventsFailed);
      return;
    }
    setQuals(hasAny(found) ? found : null);
  }, [meUct, userId, onSessionLost]);

  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);

  const name = `${session.firstName} ${session.lastName}`.trim() || me?.name || session.email;
  const roleLabel = me?.role === 'superadmin' ? 'Super-admin' : me?.role === 'admin' ? 'Admin' : null;

  // Inscriptions groupées par jour, dans l'ordre.
  const byDay: [string, CalendarEvent[]][] = [];
  for (const ev of upcoming ?? []) {
    const day = ymd(new Date(ev.start));
    const last = byDay[byDay.length - 1];
    if (last && last[0] === day) last[1].push(ev);
    else byDay.push([day, [ev]]);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl font-semibold text-brand">Profil</h1>
      <div aria-hidden className="isobath bg-line mt-2 mb-5" />

      {/* Identité */}
      <div className="flex items-center gap-4">
        <Avatar name={name} picture={picture ?? session.picture} size="md" className="w-16! h-16! text-lg!" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xl font-semibold text-ink">{name}</p>
            {roleLabel && <span className="rounded-md bg-tint text-brand text-sm font-semibold px-1.5">{roleLabel}</span>}
          </div>
          {session.email && <p className="text-sm text-muted truncate">{session.email}</p>}
          {session.clubName && <p className="text-sm text-muted">{session.clubName}</p>}
        </div>
      </div>

      {/* Mes prochaines sorties */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-brand mb-2">Mes prochaines sorties</h2>
        {eventsError ? (
          <ErrorLine text={eventsError} onRetry={load} />
        ) : upcoming === null ? (
          <Skeleton rows={2} />
        ) : upcoming.length === 0 ? (
          <div>
            <p className="text-muted">Aucune inscription à venir. Les sorties se réservent depuis le calendrier.</p>
            <button
              type="button"
              className="btn btn-quiet mt-3"
              onClick={() => {
                window.location.hash = '';
              }}
            >
              Voir le calendrier
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {byDay.map(([day, events]) => (
              <div key={day}>
                <h3 className="label mb-1.5 px-1">{dayLabel(day)}</h3>
                <div className="card divide-y divide-line overflow-hidden">
                  {events.map((ev) => (
                    <EventRow key={ev.token} ev={ev} onClick={() => onOpenEvent(ev)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Niveaux et qualifications */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-brand mb-2">Niveaux et qualifications</h2>
        {qualsError ? (
          <ErrorLine text={qualsError} onRetry={load} />
        ) : quals === undefined ? (
          <Skeleton rows={1} />
        ) : quals === null ? (
          <p className="text-muted">Les niveaux s'affichent dès votre prochaine inscription à une sortie.</p>
        ) : (
          <div className="card p-4 space-y-4">
            {quals.groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <div key={g.label}>
                  <h3 className="label mb-1.5">{g.label}</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {g.items.map((item) => (
                      <li key={item} className="chip text-brand">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            {quals.training.length > 0 && <p className="text-ink">En préparation : {quals.training.join(', ')}</p>}
            <p className="text-ink">
              Certificat médical :{' '}
              {!quals.medical ? (
                <span className="text-muted">non renseigné</span>
              ) : quals.medical.valid ? (
                <span className="text-ok font-medium">{quals.medical.until ? `valable jusqu'au ${frDate(quals.medical.until)}` : 'valable'}</span>
              ) : (
                <span className="text-danger font-medium">à renouveler</span>
              )}
            </p>
          </div>
        )}
      </section>

      {/* Réglages et compte */}
      <section className="mt-8 pt-5 border-t border-line space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ThemeToggle className="border border-field-border bg-surface" />
            <span className="text-ink">Thème</span>
          </div>
          <button type="button" onClick={onLogout} className="btn btn-quiet text-danger">
            <LogOut className="w-4 h-4" />
            Se déconnecter
          </button>
        </div>
        <a href={VPDIVE_URL} target="_blank" rel="noreferrer" className="btn btn-quiet">
          <ExternalLink className="w-4 h-4" />
          Ouvrir mon profil sur VPDive
        </a>
      </section>
    </div>
  );
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-danger flex-1 min-w-0">{text}</p>
      <button type="button" onClick={onRetry} className="btn btn-quiet">
        Réessayer
      </button>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="card divide-y divide-line overflow-hidden">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse bg-raised" />
      ))}
    </div>
  );
}
