import { z } from "zod";
import type { FetchOpts } from "./http";

/**
 * Public handle rename — POST /v1/settings/handle. The handle is the one
 * public identity string ("finder-<8hex>", renameable to [a-z0-9-]{3,20})
 * safe to show next to a leaderboard row or a first-capture badge — never an
 * email or raw user id. See apps/api/src/lib/handles.ts for the server-side
 * format and 24h rename cooldown; a rejection surfaces as an `ApiError` whose
 * `code` is "invalid_format" | "handle_taken" | "rate_limited".
 */

export const HANDLE_FORMAT = /^[a-z0-9-]{3,20}$/;

export const RenameHandleResponse = z.object({
  ok: z.literal(true),
  handle: z.string(),
});
export type RenameHandleResponse = z.infer<typeof RenameHandleResponse>;

export async function renameHandle(handle: string, opts: FetchOpts): Promise<RenameHandleResponse> {
  // Deferred import: this module's pure schema/regex exports are exercised in
  // plain `bun test` with no RN runtime, and `./http` pulls in
  // expo-secure-store transitively — keeping that import lazy means a schema
  // parse test never has to load the native module chain.
  const { apiFetch } = await import("./http");
  const res = await apiFetch<unknown>(
    "/v1/settings/handle",
    { method: "POST", body: JSON.stringify({ handle }) },
    opts,
  );
  return RenameHandleResponse.parse(res);
}
