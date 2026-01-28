import { useEffect, useMemo, useRef, useState } from "react";

import RadarMap from "./RadarMap";
import RightPanel from "./components/RightPanel";

import {
  fetchOpenSkyAircraft,
  fetchReplayMeta,
  fetchReplayAircraft,
  fetchDemoAircraft,
  dvrPush,
  dvrMeta,
  dvrAircraft,
  projectTracks,
  fetchFlightInfo,
  type AircraftState,
  type Conflict,
  type ProjectedTrack,
  type Trail,
  type StabilityById,
  type Alert,
  type AlertSeverity,
  type AlertType,
  type FlightInfo,
} from "./api";

import type { LayersState } from "./types";

// Montreal default (also used by local alert heuristics)
const DEFAULT_CENTER: [number, number] = [45.5019, -73.5674];

function roundToMinutesISO(tsMs: number, minutes: number) {
  const m = minutes * 60 * 1000;
  const rounded = Math.floor(tsMs / m) * m;
  return new Date(rounded).toISOString();
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function normDeg(d: number) {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const toDeg = (v: number) => (v * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function headingSpreadDeg(headings: number[]) {
  if (headings.length < 2) return 0;
  const toRad = (v: number) => (v * Math.PI) / 180;
  let sx = 0, sy = 0;
  for (const h of headings) {
    sx += Math.cos(toRad(h));
    sy += Math.sin(toRad(h));
  }
  const R = Math.sqrt(sx * sx + sy * sy) / headings.length;
  return (1 - R) * 180;
}

function computeInstability(points: { ts: number; lat: number; lon: number }[]) {
  if (points.length < 3) return 0;

  const headings: number[] = [];
  const turnRates: number[] = [];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    headings.push(bearingDeg(a.lat, a.lon, b.lat, b.lon));
  }

  for (let i = 1; i < headings.length; i++) {
    const dh = normDeg(headings[i] - headings[i - 1]);
    const dt = (points[i + 1]?.ts - points[i]?.ts) / 1000;
    if (dt > 0) turnRates.push(Math.abs(dh) / dt);
  }

  const spread = headingSpreadDeg(headings);
  const avgTurn = turnRates.length ? turnRates.reduce((a, b) => a + b, 0) / turnRates.length : 0;

  const spreadTerm = clamp01(spread / 25);
  const turnTerm = clamp01(avgTurn / 1.5);

  return clamp01(Math.max(spreadTerm, turnTerm));
}

// --- filtering ---
const severityRank: Record<AlertSeverity, number> = { info: 0, caution: 1, warning: 2 };

function filterAlerts(alerts: Alert[], enabled: Record<AlertType, boolean>, minSev: AlertSeverity) {
  const min = severityRank[minSev];
  return alerts.filter((a) => enabled[a.type] && severityRank[a.severity] >= min);
}

// --- local alert helpers ---
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);

  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * (Math.sin(dλ / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) / 1852;
}

// Separation detection from projected tracks (local, always works even if backend alerts fail)
function detectSeparationConflicts(tracks: ProjectedTrack[], H_NM = 5, V_FT = 1000): Conflict[] {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ids = Array.from(byId.keys());

  const conflicts: Conflict[] = [];

  // Try to infer timestep seconds (fallback 60)
  function stepSeconds(t: ProjectedTrack) {
    const p0 = t.points[0];
    const p1 = t.points[1];
    const dt = (p1?.t_s ?? 0) - (p0?.t_s ?? 0);
    if (Number.isFinite(dt) && dt > 0) return dt;
    return 60;
  }

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i])!;
      const b = byId.get(ids[j])!;
      const n = Math.min(a.points.length, b.points.length);
      if (n < 2) continue;

      const dt = Math.min(stepSeconds(a), stepSeconds(b));

      let minH = Number.POSITIVE_INFINITY;
      let minV = Number.POSITIVE_INFINITY;
      let minIdx = 0;
      let firstBreachIdx: number | null = null;

      for (let k = 0; k < n; k++) {
        const pa = a.points[k];
        const pb = b.points[k];
        const h = haversineNm(pa.lat, pa.lon, pb.lat, pb.lon);
        const v = Math.abs((pa.alt_ft ?? 0) - (pb.alt_ft ?? 0));

        if (h < minH) {
          minH = h;
          minV = v;
          minIdx = k;
        }

        if (firstBreachIdx === null && h < H_NM && v < V_FT) {
          firstBreachIdx = k;
        }
      }

      if (firstBreachIdx === null) continue;

      const cpaLat = (a.points[minIdx].lat + b.points[minIdx].lat) / 2;
      const cpaLon = (a.points[minIdx].lon + b.points[minIdx].lon) / 2;

      conflicts.push({
        a_id: a.id,
        b_id: b.id,
        cpa_lat: cpaLat,
        cpa_lon: cpaLon,
        first_breach_s: firstBreachIdx * dt,
        min_h_nm: minH,
        min_v_ft: minV,
      });
    }
  }

  // Sort most urgent first
  conflicts.sort((x, y) => x.first_breach_s - y.first_breach_s);
  return conflicts;
}

function buildLocalAlerts(ac: AircraftState[], nowMs: number): Alert[] {
  const out: Alert[] = [];
  const time_s = Math.floor(nowMs / 1000);

  // Vertical profile
  for (const a of ac) {
    const vr = a.vr_fpm ?? 0;
    const absVr = Math.abs(vr);
    if (absVr < 1500) continue;

    const sev: AlertSeverity = absVr >= 2500 ? "warning" : "caution";
    out.push({
      id: `local-vertical-${a.id}-${time_s}`,
      type: "vertical",
      severity: sev,
      title: `High vertical rate`,
      details: `${a.callsign ?? a.id} ${vr.toFixed(0)} fpm`,
      involvedAircraftIds: [a.id],
      lat: a.lat,
      lon: a.lon,
      time_s,
    });
  }

  // Congestion near Montreal center
  const within = ac.filter((a) => haversineNm(DEFAULT_CENTER[0], DEFAULT_CENTER[1], a.lat, a.lon) <= 20);
  if (within.length >= 10) {
    out.push({
      id: `local-congestion-${time_s}`,
      type: "congestion",
      severity: within.length >= 15 ? "warning" : "caution",
      title: `Congestion near Montreal`,
      details: `${within.length} aircraft within 20 NM`,
      involvedAircraftIds: within.map((x) => x.id),
      lat: DEFAULT_CENTER[0],
      lon: DEFAULT_CENTER[1],
      time_s,
    });
  }

  // Wake: close + similar track + small vertical sep
  for (let i = 0; i < ac.length; i++) {
    for (let j = i + 1; j < ac.length; j++) {
      const A = ac[i], B = ac[j];
      const d = haversineNm(A.lat, A.lon, B.lat, B.lon);
      const dv = Math.abs(A.alt_ft - B.alt_ft);

      if (d > 2.0 || dv > 700) continue;

      const dh = Math.abs(normDeg((A.track_deg ?? 0) - (B.track_deg ?? 0)));
      if (dh > 25) continue;

      out.push({
        id: `local-wake-${A.id}-${B.id}-${time_s}`,
        type: "wake",
        severity: d < 1.0 && dv < 400 ? "warning" : "caution",
        title: `Potential wake proximity`,
        details: `${A.callsign ?? A.id} ↔ ${B.callsign ?? B.id} (${d.toFixed(2)} NM, ${dv.toFixed(0)} ft)`,
        involvedAircraftIds: [A.id, B.id],
        lat: (A.lat + B.lat) / 2,
        lon: (A.lon + B.lon) / 2,
        time_s,
      });
    }
  }

  return out;
}

function conflictKey(c: Conflict) {
  const a = c.a_id;
  const b = c.b_id;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sameConflict(a: Conflict, b: Conflict) {
  return conflictKey(a) === conflictKey(b);
}

// --- GeoMet radar sampling (real data, best-effort) ---
function toWmsTime(t: string) {
  return t.includes(".") ? t.split(".")[0] + "Z" : t;
}

function mercatorProject(lat: number, lon: number) {
  const R = 6378137;
  const x = (lon * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  return { x, y };
}

function extractNumericFromGeoJson(j: any): number | null {
  const f = j?.features?.[0];
  const props = f?.properties;
  if (!props || typeof props !== "object") return null;

  // Try common keys
  const preferred = ["GRAY_INDEX", "value", "band_1", "Band1", "val"];
  for (const k of preferred) {
    const v = props[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }

  // Fall back: first numeric property
  for (const [_, v] of Object.entries(props)) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

async function geometRadarValue(lat: number, lon: number, timeISO: string): Promise<number | null> {
  try {
    const TIME = toWmsTime(timeISO);
    const { x, y } = mercatorProject(lat, lon);
    const d = 1500; // meters (small bbox around point)
    const minX = x - d, minY = y - d, maxX = x + d, maxY = y + d;

    const params = new URLSearchParams({
      SERVICE: "WMS",
      VERSION: "1.3.0",
      REQUEST: "GetFeatureInfo",
      LAYERS: "RADAR_1KM_RRAI",
      QUERY_LAYERS: "RADAR_1KM_RRAI",
      CRS: "EPSG:3857",
      BBOX: `${minX},${minY},${maxX},${maxY}`,
      WIDTH: "101",
      HEIGHT: "101",
      I: "50",
      J: "50",
      INFO_FORMAT: "application/json",
      FEATURE_COUNT: "1",
      TIME,
    });

    const url = `https://geo.weather.gc.ca/geomet/?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) return null;

    const j = await r.json();
    return extractNumericFromGeoJson(j);
  } catch {
    return null;
  }
}

async function buildWeatherAlerts(ac: AircraftState[], timeMs: number, timeISO: string | null): Promise<Alert[]> {
  if (!timeISO) return [];
  const time_s = Math.floor(timeMs / 1000);

  // limit to nearby aircraft (reduce load)
  const candidates = ac
    .filter((a) => haversineNm(DEFAULT_CENTER[0], DEFAULT_CENTER[1], a.lat, a.lon) <= 120)
    .slice(0, 30);

  const out: Alert[] = [];

  // sequential to be gentle on the service
  for (const a of candidates) {
    const v = await geometRadarValue(a.lat, a.lon, timeISO);
    if (v === null) continue;

    // We don’t assume exact units — just “higher = more intense”.
    // Tune thresholds later if you want.
    if (v <= 0) continue;

    const severity: AlertSeverity = v >= 30 ? "warning" : v >= 15 ? "caution" : "info";

    out.push({
      id: `wx-${a.id}-${time_s}`,
      type: "weather",
      severity,
      title: "Weather near aircraft",
      details: `${a.callsign ?? a.id} radar intensity ~ ${v}`,
      involvedAircraftIds: [a.id],
      lat: a.lat,
      lon: a.lon,
      time_s,
    });
  }

  return out;
}

export default function App() {
  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [tracks, setTracks] = useState<ProjectedTrack[]>([]);
  const [selected, setSelected] = useState<Conflict | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const historyRef = useRef<Map<string, { callsign?: string | null; points: any[] }>>(new Map());
  const TRAIL_WINDOW_MS = 5 * 60 * 1000;

  const [trails, setTrails] = useState<Trail[]>([]);
  const [stabilityById, setStabilityById] = useState<Record<string, number>>({});

  // Weather time for replay + WMS TIME param
  const [weatherTimeISO, setWeatherTimeISO] = useState<string | null>(null);

  const [layers, setLayers] = useState<LayersState>({
    weatherRadar: { on: true, opacity: 0.6 },
    winds: { on: false, opacity: 0.65, layer: "", style: "", streamlinesOn: false },
    trails: { on: true },
    projected: { on: true },
    cpaGeometry: "all",
  });

  // Aircraft selection
  const [selectedAircraftId, setSelectedAircraftId] = useState<string | null>(null);
  const selectedAircraft = aircraft.find((a) => a.id === selectedAircraftId) ?? null;

  // Alert selection
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  // Real flight info (best-effort)
  const [selectedAircraftFlight, setSelectedAircraftFlight] = useState<FlightInfo | null>(null);

  // DVR state
  const [dvrMetaState, setDvrMetaState] = useState<{
    frames: number;
    interval_s: number;
    oldest_ts?: number;
    newest_ts?: number;
  } | null>(null);

  // Modes
  const [mode, setMode] = useState<"demo" | "live" | "replay" | "dvr">("replay");

  // Preset replay controls
  const [frame, setFrame] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Live auto-update
  const [autoLive, setAutoLive] = useState(true);

  // DVR controls
  const [dvrFramesCount, setDvrFramesCount] = useState(0);
  const [dvrIndex, setDvrIndex] = useState(0);
  const [playingDvr, setPlayingDvr] = useState(false);

  const inFlight = useRef(false);

  const [alerts, setAlerts] = useState<Alert[]>([]);

  const [enabledTypes, setEnabledTypes] = useState<Record<AlertType, boolean>>({
    separation: true,
    weather: true,
    vertical: true,
    wake: true,
    congestion: true,
  });

  const [minSeverity, setMinSeverity] = useState<AlertSeverity>("info");

  const visibleAlerts = useMemo(
    () => filterAlerts(alerts, enabledTypes, minSeverity),
    [alerts, enabledTypes, minSeverity]
  );

  const visibleConflicts = useMemo(() => {
    const raw = visibleAlerts
      .filter((a) => a.type === "separation" && a.data?.conflict)
      .map((a) => a.data!.conflict as Conflict);

    const map = new Map<string, Conflict>();
    for (const c of raw) map.set(conflictKey(c), c);
    return Array.from(map.values());
  }, [visibleAlerts]);

  // Keep selected conflict valid when filters change
  useEffect(() => {
    if (!selected) {
      if (visibleConflicts.length) setSelected(visibleConflicts[0]);
      return;
    }
    const stillVisible = visibleConflicts.some((c) => sameConflict(c, selected));
    if (!stillVisible) setSelected(visibleConflicts[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleConflicts]);

  // Fetch “real” flight info when aircraft selection changes
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!selectedAircraftId) {
        setSelectedAircraftFlight(null);
        return;
      }
      setSelectedAircraftFlight(null);
      const info = await fetchFlightInfo(selectedAircraftId);
      if (!cancelled) setSelectedAircraftFlight(info);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedAircraftId]);

  function updateHistoryFromAircraft(ac: AircraftState[]) {
    const now = Date.now();
    const map = historyRef.current;

    for (const a of ac) {
      const entry = map.get(a.id) ?? { callsign: a.callsign ?? null, points: [] as any[] };
      entry.callsign = a.callsign ?? entry.callsign ?? null;

      entry.points.push({
        ts: now,
        lat: a.lat,
        lon: a.lon,
        alt_ft: a.alt_ft,
        track_deg: a.track_deg,
      });

      const cutoff = now - TRAIL_WINDOW_MS;
      while (entry.points.length && entry.points[0].ts < cutoff) entry.points.shift();

      map.set(a.id, entry);
    }

    const outTrails: Trail[] = ac.map((a) => {
      const e = map.get(a.id);
      return { id: a.id, callsign: e?.callsign ?? a.callsign ?? null, points: (e?.points ?? []) as any[] };
    });

    const stab: StabilityById = {};
    for (const t of outTrails) stab[t.id] = computeInstability(t.points);

    setTrails(outTrails);
    setStabilityById(stab);
  }

  async function recompute(ac: AircraftState[], timeMs: number) {
    setWeatherTimeISO(roundToMinutesISO(timeMs, 5));
    setAircraft(ac);
    updateHistoryFromAircraft(ac);

    // Project tracks (backend)
    let projected: ProjectedTrack[] = [];
    try {
      projected = await projectTracks(ac);
      setTracks(projected);
    } catch (e: any) {
      console.warn("projectTracks failed:", e?.message ?? e);
      setTracks([]);
      projected = [];
    }

    // Separation alerts computed locally from projected tracks
    const sepConflicts = detectSeparationConflicts(projected, 5, 1000);
    const time_s = Math.floor(timeMs / 1000);
    const sepAlerts: Alert[] = sepConflicts.map((c) => ({
      id: `sep-${conflictKey(c)}-${time_s}`,
      type: "separation",
      severity: c.first_breach_s < 180 ? "warning" : c.first_breach_s < 420 ? "caution" : "info",
      title: "Separation risk",
      details: `${c.a_id} × ${c.b_id} | H ${c.min_h_nm.toFixed(2)} NM | V ${c.min_v_ft.toFixed(0)} ft | breach ${(c.first_breach_s / 60).toFixed(1)} min`,
      involvedAircraftIds: [c.a_id, c.b_id],
      lat: c.cpa_lat,
      lon: c.cpa_lon,
      time_s,
      data: { conflict: c },
    }));

    const localAlerts = buildLocalAlerts(ac, timeMs);
    const weatherAlerts = await buildWeatherAlerts(ac, timeMs, weatherTimeISO);

    const all = [...sepAlerts, ...weatherAlerts, ...localAlerts];
    setAlerts(all);

    // Keep selection stable if possible
    setSelected((prev) => {
      if (!sepConflicts.length) return null;
      if (prev && sepConflicts.some((c) => sameConflict(c, prev))) return prev;
      return sepConflicts[0];
    });
  }

  async function load(frameOverride?: number) {
    if (inFlight.current) return;
    inFlight.current = true;

    setErr(null);
    setLoading(true);

    try {
      let ac: AircraftState[] = [];

      if (mode === "demo") {
        ac = await fetchDemoAircraft();
        await recompute(ac, Date.now());
      } else if (mode === "live") {
        const acRaw = await fetchOpenSkyAircraft();
        ac = acRaw.slice(0, 60);
        await recompute(ac, Date.now());
        dvrPush(ac).catch(() => {});
      } else if (mode === "replay") {
        let count = frameCount;
        if (count === 0) {
          const meta = await fetchReplayMeta();
          count = meta.frames;
          setFrameCount(count);
        }

        const f = frameOverride ?? frame;
        ac = await fetchReplayAircraft(f);

        const REPLAY_STEP_MS = 5000;
        const base = Date.now() - count * REPLAY_STEP_MS;
        await recompute(ac, base + f * REPLAY_STEP_MS);
      } else {
        // dvr
        const m = await dvrMeta();
        setDvrMetaState(m);
        setDvrFramesCount(m.frames);

        const newest = Math.max(0, m.frames - 1);
        const idx = frameOverride ?? newest;
        setDvrIndex(idx);

        ac = await dvrAircraft(idx);

        const oldest = m.oldest_ts ?? Math.floor(Date.now() / 1000);
        const tsSec = oldest + idx * m.interval_s;
        await recompute(ac, tsSec * 1000);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Load failed");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  async function loadDvr(i: number) {
    if (inFlight.current) return;
    inFlight.current = true;

    setErr(null);
    setLoading(true);

    try {
      const ac = await dvrAircraft(i);

      const m = dvrMetaState ?? (await dvrMeta());
      if (!dvrMetaState) setDvrMetaState(m);

      const oldest = m.oldest_ts ?? Math.floor(Date.now() / 1000);
      const tsSec = oldest + i * m.interval_s;

      await recompute(ac, tsSec * 1000);
    } catch (e: any) {
      setErr(e?.message ?? "Load failed");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    setPlaying(false);
    setPlayingDvr(false);

    if (mode === "replay") setFrame(0);
    if (mode === "dvr") setDvrIndex(0);

    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!playing || mode !== "replay" || frameCount <= 0) return;

    const id = setInterval(() => {
      setFrame((prev) => {
        const next = (prev + 1) % frameCount;
        load(next);
        return next;
      });
    }, 3000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, mode, frameCount]);

  useEffect(() => {
    if (mode !== "live" || !autoLive) return;

    const id = setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        const acRaw = await fetchOpenSkyAircraft();
        const ac = acRaw.slice(0, 60);
        await recompute(ac, Date.now());
        dvrPush(ac).catch(() => {});
      } catch (e: any) {
        console.warn("live poll failed:", e?.message ?? e);
      } finally {
        inFlight.current = false;
      }
    }, 3000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoLive]);

  useEffect(() => {
    if (!playingDvr || mode !== "dvr" || dvrFramesCount <= 0) return;

    const id = setInterval(() => {
      setDvrIndex((prev) => {
        const next = (prev + 1) % dvrFramesCount;
        loadDvr(next);
        return next;
      });
    }, 3000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingDvr, mode, dvrFramesCount]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <h2 style={{ margin: 0 }}>ATC Risk Tool</h2>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Live OpenSky → Project (10 min) → Predict conflicts (5 NM / 1000 ft) → Explain + Visualize
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <label>
          Mode{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="demo">Demo (guaranteed alerts)</option>
            <option value="replay">Replay (preset)</option>
            <option value="live">Live (OpenSky)</option>
            <option value="dvr">Replay (DVR buffer)</option>
          </select>
        </label>

        {mode === "live" && (
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={autoLive} onChange={(e) => setAutoLive(e.target.checked)} />
            Auto-update
          </label>
        )}

        {mode === "replay" && (
          <>
            <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
            <input
              type="range"
              min={0}
              max={Math.max(0, frameCount - 1)}
              value={frame}
              onChange={(e) => {
                const f = Number(e.target.value);
                setFrame(f);
                load(f);
              }}
              style={{ width: 260 }}
            />
            <span style={{ fontSize: 12, opacity: 0.75 }}>
              frame {frame} / {Math.max(0, frameCount - 1)}
            </span>
          </>
        )}

        {mode === "dvr" && (
          <>
            <button onClick={() => setPlayingDvr((p) => !p)}>{playingDvr ? "Pause" : "Play"}</button>
            <input
              type="range"
              min={0}
              max={Math.max(0, dvrFramesCount - 1)}
              value={dvrIndex}
              onChange={(e) => {
                const i = Number(e.target.value);
                setDvrIndex(i);
                loadDvr(i);
              }}
              style={{ width: 260 }}
            />
            <span style={{ fontSize: 12, opacity: 0.75 }}>
              DVR {dvrIndex} / {Math.max(0, dvrFramesCount - 1)}
            </span>
          </>
        )}

        <button onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Reload + Predict"}
        </button>

        {err && <span style={{ color: "crimson" }}>{err}</span>}

        <span style={{ fontSize: 12, opacity: 0.7 }}>
          Aircraft: {aircraft.length} • Tracks: {tracks.length} • Alerts: {visibleAlerts.length}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>
        <RadarMap
          aircraft={aircraft}
          tracks={tracks}
          trails={trails}
          stabilityById={stabilityById}
          conflicts={visibleConflicts}
          selected={selected}
          onSelectConflict={(c) => {
            setSelected(c);
            setSelectedAlertId((prev) => prev); // keep current unless you want to sync
          }}
          alerts={visibleAlerts}
          selectedAlertId={selectedAlertId}
          onSelectAlertId={(id) => {
            setSelectedAlertId(id);
            const a = visibleAlerts.find((x) => x.id === id);
            if (a?.involvedAircraftIds?.length) setSelectedAircraftId(a.involvedAircraftIds[0]);
          }}
          showWeather={layers.weatherRadar.on}
          weatherOpacity={layers.weatherRadar.opacity}
          weatherTimeISO={weatherTimeISO}
          showTrails={layers.trails.on}
          showProjectedTracks={layers.projected.on}
          showCpaGeometry={layers.cpaGeometry}
          selectedAircraftId={selectedAircraftId}
          onSelectAircraftId={(id) => setSelectedAircraftId(id)}
          showWinds={layers.winds.on}
          windOpacity={layers.winds.opacity}
          windLayer={layers.winds.layer}
          windStyle={layers.winds.style}
          windTimeISO={weatherTimeISO}
        />

        <RightPanel
          aircraft={aircraft}
          conflicts={visibleConflicts}
          selectedConflict={selected}
          onSelectConflict={(c) => setSelected(c)}
          selectedAircraft={selectedAircraft}
          selectedAircraftFlight={selectedAircraftFlight}
          alerts={visibleAlerts}
          enabledTypes={enabledTypes}
          setEnabledTypes={setEnabledTypes}
          minSeverity={minSeverity}
          setMinSeverity={setMinSeverity}
          selectedAlertId={selectedAlertId}
          setSelectedAlertId={setSelectedAlertId}
          layers={layers}
          setLayers={setLayers}
        />
      </div>
    </div>
  );
}
