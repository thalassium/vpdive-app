import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { windGrid, type Spot, type WindPoint } from '../../services/marineWeather';
import { WIND_SCALE, windColor } from '../../lib/marine';

const cssColor = (name: string, fallback: string) => {
  const css = getComputedStyle(document.documentElement);
  return css.getPropertyValue(`--color-${name}`).trim() || css.getPropertyValue(`--${name}`).trim() || fallback;
};

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;

/** Flèche du vent sur la carte : pointe vers où va le vent, couleur de l'échelle, vitesse dessous. */
function arrowIcon(wind: number, dir: number): L.DivIcon {
  const c = windColor(wind);
  return L.divIcon({
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 18],
    html:
      `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">` +
      `<svg width="30" height="30" viewBox="0 0 24 24" style="transform:rotate(${dir + 180}deg);filter:drop-shadow(0 1px 1px rgb(0 0 0 / .35))">` +
      `<path d="M12 2 19.5 21 12 16.5 4.5 21Z" fill="${c}" stroke="#0b1733" stroke-width="1.2" stroke-linejoin="round"/></svg>` +
      `<span style="margin-top:-2px;font:600 12px/1 'Atkinson Hyperlegible Next',system-ui,sans-serif;color:#0b1733;` +
      `background:${c};border-radius:4px;padding:1px 4px;font-variant-numeric:tabular-nums">${wind}</span></div>`,
  });
}

/**
 * Carte du vent : fond OSM et balisage OpenSeaMap, une flèche par point de la
 * grille en mer à l'heure du créneau choisi. Un tap sur la carte choisit le
 * point de la prévision.
 */
export default function WeatherMap({
  spot,
  onPick,
  spots,
  time,
}: {
  spot: { lat: number; lon: number; name: string };
  onPick: (lat: number, lon: number) => void;
  spots: readonly Spot[];
  /** Heure locale affichée, « 2026-10-11T09:00 ». */
  time: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const arrowsRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  const [grid, setGrid] = useState<WindPoint[] | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    pickRef.current = onPick;
  });

  // Carte, une fois.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const map = L.map(el, { center: [43.21, 5.37], zoom: 10, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '<a href="https://www.openseamap.org">OpenSeaMap</a> · Open-Meteo',
    }).addTo(map);
    arrowsRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => pickRef.current(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      arrowsRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let live = true;
    windGrid().then(
      (g) => live && setGrid(g),
      () => live && setDown(true),
    );
    return () => {
      live = false;
    };
  }, []);

  // Flèches à l'heure choisie.
  useEffect(() => {
    const group = arrowsRef.current;
    if (!group) return;
    group.clearLayers();
    if (!grid || !time) return;
    grid.forEach((p) => {
      const h = p.hours[time];
      if (!h) return;
      L.marker([p.lat, p.lon], { icon: arrowIcon(h.wind, h.dir), interactive: false, keyboard: false }).addTo(group);
    });
  }, [grid, time]);

  // Points de plongée ; le point courant en rose.
  useEffect(() => {
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    const brand = cssColor('brand', '#012362');
    const pink = cssColor('pink', '#f393a8');
    const all = spots.some((s) => near(s, spot)) ? spots : [...spots, { ...spot, id: 'carte' }];
    all.forEach((s) => {
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
  }, [spot, spots]);

  return (
    <div className="relative isolate h-80 sm:h-[30rem] rounded-xl overflow-hidden border border-line">
      <div ref={box} className="absolute inset-0 z-0" />

      {/* Échelle : la même couleur que les lignes de la prévision */}
      <div className="absolute bottom-6 left-2 z-[1000] rounded-lg bg-surface/90 border border-line px-2 py-1.5 text-sm text-ink">
        <div
          aria-hidden
          className="h-2 w-36 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${WIND_SCALE.map(([kn, c]) => `${c} ${(kn / 40) * 100}%`).join(', ')})`,
          }}
        />
        <div className="mt-1 flex justify-between tabular-nums text-muted">
          <span>0</span>
          <span>20</span>
          <span>40 nd</span>
        </div>
      </div>

      {down && (
        <span className="absolute top-2 left-2 z-[1000] chip text-sm bg-warn-soft text-warn shadow-lift" role="status">
          Carte du vent indisponible
        </span>
      )}
    </div>
  );
}
