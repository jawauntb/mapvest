import { afterEach, describe, expect, test } from "bun:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  DEFAULT_PREPARED_ASSETS,
  type PreparedAsset,
  parsePrepareArguments,
  prepareLaunchAssets,
} from "./prepare-launch-assets";

const TEST_WIDTH = 96;
const TEST_HEIGHT = 160;
const TEST_MASK_Y = 80;
const TEST_DURATION_SECONDS = 3 / 30;

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const makeWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "mapvest-launch-prepare-"));
  tempDirectories.push(root);
  const captureDir = join(root, "captures");
  const publicDir = join(root, "public");
  await Promise.all([
    mkdir(captureDir, { recursive: true }),
    mkdir(join(publicDir, "provenance"), { recursive: true }),
  ]);
  return { captureDir, publicDir };
};

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout;
};

const createScreenshot = (path: string) => {
  run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0xdc143c:s=${TEST_WIDTH}x${TEST_HEIGHT}`,
    "-vf",
    `drawbox=x=0:y=${TEST_MASK_Y}:w=iw:h=ih-${TEST_MASK_Y}:color=0x00ff00:t=fill`,
    "-frames:v",
    "1",
    path,
  ]);
};

const createVideo = (path: string, durationSeconds: number) => {
  run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x3366ff:s=${TEST_WIDTH}x${TEST_HEIGHT}:r=30:d=${durationSeconds}`,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
};

const samplePixel = (path: string, x: number, y: number) => {
  const raw = run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    `crop=2:2:${x}:${y},format=rgb24`,
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  return [raw[0] ?? 0, raw[1] ?? 0, raw[2] ?? 0] as const;
};

const fixtureAssets = (...scenes: PreparedAsset["scene"][]) =>
  scenes.map((scene) => {
    const asset = DEFAULT_PREPARED_ASSETS.find((candidate) => candidate.scene === scene);
    if (!asset) throw new Error(`Missing fixture asset: ${scene}`);
    return asset;
  });

const fixtureOptions = (captureDir: string, publicDir: string) => ({
  captureDir,
  publicDir,
  assets: fixtureAssets("local-brief", "universe"),
  contract: {
    width: TEST_WIDTH,
    height: TEST_HEIGHT,
    fps: 30,
    universePrivacyMaskY: TEST_MASK_Y,
  },
  durationSecondsForScene: () => TEST_DURATION_SECONDS,
});

describe("prepareLaunchAssets", () => {
  test("physically removes protected Universe pixels from decoded output", async () => {
    const { captureDir, publicDir } = await makeWorkspace();
    const fixture = join(captureDir, "fixture.png");
    createScreenshot(fixture);
    await Promise.all([
      copyFile(fixture, join(captureDir, "local-brief-raw.png")),
      copyFile(fixture, join(captureDir, "universe-raw.png")),
    ]);

    await prepareLaunchAssets(fixtureOptions(captureDir, publicDir));

    const universePath = join(publicDir, "universe.mp4");
    const universeUpper = samplePixel(universePath, 48, 40);
    const universeLower = samplePixel(universePath, 48, 140);
    const localBriefLower = samplePixel(join(publicDir, "local-economy-brief.mp4"), 48, 140);

    expect(universeUpper[0]).toBeGreaterThan(150);
    expect(universeUpper[1]).toBeLessThan(80);
    expect(universeUpper[2]).toBeLessThan(80);
    expect(Math.max(...universeLower)).toBeLessThan(35);
    expect(localBriefLower[1]).toBeGreaterThan(150);
    expect(localBriefLower[0]).toBeLessThan(80);
    expect(localBriefLower[2]).toBeLessThan(80);

    const provenance = JSON.parse(
      await readFile(join(publicDir, "provenance", "launch-captures.json"), "utf8"),
    ) as {
      outputs: Array<{
        scene: PreparedAsset["scene"];
        durationSeconds: number;
        privacyTreatment: string;
      }>;
    };
    for (const output of provenance.outputs) {
      expect(Math.abs(output.durationSeconds - TEST_DURATION_SECONDS)).toBeLessThanOrEqual(1 / 30);
    }
    expect(
      provenance.outputs.find(({ scene }) => scene === "universe")?.privacyTreatment,
    ).toContain("physical pixel mask");
  });

  test("rejects a source video shorter than its storyboard scene", async () => {
    const { captureDir, publicDir } = await makeWorkspace();
    createVideo(join(captureDir, "map-raw.mp4"), 2 / 30);

    await expect(
      prepareLaunchAssets({
        captureDir,
        publicDir,
        assets: fixtureAssets("map"),
        contract: {
          width: TEST_WIDTH,
          height: TEST_HEIGHT,
          fps: 30,
          universePrivacyMaskY: TEST_MASK_Y,
        },
        durationSecondsForScene: () => 4 / 30,
      }),
    ).rejects.toThrow("shorter than its storyboard scene");
    expect(await Bun.file(join(publicDir, "map-nearby.mp4")).exists()).toBe(false);
  });

  test("keeps the accepted generation unchanged when staging a later asset fails", async () => {
    const { captureDir, publicDir } = await makeWorkspace();
    createScreenshot(join(captureDir, "local-brief-raw.png"));
    createVideo(join(captureDir, "map-raw.mp4"), 2 / 30);
    const prior = await seedAcceptedSet(publicDir);

    await expect(
      prepareLaunchAssets({
        captureDir,
        publicDir,
        force: true,
        assets: fixtureAssets("local-brief", "map"),
        contract: {
          width: TEST_WIDTH,
          height: TEST_HEIGHT,
          fps: 30,
          universePrivacyMaskY: TEST_MASK_Y,
        },
        durationSecondsForScene: () => 4 / 30,
      }),
    ).rejects.toThrow("shorter than its storyboard scene");

    await expectAcceptedSet(publicDir, prior);
  });

  test("rolls back every accepted file when promotion fails mid-transaction", async () => {
    const { captureDir, publicDir } = await makeWorkspace();
    const fixture = join(captureDir, "fixture.png");
    createScreenshot(fixture);
    await Promise.all([
      copyFile(fixture, join(captureDir, "local-brief-raw.png")),
      copyFile(fixture, join(captureDir, "universe-raw.png")),
    ]);
    const prior = await seedAcceptedSet(publicDir);

    let injected = false;
    const renamePath = async (from: string, to: string) => {
      if (!injected && from.includes(".launch-assets-stage-") && basename(to) === "universe.mp4") {
        injected = true;
        throw new Error("injected promotion failure");
      }
      await rename(from, to);
    };

    await expect(
      prepareLaunchAssets({
        ...fixtureOptions(captureDir, publicDir),
        force: true,
        renamePath,
      }),
    ).rejects.toThrow("injected promotion failure");

    expect(injected).toBe(true);
    await expectAcceptedSet(publicDir, prior);
    expect((await readdir(publicDir)).some((name) => name.startsWith(".launch-assets-"))).toBe(
      false,
    );
  });
});

test("--capture-dir requires a value", () => {
  expect(() => parsePrepareArguments(["--capture-dir"])).toThrow("--capture-dir requires a value");
  expect(() => parsePrepareArguments(["--capture-dir", "--force"])).toThrow(
    "--capture-dir requires a value",
  );
});

const seedAcceptedSet = async (publicDir: string) => {
  const prior = {
    "local-economy-brief.mp4": "accepted local brief",
    "map-nearby.mp4": "accepted map",
    "universe.mp4": "accepted universe",
    "provenance/launch-captures.json": "accepted provenance",
  } as const;
  await Promise.all(
    Object.entries(prior).map(async ([relativePath, contents]) => {
      const path = join(publicDir, relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, contents);
    }),
  );
  return prior;
};

const expectAcceptedSet = async (
  publicDir: string,
  prior: Awaited<ReturnType<typeof seedAcceptedSet>>,
) => {
  for (const [relativePath, contents] of Object.entries(prior)) {
    expect(await readFile(join(publicDir, relativePath), "utf8")).toBe(contents);
  }
};
