/** Client du Secret Santa (POST /api/app?action=santa, server/santa.ts) : public, aucun en-tête de session. */

export interface SantaStatus {
  key: string;
  title: string;
  createdAt: string;
  people: { name: string; token: string; openedAt: string | null }[];
  exclusions: [string, string][];
}

export class SantaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/app?action=santa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new SantaError(0, 'Pas de connexion : réessayez.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new SantaError(res.status, data?.error ?? 'Erreur serveur.');
  return data;
}

export const santaApi = {
  draw: (input: { key?: string; title: string; names: string[]; exclusions: [string, string][] }) => call<SantaStatus>({ op: 'draw', ...input }),
  status: (key: string) => call<SantaStatus>({ op: 'status', key }),
  renew: (key: string, name: string) => call<SantaStatus>({ op: 'renew', key, name }),
  peek: (token: string) => call<{ name: string; title: string; opened: boolean }>({ op: 'peek', token }),
  reveal: (token: string) => call<{ name: string; title: string; to: string }>({ op: 'reveal', token }),
};
