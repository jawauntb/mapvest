#!/usr/bin/env bun
/**
 * Generate `postman.json` at the repo root from `openapi.yaml`.
 *
 * Postman is a downstream client of the OpenAPI document. This script reads
 * the YAML produced by `gen-openapi.ts`, walks each `paths.*` operation, and
 * emits a Postman Collection v2.1.0 with one folder per tag. Bodies are
 * seeded with example JSON derived from the JSON-Schema definitions so the
 * requests are runnable without hand-editing.
 *
 * Run:
 *   bun run openapi && bun run postman
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as yamlParse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const openapiPath = resolve(repoRoot, "openapi.yaml");
const outPath = resolve(repoRoot, "postman.json");

type Json = unknown;
// biome-ignore lint/suspicious/noExplicitAny: OpenAPI documents are heterogeneous JSON.
type Doc = any;

const doc = yamlParse(readFileSync(openapiPath, "utf8")) as Doc;

/**
 * Resolve a `$ref` like `#/components/schemas/Foo` to the target node.
 */
function resolveRef(ref: string): Doc {
  if (!ref.startsWith("#/")) return {};
  const parts = ref.slice(2).split("/");
  let node: Doc = doc;
  for (const p of parts) {
    if (node && typeof node === "object" && p in node) {
      node = node[p];
    } else {
      return {};
    }
  }
  return node;
}

/**
 * Generate a runnable example value that satisfies the given JSON-Schema node.
 * Prefers explicit `example` / `default` / first enum value, otherwise uses a
 * reasonable placeholder for the type.
 */
function example(schema: Doc, seen: Set<string> = new Set()): Json {
  if (!schema || typeof schema !== "object") return null;

  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return null; // avoid recursion
    const next = new Set(seen);
    next.add(schema.$ref);
    return example(resolveRef(schema.$ref), next);
  }

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return example(schema.oneOf[0], seen);
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return example(schema.anyOf[0], seen);
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, Json> = {};
    for (const s of schema.allOf) {
      const part = example(s, seen);
      if (part && typeof part === "object" && !Array.isArray(part)) {
        Object.assign(merged, part);
      }
    }
    return merged;
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case "string": {
      if (schema.format === "uri") return "https://example.com";
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "date-time") return new Date().toISOString();
      if (schema.format === "binary") return "<binary>";
      return "";
    }
    case "integer":
    case "number": {
      if (typeof schema.minimum === "number") return schema.minimum;
      if (typeof schema.maximum === "number") return schema.maximum;
      return 0;
    }
    case "boolean":
      return false;
    case "array":
      return schema.items ? [example(schema.items, seen)] : [];
    case "object":
    case undefined: {
      const props = schema.properties ?? {};
      const out: Record<string, Json> = {};
      for (const [k, v] of Object.entries(props)) {
        out[k] = example(v as Doc, seen);
      }
      return out;
    }
    default:
      return null;
  }
}

type PostmanRequest = {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string; type?: string }[];
    url: {
      raw: string;
      host: string[];
      path: string[];
      query?: { key: string; value: string; description?: string }[];
    };
    body?: {
      mode: "raw" | "formdata";
      raw?: string;
      formdata?: { key: string; type: "text" | "file"; value?: string }[];
      options?: { raw: { language: "json" } };
    };
    description?: string;
    auth?: {
      type: "bearer";
      bearer: { key: string; value: string; type: "string" }[];
    };
  };
};

type PostmanFolder = { name: string; description?: string; item: PostmanRequest[] };

const folders = new Map<string, PostmanFolder>();
const tagDescriptions = new Map<string, string>(
  (doc.tags ?? []).map((t: Doc) => [t.name as string, t.description as string]),
);

const methods = ["get", "post", "put", "delete", "patch"] as const;

for (const [rawPath, pathItem] of Object.entries(doc.paths ?? {}) as [string, Doc][]) {
  for (const method of methods) {
    const op = pathItem[method];
    if (!op) continue;

    const tag = (op.tags?.[0] as string | undefined) ?? "default";
    if (!folders.has(tag)) {
      folders.set(tag, {
        name: tag,
        description: tagDescriptions.get(tag),
        item: [],
      });
    }

    const segments = rawPath.split("/").filter(Boolean);

    // ---- query params ----
    const query: NonNullable<PostmanRequest["request"]["url"]["query"]> = (op.parameters ?? [])
      .filter((p: Doc) => p.in === "query")
      .map((p: Doc) => ({
        key: p.name as string,
        value:
          p.example !== undefined
            ? String(p.example)
            : p.schema
              ? String(example(p.schema) ?? "")
              : "",
        description: p.description as string | undefined,
      }));

    const url = {
      raw: `{{baseUrl}}${rawPath}${
        query.length > 0 ? `?${query.map((q) => `${q.key}=${q.value}`).join("&")}` : ""
      }`,
      host: ["{{baseUrl}}"],
      path: segments,
      ...(query.length > 0 ? { query } : {}),
    };

    // ---- body ----
    let body: PostmanRequest["request"]["body"] | undefined;
    const content = op.requestBody?.content;
    if (content?.["application/json"]?.schema) {
      body = {
        mode: "raw",
        raw: JSON.stringify(example(content["application/json"].schema), null, 2),
        options: { raw: { language: "json" } },
      };
    } else if (content?.["multipart/form-data"]?.schema) {
      const schema = content["multipart/form-data"].schema;
      const props = schema.properties ?? {};
      body = {
        mode: "formdata",
        formdata: Object.entries(props).map(([k, v]: [string, Doc]) => {
          const isBinary =
            v?.format === "binary" || (v?.type === "string" && v?.format === "binary");
          if (isBinary) {
            return { key: k, type: "file" as const };
          }
          return {
            key: k,
            type: "text" as const,
            value: JSON.stringify(example(v)),
          };
        }),
      };
    }

    const request: PostmanRequest = {
      name: op.summary ?? `${method.toUpperCase()} ${rawPath}`,
      request: {
        method: method.toUpperCase(),
        header:
          body?.mode === "raw"
            ? [{ key: "Content-Type", value: "application/json", type: "text" }]
            : [],
        url,
        ...(body ? { body } : {}),
        description: op.description as string | undefined,
        ...(op.security && op.security.length > 0
          ? {
              auth: {
                type: "bearer" as const,
                bearer: [{ key: "token", value: "{{sessionToken}}", type: "string" as const }],
              },
            }
          : {}),
      },
    };

    folders.get(tag)!.item.push(request);
  }
}

const localServer =
  (doc.servers ?? []).find((s: Doc) => /localhost/i.test(String(s.url)))?.url ??
  "http://localhost:3001";

const collection = {
  info: {
    name: `${doc.info?.title ?? "Mapvest API"} — v${doc.info?.version ?? "0"}`,
    description: `${
      doc.info?.description ?? ""
    }\n\nGenerated from openapi.yaml. Regenerate: \`bun run openapi && bun run postman\`.`,
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: Array.from(folders.values()),
  variable: [
    { key: "baseUrl", value: localServer, type: "string" },
    { key: "sessionToken", value: "", type: "string" },
  ],
};

writeFileSync(outPath, `${JSON.stringify(collection, null, 2)}\n`, "utf8");

console.log(`postman: wrote ${outPath}`);
