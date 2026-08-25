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
  let cleaned = "";
  for (const character of s) {
    const codePoint = character.codePointAt(0);
    const isControl =
      codePoint !== undefined &&
      (codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f));
    if (!isControl) cleaned += character;
  }
  return cleaned;
}

/** Strip control chars and cap length. Safe for undefined/null input. */
export function sanitizeOcrString(s: string | undefined | null): string | undefined {
  if (s === undefined || s === null) return undefined;
  const cleaned = stripControlChars(s);
  return cleaned.length > MAX_OCR_STRING_LENGTH ? cleaned.slice(0, MAX_OCR_STRING_LENGTH) : cleaned;
}
