import { preferModels, toSlots, type Slot } from '../lib/marine';
import { sessionCache } from '../lib/cache';

/**
 * Météo marine, sans clé ni compte :
 *  - vent et rafales : Open-Meteo, modèle Météo-France (AROME puis ARPEGE),
 *    complété par le modèle par défaut au-delà de 4 jours ;
 *  - vagues, houle, eau : Open-Meteo Marine (modèle européen 5 km sur 3 jours) ;
 *  - carte : le vent sur une grille de points en mer, même source.
 */

/** Points de plongée du club ; Pointe Rouge d'abord, c'est le port. */
export const SPOTS = [
  { id: 'pointe-rouge', name: 'Pointe Rouge', lat: 43.243, lon: 5.362 },
  { id: 'frioul', name: 'Frioul', lat: 43.278, lon: 5.300 },
  { id: 'planier', name: 'Planier', lat: 43.199, lon: 5.230 },
  { id: 'riou', name: 'Riou', lat: 43.176, lon: 5.388 },
  { id: 'cassidaigne', name: 'Cassidaigne', lat: 43.145, lon: 5.545 },
] as const;

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

const TTL = 30 * 60 * 1000;
const memoire = new Map<string, { at: number; slots: Slot[] }>();

/** Prévisions gardées dans l'onglet 30 min, par point (« meteo:43.243,5.362 »). */
const stockage = sessionCache('meteo:', TTL, (v): v is Slot[] => Array.isArray(v), { field: 'slots' });

const lire = (cle: string): Slot[] | null => {
  const m = memoire.get(cle);
  if (m && Date.now() - m.at < TTL) return m.slots;
  return stockage.read(cle);
};

const garder = (cle: string, slots: Slot[]) => {
  memoire.set(cle, { at: Date.now(), slots });
  // Stockage plein ou interdit : la mémoire suffit pour la session.
  stockage.write(cle, slots);
};

async function json(url: string): Promise<Record<string, unknown[]>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Météo indisponible (HTTP ${res.status}).`);
  const body = (await res.json()) as { hourly?: Record<string, unknown[]> };
  return body.hourly ?? {};
}

/**
 * Créneaux horaires sur 7 jours en un point. La mer est facultative : si
 * l'API marine échoue, le vent reste affiché.
 */
export async function forecastAt(lat: number, lon: number): Promise<Slot[]> {
  const cle = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const deja = lire(cle);
  if (deja) return deja;

  const base = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=Europe%2FParis&forecast_days=7`;
  const [vent, mer] = await Promise.all([
    json(
      `https://api.open-meteo.com/v1/forecast?${base}&models=meteofrance_seamless,best_match&wind_speed_unit=kn` +
        '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m',
    ),
    json(
      `https://marine-api.open-meteo.com/v1/marine?${base}` +
        '&hourly=wave_height,wind_wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature',
    ).catch(() => null),
  ]);
  const slots = toSlots(preferModels(vent, ['meteofrance_seamless', 'best_match']), mer);
  garder(cle, slots);
  return slots;
}

export interface WindPoint {
  lat: number;
  lon: number;
  /** Heure locale « 2026-10-11T09:00 » → vent (nd), rafales (nd), direction d'où il vient (°). */
  hours: Record<string, { wind: number; gusts: number; dir: number }>;
}

/** Grille de la carte : de l'ouest du Planier à l'est de Cassis, points en mer seulement. */
const GRID_LATS = [43.1, 43.16, 43.22, 43.28, 43.34];
const GRID_LONS = [5.13, 5.21, 5.29, 5.37, 5.45, 5.53, 5.61];

let grille: { at: number; points: Promise<WindPoint[]> } | null = null;

/**
 * Vent sur la grille de la carte, 7 jours, en un seul appel Open-Meteo (il
 * accepte une liste de points). Les points à terre (altitude > 0) sont écartés.
 */
export function windGrid(): Promise<WindPoint[]> {
  if (grille && Date.now() - grille.at < TTL) return grille.points;
  const lats: number[] = [];
  const lons: number[] = [];
  GRID_LATS.forEach((la) =>
    GRID_LONS.forEach((lo) => {
      lats.push(la);
      lons.push(lo);
    }),
  );
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    '&timezone=Europe%2FParis&forecast_days=7&models=meteofrance_seamless,best_match&wind_speed_unit=kn' +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m';
  const points = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Carte du vent indisponible (HTTP ${r.status}).`))))
    .then((body: { latitude: number; longitude: number; elevation?: number; hourly?: Record<string, unknown[]> }[]) =>
      (Array.isArray(body) ? body : [body])
        .map((p, i) => ({ p, lat: lats[i]!, lon: lons[i]! }))
        .filter(({ p }) => (p.elevation ?? 0) <= 0)
        .map(({ p, lat, lon }) => {
          const hours: WindPoint['hours'] = {};
          toSlots(preferModels(p.hourly ?? {}, ['meteofrance_seamless', 'best_match']), null).forEach((s) => {
            hours[s.time] = { wind: s.wind, gusts: s.gusts, dir: s.windDir };
          });
          return { lat, lon, hours };
        }),
    );
  grille = { at: Date.now(), points };
  points.catch(() => {
    grille = null;
  });
  return points;
}
