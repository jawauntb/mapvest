export type ShareCardReadiness = {
  laidOut: boolean;
  brandMarkLoaded: boolean;
};

export function isShareCardReady(readiness: ShareCardReadiness): boolean {
  return readiness.laidOut && readiness.brandMarkLoaded;
}

/** Keep both the native card and the text fallback behind one in-flight guard. */
export function canStartShareAttempt(input: { ready: boolean; inFlight: boolean }): boolean {
  return input.ready && !input.inFlight;
}
