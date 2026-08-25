import { probeApi } from "@/lib/status";
import { NextResponse } from "next/server";

/**
 * GET /api/status
 *
 * Server-side probe of the live Mapvest API's /v1/health endpoint with a
 * 2s timeout. Returns:
 *   { api: "up" | "down", checkedAt: <ISO string> }
 *
 * Cached briefly at the edge so we don't hammer /v1/health on every hit,
 * but not so long that a real outage stays green for minutes.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const status = await probeApi();
  return NextResponse.json(status, {
    headers: {
      // Small cache window: fresh enough to reflect outages, cheap enough
      // that a burst of readers doesn't fan out into /v1/health calls.
      "cache-control": "public, max-age=15, s-maxage=15",
    },
  });
}
