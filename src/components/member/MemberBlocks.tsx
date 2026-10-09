/*
 * Morceaux d'une fiche de membre, communs à « Mon profil » (ProfileView) et à la
 * fiche d'un autre membre (MemberSheet) : informations groupées, niveaux et
 * certificat, documents, boîte dépliable, squelette de chargement.
 */
import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink, FileText, ImageIcon } from 'lucide-react';
import type { MemberDocument, MemberInfo } from '../../services/vpdive';
import { frDate } from '../../lib/dates';
import type { Quals } from './quals';

/** Un groupe de lignes « libellé : valeur » (Contact, Identité…) ; une valeur vide n'est pas affichée. */
export interface InfoGroup {
  titre: string;
  lignes: [string, ReactNode][];
}

/** Groupes de lignes « libellé : valeur », chacun sous son petit titre ; un groupe sans valeur disparaît. */
export function InfoGroups({ groupes }: { groupes: InfoGroup[] }) {
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

/**
 * Les informations d'un membre, groupées comme sur une fiche d'adhésion : contact,
 * identité, adhésion, licences. Une ligne vide n'est pas affichée ; le contact
 * d'urgence n'existe pas dans VPDive, on le dit plutôt que de laisser croire à un oubli.
 */
export function InfoList({ info }: { info: MemberInfo }) {
  const adresse = [info.address, [info.zipCode, info.city].filter(Boolean).join(' '), info.country].filter(Boolean).join(', ');
  const naissance = [info.birthday && `le ${frDate(info.birthday)}`, info.birthPlace && `à ${info.birthPlace}`].filter(Boolean).join(' ');
  const groupes: InfoGroup[] = [
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
  return <InfoGroups groupes={groupes} />;
}

/** Niveaux (en pastilles, par groupe), formation en préparation et certificat médical. */
export function QualsList({ quals }: { quals: Quals }) {
  return (
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
  );
}

/** Documents déposés sur VPDive : une ligne par document, le lien ouvre le fichier. */
export function DocumentList({ documents }: { documents: MemberDocument[] }) {
  return (
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
  );
}

/**
 * Boîte dépliable du profil : un titre qui ouvre ou ferme son contenu
 * (élément <details>, accessible au clavier et au lecteur d'écran sans code).
 * Le titre est le bandeau rose des sections (section-title), texte et icônes en
 * marine ; l'anneau de focus passe en marine, à l'intérieur (la carte rogne ce qui dépasse).
 */
export function Box({ icon, title, count, defaultOpen, children }: { icon: ReactNode; title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group card overflow-hidden">
      <summary className="section-title flex-nowrap gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-[filter] hover:brightness-95 focus-visible:outline-on-accent focus-visible:-outline-offset-4">
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 text-lg">{title}</span>
        {count !== undefined && count > 0 && <span className="text-sm font-normal tabular-nums">{count}</span>}
        <ChevronDown aria-hidden className="w-5 h-5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

/** Lignes grisées qui battent, à la place d'un contenu en cours de lecture. */
export function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse bg-raised" />
      ))}
    </div>
  );
}
