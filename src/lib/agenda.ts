/**
 * Agenda : petites règles sur les sorties telles que VPDive les renvoie,
 * sans dépendance à l'interface (testées dans agenda.test.ts).
 */

/**
 * Sortie annulée ? VPDive n'a pas d'état « annulée » : la convention du club est
 * d'écrire « [ANNULÉE] » (ou « Annulé », « annulation »…) dans le titre. Le mot
 * doit commencer par « annul » : « Assemblée annuelle » n'est pas une annulation.
 */
export function isCancelledTitle(title: string): boolean {
  const plain = title.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /(^|[^a-z])annul/i.test(plain);
}

/**
 * Date VPDive → ISO lisible par tous les navigateurs. L'agenda renvoie de l'ISO
 * (« 2026-10-10T08:15:00+02:00 »), mais d'autres réponses écrivent
 * « 2026-10-10 08:15:00 » (avec parfois des microsecondes), que Safari refuse
 * de lire (new Date → Invalid Date). Une date déjà ISO, ou illisible, passe telle quelle.
 */
export function isoDateTime(s: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(.*)$/.exec(s.trim());
  if (!m) return s;
  const [, day, time, zone] = m;
  return `${day}T${time!.length === 5 ? `${time}:00` : time}${zone!.trim()}`;
}

/** « 2026-10-01 » → « 2026-09-30 » (jour local, sans passer par UTC). */
export function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Jours que montre la vue Liste d'un mois (`month` de 0 à 11) : tout le mois,
 * sauf le mois en cours, qui commence la veille d'aujourd'hui (le reste est passé).
 */
export function listDaysOf(days: string[], year: number, month: number, today: string): string[] {
  const inMonth = (d: string) => Number(d.slice(0, 4)) === year && Number(d.slice(5, 7)) - 1 === month;
  const from = inMonth(today) ? dayBefore(today) : '';
  return days.filter((d) => inMonth(d) && d >= from).sort();
}
