import { useState } from 'react';
import { Check, ExternalLink, FileText, UserCheck, UserPlus, X } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Spinner } from '../Spinner';
import { GabianLoader } from '../Gabian';
import { vpdive, type PendingValidation } from '../../services/vpdiveApi';
import { appApi, type RegistrationRequest } from '../../services/appApi';
import { useConfirm } from '../../hooks/useConfirm';
import { cacheKey } from './memberCache';

/*
 * Les deux onglets « à traiter d'abord » de la gestion des adhésions : tant
 * qu'une inscription ou un document n'est pas validé, VPDive n'en tient pas
 * compte, et les vérifications (Adhésions, Relance) le verraient manquant.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Après une validation, la fiche du membre gardée en session est périmée. */
function forgetMember(uct: string) {
  try {
    sessionStorage.removeItem(cacheKey(uct));
    sessionStorage.removeItem(`docs-status:${uct}`);
  } catch {
    // Stockage indisponible : rien à oublier.
  }
}

function Empty({ children }: { children: string }) {
  return <p className="py-12 text-center text-muted">{children}</p>;
}

function Failure({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="p-4 rounded-xl bg-danger-soft text-danger flex flex-wrap items-center gap-3">
      <span className="flex-1 min-w-0">{error}</span>
      <button type="button" onClick={onRetry} className="btn btn-quiet sm:h-9 text-sm">
        Réessayer
      </button>
    </div>
  );
}

// ── Membres à valider ──────────────────────────────────────────────

/**
 * Demandes d'inscription au club : la personne a créé son compte et demandé à
 * rejoindre le club ; elle n'est pas encore dans la liste des membres.
 */
export function RegistrationRequestsTab({
  requests,
  error,
  onReload,
  onChange,
  onSessionLost,
}: {
  requests: RegistrationRequest[] | null;
  error: string | null;
  onReload: () => void;
  onChange: (list: RegistrationRequest[]) => void;
  onSessionLost: (e: unknown) => boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const { confirm, confirmDialog } = useConfirm();
  if (error) return <Failure error={error} onRetry={onReload} />;
  if (!requests) return <GabianLoader label="Lecture des demandes d’inscription sur VPDive…" />;
  if (!requests.length) return <Empty>Aucune demande d’inscription en attente.</Empty>;

  const decide = async (r: RegistrationRequest, decision: 'member' | 'guest' | 'refuse') => {
    if (decision === 'refuse' && !(await confirm({ title: `Refuser l’accès au site à ${r.name || 'cette personne'} ?`, confirmLabel: 'Refuser', danger: true }))) return;
    setBusy(r.token);
    setRowError(({ [r.token]: _, ...rest }) => rest);
    try {
      onChange(await appApi.decideRegistration(r.token, decision));
    } catch (e) {
      if (!onSessionLost(e)) setRowError((x) => ({ ...x, [r.token]: message(e) }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted max-w-3xl">
        Ces personnes ont créé leur compte et demandé à rejoindre le club. Tant que la demande n’est pas acceptée, elles ne sont pas dans la liste des membres de VPDive.
      </p>
      <ul className="card divide-y divide-line">
        {requests.map((r) => (
          <li key={r.token} className="p-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Avatar name={r.name} picture={r.picture} size="md" initials={false} />
            <div className="flex-1 min-w-[12rem]">
              <p className="font-semibold text-ink">{r.name || 'Sans nom'}</p>
              {r.contact && <p className="text-sm text-muted break-words">{r.contact}</p>}
              {rowError[r.token] && (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {rowError[r.token]}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy !== null} aria-busy={busy === r.token} onClick={() => void decide(r, 'member')} className="btn btn-primary sm:h-9 text-sm">
                {busy === r.token ? <Spinner /> : <UserCheck className="w-4 h-4" />} Accepter comme membre
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(r, 'guest')}
                title="Invité : pas de messagerie, n’apparaît pas aux autres membres"
                className="btn btn-quiet sm:h-9 text-sm"
              >
                <UserPlus className="w-4 h-4" /> Accepter comme invité
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void decide(r, 'refuse')} className="btn btn-quiet sm:h-9 text-sm hover:text-danger hover:border-danger/40">
                <X className="w-4 h-4" /> Refuser
              </button>
            </div>
          </li>
        ))}
      </ul>
      {confirmDialog}
    </div>
  );
}

// ── Documents en attente ───────────────────────────────────────────

/**
 * Documents et déclarations déposés par les membres (CACI, licence, saison,
 * niveaux), en attente de validation. Regroupés par membre ; chaque élément se
 * valide ou se refuse comme dans le « Suivi des validations » de VPDive.
 */
export function PendingDocumentsTab({
  items,
  error,
  onReload,
  onChange,
  onSessionLost,
  onForget,
}: {
  items: PendingValidation[] | null;
  error: string | null;
  onReload: () => void;
  onChange: (list: PendingValidation[]) => void;
  onSessionLost: (e: unknown) => boolean;
  /** Après une décision : la fiche de ce membre gardée en mémoire (gestion des adhésions) est périmée. */
  onForget?: (uct: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const { confirm, confirmDialog } = useConfirm();
  if (error) return <Failure error={error} onRetry={onReload} />;
  if (!items) return <GabianLoader label="Lecture des documents en attente sur VPDive…" />;
  if (!items.length) return <Empty>Aucun document en attente de validation.</Empty>;

  const keyOf = (v: PendingValidation) => `${v.member}|${v.type}|${v.entityId}`;
  const byMember = new Map<string, PendingValidation[]>();
  for (const v of items) byMember.set(v.member, [...(byMember.get(v.member) ?? []), v]);
  const members = [...byMember.values()].sort((a, b) => a[0]!.memberName.localeCompare(b[0]!.memberName, 'fr'));

  /** Valide ou refuse, un élément ou tous ceux d'un membre, l'un après l'autre. */
  const decide = async (list: PendingValidation[], decision: 'approve' | 'reject', busyKey: string) => {
    if (
      decision === 'reject' &&
      !(await confirm({ title: `Refuser ${list.length > 1 ? 'ces documents' : 'ce document'} ?`, message: `${list.map((v) => v.typeLabel).join(', ')} de ${list[0]!.memberName}.`, confirmLabel: 'Refuser', danger: true }))
    )
      return;
    setBusy(busyKey);
    let left = items;
    try {
      for (const v of list) {
        await vpdive.decideValidation(v, decision);
        left = left.filter((x) => keyOf(x) !== keyOf(v));
        onChange(left);
        setRowError(({ [keyOf(v)]: _, ...rest }) => rest);
      }
    } catch (e) {
      if (!onSessionLost(e)) {
        const failed = list.find((v) => left.some((x) => keyOf(x) === keyOf(v)));
        if (failed) setRowError((x) => ({ ...x, [keyOf(failed)]: message(e) }));
      }
    } finally {
      forgetMember(list[0]!.member);
      onForget?.(list[0]!.member);
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted max-w-3xl">
        Déposés par les membres eux-mêmes. Tant qu’ils ne sont pas validés, VPDive n’en tient pas compte : un membre peut paraître sans licence ou sans saison alors qu’il les a
        renseignées.
      </p>
      {members.map((list) => {
        const first = list[0]!;
        return (
          <article key={first.member} className="card overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-raised border-b border-line">
              <Avatar name={first.memberName} picture={first.picture} size="sm" initials={false} />
              <span className="flex-1 min-w-0 font-semibold text-ink truncate">{first.memberName}</span>
              {list.length > 1 && (
                <button type="button" disabled={busy !== null} aria-busy={busy === first.member} onClick={() => void decide(list, 'approve', first.member)} className="btn btn-quiet sm:h-8 text-sm">
                  {busy === first.member ? <Spinner /> : <Check className="w-4 h-4" />} Tout valider ({list.length})
                </button>
              )}
            </header>
            <ul className="divide-y divide-line">
              {list.map((v) => {
                const k = keyOf(v);
                return (
                  <li key={k} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="w-36 shrink-0 font-semibold text-brand">{v.typeLabel}</span>
                    <div className="flex-1 min-w-[10rem]">
                      <p className="text-ink break-words">{v.detail || '—'}</p>
                      {v.files.length > 0 && (
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
                          {v.files.map((f) => (
                            <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand underline underline-offset-2">
                              <FileText className="w-3.5 h-3.5" /> {f.label}
                              <ExternalLink className="w-3 h-3 opacity-60" />
                            </a>
                          ))}
                        </p>
                      )}
                      {rowError[k] && (
                        <p role="alert" className="mt-1 text-sm text-danger">
                          {rowError[k]}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={busy !== null} aria-busy={busy === k} onClick={() => void decide([v], 'approve', k)} className="btn btn-primary sm:h-9 text-sm">
                        {busy === k ? <Spinner /> : <Check className="w-4 h-4" />} Valider
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void decide([v], 'reject', k)} className="btn btn-quiet sm:h-9 text-sm hover:text-danger hover:border-danger/40">
                        <X className="w-4 h-4" /> Refuser
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
      {confirmDialog}
    </div>
  );
}
