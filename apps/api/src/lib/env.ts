/**
 * Env accessors with dev-safe defaults so the API boots without Doppler in local tests.
 * In production these MUST be supplied via Doppler (`cofounder/dev` or `cofounder/stg`).
 */

const DEV_DEFAULT_WARNING = (name: string) =>
  `[env] ${name} not set — using dev default. DO NOT ship this to prod.`;

let warned = new Set<string>();
function warnOnce(name: string) {
  if (warned.has(name)) return;
  warned.add(name);
  if (process.env.NODE_ENV !== "test") console.warn(DEV_DEFAULT_WARNING(name));
}

export function sessionSigningKey(): string {
  const v = process.env.SESSION_SIGNING_KEY;
  if (v && v.length >= 16) return v;
  warnOnce("SESSION_SIGNING_KEY");
  return "dev-session-signing-key-change-me";
}

export function mapsSigningKey(): string {
  const v = process.env.IOS_MAPS_TOKEN_SIGNING_KEY;
  if (v && v.length >= 16) return v;
  warnOnce("IOS_MAPS_TOKEN_SIGNING_KEY");
  return "dev-maps-signing-key-change-me";
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function googleMapsKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

export function postgresUrl(): string | undefined {
  return process.env.POSTGRES_URL || undefined;
}

/** Test-only helper — resets the once-warned set. */
export function __resetEnvWarnings() {
  warned = new Set<string>();
}
