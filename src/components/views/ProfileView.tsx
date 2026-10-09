import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Award, ChevronDown, ExternalLink, FileText, FolderOpen, IdCard, ImageIcon, LogOut } from 'lucide-react';
import { vpdive, type EmergencyContact, type MemberDocument, type MemberInfo, type MemberProfile, type RosterEntry, type Session } from '../../services/vpdive';
import { ymd, frDate } from '../../lib/dates';
import type { Me } from '../../services/appApi';
import { Avatar } from '../Avatar';
import { ThemeToggle } from '../ThemeToggle';
import { message } from '../../lib/errors';

/** Ma page profil sur VPDive : informations, documents, niveaux. */
const VPDIVE_URL = 'https://septentrion-env.vpdive.com/app/profile';

/** Niveaux, prérogatives et certificat médical, quelle que soit leur source. */
interface Quals {
  groups: { label: string; items: string[] }[];
  training: string[];
  medical: { until: string | null; valid: boolean } | null;
}

/** « 2027-03-12 » → « 12/03/2027 ». */

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
  onPicture,
  onLogout,
  onSessionLost,
}: {
  session: Session;
  me: Me | null;
  picture?: string;
  /** Photo relue sur VPDive à l'ouverture du profil : l'appli la reprend (en-tête, onglet). */
  onPicture?: (picture: string) => void;
  onLogout: () => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  /** Photo relue à chaque ouverture du profil (changée sur VPDive entre-temps) ; undefined tant qu'elle n'est pas relue. */
  const [freshPicture, setFreshPicture] = useState<string | undefined>(undefined);
  const onPictureRef = useRef(onPicture);
  useEffect(() => {
    onPictureRef.current = onPicture;
  });
  useEffect(() => {
    let live = true;
    vpdive.refreshPicture().then(
      (p) => {
        if (!live) return;
        setFreshPicture(p);
        onPictureRef.current?.(p);
      },
      (e) => live && !onSessionLost(e) && console.warn('Photo non relue :', e),
    );
    return () => {
      live = false;
    };
  }, [onSessionLost]);
  /** undefined : en cours ; null : rien trouvé. */
  const [quals, setQuals] = useState<Quals | null | undefined>(undefined);
  const [qualsError, setQualsError] = useState<string | null>(null);
  /** undefined : en cours ; null : fiche VPDive inaccessible. */
  const [documents, setDocuments] = useState<MemberDocument[] | null | undefined>(undefined);
  /** undefined : en cours ; null : fiche VPDive inaccessible. */
  const [info, setInfo] = useState<MemberInfo | null | undefined>(undefined);
  const request = useRef(0);

  const meUct = me?.uct ?? null;
  const userId = session.userId;

  const load = useCallback(async () => {
    const id = ++request.current;
    const stale = () => id !== request.current;
    setQuals(undefined);
    setQualsError(null);
    setDocuments(undefined);
    setInfo(undefined);

    // Ma fiche VPDive (« Mon profil ») : niveaux et documents déposés. À défaut, la fiche
    //    membre (admins), puis la liste des inscrits d'une sortie pour les niveaux.
    let found: Quals | null = null;
    if (meUct) {
      try {
        const file = await vpdive.myFile(meUct);
        if (stale()) return;
        found = fromProfile(file.profile);
        setDocuments(file.documents);
        setInfo(file.info);
      } catch (e) {
        if (stale() || onSessionLost(e)) return;
        setDocuments(null);
        setInfo(null);
        try {
          found = fromProfile(await vpdive.memberProfile(meUct));
        } catch (e2) {
          // Refusée aux simples membres (403) : on passe à la liste des inscrits.
          if (stale() || onSessionLost(e2)) return;
        }
      }
    } else {
      setDocuments(null);
      setInfo(null);
    }
    // Dernier recours pour les niveaux : la liste des inscrits de ma prochaine sortie.
    if (!hasAny(found) && userId !== null) {
      try {
        const to = new Date();
        to.setDate(to.getDate() + 90);
        const first = (await vpdive.fetchEvents(ymd(new Date()), ymd(to))).find((ev) => ev.registered);
        if (first) {
          const entry = (await vpdive.fetchRoster(first.token)).find((r) => r.id === String(userId));
          if (entry) found = fromRoster(entry);
        }
      } catch (e) {
        if (stale() || onSessionLost(e)) return;
        setQualsError(message(e));
        return;
      }
    }
    if (stale()) return;
    setQuals(hasAny(found) ? found : null);
  }, [meUct, userId, onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);
  // Fermeture du profil : la lecture en cours n'écrit plus rien (une nouvelle lecture, elle, invalide la précédente d'elle-même).
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  const name = `${session.firstName} ${session.lastName}`.trim() || me?.name || session.email;
  const roleLabel = me?.role === 'superadmin' ? 'Super-admin' : me?.role === 'admin' ? 'Admin' : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-xl font-semibold text-brand">Profil</h1>
      <div aria-hidden className="isobath bg-line mt-2 mb-5" />

      {/* Identité */}
      <div className="flex items-center gap-4">
        <Avatar name={name} picture={freshPicture ?? picture ?? session.picture} size="md" className="w-16! h-16! text-lg!" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xl font-semibold text-ink">{name}</p>
            {roleLabel && <span className="rounded-md bg-tint text-brand text-sm font-semibold px-1.5">{roleLabel}</span>}
          </div>
          {session.email && <p className="text-sm text-muted truncate">{session.email}</p>}
          {session.clubName && <p className="text-sm text-muted">{session.clubName}</p>}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {/* Mes infos : ce que VPDive sait de moi ; se modifie sur VPDive */}
        <Box icon={<IdCard className="w-5 h-5" />} title="Mes infos">
          {info === undefined ? (
            <Skeleton rows={2} />
          ) : info === null ? (
            <div className="p-4">
              <p className="text-muted">Vos informations ne sont pas accessibles depuis l’appli.</p>
            </div>
          ) : (
            <InfoList info={info} />
          )}
          <EmergencyBlock onSessionLost={onSessionLost} />
          <div className="px-4 pb-4">
            <a href={VPDIVE_URL} target="_blank" rel="noreferrer" className="btn btn-quiet">
              <ExternalLink className="w-4 h-4" />
              Modifier sur VPDive
            </a>
          </div>
        </Box>

        <Box icon={<Award className="w-5 h-5" />} title="Mes niveaux">
          <div className="p-4">
            {qualsError ? (
              <ErrorLine text={qualsError} onRetry={load} />
            ) : quals === undefined ? (
              <div aria-hidden className="h-14 rounded-lg animate-pulse bg-raised" />
            ) : quals === null ? (
              <p className="text-muted">Les niveaux s’affichent dès votre prochaine inscription à une sortie.</p>
            ) : (
              <div className="space-y-4">
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
                {quals.training.length > 0 && <p className="text-ink">En préparation : {quals.training.join(', ')}</p>}
                <p className="text-ink">
                  Certificat médical :{' '}
                  {!quals.medical ? (
                    <span className="text-muted">non renseigné</span>
                  ) : quals.medical.valid ? (
                    <span className="text-ok font-medium">{quals.medical.until ? `valable jusqu’au ${frDate(quals.medical.until)}` : 'valable'}</span>
                  ) : (
                    <span className="text-danger font-medium">à renouveler</span>
                  )}
                </p>
              </div>
            )}
          </div>
        </Box>

        {/* Mes documents : ceux que le membre a déposés sur VPDive ; le lien ouvre le fichier */}
        <Box icon={<FolderOpen className="w-5 h-5" />} title="Mes documents" count={documents?.length}>
          {documents === undefined ? (
            <Skeleton rows={2} />
          ) : documents === null || documents.length === 0 ? (
            <div className="p-4">
              <p className="text-muted">
                {documents === null ? 'Vos documents ne sont pas accessibles depuis l’appli.' : 'Aucun document déposé sur VPDive.'}
              </p>
              <a href={VPDIVE_URL} target="_blank" rel="noreferrer" className="btn btn-quiet mt-3">
                <ExternalLink className="w-4 h-4" />
                Déposer un document sur VPDive
              </a>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {documents.map((doc) => (
                <li key={doc.url}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-raised focus-visible:bg-raised transition-colors"
                  >
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-tint text-brand inline-flex items-center justify-center">
                      {doc.kind === 'image' ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-ink truncate">{doc.label}</span>
                      {doc.detail && <span className="block text-sm text-muted truncate">{doc.detail}</span>}
                    </span>
                    <ExternalLink aria-hidden className="w-4 h-4 text-muted shrink-0" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>

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

/** « 1985-04-12 » → « 12/04/1985 ». */

/**
 * Mes infos, groupées comme sur une fiche d'adhésion : contact, identité,
 * adhésion, licences. Une ligne vide n'est pas affichée ; le contact d'urgence
 * n'existe pas dans VPDive, on le dit plutôt que de laisser croire à un oubli.
 */
function InfoList({ info }: { info: MemberInfo }) {
  const adresse = [info.address, [info.zipCode, info.city].filter(Boolean).join(' '), info.country].filter(Boolean).join(', ');
  const naissance = [info.birthday && `le ${frDate(info.birthday)}`, info.birthPlace && `à ${info.birthPlace}`].filter(Boolean).join(' ');
  const groupes: { titre: string; lignes: [string, ReactNode][] }[] = [
    {
      titre: 'Contact',
      lignes: [
        ['Téléphone', info.phone && <a href={`tel:${info.phone.replace(/\s/g, '')}`} className="text-brand underline underline-offset-2">{info.phone}</a>],
        ['E-mail', info.email],
        ['Adresse', adresse],
      ],
    },
    {
      titre: 'Identité',
      lignes: [
        ['Nom', [info.civility, info.firstName, info.lastName].filter(Boolean).join(' ')],
        ['Nom de naissance', info.birthName !== info.lastName ? info.birthName : ''],
        ['Naissance', naissance],
      ],
    },
    {
      titre: 'Adhésion',
      lignes: [
        ['Membre depuis', frDate(info.memberSince)],
        ['Saisons', info.seasons.join(', ')],
        ['Assurance', [info.insurance, info.insuranceYear && `(${info.insuranceYear})`].filter(Boolean).join(' ')],
        ['Honorabilité', info.honorabilityAt && `contrôle validé le ${frDate(info.honorabilityAt)}`],
        ['Visible des membres', [info.shows.phone && 'téléphone', info.shows.birthday && 'date de naissance'].filter(Boolean).join(', ') || 'ni téléphone ni date de naissance'],
      ],
    },
    {
      titre: 'Licences',
      lignes: info.licences.map((l): [string, ReactNode] => [
        l.organization || 'Licence',
        <span>
          <span className="tabular-nums">{l.number}</span>
          {l.expired ? (
            <span className="text-danger"> · expirée</span>
          ) : l.expires ? (
            <span className="text-muted"> · jusqu’au {frDate(l.expires)}</span>
          ) : l.validated ? (
            <span className="text-ok"> · validée</span>
          ) : (
            <span className="text-muted"> · en attente</span>
          )}
        </span>,
      ]),
    },
  ];
  return (
    <div className="p-4 space-y-4">
      {groupes.map((g) => {
        const lignes = g.lignes.filter(([, v]) => !!v);
        if (!lignes.length) return null;
        return (
          <div key={g.titre}>
            <h3 className="label mb-1">{g.titre}</h3>
            <dl className="divide-y divide-line">
              {lignes.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_1fr] sm:grid-cols-[11rem_1fr] gap-3 py-2">
                  <dt className="text-sm text-muted">{k}</dt>
                  <dd className="text-ink break-words min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

const NO_CONTACT: EmergencyContact = { firstName: '', lastName: '', phone: '', cellphone: '', link: '' };
const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;

/**
 * Personne à contacter en cas d'urgence : lue et enregistrée sur VPDive, comme
 * sur sa page « Mon profil » (même formulaire, mêmes champs).
 *
 * VPDive enregistre les cinq champs ensemble : tant que la lecture n'a pas
 * réussi, la modification est fermée (un formulaire vide écraserait le contact
 * existant).
 */
function EmergencyBlock({ onSessionLost }: { onSessionLost: (e: unknown) => boolean }) {
  /** undefined : en cours ; null : illisible. */
  const [contact, setContact] = useState<EmergencyContact | null | undefined>(undefined);
  const [draft, setDraft] = useState<EmergencyContact | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** Aucun numéro saisi : les deux champs de téléphone sont signalés, reliés au message d'erreur. */
  const [noPhone, setNoPhone] = useState(false);
  const errorId = useId();

  // À l'ouverture, le contact est déjà en lecture (undefined) ; « réessayer » l'y remet avant de relire.
  useEffect(() => {
    let cancelled = false;
    vpdive.myEmergencyContact().then(
      (c) => !cancelled && setContact(c),
      (e) => !cancelled && !onSessionLost(e) && setContact(null),
    );
    return () => {
      cancelled = true;
    };
  }, [onSessionLost, attempt]);

  const filled = !!contact && Object.values(contact).some(Boolean);
  const save = async () => {
    if (!draft) return;
    if (!draft.phone.trim() && !draft.cellphone.trim()) {
      setNoPhone(true);
      setError('Indiquez au moins un numéro de téléphone.');
      return;
    }
    setNoPhone(false);
    setSaving(true);
    setError(null);
    try {
      await vpdive.saveEmergencyContact(draft);
      setContact(draft);
      setDraft(null);
      setSaved(true);
    } catch (e) {
      if (!onSessionLost(e)) setError(message(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof EmergencyContact, label: string, type = 'text', placeholder = '') => {
    const invalid = noPhone && (key === 'phone' || key === 'cellphone');
    return (
      <label className="block">
        <span className="label block mb-1">{label}</span>
        <input
          type={type}
          value={draft?.[key] ?? ''}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(e) => setDraft((d) => ({ ...(d ?? NO_CONTACT), [key]: e.target.value }))}
          className={`field w-full ${invalid ? 'border-danger' : ''}`}
        />
      </label>
    );
  };

  return (
    <div className="px-4 pb-4">
      <h3 className="label mb-1">Contact d’urgence</h3>
      {draft ? (
        <div className="space-y-3 pt-1">
          <div className="grid sm:grid-cols-2 gap-3">
            {field('firstName', 'Prénom')}
            {field('lastName', 'Nom')}
            {field('cellphone', 'Portable', 'tel', '06 12 34 56 78')}
            {field('phone', 'Téléphone', 'tel', '01 23 45 67 89')}
          </div>
          {field('link', 'Lien avec vous', 'text', 'Conjoint, parent, ami…')}
          {error && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary">
              {saving ? 'Enregistrement…' : 'Enregistrer sur VPDive'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setError(null);
                setNoPhone(false);
              }}
              disabled={saving}
              className="btn btn-quiet"
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            {contact === undefined ? (
              <span className="text-muted">Chargement…</span>
            ) : contact === null ? (
              <p role="alert" className="text-danger">
                Contact d’urgence illisible,{' '}
                <button
                  type="button"
                  onClick={() => {
                    setContact(undefined);
                    setAttempt((n) => n + 1);
                  }}
                  className="font-semibold underline underline-offset-2"
                >
                  réessayer
                </button>
              </p>
            ) : filled ? (
              <>
                <p className="text-ink">
                  {[contact!.firstName, contact!.lastName].filter(Boolean).join(' ') || 'Contact'}
                  {contact!.link && <span className="text-muted"> · {contact!.link}</span>}
                </p>
                <p className="text-sm space-x-3">
                  {[contact!.cellphone, contact!.phone].filter(Boolean).map((n) => (
                    <a key={n} href={telHref(n)} className="text-brand underline underline-offset-2">
                      {n}
                    </a>
                  ))}
                </p>
              </>
            ) : (
              <span className="text-muted">Non renseigné.</span>
            )}
            {saved && <p className="text-sm text-ok mt-1">Enregistré sur VPDive.</p>}
          </div>
          {/* Modifiable seulement une fois le contact lu : sinon l'enregistrement effacerait l'existant. */}
          {contact && (
            <button
              type="button"
              onClick={() => {
                setDraft(contact);
                setError(null);
                setSaved(false);
              }}
              className="btn btn-quiet sm:h-9 text-sm"
            >
              {filled ? 'Modifier' : 'Ajouter'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Boîte dépliable du profil : un titre qui ouvre ou ferme son contenu
 * (élément <details>, accessible au clavier et au lecteur d'écran sans code).
 */
function Box({ icon, title, count, defaultOpen, children }: { icon: ReactNode; title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group card border-l-4 border-l-brand overflow-hidden">
      <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-raised">
        <span className="text-brand shrink-0">{icon}</span>
        <span className="flex-1 text-lg font-semibold text-ink">{title}</span>
        {count !== undefined && count > 0 && <span className="text-sm text-muted tabular-nums">{count}</span>}
        <ChevronDown aria-hidden className="w-5 h-5 text-muted shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
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
    <div aria-hidden className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse bg-raised" />
      ))}
    </div>
  );
}
