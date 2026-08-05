import { Hono } from "hono";
import type { IdentifyResponse, Investable, Source } from "@mapvest/core";
import { identifyFromImage } from "@mapvest/vision";
import { resolveComparable, resolveEtfExposure, resolveTicker } from "@mapvest/finance";

const identify = new Hono();

identify.post("/", async (c) => {
  const form = await c.req.formData();
  const file = form.get("image");
  const lat = form.get("lat");
  const lng = form.get("lng");
  if (!(file instanceof File)) return c.json({ error: "image required" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const location = lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined;

  const identification = await identifyFromImage(bytes, { location });
  const investables: Investable[] = [];

  for (const d of identification.detected) {
    if (!d.brand) continue;
    const { brand, sources } = await resolveTicker(d.brand);
    const publicSources: Source[] = [
      ...sources,
      {
        provider: "openrouter",
        fetchedAt: new Date().toISOString(),
        confidence: d.confidence,
      },
    ];

    if (brand.isPublic) {
      investables.push({
        brand,
        comparables: [],
        etfs: [],
        confidence: d.confidence,
        sources: publicSources,
      });
    } else {
      const [comparables, etfs] = await Promise.all([
        resolveComparable(d.brand, d.sector),
        resolveEtfExposure(d.sector ?? d.brand),
      ]);
      investables.push({
        brand,
        comparables,
        etfs,
        confidence: d.confidence === "high" ? "medium" : "low",
        sources: publicSources,
      });
    }
  }

  const resp: IdentifyResponse = { identification, investables };
  return c.json(resp);
});

export default identify;
