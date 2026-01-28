// src/api.ts
export type AircraftState = {
  id: string;                 // usually ICAO24 for OpenSky
  callsign?: string | null;
  lat: number;
  lon: number;
  alt_ft: number;
  gs_kt: number;
  track_deg: number;
  vr_fpm?: number | null;
};

export type ProjectedPoint = {
  lat: number;
  lon: number;
  alt_ft: number;
  // optional time offset (seconds) if your backend provides it
  t_s?: number;
};

export type ProjectedTrack = {
  id: string;
  points: ProjectedPoint[];
};

export type TrailPoint = {
  ts: number;
  lat: number;
  lon: number;
  alt_ft?: number;
  track_deg?: number;
};

export type Trail = {
  id: string;
  callsign?: string | null;
  points: TrailPoint[];
};

export type Conflict = {
  a_id: string;
  b_id: string;
  cpa_lat: number;
  cpa_lon: number;
  first_breach_s: number; // seconds until first breach (relative)
  min_h_nm: number;
  min_v_ft: number;
};

export type AlertSeverity = "info" | "caution" | "warning";
export type AlertType = "separation" | "weather" | "vertical" | "wake" | "congestion";

export type Alert = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  details: string;
  involvedAircraftIds: string[];
  lat: number;
  lon: number;
  time_s: number;

  // optional payload for richer UI (used for separation -> conflict)
  data?: {
    conflict?: Conflict;
    [k: string]: any;
  };
};

export type StabilityById = Record<string, number>;

export type FlightInfo = {
  icao24: string;
  callsign?: string | null;
  firstSeen?: number; // unix seconds
  lastSeen?: number;  // unix seconds
  estDepartureAirport?: string | null;
  estArrivalAirport?: string | null;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ??
  "http://localhost:8000";

// --- existing backend calls (keep these matching your backend routes) ---
export async function fetchOpenSkyAircraft(): Promise<AircraftState[]> {
  const r = await fetch(`${API_BASE}/opensky/aircraft`);
  if (!r.ok) throw new Error(`OpenSky fetch failed: ${r.status}`);
  return r.json();
}

export async function fetchReplayMeta(): Promise<{ frames: number }> {
  const r = await fetch(`${API_BASE}/replay/meta`);
  if (!r.ok) throw new Error(`Replay meta failed: ${r.status}`);
  return r.json();
}

export async function fetchReplayAircraft(frame: number): Promise<AircraftState[]> {
  const r = await fetch(`${API_BASE}/replay/aircraft?frame=${frame}`);
  if (!r.ok) throw new Error(`Replay frame failed: ${r.status}`);
  return r.json();
}

export async function fetchDemoAircraft(): Promise<AircraftState[]> {
  const r = await fetch(`${API_BASE}/demo/aircraft`);
  if (!r.ok) throw new Error(`Demo aircraft failed: ${r.status}`);
  return r.json();
}

export async function dvrPush(ac: AircraftState[]): Promise<void> {
  await fetch(`${API_BASE}/dvr/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aircraft: ac }),
  }).catch(() => {});
}

export async function dvrMeta(): Promise<{ frames: number; interval_s: number; oldest_ts?: number; newest_ts?: number }> {
  const r = await fetch(`${API_BASE}/dvr/meta`);
  if (!r.ok) throw new Error(`DVR meta failed: ${r.status}`);
  return r.json();
}

export async function dvrAircraft(i: number): Promise<AircraftState[]> {
  const r = await fetch(`${API_BASE}/dvr/aircraft?i=${i}`);
  if (!r.ok) throw new Error(`DVR aircraft failed: ${r.status}`);
  return r.json();
}

export async function projectTracks(ac: AircraftState[]): Promise<ProjectedTrack[]> {
  const r = await fetch(`${API_BASE}/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aircraft: ac }),
  });
  if (!r.ok) throw new Error(`Project failed: ${r.status}`);
  return r.json();
}

// Optional: if you still have a backend alerts endpoint.
// We won’t rely on it anymore for separation (we compute locally),
// but you can keep it for future expansion.
export async function fetchAlerts(_ac: AircraftState[]): Promise<Alert[]> {
  const r = await fetch(`${API_BASE}/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aircraft: _ac }),
  });
  if (!r.ok) throw new Error(`Alerts failed: ${r.status}`);
  return r.json();
}

// --- REAL flight info (OpenSky flights/aircraft). Best-effort (CORS/rate-limits may block in browser). ---
export async function fetchFlightInfo(icao24: string): Promise<FlightInfo | null> {
  try {
    const end = Math.floor(Date.now() / 1000);
    const begin = end - 24 * 3600;

    const url = `https://opensky-network.org/api/flights/aircraft?icao24=${encodeURIComponent(
      icao24
    )}&begin=${begin}&end=${end}`;

    const r = await fetch(url);
    if (!r.ok) return null;

    const flights = (await r.json()) as any[];
    if (!Array.isArray(flights) || flights.length === 0) return null;

    flights.sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0));
    const last = flights[flights.length - 1];

    return {
      icao24,
      callsign: last.callsign ?? null,
      firstSeen: last.firstSeen,
      lastSeen: last.lastSeen,
      estDepartureAirport: last.estDepartureAirport ?? null,
      estArrivalAirport: last.estArrivalAirport ?? null,
    };
  } catch {
    return null;
  }
}
