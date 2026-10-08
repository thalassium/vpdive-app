import { preferModels, toSlots, type Slot } from '../lib/marine';

/**
 * Météo marine, sans clé ni compte :
 *  - vent et rafales : Open-Meteo, modèle Météo-France (AROME puis ARPEGE),
 *    complété par le modèle par défaut au-delà de 4 jours ;
 *  - vagues, houle, eau : Open-Meteo Marine (modèle européen 5 km sur 3 jours) ;
 *  - carte : Ifremer, modèle de vagues WW3 Provence à 200 m (WMS).
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

const lire = (cle: string): Slot[] | null => {
  const m = memoire.get(cle);
  if (m && Date.now() - m.at < TTL) return m.slots;
  try {
    const raw = sessionStorage.getItem(cle);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; slots: Slot[] };
    if (Date.now() - v.at >= TTL) return null;
    memoire.set(cle, v);
    return v.slots;
  } catch {
    return null;
  }
};

const garder = (cle: string, slots: Slot[]) => {
  const v = { at: Date.now(), slots };
  memoire.set(cle, v);
  try {
    sessionStorage.setItem(cle, JSON.stringify(v));
  } catch {
    // Stockage plein ou interdit : la mémoire suffit pour la session.
  }
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
  const cle = `meteo:${lat.toFixed(3)},${lon.toFixed(3)}`;
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

/** Ifremer, modèle de vagues WAVEWATCH III, zone Provence, grille de 200 m. */
export const IFREMER_WMS = 'https://tds1.ifremer.fr/thredds/wms/MARC-MENOR-WW3_PROVENCE200M-FOR_FULL_TIME_SERIE';

let pasIfremer: Promise<string[]> | null = null;

/**
 * Pas de temps à venir du modèle Ifremer (toutes les 3 h, sur environ 5 jours).
 * Le GetCapabilities pèse 1,7 Mo : on lit plutôt la fiche JSON de la couche
 * (prochain pas, jours couverts) puis les heures du dernier jour, souvent
 * incomplet. À défaut, une grille de 3 h sur 4 jours.
 */
export function ifremerTimes(): Promise<string[]> {
  pasIfremer ??= (async () => {
    const meta = (await (await fetch(`${IFREMER_WMS}?request=GetMetadata&item=layerDetails&layerName=hs`)).json()) as {
      nearestTimeIso?: string;
      datesWithData?: Record<string, Record<string, number[]>>;
    };
    const jours: string[] = [];
    Object.entries(meta.datesWithData ?? {}).forEach(([an, mois]) =>
      Object.entries(mois).forEach(([m, js]) =>
        js.forEach((j) => jours.push(`${an}-${String(Number(m) + 1).padStart(2, '0')}-${String(j).padStart(2, '0')}`)),
      ),
    );
    jours.sort();
    const dernier = jours.at(-1);
    if (!meta.nearestTimeIso || !dernier) throw new Error('fiche Ifremer incomplète');
    const fin = (await (await fetch(`${IFREMER_WMS}?request=GetMetadata&item=timesteps&layerName=hs&day=${dernier}`)).json()) as {
      timesteps?: string[];
    };
    const derniere = Date.parse(`${dernier}T${fin.timesteps?.at(-1) ?? '00:00:00.000Z'}`);
    return pas3h(Date.parse(meta.nearestTimeIso), derniere);
  })().catch(() => {
    const t = Date.now();
    return pas3h(t - (t % (3 * 3600_000)), t + 4 * 24 * 3600_000);
  });
  return pasIfremer;
}

function pas3h(debut: number, fin: number): string[] {
  const out: string[] = [];
  for (let t = debut; t <= fin && out.length < 60; t += 3 * 3600_000) out.push(new Date(t).toISOString());
  return out;
}
