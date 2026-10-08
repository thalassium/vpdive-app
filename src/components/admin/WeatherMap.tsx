import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { IFREMER_WMS, ifremerTimes, type Spot } from '../../services/marineWeather';

type Mode = 'hs' | 'wind';

const MODES: Record<Mode, { label: string; styles: string; range: string; min: string; max: string; down: string }> = {
  hs: { label: 'Vagues', styles: 'boxfill/occam', range: '0,3', min: '0 m', max: '3 m', down: 'Carte des vagues Ifremer indisponible' },
  // Vitesse en m/s : 15 m/s ≈ 30 nœuds.
  wind: { label: 'Vent', styles: 'fancyvec/occam', range: '0,15', min: '0', max: '30 nd', down: 'Carte du vent Ifremer indisponible' },
};

const legendUrl = (m: Mode) =>
  `${IFREMER_WMS}?REQUEST=GetLegendGraphic&LAYER=${m}&PALETTE=occam&COLORSCALERANGE=${MODES[m].range}&COLORBARONLY=true&WIDTH=12&HEIGHT=120`;

const parisParts = (iso: string) => {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} · ${Number(get('hour'))} h`;
};

const cssColor = (name: string, fallback: string) => {
  const css = getComputedStyle(document.documentElement);
  return css.getPropertyValue(`--color-${name}`).trim() || css.getPropertyValue(`--${name}`).trim() || fallback;
};

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;

/** Carte marine : fond OSM, balisage OpenSeaMap, vagues ou vent du modèle Ifremer WW3 Provence. */
export default function WeatherMap({
  spot,
  onPick,
  spots,
}: {
  spot: { lat: number; lon: number; name: string };
  onPick: (lat: number, lon: number) => void;
  spots: readonly Spot[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const wmsRef = useRef<L.TileLayer.WMS | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  const stats = useRef({ errors: 0, loads: 0 });

  const [mode, setMode] = useState<Mode>('hs');
  const [times, setTimes] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [down, setDown] = useState(false);

  useEffect(() => {
    pickRef.current = onPick;
  });

  // Carte, une fois.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const map = L.map(el, { center: [43.22, 5.36], zoom: 10, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '<a href="https://www.openseamap.org">OpenSeaMap</a>',
    }).addTo(map);

    // Les options inconnues de Leaflet partent telles quelles en paramètres WMS.
    const options: L.WMSOptions & Record<string, unknown> = {
      layers: 'hs',
      styles: MODES.hs.styles,
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.6,
      attribution: 'Ifremer',
      COLORSCALERANGE: MODES.hs.range,
    };
    const wms = L.tileLayer.wms(IFREMER_WMS, options);
    wms.on('tileload', () => {
      stats.current.loads++;
      setDown(false);
    });
    wms.on('tileerror', () => {
      stats.current.errors++;
      if (stats.current.errors >= 4 && stats.current.loads === 0) setDown(true);
    });
    wmsRef.current = wms;

    markersRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => pickRef.current(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      wmsRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Pas de temps Ifremer : par défaut, le plus proche de maintenant.
  useEffect(() => {
    let live = true;
    ifremerTimes().then((list) => {
      if (!live || !list.length) return;
      const now = Date.now();
      let best = 0;
      list.forEach((t, i) => {
        if (Math.abs(Date.parse(t) - now) < Math.abs(Date.parse(list[best]!) - now)) best = i;
      });
      setTimes(list);
      setStep(best);
    });
    return () => {
      live = false;
    };
  }, []);

  // Couche et heure, sans recharger à chaque cran du curseur.
  const time = times[step];
  useEffect(() => {
    if (!time) return;
    const t = setTimeout(() => {
      const map = mapRef.current;
      const wms = wmsRef.current;
      if (!map || !wms) return;
      stats.current = { errors: 0, loads: 0 };
      setDown(false);
      wms.setParams({ layers: mode, styles: MODES[mode].styles, COLORSCALERANGE: MODES[mode].range, TIME: time } as L.WMSParams);
      if (!map.hasLayer(wms)) wms.addTo(map);
    }, 250);
    return () => clearTimeout(t);
  }, [mode, time]);

  // Points de plongée ; le point courant en rose.
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    const brand = cssColor('brand', '#012362');
    const pink = cssColor('pink', '#f393a8');
    spots.forEach((s) => {
      const current = near(s, spot);
      L.circleMarker([s.lat, s.lon], {
        radius: current ? 8 : 6,
        color: '#ffffff',
        weight: 2,
        fillColor: current ? pink : brand,
        fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(s.name, { direction: 'top', offset: [0, -6] })
        .on('click', () => pickRef.current(s.lat, s.lon))
        .addTo(group);
    });
    if (!spots.some((s) => near(s, spot))) {
      L.circleMarker([spot.lat, spot.lon], { radius: 8, color: '#ffffff', weight: 2, fillColor: pink, fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(spot.name, { direction: 'top', offset: [0, -6] })
        .addTo(group);
    }
  }, [spot, spots]);

  const m = MODES[mode];

  return (
    <div className="space-y-3">
      <div className="relative isolate h-80 sm:h-[28rem] rounded-xl overflow-hidden border border-line">
        <div ref={box} className="absolute inset-0 z-0" />

        <div className="absolute top-2 right-2 z-[1000] inline-flex rounded-lg border border-field-border bg-surface p-1 shadow-lift">
          {(Object.keys(MODES) as Mode[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              aria-pressed={mode === k}
              className={`h-8 px-3 rounded-md text-sm font-medium transition-colors ${mode === k ? 'bg-tint text-brand' : 'text-muted hover:text-ink'}`}
            >
              {MODES[k].label}
            </button>
          ))}
        </div>

        <div className="absolute bottom-6 left-2 z-[1000] rounded-lg bg-surface/90 border border-line px-2 py-1.5 flex items-stretch gap-1.5 text-sm text-ink">
          <img src={legendUrl(mode)} alt="" width={12} height={120} className="w-3 h-[120px] rounded-sm" />
          <span className="flex flex-col justify-between tabular-nums">
            <span>{m.max}</span>
            <span>{m.min}</span>
          </span>
        </div>

        {down && (
          <span className="absolute top-2 left-2 z-[1000] chip text-sm bg-warn-soft text-warn shadow-lift" role="status">
            {m.down}
          </span>
        )}
      </div>

      {times.length > 1 && time && (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={times.length - 1}
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
            aria-label="Heure de la carte"
            aria-valuetext={parisParts(time)}
            className="flex-1 accent-[var(--brand)]"
          />
          <span className="w-32 shrink-0 text-right text-sm text-ink tabular-nums">{parisParts(time)}</span>
        </div>
      )}
    </div>
  );
}
