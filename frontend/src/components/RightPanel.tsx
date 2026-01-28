import React from "react";
import type { AircraftState, Conflict, Alert, AlertSeverity, AlertType, FlightInfo } from "../api";
import AlertsPanel from "../AlertsPanel";
import type { LayersState } from "../types";

type Props = {
  aircraft: AircraftState[];
  conflicts: Conflict[];

  selectedConflict: Conflict | null;
  onSelectConflict: (c: Conflict) => void;

  selectedAircraft: AircraftState | null;
  selectedAircraftFlight: FlightInfo | null;

  alerts: Alert[];
  enabledTypes: Record<AlertType, boolean>;
  setEnabledTypes: React.Dispatch<React.SetStateAction<Record<AlertType, boolean>>>;
  minSeverity: AlertSeverity;
  setMinSeverity: React.Dispatch<React.SetStateAction<AlertSeverity>>;

  selectedAlertId: string | null;
  setSelectedAlertId: React.Dispatch<React.SetStateAction<string | null>>;

  layers: LayersState;
  setLayers: React.Dispatch<React.SetStateAction<LayersState>>;
};

type TabKey = "alerts" | "layers" | "aircraft";

function airlineGuess(callsign?: string | null) {
  if (!callsign) return null;
  const cs = callsign.trim().toUpperCase();
  const prefix = cs.slice(0, 3);

  const map: Record<string, string> = {
    ACA: "Air Canada",
    WJA: "WestJet",
    SWR: "Swiss",
    BAW: "British Airways",
    DAL: "Delta",
    UAL: "United",
    AAL: "American",
    AFR: "Air France",
    KLM: "KLM",
  };

  return map[prefix] ?? null;
}

function fmtTimeUnix(sec?: number) {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return d.toLocaleString();
}

export default function RightPanel(props: Props) {
  const {
    aircraft,
    alerts,
    enabledTypes,
    setEnabledTypes,
    minSeverity,
    setMinSeverity,
    selectedConflict,
    onSelectConflict,
    selectedAircraft,
    selectedAircraftFlight,
    selectedAlertId,
    setSelectedAlertId,
    layers,
    setLayers,
  } = props;

  const [tab, setTab] = React.useState<TabKey>("alerts");

  return (
    <div style={{ width: 380, border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", borderBottom: "1px solid #eee", background: "#fafafa" }}>
        {(["alerts", "layers", "aircraft"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              padding: "10px 12px",
              border: "none",
              background: tab === k ? "white" : "transparent",
              borderBottom: tab === k ? "2px solid #111" : "2px solid transparent",
              cursor: "pointer",
              fontWeight: tab === k ? 700 : 600,
            }}
          >
            {k === "alerts" ? "Alerts" : k === "layers" ? "Layers" : "Aircraft"}
          </button>
        ))}
      </div>

      <div style={{ padding: 12, display: "grid", gap: 12 }}>
        {tab === "alerts" && (
          <AlertsPanel
            aircraft={aircraft}
            alerts={alerts}
            enabledTypes={enabledTypes}
            setEnabledTypes={setEnabledTypes}
            minSeverity={minSeverity}
            setMinSeverity={setMinSeverity}
            selectedConflict={selectedConflict}
            onSelectConflict={onSelectConflict}
            selectedAlertId={selectedAlertId}
            onSelectAlertId={(id) => setSelectedAlertId(id)}
          />
        )}

        {tab === "layers" && (
          <>
            <div style={{ fontWeight: 800 }}>Weather</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={layers.weatherRadar.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    weatherRadar: { ...s.weatherRadar, on: e.target.checked },
                  }))
                }
              />
              Precip radar (GeoMet)
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: layers.weatherRadar.on ? 1 : 0.5 }}>
              Opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layers.weatherRadar.opacity}
                disabled={!layers.weatherRadar.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    weatherRadar: { ...s.weatherRadar, opacity: Number(e.target.value) },
                  }))
                }
                style={{ width: 160 }}
              />
              <span style={{ fontSize: 12, opacity: 0.75 }}>{layers.weatherRadar.opacity.toFixed(2)}</span>
            </label>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, fontWeight: 800 }}>Winds</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={layers.winds.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    winds: { ...s.winds, on: e.target.checked },
                  }))
                }
              />
              Winds (GeoMet WMS overlay)
            </label>

            <label style={{ display: "grid", gap: 6, opacity: layers.winds.on ? 1 : 0.6 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Wind WMS layer name</div>
              <input
                value={layers.winds.layer}
                disabled={!layers.winds.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    winds: { ...s.winds, layer: e.target.value },
                  }))
                }
                placeholder='Paste a GeoMet WMS layer name'
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 12 }}
              />
            </label>

            <label style={{ display: "grid", gap: 6, opacity: layers.winds.on ? 1 : 0.6 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Wind WMS style (optional)</div>
              <input
                value={layers.winds.style}
                disabled={!layers.winds.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    winds: { ...s.winds, style: e.target.value },
                  }))
                }
                placeholder='Leave blank for default style'
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 12 }}
              />
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: layers.winds.on ? 1 : 0.5 }}>
              Opacity
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layers.winds.opacity}
                disabled={!layers.winds.on}
                onChange={(e) =>
                  setLayers((s) => ({
                    ...s,
                    winds: { ...s.winds, opacity: Number(e.target.value) },
                  }))
                }
                style={{ width: 160 }}
              />
              <span style={{ fontSize: 12, opacity: 0.75 }}>{layers.winds.opacity.toFixed(2)}</span>
            </label>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, fontWeight: 800 }}>Traffic</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={layers.trails.on}
                onChange={(e) => setLayers((s) => ({ ...s, trails: { on: e.target.checked } }))}
              />
              Past trails (last 5 min)
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={layers.projected.on}
                onChange={(e) => setLayers((s) => ({ ...s, projected: { on: e.target.checked } }))}
              />
              Projected tracks
            </label>

            <div style={{ borderTop: "1px solid #eee", paddingTop: 10, fontWeight: 800 }}>Conflicts</div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  name="cpaGeometry"
                  checked={layers.cpaGeometry === "selected"}
                  onChange={() => setLayers((s) => ({ ...s, cpaGeometry: "selected" }))}
                />
                Show CPA geometry: Selected only
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  name="cpaGeometry"
                  checked={layers.cpaGeometry === "all"}
                  onChange={() => setLayers((s) => ({ ...s, cpaGeometry: "all" }))}
                />
                Show CPA geometry: All
              </label>
            </div>
          </>
        )}

        {tab === "aircraft" && (
          <>
            <div style={{ fontWeight: 800 }}>Selected aircraft</div>
            {selectedAircraft ? (
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>
                  {selectedAircraft.callsign ?? selectedAircraft.id}
                </div>

                {airlineGuess(selectedAircraft.callsign) && (
                  <div>Airline (guess): {airlineGuess(selectedAircraft.callsign)}</div>
                )}

                <div>Alt: {selectedAircraft.alt_ft.toFixed(0)} ft</div>
                <div>GS: {selectedAircraft.gs_kt.toFixed(0)} kt</div>
                <div>Track: {selectedAircraft.track_deg.toFixed(0)}°</div>

                <div style={{ borderTop: "1px solid #eee", marginTop: 10, paddingTop: 10, fontWeight: 800 }}>
                  Flight info (real, best-effort)
                </div>

                {selectedAircraftFlight ? (
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    <div>ICAO24: {selectedAircraftFlight.icao24}</div>
                    {selectedAircraftFlight.callsign && <div>Callsign: {selectedAircraftFlight.callsign}</div>}
                    <div>
                      Route:{" "}
                      <b>{selectedAircraftFlight.estDepartureAirport ?? "?"}</b> →{" "}
                      <b>{selectedAircraftFlight.estArrivalAirport ?? "?"}</b>
                    </div>
                    <div>First seen: {fmtTimeUnix(selectedAircraftFlight.firstSeen) ?? "?"}</div>
                    <div>Last seen: {fmtTimeUnix(selectedAircraftFlight.lastSeen) ?? "?"}</div>
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                      If this shows blanks, it’s usually OpenSky CORS/rate-limits. We can proxy it through your backend later.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
                    Loading / unavailable (OpenSky may block browser requests). We can add a backend proxy if needed.
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                Click an aircraft marker on the map to inspect it.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
