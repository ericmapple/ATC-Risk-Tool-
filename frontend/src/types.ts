// src/types.ts
export type LayersState = {
  weatherRadar: { on: boolean; opacity: number };

  // Winds overlay (WMS tiles)
  winds: {
    on: boolean;
    opacity: number;
    layer: string;   // WMS layer name
    style: string;   // WMS style name (optional; "" means default)
    // We keep streamlines as an optional “experimental” feature (disabled by default).
    streamlinesOn?: boolean;
  };

  trails: { on: boolean };
  projected: { on: boolean };

  // Conflict CPA geometry visibility
  cpaGeometry: "selected" | "all";
};
