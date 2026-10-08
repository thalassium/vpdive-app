/**
 * Météo marine : fusion des prévisions Open-Meteo (vent AROME, mer) en
 * créneaux horaires, niveaux d'alerte pour décider d'une sortie.
 */

/** Seuils de la décision de sortie : le seul endroit où ils se règlent. */
export const SEUILS = {
  /** Jaune : la règle ⚠️ de l'agenda pour le vent, puis rafales et vagues. */
  jaune: { vent: 16, rafales: 22, vagues: 1 },
  rouge: { vent: 22, rafales: 30, vagues: 1.5 },
} as const;

export type Level = 'ok' | 'jaune' | 'rouge';

export interface Slot {
  /** Heure locale « 2026-10-11T09:00 », comme Open-Meteo avec timezone=Europe/Paris. */
  time: string;
  /** Vent moyen et rafales, en nœuds. */
  wind: number;
  gusts: number;
  /** D'où vient le vent, en degrés. */
  windDir: number;
  /** Hauteur significative totale, mer du vent, houle (m) ; null hors couverture. */
  waves: number | null;
  windWaves: number | null;
  swell: number | null;
  swellPeriod: number | null;
  swellDir: number | null;
  /** Température de l'eau (°C). */
  water: number | null;
}

const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** 225 → « SO ». */
export function compass(deg: number): string {
  return ROSE[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

/** Force Beaufort d'un vent en nœuds (bornes hautes de chaque force). */
export function beaufort(kn: number): number {
  const bornes = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
  const i = bornes.findIndex((b) => kn < b);
  return i === -1 ? 12 : i;
}

/** Niveau d'un créneau : le pire des trois critères. */
export function level(s: Pick<Slot, 'wind' | 'gusts' | 'waves'>): Level {
  const au = (t: (typeof SEUILS)['jaune' | 'rouge']) => s.wind >= t.vent || s.gusts >= t.rafales || (s.waves ?? 0) >= t.vagues;
  return au(SEUILS.rouge) ? 'rouge' : au(SEUILS.jaune) ? 'jaune' : 'ok';
}

type Hourly = Record<string, unknown[] | undefined>;
const num = (a: unknown[] | undefined, i: number): number | null => {
  const v = a?.[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * Réponse Open-Meteo à plusieurs modèles (« wind_speed_10m_meteofrance_seamless »,
 * « …_best_match ») → une seule série par variable, heure par heure : le
 * premier modèle qui a une valeur l'emporte. Météo-France s'arrête vers 4 jours,
 * le modèle par défaut prend le relais.
 */
export function preferModels(hourly: Hourly, models: string[]): Hourly {
  const out: Hourly = { time: hourly.time };
  const vars = new Set(
    Object.keys(hourly)
      .map((k) => models.reduce((v, m) => (v.endsWith(`_${m}`) ? v.slice(0, -m.length - 1) : v), k))
      .filter((k) => k !== 'time'),
  );
  const n = (hourly.time ?? []).length;
  vars.forEach((v) => {
    out[v] = Array.from({ length: n }, (_, i) => {
      for (const m of models) {
        const x = hourly[`${v}_${m}`]?.[i];
        if (typeof x === 'number') return x;
      }
      return null;
    });
  });
  return out;
}

/**
 * Fusionne les réponses horaires « forecast » (vent) et « marine » (mer) sur
 * l'heure. Une heure sans vent est écartée ; la mer peut manquer (au-delà de
 * l'horizon du modèle de vagues).
 */
export function toSlots(forecast: Hourly, marine: Hourly | null): Slot[] {
  const mer = new Map<string, number>();
  ((marine?.time as string[] | undefined) ?? []).forEach((t, i) => mer.set(t, i));
  const out: Slot[] = [];
  ((forecast.time as string[] | undefined) ?? []).forEach((time, i) => {
    const wind = num(forecast.wind_speed_10m, i);
    if (wind === null) return;
    const j = mer.get(time);
    const m = (k: string) => (j === undefined ? null : num(marine?.[k], j));
    out.push({
      time,
      wind: Math.round(wind),
      gusts: Math.round(num(forecast.wind_gusts_10m, i) ?? wind),
      windDir: num(forecast.wind_direction_10m, i) ?? 0,
      waves: m('wave_height'),
      windWaves: m('wind_wave_height'),
      swell: m('swell_wave_height'),
      swellPeriod: m('swell_wave_period'),
      swellDir: m('swell_wave_direction'),
      water: m('sea_surface_temperature'),
    });
  });
  return out;
}

/**
 * Le pire créneau entre deux instants locaux (« 2026-10-11T09:00:00 » ou
 * « 2026-10-11 09:00 ») : vent d'abord, puis vagues. null si aucun créneau.
 */
export function worstIn(slots: Slot[], start: string, end: string): Slot | null {
  const cle = (s: string) => s.replace(' ', 'T').slice(0, 13);
  const a = cle(start);
  // Une sortie de 9 h à 12 h couvre les créneaux de 9, 10, 11 et 12 h.
  const b = cle(end || start);
  const dedans = slots.filter((s) => s.time.slice(0, 13) >= a && s.time.slice(0, 13) <= b);
  if (!dedans.length) return null;
  const rang: Record<Level, number> = { ok: 0, jaune: 1, rouge: 2 };
  return dedans.reduce((pire, s) => {
    const d = rang[level(s)] - rang[level(pire)];
    if (d !== 0) return d > 0 ? s : pire;
    if (s.gusts !== pire.gusts) return s.gusts > pire.gusts ? s : pire;
    return (s.waves ?? 0) > (pire.waves ?? 0) ? s : pire;
  });
}

/**
 * Échelle de couleur du vent, en nœuds, comme les sites de vent (Windfinder,
 * Windguru) : bleu au calme, vert pour un vent maniable ; le jaune arrive au
 * seuil de vigilance (16 nd), l'orange au seuil rouge (22 nd).
 */
export const WIND_SCALE: [number, string][] = [
  [0, '#a9c3f0'],
  [6, '#5aa9e6'],
  [10, '#3fc1c9'],
  [13, '#4cc37a'],
  [16, '#b5d84a'],
  [19, '#f2d04a'],
  [22, '#f39a3c'],
  [28, '#e5533f'],
  [34, '#c23a6e'],
  [40, '#8e3fa6'],
];

/** Couleur d'un vent en nœuds, interpolée entre les paliers de WIND_SCALE. */
export function windColor(kn: number): string {
  const s = WIND_SCALE;
  if (kn <= s[0]![0]) return s[0]![1];
  for (let i = 1; i < s.length; i++) {
    const [b, cb] = s[i]!;
    if (kn <= b) {
      const [a, ca] = s[i - 1]!;
      const t = (kn - a) / (b - a);
      const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
      return '#' + [0, 1, 2].map((k) => Math.round(ch(ca, k) + (ch(cb, k) - ch(ca, k)) * t).toString(16).padStart(2, '0')).join('');
    }
  }
  return s[s.length - 1]![1];
}

/** 0.64 → « 0,6 m ». */
export const metres = (m: number | null) => (m === null ? '–' : `${m.toFixed(1).replace('.', ',')} m`);
