/** Stable sector → accent color for pins, rows, and badges. */

const SECTOR_COLORS: Record<string, string> = {
  technology: "#5B8CFF",
  "information technology": "#5B8CFF",
  "consumer discretionary": "#FF8A4C",
  "consumer cyclical": "#FF8A4C",
  "consumer staples": "#3EE68A",
  "consumer defensive": "#3EE68A",
  healthcare: "#FF6B9D",
  "health care": "#FF6B9D",
  financials: "#C4A0FF",
  financial: "#C4A0FF",
  energy: "#F5C542",
  industrials: "#8B9BB4",
  materials: "#B8956C",
  "basic materials": "#B8956C",
  utilities: "#4ECDC4",
  "real estate": "#E8A0BF",
  "communication services": "#7AD7F0",
  communications: "#7AD7F0",
  "communication": "#7AD7F0",
};

export function sectorColor(sector?: string | null): string {
  if (!sector) return "#888888";
  const key = sector.trim().toLowerCase();
  if (SECTOR_COLORS[key]) return SECTOR_COLORS[key];
  for (const [k, v] of Object.entries(SECTOR_COLORS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  // Deterministic fallback from string hash so unknown sectors stay distinct.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 62%, 58%)`;
}

/** Map pin palette: public uses sector color; private comps orange; unknown gray. */
export function investablePinColor(opts: {
  isPublic?: boolean;
  sector?: string | null;
  hasComps?: boolean;
}): string {
  if (opts.isPublic) return sectorColor(opts.sector) || "#3EE68A";
  if (opts.hasComps) return "#F5A524";
  return "#666666";
}
