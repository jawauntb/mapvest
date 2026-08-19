import type { OhlcvPoint, ValuePoint } from "@/api/underlying";

/** Math + formatting helpers shared by the terminal chart components. */

export type Domain = [number, number];

export function extent(values: number[]): Domain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

export function padDomain([min, max]: Domain, frac: number): Domain {
  const pad = (max - min) * frac;
  return [min - pad, max + pad];
}

/** Plain linear scale; collapses a zero-span domain safely. */
export function linearScale([d0, d1]: Domain, [r0, r1]: Domain): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** "Nice" ticks à la d3 — round steps of 1/2/5 × 10^k inside the domain. */
export function niceTicks([min, max]: Domain, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const rawStep = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(v);
  return ticks;
}

/**
 * Stride decimation that always keeps the final point — long daily series
 * (2y ≈ 500 bars) get thinned so SVG stays responsive.
 */
export function decimate<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    const p = points[Math.round(i * step)];
    if (p !== undefined) out.push(p);
  }
  return out;
}

/** OHLC-preserving downsample: per bucket open=first, close=last, high=max, low=min, volume=sum. */
export function bucketOhlc(points: OhlcvPoint[], max: number): OhlcvPoint[] {
  if (points.length <= max) return points;
  const out: OhlcvPoint[] = [];
  const size = points.length / max;
  for (let b = 0; b < max; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(points.length, Math.max(start + 1, Math.floor((b + 1) * size)));
    const first = points[start];
    if (!first) continue;
    let high = first.high;
    let low = first.low;
    let volume = 0;
    let close = first.close;
    let date = first.date;
    for (let i = start; i < end; i++) {
      const p = points[i];
      if (!p) continue;
      if (p.high > high) high = p.high;
      if (p.low < low) low = p.low;
      volume += p.volume;
      close = p.close;
      date = p.date;
    }
    out.push({ date, open: first.open, high, low, close, volume });
  }
  return out;
}

/** Map ValuePoints onto an index-keyed date axis (trading days, gaps skipped). */
export function indexByDate(dates: string[]): Map<string, number> {
  const map = new Map<string, number>();
  dates.forEach((d, i) => {
    map.set(d, i);
  });
  return map;
}

/** SVG polyline points string for a value series on shared x/y scales. */
export function polylinePoints(
  series: ValuePoint[],
  dateIndex: Map<string, number>,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  const parts: string[] = [];
  for (const p of series) {
    const i = dateIndex.get(p.date);
    if (i === undefined || !Number.isFinite(p.value)) continue;
    const px = x(i);
    const py = y(p.value);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    parts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return parts.join(" ");
}

/** Never mount empty or NaN `points` strings — layout math treats those as missing. */
export function isSafeSvgPoints(points: string | undefined): points is string {
  return typeof points === "string" && points.length > 0 && !/\bNaN\b|\bInfinity\b/.test(points);
}

/** Evenly spread label indices across a category axis (first + last included). */
export function tickIndices(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Math.round((i * (length - 1)) / (count - 1)));
  }
  return [...new Set(out)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-14" → "Aug 14" (or "Aug '26" when the window spans years). */
export function shortDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  if (withYear) return `${month} '${(y ?? "").slice(2)}`;
  return `${month} ${Number(d)}`;
}

export function spansYears(dates: string[]): boolean {
  const first = dates[0];
  const last = dates[dates.length - 1];
  return !!first && !!last && first.slice(0, 4) !== last.slice(0, 4);
}

// -------- formatters --------

export function fmtPrice(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 1 : 2;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** 42_296_300 → "42M"; 1_234 → "1.2K". */
export function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${Math.round(v / 1e6)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${Math.round(v)}`;
}

/** Fraction → percent string: 0.191 → "19.1%". */
export function fmtPct(frac: number, digits = 1): string {
  return `${(frac * 100).toFixed(digits)}%`;
}
