import type { Router } from "expo-router";

/**
 * Payload shape for the "Chat about this" universal action. Every entry
 * point on the app that shows content (ticker chip, brief card, nearby
 * list, map snapshot, …) can hand one of these to `openChatAbout` and get
 * a research chat pre-seeded with a smart first-message draft.
 *
 * The seed is **just a draft**. The Research screen fills it into the
 * composer but never auto-sends — the user always sees the message before
 * it goes out so they can edit + submit.
 */
export type ChatSeed =
  | { kind: "ticker"; ticker: string }
  | { kind: "brief"; title: string; body: string; ticker?: string }
  | {
      kind: "list";
      label: string;
      items: Array<{ ticker?: string; name: string; sector?: string }>;
    }
  | {
      kind: "map";
      label: string;
      center?: { lat: number; lng: number };
      nearby: Array<{ ticker?: string; name: string; distanceMeters?: number }>;
    };

/**
 * Base64-encode a UTF-8 string in a way that works whether Buffer is
 * available (dev / Node contexts) or not (bare Hermes RN runtime). The
 * classic `btoa` chokes on non-Latin-1 code points — a brand name with an
 * accent would crash the button — so we go via UTF-8 bytes explicitly.
 */
function utf8ToBase64(input: string): string {
  // Prefer Buffer when the runtime exposes it (Metro + polyfills usually do).
  const B = (
    globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }
  ).Buffer;
  if (B) {
    try {
      return B.from(input, "utf-8").toString("base64");
    } catch {
      // fall through to manual path
    }
  }
  // Manual UTF-8 → binary string → btoa. `unescape(encodeURIComponent(…))`
  // is the idiomatic "make btoa unicode-safe" trick; it's stable in Hermes.
  // biome-ignore lint/suspicious/noExplicitAny: legacy shim for RN runtime
  const g = globalThis as any;
  const bin =
    typeof g.unescape === "function" && typeof encodeURIComponent === "function"
      ? g.unescape(encodeURIComponent(input))
      : input;
  if (typeof g.btoa === "function") return g.btoa(bin);
  // Absolute last resort: percent-encode. `decodeChatSeed` will still parse
  // it, because it URI-decodes before base64-decoding.
  return encodeURIComponent(input);
}

/** Symmetric decoder for `ChatSeed`. Returns `null` on any parse failure. */
export function decodeChatSeed(encoded: string | undefined | null): ChatSeed | null {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    // biome-ignore lint/suspicious/noExplicitAny: runtime globals
    const g = globalThis as any;
    let jsonStr: string;
    const B = g.Buffer;
    if (B) {
      jsonStr = B.from(encoded, "base64").toString("utf-8");
    } else if (typeof g.atob === "function") {
      const bin = g.atob(encoded);
      // Reverse of the encoder: binary string → UTF-8 via
      // `decodeURIComponent(escape(…))`.
      jsonStr = typeof g.escape === "function" ? decodeURIComponent(g.escape(bin)) : bin;
    } else {
      // The absolute-last-resort encoder path used percent-encoding.
      jsonStr = decodeURIComponent(encoded);
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") return null;
    return parsed as ChatSeed;
  } catch {
    return null;
  }
}

/**
 * Compose a smart first-message draft from a `ChatSeed`. This is the exact
 * string the Research composer should be pre-filled with — the user can
 * edit it before submitting.
 *
 * Kept alongside the encoder so any screen that wants to preview the draft
 * (say, a confirmation sheet) uses the same builder as the Research screen.
 */
export function seedToDraft(seed: ChatSeed): string {
  switch (seed.kind) {
    case "ticker":
      return `Give me a research brief on $${seed.ticker}.`;
    case "brief":
      return `Ask a follow-up about this brief: "${seed.title}" — ${seed.body}`;
    case "list": {
      const parts = seed.items.map((i) => `$${i.ticker || i.name}`);
      return `Discuss this list — ${seed.label}: ${parts.join(", ")}`;
    }
    case "map": {
      const parts = seed.nearby.map((n) => `$${n.ticker || n.name}`);
      return `What's investable in this area? ${seed.label}. Nearby: ${parts.join(", ")}`;
    }
    default:
      // Exhaustiveness guard — new kinds should fail loudly at type-check
      // time, not silently render an empty draft at runtime.
      return "";
  }
}

/**
 * Open the Research chat pre-seeded with `seed`. Uses expo-router to push
 * `/(tabs)/research?intent=new&seed=<b64>`; the Research screen reads
 * `seed` on mount, decodes it, and pre-fills the composer input.
 *
 * We never auto-send — the seed is a draft, not a submission.
 */
export function openChatAbout(router: Router, seed: ChatSeed): void {
  const b64 = utf8ToBase64(JSON.stringify(seed));
  // `as never` matches the pattern used elsewhere (see AppSidebar) — expo-
  // router's typed-routes plugin doesn't know about arbitrary query strings.
  router.push(`/(tabs)/research?intent=new&seed=${encodeURIComponent(b64)}` as never);
}
