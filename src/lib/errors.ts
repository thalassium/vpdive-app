/**
 * Le texte d'une erreur, à montrer tel quel : son message ; à défaut (pas une
 * Error, ou un message vide), `fallback` s'il est donné, sinon l'erreur en texte.
 */
export function message(e: unknown, fallback?: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (fallback !== undefined) return fallback;
  return e instanceof Error ? e.message : String(e);
}
