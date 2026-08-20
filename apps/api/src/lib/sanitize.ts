/**
 * Sanitizers for OCR'd / model-produced text before we echo it back to
 * clients. These sit between the vision layer and any JSON response, so
 * anything the model produces that looks like a control sequence never
 * survives the round-trip.
 *
 * Two guarantees:
 *   1. Control characters are stripped so nothing downstream (loggers,
 *      terminals, downstream LLMs) can be tricked by escape sequences,
 *      NULs, or C1 controls.
 *   2. Each string is hard-capped at 4KB so a runaway OCR result cannot
 *      inflate our response payloads or be used as a prompt-injection
 *      vector.
 */

/** Hard cap on any OCR'd string we echo back, in bytes/chars. */
export const MAX_OCR_STRING_LENGTH = 4 * 1024;

/**
 * Remove C0 control characters (except \n and \t), DEL, and C1 controls.
 * Newlines and tabs are preserved because OCR of multi-line text is a
 * legitimate use case; everything else is noise or a prompt-injection
 * vector.
 */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, "");
}

/** Strip control chars and cap length. Safe for undefined/null input. */
export function sanitizeOcrString(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  const cleaned = stripControlChars(s);
  return cleaned.length > MAX_OCR_STRING_LENGTH ? cleaned.slice(0, MAX_OCR_STRING_LENGTH) : cleaned;
}
