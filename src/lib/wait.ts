/** Attend `ms` millisecondes. */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
