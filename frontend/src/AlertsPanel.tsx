// src/AlertsPanel.tsx
import React from "react";
import type { AircraftState, Alert, AlertSeverity, AlertType, Conflict } from "./api";

type Props = {
  aircraft: AircraftState[];

  alerts: Alert[];
  enabledTypes: Record<AlertType, boolean>;
  setEnabledTypes: React.Dispatch<React.SetStateAction<Record<AlertType, boolean>>>;

  minSeverity: AlertSeverity;
  setMinSeverity: React.Dispatch<React.SetStateAction<AlertSeverity>>;

  selectedConflict: Conflict | null;
  onSelectConflict: (c: Conflict) => void;

  selectedAlertId: string | null;
  onSelectAlertId: (id: string | null) => void;
};

const sevRank: Record<AlertSeverity, number> = { info: 0, caution: 1, warning: 2 };

function sevColor(sev: AlertSeverity) {
  return sev === "warning" ? "crimson" : sev === "caution" ? "orange" : "#333";
}

export default function AlertsPanel(props: Props) {
  const {
    alerts,
    enabledTypes,
    setEnabledTypes,
    minSeverity,
    setMinSeverity,
    selectedAlertId,
    onSelectAlertId,
    onSelectConflict,
  } = props;

  const filtered = React.useMemo(() => {
    const min = sevRank[minSeverity];
    return alerts
      .filter((a) => enabledTypes[a.type] && sevRank[a.severity] >= min)
      .sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
  }, [alerts, enabledTypes, minSeverity]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900 }}>Alert Filters</div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["separation", "weather", "vertical", "wake", "congestion"] as AlertType[]).map((t) => (
            <label key={t} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={enabledTypes[t]}
                onChange={(e) => setEnabledTypes((s) => ({ ...s, [t]: e.target.checked }))}
              />
              {t}
            </label>
          ))}
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Minimum severity
          <select value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as AlertSeverity)}>
            <option value="info">info</option>
            <option value="caution">caution</option>
            <option value="warning">warning</option>
          </select>
        </label>
      </div>

      <div style={{ borderTop: "1px solid #eee", paddingTop: 10, fontWeight: 900 }}>
        Alerts ({filtered.length})
      </div>

      <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto", paddingRight: 4 }}>
        {filtered.map((a) => {
          const selected = a.id === selectedAlertId;
          return (
            <button
              key={a.id}
              onClick={() => {
                onSelectAlertId(a.id);

                // If this alert contains a conflict, also select the conflict (so CPA highlights).
                const c = a.data?.conflict;
                if (a.type === "separation" && c) onSelectConflict(c);
              }}
              style={{
                textAlign: "left",
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: 10,
                background: selected ? "#f7f7ff" : "white",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900, color: sevColor(a.severity) }}>{a.title}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{a.type}</div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{a.details}</div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 6 }}>
                {a.involvedAircraftIds.join(" • ")}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            No alerts visible under current filters.
          </div>
        )}
      </div>

      <button
        onClick={() => onSelectAlertId(null)}
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 10,
          background: "white",
          cursor: "pointer",
        }}
      >
        Clear alert selection
      </button>
    </div>
  );
}
