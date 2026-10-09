/**
 * Journaux du serveur, une ligne JSON par événement, pour la supervision
 * (Vercel Log Drain → outil de suivi) : {level, at, action, status, message, …}.
 *
 * Jamais de données personnelles ni de jetons : pas d'e-mail, de nom,
 * d'uct ni d'en-tête Authorization ; seulement l'action, le code, le message
 * d'erreur et des compteurs.
 */
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  action?: string | null;
  status?: number;
  message?: string;
  [key: string]: unknown;
}

/** Une ligne JSON sur la sortie de Vercel (console.error pour les erreurs, console.log sinon). */
export function log(level: LogLevel, fields: LogFields): void {
  const line = JSON.stringify({ level, at: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Message et pile d'une erreur, bornés. */
export function errorFields(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message.slice(0, 500), ...(e.stack ? { stack: e.stack.slice(0, 4000) } : {}) };
  return { message: String(e).slice(0, 500) };
}
