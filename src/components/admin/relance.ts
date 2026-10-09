/*
 * Relance des inscrits (gestion des adhésions) : formes et règles partagées par
 * le hook de lecture (useRelance), l'onglet (RelanceTab) et la fenêtre de relance
 * (ReminderSheet). Les règles des documents sont dans lib/docsCheck.ts.
 */
import type { RosterEntry } from '../../services/vpdive';
import { checkDocs, type DocIssue, type DocKind, type DocsStatus } from '../../lib/docsCheck';

/** Qui relance (signature des messages). */
export interface Me {
  uct: string;
  name: string;
  picture: string;
}

export interface Outing {
  token: string;
  title: string;
  /** AAAA-MM-JJ */
  date: string;
  roster: RosterEntry[];
}

/** Une sortie pour laquelle le dossier du membre n'est pas en règle. */
export interface Concern {
  outing: Outing;
  waitingList: boolean;
  issues: DocIssue[];
}

/** Un membre, toutes ses sorties concernées. */
export interface Row {
  key: string;
  name: string;
  firstname: string;
  email: string;
  uct: string;
  picture: string;
  level: 'red' | 'yellow';
  /** Un problème par sorte, tel qu'il se pose pour la première sortie concernée. */
  issues: DocIssue[];
  concerns: Concern[];
}

export type Filter = 'all' | DocKind | 'ignored';
export type Phase = 'events' | 'rosters' | 'status' | 'stopped' | 'done' | 'error';

export const DAYS_AHEAD = 60;

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
export const hasKind = (r: Row, kind: DocKind) => r.issues.some((i) => i.kind === kind && i.level !== 'muted');

/**
 * Un membre par ligne, avec toutes ses sorties concernées : les dossiers en
 * défaut (rouge) d'abord, puis par date de la première sortie, puis par nom.
 */
export function relanceRows(outings: Outing[], statuses: Record<string, DocsStatus>): Row[] {
  const map = new Map<string, Row>();
  for (const o of [...outings].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const e of o.roster) {
      const status = e.uct ? (statuses[e.uct] ?? null) : null;
      const res = checkDocs(e, o.date, status);
      if (res.level === 'ok') continue;
      const key = e.uct || `id:${e.id}`;
      let row = map.get(key);
      if (!row) {
        row = { key, name: e.name, firstname: e.firstname, email: e.email ?? '', uct: e.uct ?? '', picture: e.picture ?? '', level: 'yellow', issues: [], concerns: [] };
        map.set(key, row);
      }
      row.email ||= e.email ?? '';
      row.picture ||= e.picture ?? '';
      row.concerns.push({ outing: o, waitingList: e.waitingList, issues: res.issues });
      if (res.level === 'red') row.level = 'red';
    }
  }
  for (const row of map.values()) {
    const all = row.concerns.flatMap((c) => c.issues);
    for (const kind of ['caci', 'licence', 'adhesion'] as const) {
      const issue = all.find((i) => i.kind === kind && i.level !== 'muted') ?? all.find((i) => i.kind === kind);
      if (issue) row.issues.push(issue);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1) ||
      a.concerns[0]!.outing.date.localeCompare(b.concerns[0]!.outing.date) ||
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
  );
}
