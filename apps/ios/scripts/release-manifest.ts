import { basename, resolve } from "node:path";
import {
  type ReleaseCopySurface,
  createReleaseLedger,
  loadReleaseManifest,
  renderReleaseCopy,
  validateReleaseRequest,
} from "../src/release/releaseManifest";

function required(value: string | undefined, description: string): string {
  if (!value) {
    throw new Error(`Missing ${description}`);
  }
  return value;
}

function assertManifestPath(path: string): string {
  const absolute = resolve(path);
  const releaseRoot = resolve(import.meta.dir, "../release");
  if (
    !absolute.startsWith(`${releaseRoot}/`) ||
    !/^v\d+\.\d+\.\d+\.json$/.test(basename(absolute))
  ) {
    throw new Error("Release manifest path must be apps/ios/release/v<version>.json");
  }
  return absolute;
}

async function main(args: string[]): Promise<void> {
  const command = required(args[0], "command");
  const manifestPath = assertManifestPath(required(args[1], "release manifest path"));
  const manifest = await loadReleaseManifest(manifestPath);

  if (command === "validate") {
    console.log(manifest.contentHash);
    return;
  }
  if (command === "render") {
    const surface = required(args[2], "copy surface") as ReleaseCopySurface;
    if (
      !(["testflight", "beta-review", "app-store-whats-new", "app-review"] as string[]).includes(
        surface,
      )
    ) {
      throw new Error(`Unknown release copy surface: ${surface}`);
    }
    process.stdout.write(renderReleaseCopy(manifest, surface));
    return;
  }
  if (command === "validate-request") {
    const request = validateReleaseRequest({
      manifest,
      manifestHash: required(args[2], "manifest hash"),
      sourceCommitSha: required(args[3], "source commit SHA"),
      currentMainSha: required(args[4], "current main SHA"),
    });
    console.log(
      JSON.stringify({
        manifestId: request.manifest.manifestId,
        manifestHash: request.manifestHash,
        sourceCommitSha: request.sourceCommitSha,
      }),
    );
    return;
  }
  if (command === "create-ledger") {
    const request = validateReleaseRequest({
      manifest,
      manifestHash: required(args[2], "manifest hash"),
      sourceCommitSha: required(args[3], "source commit SHA"),
      currentMainSha: required(args[4], "current main SHA"),
    });
    const ledger = createReleaseLedger(request, {
      buildNumber: required(args[5], "build number"),
      easBuildId: required(args[6], "EAS build ID"),
      ascBuildId: required(args[7], "ASC build ID"),
      appStoreVersionId: required(args[8], "App Store version ID"),
    });
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }
  throw new Error(`Unknown release manifest command: ${command}`);
}

if (import.meta.main) {
  try {
    await main(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
