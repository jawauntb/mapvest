import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import {
  APP_STORE_CONNECT_REQUEST_TIMEOUT_MS,
  AppStoreConnectClient,
  createAppStoreConnectToken,
} from "../../scripts/app-store-release";
import type { AppStoreReleaseLedger } from "./appStoreRelease";

function json(data: unknown): Response {
  return Response.json(data, { status: 200, headers: { "x-request-id": "request-id" } });
}

function ledger(): AppStoreReleaseLedger {
  return {
    schemaVersion: 1,
    manifestHash: `sha256:${"a".repeat(64)}`,
    sourceCommitSha: "1234567890abcdef1234567890abcdef12345678",
    identity: {
      bundleIdentifier: "com.mapvest.app",
      appStoreConnectAppId: "6798832989",
      marketingVersion: "0.1.0",
      buildNumber: "128",
      easBuildId: "eas-build-id",
      ascBuildId: "asc-build-id",
      appStoreVersionId: "version-id",
    },
    evidence: {
      ci: "github-actions://ci",
      xcode26_archive: "github-actions://archive",
      archive_identity_and_privacy: "github-actions://identity",
      testflight_distribution: "eas://testflight",
      physical_device_checklist: "github-actions://device",
      app_store_metadata_audit: "github-actions://metadata",
      app_privacy_audit: "github-actions://privacy",
      reviewer_access: "github-actions://reviewer",
      subscription_review: "github-actions://subscription",
      account_deletion_and_ai_consent: "github-actions://account",
    },
    history: [{ at: "2026-09-01T00:00:00.000Z", state: "manifest_validated" }],
  };
}

function inspectionFetch(
  submissionDocument: unknown,
  seen: string[] = [],
): (input: string | URL | Request) => Promise<Response> {
  return async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/apps/6798832989?")) {
      return json({
        data: {
          type: "apps",
          id: "6798832989",
          attributes: { bundleId: "com.mapvest.app" },
        },
      });
    }
    if (url.includes("/appStoreVersions/version-id?")) {
      return json({
        data: {
          type: "appStoreVersions",
          id: "version-id",
          attributes: {
            versionString: "0.1.0",
            appVersionState: "PREPARE_FOR_SUBMISSION",
          },
        },
      });
    }
    if (url.includes("/builds/asc-build-id?")) {
      return json({
        data: {
          type: "builds",
          id: "asc-build-id",
          attributes: { version: "128", processingState: "VALID", expired: false },
        },
        included: [
          {
            type: "apps",
            id: "6798832989",
            attributes: { bundleId: "com.mapvest.app" },
          },
          {
            type: "preReleaseVersions",
            id: "pre",
            attributes: { version: "0.1.0", platform: "IOS" },
          },
        ],
      });
    }
    if (url.endsWith("/appStoreVersions/version-id/relationships/build")) {
      return json({ data: null });
    }
    if (url.includes("/appStoreVersionLocalizations?")) {
      return json({
        data: [
          {
            type: "appStoreVersionLocalizations",
            id: "loc",
            attributes: {
              description: "description",
              keywords: "keywords",
              supportUrl: "https://mapvest.app/support",
              whatsNew: "new",
            },
          },
        ],
      });
    }
    if (url.endsWith("/appStoreVersions/version-id/appStoreReviewDetail")) {
      return json({
        data: {
          type: "appStoreReviewDetails",
          id: "review",
          attributes: {
            contactEmail: "review@example.com",
            notes: "notes",
            demoAccountRequired: false,
          },
        },
      });
    }
    if (url.includes("/apps/6798832989/reviewSubmissions?")) {
      return json(submissionDocument);
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

describe("App Store Connect client", () => {
  test("creates a SHA-256 ES256 token with bounded claims", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const token = createAppStoreConnectToken(
      { keyId: "key-id", issuerId: "issuer-id", privateKey },
      1_788_200_000,
    );
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toEqual({
      alg: "ES256",
      kid: "key-id",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toEqual({
      iss: "issuer-id",
      iat: 1_788_200_000,
      exp: 1_788_200_600,
      aud: "appstoreconnect-v1",
    });
    expect(Buffer.from(signature!, "base64url")).toHaveLength(64);
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
  });

  test("uses current App Store version state and exact review relationships", async () => {
    const seen: string[] = [];
    const client = new AppStoreConnectClient({
      token: "token",
      fetch: inspectionFetch({ data: [], meta: { paging: { total: 0, limit: 200 } } }, seen),
    });

    const observed = await client.inspect(ledger());

    expect(observed.storefrontState).toBe("PREPARE_FOR_SUBMISSION");
    expect(observed.metadataComplete).toBe(true);
    expect(seen.join("\n")).toContain("appVersionState");
    expect(seen.join("\n")).toContain("include=items,appStoreVersionForReview");
    expect(seen.join("\n")).toContain("limit=200");
  });

  test("fails closed when a different App Store version is already in active review", async () => {
    const client = new AppStoreConnectClient({
      token: "token",
      fetch: inspectionFetch({
        data: [
          {
            type: "reviewSubmissions",
            id: "exact-draft",
            attributes: { state: "READY_FOR_REVIEW", platform: "IOS" },
            relationships: {
              items: { data: [] },
              appStoreVersionForReview: { data: null },
            },
          },
          {
            type: "reviewSubmissions",
            id: "other-active",
            attributes: { state: "IN_REVIEW", platform: "IOS" },
            relationships: {
              items: { data: [{ type: "reviewSubmissionItems", id: "item-2" }] },
              appStoreVersionForReview: {
                data: { type: "appStoreVersions", id: "other-version" },
              },
            },
          },
        ],
        meta: { paging: { total: 2, limit: 200 } },
      }),
    });

    await expect(client.inspect(ledger())).rejects.toThrow(
      "Another App Store version is already active",
    );
  });

  test("resolves one exact valid ASC build and iOS App Store version", async () => {
    const seen: string[] = [];
    const client = new AppStoreConnectClient({
      token: "token",
      fetch: async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("/apps/6798832989/appStoreVersions?")) {
          return json({
            data: [
              {
                type: "appStoreVersions",
                id: "version-id",
                attributes: { versionString: "0.1.0", platform: "IOS" },
              },
            ],
          });
        }
        if (url.includes("/builds?")) {
          return json({
            data: [
              {
                type: "builds",
                id: "asc-build-id",
                attributes: { version: "128", processingState: "VALID", expired: false },
                relationships: {
                  preReleaseVersion: {
                    data: { type: "preReleaseVersions", id: "pre-release-id" },
                  },
                },
              },
            ],
            included: [
              {
                type: "apps",
                id: "6798832989",
                attributes: { bundleId: "com.mapvest.app" },
              },
              {
                type: "preReleaseVersions",
                id: "pre-release-id",
                attributes: { version: "0.1.0", platform: "IOS" },
              },
            ],
          });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    await expect(
      client.resolveReleaseIdentity({
        appId: "6798832989",
        bundleIdentifier: "com.mapvest.app",
        marketingVersion: "0.1.0",
        buildNumber: "128",
      }),
    ).resolves.toEqual({ ascBuildId: "asc-build-id", appStoreVersionId: "version-id" });
    expect(seen.join("\n")).toContain("filter[version]=128");
    expect(seen.join("\n")).toContain("filter[versionString]=0.1.0");
  });

  test("sends the exact current JSON:API release request", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new AppStoreConnectClient({
      token: "token",
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return json({ data: { type: "appStoreVersionReleaseRequests", id: "request-id" } });
      },
    });

    await client.mutate({ kind: "request_storefront_release", appStoreVersionId: "version-id" });

    expect(calls[0]?.url).toEndWith("/v1/appStoreVersionReleaseRequests");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      data: {
        type: "appStoreVersionReleaseRequests",
        relationships: {
          appStoreVersion: { data: { type: "appStoreVersions", id: "version-id" } },
        },
      },
    });
  });

  test("aborts a stalled App Store Connect request", async () => {
    const client = new AppStoreConnectClient({
      token: "token",
      requestTimeoutMs: 1,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    });

    await expect(
      client.mutate({ kind: "request_storefront_release", appStoreVersionId: "version-id" }),
    ).rejects.toThrow("did not complete within 1ms");
    expect(APP_STORE_CONNECT_REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});
