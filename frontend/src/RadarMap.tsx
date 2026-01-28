import { useEffect, useMemo, useRef, useState } from "react";

import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  Circle,
  useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";

import type { AircraftState, Conflict, ProjectedTrack, Trail, Alert } from "./api";

type Props = {
  aircraft: AircraftState[];
  tracks: ProjectedTrack[];
  trails: Trail[];
  stabilityById: Record<string, number>;
  conflicts: Conflict[];
  selected: Conflict | null;

  onSelectConflict?: (c: Conflict) => void;

  alerts?: Alert[];
  selectedAlertId?: string | null;
  onSelectAlertId?: (id: string | null) => void;

  showWeather?: boolean;
  weatherOpacity?: number;
  weatherTimeISO?: string | null; // key for replay

  showTrails?: boolean;
  showProjectedTracks?: boolean;
  showCpaGeometry?: "all" | "selected";
  selectedAircraftId?: string | null;
  onSelectAircraftId?: (id: string) => void;

  showWinds?: boolean;
  windOpacity?: number;
  windLayer?: string;
  windStyle?: string;
  windTimeISO?: string | null;
};

const STORAGE_KEY = "atc_map_camera_v1";

// Montreal default
const DEFAULT_CENTER: [number, number] = [45.5019, -73.5674];
const DEFAULT_ZOOM = 8;

// 5 NM ring in meters
const NM_TO_M = 1852;
const RING_5NM_M = 5 * NM_TO_M;

function planeIcon(trackDeg: number, isSelected: boolean) {
  const size = isSelected ? 34 : 28;
  const opacity = isSelected ? 0.95 : 0.85;

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      style="transform: rotate(${trackDeg}deg); opacity:${opacity};">
      <path d="M32 4 L38 22 L56 30 L38 34 L34 60 L32 52 L30 60 L26 34 L8 30 L26 22 Z" fill="black"/>
      <path d="M32 10 L36 24 L32 26 L28 24 Z" fill="white" opacity="0.35"/>
      <circle cx="32" cy="6.5" r="2.3" fill="white" opacity="0.75"/>
    </svg>`;

  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function alertIcon(kind: string, severity: "info" | "caution" | "warning", selected: boolean) {
  const bg =
    severity === "warning" ? "crimson" : severity === "caution" ? "orange" : "#333";
  const size = selected ? 16 : 12;

  const label =
    kind === "weather" ? "WX" :
    kind === "vertical" ? "V" :
    kind === "wake" ? "W" :
    kind === "congestion" ? "C" :
    "!";

  const html = `
    <div style="
      width:${size}px;height:${size}px;
      border-radius:999px;
      background:${bg};
      border:${selected ? 3 : 2}px solid white;
      box-shadow:0 0 0 1px rgba(0,0,0,0.25);
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 9 : 8}px;
      color:white;font-weight:900;
      transform: translate(-50%, -50%);
    ">${label}</div>
  `;

  return L.divIcon({ className: "", html, iconSize: [size, size], iconAnchor: [0, 0] });
}

function CameraSync({ enabled }: { enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { center: [number, number]; zoom: number };
      if (parsed?.center && typeof parsed.zoom === "number") {
        map.setView(parsed.center, parsed.zoom, { animate: false });
      }
    } catch {
      // ignore
    }
  }, [enabled, map]);

  useEffect(() => {
    if (!enabled) return;

    const save = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ center: [c.lat, c.lng] as [number, number], zoom: z }));
    };

    map.on("moveend", save);
    map.on("zoomend", save);
    return () => {
      map.off("moveend", save);
      map.off("zoomend", save);
    };
  }, [enabled, map]);

  return null;
}

function ZoomToSelected({
  enabled,
  aircraft,
  selected,
  tracks,
  requestZoomToken,
}: {
  enabled: boolean;
  aircraft: AircraftState[];
  selected: Conflict | null;
  tracks: ProjectedTrack[];
  requestZoomToken: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    if (!selected) return;
    if (requestZoomToken === 0) return;

    const a = aircraft.find((x) => x.id === selected.a_id);
    const b = aircraft.find((x) => x.id === selected.b_id);

    const points: [number, number][] = [];
    if (a) points.push([a.lat, a.lon]);
    if (b) points.push([b.lat, b.lon]);
    points.push([selected.cpa_lat, selected.cpa_lon]);

    const trackById = new Map(tracks.map((t) => [t.id, t]));
    if (a) trackById.get(a.id)?.points.slice(0, 10).forEach((p) => points.push([p.lat, p.lon]));
    if (b) trackById.get(b.id)?.points.slice(0, 10).forEach((p) => points.push([p.lat, p.lon]));

    if (points.length < 2) return;

    const bounds = L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds.pad(0.25), { animate: true });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestZoomToken]);

  return null;
}

function Recenter({ enabled, requestRecenterToken }: { enabled: boolean; requestRecenterToken: number }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    if (requestRecenterToken === 0) return;
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestRecenterToken]);

  return null;
}

function toWmsTime(t: string) {
  return t.includes(".") ? t.split(".")[0] + "Z" : t;
}

function WindLayer({
  enabled,
  opacity,
  layerName,
  styleName,
  timeISO,
}: {
  enabled: boolean;
  opacity: number;
  layerName: string;
  styleName?: string;
  timeISO?: string | null;
}) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer.WMS | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled) return;
    if (!layerName) return;

    const wms = L.tileLayer.wms("https://geo.weather.gc.ca/geomet/", {
      layers: layerName,
      styles: styleName && styleName.trim().length ? styleName.trim() : undefined,
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      uppercase: true,
      tiled: true,
      opacity,
      crossOrigin: "anonymous",
    } as any);

    (wms as any).setZIndex?.(510);
    wms.addTo(map);
    layerRef.current = wms;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [enabled, map, layerName, styleName]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setOpacity(opacity);
  }, [opacity]);

  useEffect(() => {
    if (!layerRef.current) return;
    if (!timeISO) return;
    const TIME = toWmsTime(timeISO);
    (layerRef.current as any).setParams({ TIME }, false);
    layerRef.current.redraw();
  }, [timeISO]);

  return null;
}

function WeatherRadarLayer({
  enabled,
  opacity,
  timeISO,
}: {
  enabled: boolean;
  opacity: number;
  timeISO?: string | null;
}) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer.WMS | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!enabled) return;

    const wms = L.tileLayer.wms("https://geo.weather.gc.ca/geomet/", {
      layers: "RADAR_1KM_RRAI",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      uppercase: true,
      tiled: true,
      opacity,
      crossOrigin: "anonymous",
    } as any);

    (wms as any).setZIndex?.(500);
    wms.addTo(map);
    layerRef.current = wms;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [enabled, map]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.setOpacity(opacity);
  }, [opacity]);

  useEffect(() => {
    if (!layerRef.current) return;
    if (!timeISO) return;
    const TIME = toWmsTime(timeISO);
    (layerRef.current as any).setParams({ TIME }, false);
    layerRef.current.redraw();
  }, [timeISO]);

  return null;
}

export default function RadarMap({
  aircraft,
  tracks,
  trails,
  stabilityById,
  conflicts,
  selected,
  onSelectConflict,

  alerts = [],
  selectedAlertId = null,
  onSelectAlertId,

  showWeather = false,
  weatherOpacity = 0.45,
  weatherTimeISO = null,

  showTrails = true,
  showProjectedTracks = true,
  showCpaGeometry = "all",
  selectedAircraftId = null,
  onSelectAircraftId,

  showWinds = false,
  windOpacity = 0.65,
  windLayer = "",
  windStyle = "",
  windTimeISO = null,
}: Props) {
  const [manualCamera, setManualCamera] = useState(true);
  const [zoomToken, setZoomToken] = useState(0);
  const [recenterToken, setRecenterToken] = useState(0);

  const center: LatLngExpression = DEFAULT_CENTER;

  const selectedIds = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set([selected.a_id, selected.b_id]);
  }, [selected]);

  const trackStyle = useMemo(() => ({ color: "#1e88e5", weight: 2, opacity: 0.25 }), []);
  const trackStyleSelected = useMemo(() => ({ color: "#1e88e5", weight: 3, opacity: 0.55 }), []);
  const trailStyle = useMemo(() => ({ color: "#555", weight: 2, opacity: 0.35 }), []);

  const showConflict = (c: Conflict) => {
    if (showCpaGeometry === "all") return true;
    if (showCpaGeometry === "selected") {
      return !!selected && c.a_id === selected.a_id && c.b_id === selected.b_id;
    }
    return true;
  };

  const nonSeparationAlerts = useMemo(() => alerts.filter((a) => a.type !== "separation"), [alerts]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={manualCamera} onChange={(e) => setManualCamera(e.target.checked)} />
          Manual camera (no auto-jump)
        </label>

        <button onClick={() => setRecenterToken((x) => x + 1)}>Recenter Montreal</button>
        <button onClick={() => setZoomToken((x) => x + 1)} disabled={!selected}>
          Zoom to selected
        </button>

        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Click CPA markers or alert dots • Conflicts show CPA rings • Hover planes for details
        </span>
      </div>

      <div style={{ height: 520, width: "100%" }}>
        <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }}>
          <CameraSync enabled={manualCamera} />
          <Recenter enabled={manualCamera} requestRecenterToken={recenterToken} />
          <ZoomToSelected enabled={manualCamera} aircraft={aircraft} tracks={tracks} selected={selected} requestZoomToken={zoomToken} />

          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <WeatherRadarLayer enabled={showWeather} opacity={weatherOpacity} timeISO={weatherTimeISO} />
          <WindLayer
            enabled={showWinds}
            opacity={windOpacity}
            layerName={windLayer ?? ""}
            styleName={windStyle ?? ""}
            timeISO={windTimeISO}
          />

          {/*
            Animated vector streamlines (EXPERIMENTAL)
            We intentionally keep this OFF for now because it can be heavy.
            If you want it later, we’ll add a proper wind vector grid source + canvas particle advection.
          */}

          {showTrails &&
            trails.map((t) => {
              const pts = t.points.map((p) => [p.lat, p.lon] as [number, number]);
              if (pts.length < 2) return null;
              return <Polyline key={`trail-${t.id}`} positions={pts} pathOptions={trailStyle} />;
            })}

          {showProjectedTracks &&
            tracks.map((t) => {
              const instab = stabilityById[t.id] ?? 0;
              const maxPts = instab >= 0.4 ? 9 : t.points.length;
              const pts = t.points.slice(0, maxPts).map((p) => [p.lat, p.lon] as [number, number]);
              const isSel = selectedIds.has(t.id);

              return <Polyline key={t.id} positions={pts} pathOptions={isSel ? trackStyleSelected : trackStyle} />;
            })}

          {aircraft.map((a) => {
            const isConflictSel = selectedIds.has(a.id);
            const isAircraftSel = selectedAircraftId === a.id;
            const iconSelected = isConflictSel || isAircraftSel;

            return (
              <Marker
                key={a.id}
                position={[a.lat, a.lon]}
                icon={planeIcon(a.track_deg ?? 0, iconSelected)}
                eventHandlers={onSelectAircraftId ? { click: () => onSelectAircraftId(a.id) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={0.95} permanent={false} sticky>
                  <div style={{ fontSize: 12 }}>
                    <div><b>{a.callsign ?? a.id}</b></div>
                    <div>Alt: {a.alt_ft.toFixed(0)} ft</div>
                    <div>GS: {a.gs_kt.toFixed(0)} kt</div>
                    <div>Track: {a.track_deg.toFixed(0)}°</div>
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

          {conflicts.filter(showConflict).map((c) => {
            const isSel = selected ? c.a_id === selected.a_id && c.b_id === selected.b_id : false;
            return (
              <Circle
                key={`cpa-ring-${c.a_id}-${c.b_id}`}
                center={[c.cpa_lat, c.cpa_lon]}
                radius={RING_5NM_M}
                pathOptions={{
                  color: "red",
                  weight: isSel ? 3 : 1.5,
                  opacity: isSel ? 0.65 : 0.25,
                  fillOpacity: isSel ? 0.08 : 0.03,
                }}
              />
            );
          })}

          {conflicts.filter(showConflict).map((c) => {
            const isSel = selected ? c.a_id === selected.a_id && c.b_id === selected.b_id : false;
            return (
              <Marker
                key={`cpa-${c.a_id}-${c.b_id}`}
                position={[c.cpa_lat, c.cpa_lon]}
                eventHandlers={
                  onSelectConflict
                    ? {
                        click: () => onSelectConflict(c),
                      }
                    : undefined
                }
              >
                <Tooltip direction="right" opacity={0.95} permanent={false} sticky>
                  <div style={{ fontSize: 12 }}>
                    <b>CPA {isSel ? "(selected)" : ""}</b>
                    <br />
                    {c.a_id} × {c.b_id}
                    <br />
                    breach in {(c.first_breach_s / 60).toFixed(1)} min
                    <br />
                    min H {c.min_h_nm.toFixed(2)} NM • min V {c.min_v_ft.toFixed(0)} ft
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Non-separation alerts (weather/vertical/wake/congestion) */}
          {nonSeparationAlerts.map((a) => {
            const isSel = a.id === selectedAlertId;
            return (
              <Marker
                key={a.id}
                position={[a.lat, a.lon]}
                icon={alertIcon(a.type, a.severity, isSel)}
                eventHandlers={
                  onSelectAlertId
                    ? { click: () => onSelectAlertId(a.id) }
                    : undefined
                }
              >
                <Tooltip direction="top" opacity={0.95} permanent={false} sticky>
                  <div style={{ fontSize: 12 }}>
                    <b>{a.title}</b>
                    <div style={{ opacity: 0.85 }}>{a.details}</div>
                  </div>
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
