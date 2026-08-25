import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

// The Mapvest OG image is a procedurally-generated SVG at
// apps/landing/public/og.svg. This route serves the same bytes from
// `/og` with an explicit `image/svg+xml` content type so consumers that
// hit `/og` (without the extension) also get a valid OG image.
//
// Static-hosted: any deploy target that serves /public also serves it at
// /og.svg directly — this route is the extensionless alias.

export const dynamic = "force-static";
export const revalidate = false;

export async function GET(): Promise<Response> {
  const svgPath = path.join(process.cwd(), "public", "og.svg");
  const svg = await readFile(svgPath, "utf8");
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
    },
  });
}
