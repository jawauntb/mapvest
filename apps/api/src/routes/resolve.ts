import { Hono } from "hono";
import type { ResolveComparableResponse } from "@mapvest/core";
import { resolveComparable, resolveEtfExposure, resolveTicker } from "@mapvest/finance";

const resolve = new Hono();

resolve.post("/", async (c) => {
  const body = await c.req.json<{ brand: string; hintSector?: string }>();
  if (!body.brand) return c.json({ error: "brand required" }, 400);

  const { brand } = await resolveTicker(body.brand);
  const [comparables, etfs] = await Promise.all([
    brand.isPublic ? Promise.resolve([]) : resolveComparable(body.brand, body.hintSector),
    resolveEtfExposure(body.hintSector ?? body.brand),
  ]);

  const resp: ResolveComparableResponse = { brand, comparables, etfs };
  return c.json(resp);
});

export default resolve;
