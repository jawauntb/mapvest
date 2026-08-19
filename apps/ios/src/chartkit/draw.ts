/**
 * Geometry for View-based charts. Kept free of react-native so bun tests can
 * cover the math that used to live in RNSVG (which native-crashed on iOS /
 * current Xcode builds).
 */

export type Pt = { x: number; y: number };

export type SegmentFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  rotateDeg: number;
};

export type FillStrip = { x: number; y: number; width: number; height: number };

export function isFinitePt(p: Pt): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** SVG `points` — `"x,y x,y"` or comma-separated numbers. Drops NaN/Infinity. */
export function parsePoints(points: string | undefined): Pt[] {
  if (!points) return [];
  const nums = points
    .trim()
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Layout a 1px-tall bar so that after rotation around its *center* it covers
 * A→B. Positioning at A with a default center origin is what made the old
 * sparklines look like disconnected dashes.
 */
export function segmentFrame(a: Pt, b: Pt, strokeWidth: number): SegmentFrame | null {
  if (!isFinitePt(a) || !isFinitePt(b) || !Number.isFinite(strokeWidth)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 0.05) return null;
  const h = Math.max(strokeWidth, 1);
  const overlap = 0.45;
  const w = len + overlap;
  return {
    left: (a.x + b.x) / 2 - w / 2,
    top: (a.y + b.y) / 2 - h / 2,
    width: w,
    height: h,
    rotateDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function parseDasharray(input: string | number | undefined): number[] | null {
  if (input == null) return null;
  if (typeof input === "number") return input > 0 ? [input, input] : null;
  const nums = input
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);
  return nums.length > 0 ? nums : null;
}

/** Walk A→B emitting on-dash frames for an SVG `strokeDasharray`. */
export function dashFrames(a: Pt, b: Pt, strokeWidth: number, dasharray: number[]): SegmentFrame[] {
  if (dasharray.length === 0) {
    const f = segmentFrame(a, b, strokeWidth);
    return f ? [f] : [];
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 0.05) return [];
  const ux = dx / len;
  const uy = dy / len;
  const out: SegmentFrame[] = [];
  let dist = 0;
  let i = 0;
  let drawing = true;
  let guard = 0;
  while (dist < len - 0.02 && guard < 400) {
    guard += 1;
    const raw = dasharray[i % dasharray.length] ?? 0;
    const step = Math.min(Math.max(raw, 0), len - dist);
    if (drawing && step > 0.25) {
      const start = { x: a.x + ux * dist, y: a.y + uy * dist };
      const end = { x: a.x + ux * (dist + step), y: a.y + uy * (dist + step) };
      const f = segmentFrame(start, end, strokeWidth);
      if (f) out.push(f);
    }
    dist += step === 0 ? 0.5 : step;
    i += 1;
    drawing = !drawing;
  }
  return out;
}

export function lineFrames(
  a: Pt,
  b: Pt,
  strokeWidth: number,
  dasharray?: string | number,
): SegmentFrame[] {
  const dash = parseDasharray(dasharray);
  if (dash) return dashFrames(a, b, strokeWidth, dash);
  const f = segmentFrame(a, b, strokeWidth);
  return f ? [f] : [];
}

export function normalizeRect(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  if (![x, y, width, height].every(Number.isFinite)) return null;
  let rx = x;
  let ry = y;
  let rw = width;
  let rh = height;
  if (rw < 0) {
    rx += rw;
    rw = -rw;
  }
  if (rh < 0) {
    ry += rh;
    rh = -rh;
  }
  if (rw <= 0 && rh <= 0) return null;
  return { x: rx, y: ry, width: Math.max(rw, 0.5), height: Math.max(rh, 0.5) };
}

/**
 * Even-odd vertical strips for a filled polygon. Used for area-under-line and
 * regression channels without native Path/SVG.
 */
export function polygonFillStrips(pts: Pt[], stripWidth = 2): FillStrip[] {
  if (pts.length < 3) return [];
  let minX = pts[0]?.x ?? 0;
  let maxX = minX;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  if (!(maxX > minX)) return [];
  const strips: FillStrip[] = [];
  const n = pts.length;
  const step = Math.max(stripWidth, 1);
  for (let x0 = minX; x0 < maxX; x0 += step) {
    const w = Math.min(step, maxX - x0);
    const x = x0 + w / 2;
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      if (dx === 0) continue;
      const crosses = a.x <= x && x < b.x ? true : b.x <= x && x < a.x;
      if (!crosses) continue;
      const y = a.y + ((x - a.x) / dx) * (b.y - a.y);
      if (Number.isFinite(y)) ys.push(y);
    }
    ys.sort((l, r) => l - r);
    for (let i = 0; i + 1 < ys.length; i += 2) {
      const y1 = ys[i];
      const y2 = ys[i + 1];
      if (y1 == null || y2 == null) continue;
      const h = y2 - y1;
      if (h >= 0.4) strips.push({ x: x0, y: y1, width: w, height: h });
    }
  }
  return strips;
}

/** Map a close series onto pixel space. Degenerate range still draws a flat line. */
export function sparklinePoints(
  series: number[],
  width: number,
  height: number,
  pad: number,
): Pt[] {
  if (series.length < 2 || !(width > 0) || !(height > 0)) return [];
  const first = series[0];
  if (typeof first !== "number") return [];
  let mn = first;
  let mx = first;
  for (const v of series) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = Math.max(mx - mn, 1e-9);
  const innerH = Math.max(height - pad * 2, 1);
  const innerW = Math.max(width - pad * 2, 1);
  return series.map((v, i) => ({
    x: pad + (i / (series.length - 1)) * innerW,
    y: pad + (1 - (v - mn) / range) * innerH,
  }));
}

export function pointsAttr(pts: Pt[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
