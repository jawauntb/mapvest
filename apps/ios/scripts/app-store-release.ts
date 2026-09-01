import { createPrivateKey, sign } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type AppStoreObservation,
  type AppStoreReleaseAction,
  type AppStoreReleaseLedger,
  AppStoreReleaseMachine,
  type AppStoreReleaseMode,
  parseReviewSubmissionState,
} from "../src/release/appStoreRelease";
import {
  loadReleaseManifest,
  validateRecordedReleaseRequest,
} from "../src/release/releaseManifest";

type JsonApiResource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: JsonApiResource | JsonApiResource[] | null }>;
};

type JsonApiDocument = {
  data: JsonApiResource | JsonApiResource[] | null;
  included?: JsonApiResource[];
  meta?: { paging?: { total?: number; limit?: number } };
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const APP_STORE_CONNECT_REQUEST_TIMEOUT_MS = 30_000;

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function privateKeyFromEnvironment(value: string): string {
  return value.includes("BEGIN PRIVATE KEY")
    ? value.replaceAll("\\n", "\n")
    : Buffer.from(value, "base64").toString("utf8");
}

export function createAppStoreConnectToken(
  credentials: {
    keyId: string;
    issuerId: string;
    privateKey: string;
  } = {
    keyId: requireEnvironment("APP_STORE_CONNECT_KEY_ID"),
    issuerId: requireEnvironment("APP_STORE_CONNECT_ISSUER_ID"),
    privateKey: requireEnvironment("APP_STORE_CONNECT_PRIVATE_KEY"),
  },
  now = Math.floor(Date.now() / 1_000),
): string {
  const privateKey = privateKeyFromEnvironment(credentials.privateKey);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.issuerId,
      iat: now,
      exp: now + 10 * 60,
      aud: "appstoreconnect-v1",
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64Url(signature)}`;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing protected environment value ${name}`);
  }
  return value;
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value, received ${name ?? "end of arguments"}`);
    }
    flags.set(name.slice(2), value);
  }
  return flags;
}

function resource(document: JsonApiDocument, description: string): JsonApiResource {
  if (Array.isArray(document.data) || document.data === null) {
    throw new Error(`App Store Connect returned no exact ${description}`);
  }
  return document.data;
}

function resources(document: JsonApiDocument): JsonApiResource[] {
  return Array.isArray(document.data) ? document.data : document.data ? [document.data] : [];
}

function releaseManifestPath(value: string): string {
  const absolute = resolve(value);
  const releaseRoot = resolve(import.meta.dir, "../release");
  if (
    !absolute.startsWith(`${releaseRoot}/`) ||
    !/^v\d+\.\d+\.\d+\.json$/.test(basename(absolute))
  ) {
    throw new Error("Release manifest path must be apps/ios/release/v<version>.json");
  }
  return absolute;
}

export class AppStoreConnectClient {
  private readonly token?: string;
  private readonly tokenFactory: () => string;
  private readonly fetch: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly baseUrl = "https://api.appstoreconnect.apple.com/v1";

  constructor(
    options: {
      token?: string;
      tokenFactory?: () => string;
      fetch?: FetchLike;
      requestTimeoutMs?: number;
    } = {},
  ) {
    this.token = options.token;
    this.tokenFactory = options.tokenFactory ?? createAppStoreConnectToken;
    this.fetch = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? APP_STORE_CONNECT_REQUEST_TIMEOUT_MS;
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<JsonApiDocument> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.token ?? this.tokenFactory()}`,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new Error(
        `App Store Connect ${options.method ?? "GET"} ${path} did not complete within ${this.requestTimeoutMs}ms`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const requestId = response.headers.get("x-request-id") ?? "unavailable";
      throw new Error(
        `App Store Connect ${options.method ?? "GET"} ${path} failed with ${response.status}; request-id ${requestId}`,
      );
    }
    if (response.status === 204) {
      return { data: null };
    }
    return (await response.json()) as JsonApiDocument;
  }

  async inspect(ledger: AppStoreReleaseLedger): Promise<AppStoreObservation> {
    const identity = ledger.identity;
    const [
      appDocument,
      versionDocument,
      buildDocument,
      attachedDocument,
      localizationDocument,
      reviewDetailDocument,
      submissionDocument,
    ] = await Promise.all([
      this.request(`/apps/${identity.appStoreConnectAppId}?fields[apps]=bundleId`),
      this.request(
        `/appStoreVersions/${identity.appStoreVersionId}?fields[appStoreVersions]=versionString,appVersionState`,
      ),
      this.request(
        `/builds/${identity.ascBuildId}?fields[builds]=version,processingState,expired,app,preReleaseVersion&include=app,preReleaseVersion&fields[apps]=bundleId&fields[preReleaseVersions]=version,platform`,
      ),
      this.request(`/appStoreVersions/${identity.appStoreVersionId}/relationships/build`),
      this.request(
        `/appStoreVersionLocalizations?filter[appStoreVersion]=${encodeURIComponent(identity.appStoreVersionId)}&fields[appStoreVersionLocalizations]=description,keywords,supportUrl,whatsNew&limit=1`,
      ),
      this.request(`/appStoreVersions/${identity.appStoreVersionId}/appStoreReviewDetail`),
      ledger.runtime?.reviewSubmissionId
        ? this.request(
            `/reviewSubmissions/${ledger.runtime.reviewSubmissionId}?fields[reviewSubmissions]=state,platform,items,appStoreVersionForReview&include=items,appStoreVersionForReview&limit[items]=50`,
          )
        : this.request(
            `/apps/${identity.appStoreConnectAppId}/reviewSubmissions?fields[reviewSubmissions]=state,platform,items,appStoreVersionForReview&include=items,appStoreVersionForReview&limit=200&limit[items]=50`,
          ),
    ]);
    const app = resource(appDocument, "app");
    const version = resource(versionDocument, "App Store version");
    const build = resource(buildDocument, "build");
    const buildApp = buildDocument.included?.find((candidate) => candidate.type === "apps");
    const preReleaseVersion = buildDocument.included?.find(
      (candidate) => candidate.type === "preReleaseVersions",
    );
    if (app.attributes?.bundleId !== identity.bundleIdentifier) {
      throw new Error(
        `Bundle identifier mismatch: expected ${identity.bundleIdentifier}, observed ${String(app.attributes?.bundleId)}`,
      );
    }
    if (
      buildApp?.id !== identity.appStoreConnectAppId ||
      buildApp.attributes?.bundleId !== identity.bundleIdentifier
    ) {
      throw new Error("Exact ASC build does not belong to the recorded App Store Connect app");
    }
    if (
      preReleaseVersion?.attributes?.version !== identity.marketingVersion ||
      preReleaseVersion.attributes?.platform !== "IOS"
    ) {
      throw new Error("Exact ASC build does not belong to the recorded iOS marketing version");
    }
    const submissionCandidates = resources(submissionDocument);
    const totalSubmissions = submissionDocument.meta?.paging?.total;
    if (totalSubmissions !== undefined && totalSubmissions > submissionCandidates.length) {
      throw new Error("App Store Connect review submission list was truncated");
    }
    const inspectedSubmissions = submissionCandidates.map((candidate) => {
      const linkedVersion = candidate.relationships?.appStoreVersionForReview?.data;
      const itemVersionId =
        linkedVersion && !Array.isArray(linkedVersion) ? linkedVersion.id : null;
      const linkedItems = candidate.relationships?.items?.data;
      const itemIds = Array.isArray(linkedItems) ? linkedItems.map((item) => item.id) : [];
      return { candidate, itemIds, itemVersionId };
    });
    const exactSubmissions = inspectedSubmissions.filter(
      ({ itemVersionId }) => itemVersionId === identity.appStoreVersionId,
    );
    if (exactSubmissions.length > 1) {
      throw new Error(
        `Multiple reviewSubmissions target the exact App Store version: ${exactSubmissions.map(({ candidate }) => candidate.id).join(", ")}`,
      );
    }
    const readyDrafts = inspectedSubmissions.filter(
      ({ candidate, itemIds, itemVersionId }) =>
        candidate.attributes?.state === "READY_FOR_REVIEW" &&
        itemVersionId === null &&
        itemIds.length === 0 &&
        (candidate.attributes?.platform === "IOS" || candidate.attributes?.platform == null),
    );
    if (exactSubmissions.length === 0 && readyDrafts.length > 1) {
      throw new Error(
        `Multiple iOS READY_FOR_REVIEW submissions require operator resolution: ${readyDrafts.map(({ candidate }) => candidate.id).join(", ")}`,
      );
    }
    const selectedSubmission = exactSubmissions[0] ?? readyDrafts[0];
    const conflictingActiveVersion = inspectedSubmissions.find(
      ({ candidate, itemVersionId }) =>
        itemVersionId !== null &&
        itemVersionId !== identity.appStoreVersionId &&
        ["WAITING_FOR_REVIEW", "IN_REVIEW", "COMPLETING"].includes(
          String(candidate.attributes?.state),
        ),
    );
    if (conflictingActiveVersion) {
      throw new Error(
        `Another App Store version is already active in review submission ${conflictingActiveVersion.candidate.id}`,
      );
    }
    const submission = selectedSubmission?.candidate;
    let reviewSubmission: AppStoreObservation["reviewSubmission"] = null;
    if (submission) {
      reviewSubmission = {
        id: submission.id,
        state: parseReviewSubmissionState(submission.attributes?.state),
        itemVersionId: selectedSubmission?.itemVersionId ?? null,
      };
    }
    const localization = resources(localizationDocument)[0];
    const reviewDetail = resources(reviewDetailDocument)[0];
    const reviewDetailsPresent =
      Boolean(reviewDetail?.attributes?.contactEmail) &&
      Boolean(reviewDetail?.attributes?.notes) &&
      (reviewDetail?.attributes?.demoAccountRequired !== true ||
        (Boolean(reviewDetail.attributes?.demoAccountName) &&
          Boolean(reviewDetail.attributes?.demoAccountPassword)));
    const metadataComplete =
      reviewDetailsPresent &&
      Boolean(localization?.attributes?.description) &&
      Boolean(localization?.attributes?.keywords) &&
      Boolean(localization?.attributes?.supportUrl) &&
      Boolean(localization?.attributes?.whatsNew) &&
      Boolean(ledger.evidence.app_store_metadata_audit) &&
      Boolean(ledger.evidence.app_privacy_audit) &&
      Boolean(ledger.evidence.reviewer_access) &&
      Boolean(ledger.evidence.subscription_review);
    return {
      appId: app.id,
      appStoreVersionId: version.id,
      marketingVersion: String(version.attributes?.versionString ?? ""),
      ascBuildId: build.id,
      buildNumber: String(build.attributes?.version ?? ""),
      buildProcessingState: String(build.attributes?.processingState ?? ""),
      buildExpired: build.attributes?.expired === true,
      attachedBuildId:
        attachedDocument.data === null ? null : resource(attachedDocument, "attached build").id,
      metadataComplete,
      agreementsValid: process.env.MAPVEST_ASC_AGREEMENTS_CONFIRMED === "true",
      testFlightEvidenceComplete: Boolean(
        ledger.evidence.testflight_distribution && ledger.evidence.physical_device_checklist,
      ),
      reviewSubmission,
      storefrontState: String(version.attributes?.appVersionState ?? ""),
    };
  }

  async resolveReleaseIdentity(input: {
    appId: string;
    bundleIdentifier: string;
    marketingVersion: string;
    buildNumber: string;
  }): Promise<{ ascBuildId: string; appStoreVersionId: string }> {
    const [versionsDocument, buildsDocument] = await Promise.all([
      this.request(
        `/apps/${input.appId}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(input.marketingVersion)}&fields[appStoreVersions]=versionString,platform&limit=2`,
      ),
      this.request(
        `/builds?filter[app]=${encodeURIComponent(input.appId)}&filter[version]=${encodeURIComponent(input.buildNumber)}&fields[builds]=version,processingState,expired,app,preReleaseVersion&include=app,preReleaseVersion&fields[apps]=bundleId&fields[preReleaseVersions]=version,platform&limit=200`,
      ),
    ]);
    const versions = resources(versionsDocument).filter(
      (candidate) =>
        candidate.attributes?.versionString === input.marketingVersion &&
        candidate.attributes?.platform === "IOS",
    );
    if (versions.length !== 1) {
      throw new Error(
        `Expected one iOS App Store version for ${input.marketingVersion}, observed ${versions.length}`,
      );
    }
    const buildApp = buildsDocument.included?.find(
      (candidate) => candidate.type === "apps" && candidate.id === input.appId,
    );
    if (buildApp?.attributes?.bundleId !== input.bundleIdentifier) {
      throw new Error("Resolved ASC build app does not match the release bundle identifier");
    }
    const preReleaseVersions = new Map(
      (buildsDocument.included ?? [])
        .filter((candidate) => candidate.type === "preReleaseVersions")
        .map((candidate) => [candidate.id, candidate]),
    );
    const builds = resources(buildsDocument).filter((candidate) => {
      const relationship = candidate.relationships?.preReleaseVersion?.data;
      const preRelease =
        relationship && !Array.isArray(relationship)
          ? preReleaseVersions.get(relationship.id)
          : undefined;
      return (
        candidate.attributes?.version === input.buildNumber &&
        candidate.attributes?.processingState === "VALID" &&
        candidate.attributes?.expired !== true &&
        preRelease?.attributes?.version === input.marketingVersion &&
        preRelease.attributes?.platform === "IOS"
      );
    });
    if (builds.length !== 1) {
      throw new Error(
        `Expected one valid ASC build ${input.marketingVersion} (${input.buildNumber}), observed ${builds.length}`,
      );
    }
    return { ascBuildId: builds[0]!.id, appStoreVersionId: versions[0]!.id };
  }

  async mutate(action: AppStoreReleaseAction): Promise<void> {
    if (action.kind === "attach_build") {
      await this.request(`/appStoreVersions/${action.appStoreVersionId}/relationships/build`, {
        method: "PATCH",
        body: { data: { type: "builds", id: action.ascBuildId } },
      });
      return;
    }
    if (action.kind === "create_review_submission") {
      await this.request("/reviewSubmissions", {
        method: "POST",
        body: {
          data: {
            type: "reviewSubmissions",
            relationships: { app: { data: { type: "apps", id: action.appId } } },
          },
        },
      });
      return;
    }
    if (action.kind === "create_review_submission_item") {
      if (action.reviewSubmissionId === "pending-review-submission") {
        throw new Error("Review submission must be re-read before creating its item");
      }
      await this.request("/reviewSubmissionItems", {
        method: "POST",
        body: {
          data: {
            type: "reviewSubmissionItems",
            relationships: {
              reviewSubmission: {
                data: { type: "reviewSubmissions", id: action.reviewSubmissionId },
              },
              appStoreVersion: {
                data: { type: "appStoreVersions", id: action.appStoreVersionId },
              },
            },
          },
        },
      });
      return;
    }
    if (action.kind === "submit_review") {
      if (action.reviewSubmissionId === "pending-review-submission") {
        throw new Error("Review submission must be re-read before submission");
      }
      await this.request(`/reviewSubmissions/${action.reviewSubmissionId}`, {
        method: "PATCH",
        body: {
          data: {
            type: "reviewSubmissions",
            id: action.reviewSubmissionId,
            attributes: { submitted: true },
          },
        },
      });
      return;
    }
    await this.request("/appStoreVersionReleaseRequests", {
      method: "POST",
      body: {
        data: {
          type: "appStoreVersionReleaseRequests",
          relationships: {
            appStoreVersion: {
              data: { type: "appStoreVersions", id: action.appStoreVersionId },
            },
          },
        },
      },
    });
  }
}

async function loadAndValidate(flags: Map<string, string>): Promise<{
  ledger: AppStoreReleaseLedger;
  ledgerPath: string;
}> {
  const ledgerPath = resolve(requiredFlag(flags, "ledger"));
  if (basename(ledgerPath) !== "release-ledger.json") {
    throw new Error("Runtime release ledger file must be named release-ledger.json");
  }
  const [manifest, ledgerText] = await Promise.all([
    loadReleaseManifest(releaseManifestPath(requiredFlag(flags, "manifest"))),
    readFile(ledgerPath, "utf8"),
  ]);
  const ledger = JSON.parse(ledgerText) as AppStoreReleaseLedger;
  const request = validateRecordedReleaseRequest({
    manifest,
    manifestHash: requiredFlag(flags, "manifest-hash"),
    sourceCommitSha: requiredFlag(flags, "source-sha"),
  });
  if (ledger.schemaVersion !== 1) {
    throw new Error("Runtime release ledger schemaVersion must be 1");
  }
  if (
    ledger.manifestHash !== request.manifestHash ||
    ledger.sourceCommitSha !== request.sourceCommitSha
  ) {
    throw new Error("Runtime release ledger is not bound to this manifest and source SHA");
  }
  if (
    ledger.identity.bundleIdentifier !== manifest.identity.bundleIdentifier ||
    ledger.identity.appStoreConnectAppId !== manifest.identity.appStoreConnectAppId ||
    ledger.identity.marketingVersion !== manifest.identity.marketingVersion
  ) {
    throw new Error("Runtime release ledger identity does not match the static manifest");
  }
  if (!Array.isArray(ledger.history) || typeof ledger.evidence !== "object" || !ledger.evidence) {
    throw new Error("Runtime release ledger history and evidence are required");
  }
  for (const evidenceId of manifest.evidence.required) {
    const reference = ledger.evidence[evidenceId];
    if (typeof reference !== "string" || reference.trim().length === 0) {
      throw new Error(`Runtime release ledger is missing evidence ${evidenceId}`);
    }
  }
  return { ledger, ledgerPath };
}

async function writeLedger(
  ledgerPath: string,
  ledger: AppStoreReleaseLedger,
  state: string,
  observation?: AppStoreObservation,
): Promise<void> {
  const now = new Date().toISOString();
  const detail = observation?.reviewSubmission?.id;
  const previous = ledger.history.at(-1);
  if (previous?.state !== state || previous.detail !== detail) {
    ledger.history.push({ at: now, state, detail });
    ledger.history = ledger.history.slice(-100);
  }
  ledger.runtime = {
    reviewSubmissionId: observation?.reviewSubmission?.id,
    observedState: state,
    updatedAt: now,
  };
  const temporary = `${ledgerPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, ledgerPath);
}

async function main(): Promise<void> {
  const flags = parseFlags(Bun.argv.slice(2));
  const { ledger, ledgerPath } = await loadAndValidate(flags);
  if (flags.get("offline") === "true") {
    console.log(
      JSON.stringify({
        state: "offline_preflight_validated",
        manifestHash: ledger.manifestHash,
        sourceCommitSha: ledger.sourceCommitSha,
        identity: ledger.identity,
      }),
    );
    return;
  }
  const mode = requiredFlag(flags, "mode") as AppStoreReleaseMode;
  if (!(["dry-run", "submit", "release"] as string[]).includes(mode)) {
    throw new Error(`Unsupported App Store release mode: ${mode}`);
  }
  const client = new AppStoreConnectClient();
  const machine = new AppStoreReleaseMachine({
    inspect: (candidate) => client.inspect(candidate),
    mutate: (action) => client.mutate(action),
    onTransition: (state, observation) => writeLedger(ledgerPath, ledger, state, observation),
  });
  const result = await machine.run(mode, ledger);
  await writeLedger(ledgerPath, ledger, result.state, result.observation);
  console.log(
    JSON.stringify({
      state: result.state,
      manifestHash: ledger.manifestHash,
      sourceCommitSha: ledger.sourceCommitSha,
      identity: ledger.identity,
      reviewSubmissionId: result.observation.reviewSubmission?.id,
      plannedActions: result.plannedActions.map((action) => action.kind),
    }),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
