/**
 * Minimal geohash encode (base32) — precision 6 ≈ 1.2km × 0.6km cells.
 * Used as nearby cache tile keys.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) + 1;
        lngMin = mid;
      } else {
        ch = (ch << 1) + 0;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) + 1;
        latMin = mid;
      } else {
        ch = (ch << 1) + 0;
        latMax = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch]!;
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function nearbyCacheKey(lat: number, lng: number, radius: number): {
  cacheKey: string;
  geohash: string;
  radiusBucket: number;
} {
  const geohash = encodeGeohash(lat, lng, 6);
  // Bucket radius to avoid fragmenting cache (250/500/1000/2000…).
  const radiusBucket = Math.max(100, Math.round(radius / 100) * 100);
  return {
    cacheKey: `v1:${geohash}:${radiusBucket}`,
    geohash,
    radiusBucket,
  };
}
