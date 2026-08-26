/** Canonical public origin used by every recipient-facing Mapvest share. */
export const MAPVEST_URL = "https://mapvest.app";
const MAPVEST_APP_LINK_ORIGIN = "https://www.mapvest.app";

const MAPVEST_WEB_HOSTS = new Set(["mapvest.app", "www.mapvest.app"]);

/**
 * Build a recipient-safe web URL for a ticker or unresolved brand.
 *
 * The matching web route accepts either value. When the iOS app is installed,
 * its associated-domain entitlement opens the same URL in Mapvest and
 * `redirectMapvestWebPath` rewrites it to the native detail route.
 */
export function investableShareUrl(tickerOrBrand: string): string {
  const value = tickerOrBrand.trim();
  if (!value) return `${MAPVEST_URL}/app`;
  const normalized = (value.startsWith("$") ? value.slice(1) : value).trim();
  if (!normalized) return `${MAPVEST_URL}/app`;
  return `${MAPVEST_APP_LINK_ORIGIN}/app/ticker/${encodeURIComponent(normalized)}`;
}

/**
 * Rewrite a canonical Mapvest web-detail URL into the equivalent Expo Router
 * path. Unknown, malformed, or off-domain links pass through untouched.
 */
export function redirectMapvestWebPath(path: string): string {
  try {
    // React Native's URL polyfill mis-parses absolute URLs with custom
    // schemes when a base is supplied (`new URL("mapvest://…", base)` comes
    // back as an https mapvest.app URL), which would defeat the host guard
    // below. Reject non-https schemes by string before constructing the URL;
    // scheme-less web paths ("/app/ticker/X") still fall through to the base.
    const scheme = path.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && scheme !== "https") return path;
    const url = new URL(path, MAPVEST_URL);
    if (url.protocol !== "https:" || !MAPVEST_WEB_HOSTS.has(url.hostname.toLowerCase())) {
      return path;
    }
    const match = url.pathname.match(/^\/app\/ticker\/([^/]+)\/?$/i);
    const encodedTarget = match?.[1];
    if (!encodedTarget) return path;
    const target = decodeURIComponent(encodedTarget).trim();
    return target ? `/detail/${encodeURIComponent(target)}` : path;
  } catch {
    return path;
  }
}
