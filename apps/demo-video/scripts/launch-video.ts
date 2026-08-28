import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  COMPOSITION_VARIANTS,
  FPS,
  LAUNCH_STORYBOARD,
  TOTAL_DURATION_IN_FRAMES,
} from "../src/storyboard";
import {
  RENDER_MANIFEST_FILENAME,
  assertLaunchInputsUnchanged,
  collectLaunchInputSnapshot,
  createRenderManifest,
  sha256File,
  validatePreparedLaunchAssets,
} from "./launch-integrity";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "out");
const REMOTION = join(ROOT, "node_modules", ".bin", "remotion");
const command = process.argv[2] ?? "plan";

const run = (args: string[]) => {
  const result = Bun.spawnSync(args, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${args[0]} exited ${result.exitCode}`);
};

const printPlan = () => {
  console.log(`# Mapvest launch video · ${TOTAL_DURATION_IN_FRAMES / FPS}s · ${FPS} fps\n`);
  for (const scene of LAUNCH_STORYBOARD) {
    const start = (scene.startFrame / FPS).toFixed(1);
    const end = (scene.endFrame / FPS).toFixed(1);
    console.log(
      `${start}-${end}s  ${scene.id.padEnd(12)}  ${scene.copy.headline} ${scene.copy.accent}`,
    );
    console.log(`             ${scene.copy.body}`);
    console.log(`             asset: public/${scene.asset}\n`);
  }
  console.log("Capture anchors (development client only):");
  console.log("- mapvest://map (set public location to Flatiron: 40.7411,-73.9897; hide Finds)");
  console.log("- mapvest://home?demoSection=local");
  console.log("- mapvest://universe");
  console.log("- mapvest://home?demoSection=daily");
  console.log(
    "- Never retain or commit the account drawer, email, Photos picker, or full history.\n",
  );
  console.log("Delivery variants:");
  for (const variant of COMPOSITION_VARIANTS) {
    console.log(
      `- ${variant.id}: ${variant.width}x${variant.height}, ${variant.soundtrack} -> out/${variant.outputFilename}`,
    );
  }
};

const publishCompletedRenderSet = async (stagingDir: string) => {
  const artifacts = [
    ...COMPOSITION_VARIANTS.map(({ outputFilename }) => outputFilename),
    RENDER_MANIFEST_FILENAME,
  ];
  const backupDir = await mkdtemp(join(OUT_DIR, ".launch-backup-"));
  const backedUp = [] as string[];
  const published = [] as string[];

  try {
    for (const artifact of artifacts) {
      const target = join(OUT_DIR, artifact);
      if (await Bun.file(target).exists()) {
        await rename(target, join(backupDir, artifact));
        backedUp.push(artifact);
      }
    }
    for (const artifact of artifacts) {
      await rename(join(stagingDir, artifact), join(OUT_DIR, artifact));
      published.push(artifact);
    }
  } catch (error) {
    for (const artifact of published.reverse()) {
      await rm(join(OUT_DIR, artifact), { force: true });
    }
    for (const artifact of backedUp.reverse()) {
      await rename(join(backupDir, artifact), join(OUT_DIR, artifact));
    }
    throw error;
  } finally {
    await rm(backupDir, { force: true, recursive: true });
  }
};

const renderAll = async () => {
  await validatePreparedLaunchAssets(ROOT);
  const inputsBeforeRender = await collectLaunchInputSnapshot(ROOT);
  await mkdir(OUT_DIR, { recursive: true });
  const stagingDir = await mkdtemp(join(OUT_DIR, ".launch-render-"));
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID()}`;

  try {
    for (const variant of COMPOSITION_VARIANTS) {
      console.log(`\nRendering ${variant.id} into run ${runId}...`);
      const args = [
        REMOTION,
        "render",
        "src/index.ts",
        variant.id,
        join(stagingDir, variant.outputFilename),
        "--codec=h264",
        "--crf=18",
        "--concurrency=4",
        "--color-space=bt709",
      ];
      args.push(variant.soundtrack === "music" ? "--audio-codec=aac" : "--muted");
      run(args);
    }

    await validatePreparedLaunchAssets(ROOT);
    const inputsAfterRender = await collectLaunchInputSnapshot(ROOT);
    assertLaunchInputsUnchanged(inputsBeforeRender, inputsAfterRender);
    const renders = await Promise.all(
      COMPOSITION_VARIANTS.map(async ({ id, outputFilename }) => ({
        id,
        file: outputFilename,
        sha256: await sha256File(join(stagingDir, outputFilename)),
      })),
    );
    const manifest = createRenderManifest(
      runId,
      new Date().toISOString(),
      inputsAfterRender,
      renders,
    );
    await Bun.write(
      join(stagingDir, RENDER_MANIFEST_FILENAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await publishCompletedRenderSet(stagingDir);
    console.log(`\nPublished complete launch render run ${runId}.`);
    console.log(`Manifest: ${join(OUT_DIR, RENDER_MANIFEST_FILENAME)}`);
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
};

const main = async () => {
  switch (command) {
    case "plan":
      printPlan();
      break;
    case "prepare":
      run(["bun", join("scripts", "prepare-launch-assets.ts"), ...process.argv.slice(3)]);
      break;
    case "music":
      run(["bun", join("scripts", "generate-music.ts"), ...process.argv.slice(3)]);
      break;
    case "render":
      await renderAll();
      break;
    case "verify":
      run(["bun", join("scripts", "verify-launch.ts")]);
      break;
    case "all":
      await renderAll();
      run(["bun", join("scripts", "verify-launch.ts")]);
      break;
    default:
      throw new Error(
        `Unknown command: ${command}. Use plan, prepare, music, render, verify, or all.`,
      );
  }
};

await main();
