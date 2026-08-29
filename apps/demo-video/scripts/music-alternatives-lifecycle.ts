import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const RENAME_EXCL = 0x0000_0004;

export type DestinationLock = { path: string; token: string };

export type MusicAlternativesPublication = {
  preflight: (parentDirectory: string) => Promise<void>;
  publish: (stagingDirectory: string, outputDirectory: string) => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const inertPath = (path: string) => JSON.stringify(path);

export const pathExists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

export const assertDestinationAvailable = async (outputDirectory: string) => {
  if (await pathExists(outputDirectory)) {
    throw new Error(
      `Music alternatives destination already exists and is immutable: ${inertPath(outputDirectory)}`,
    );
  }
};

const darwinRenameDirectoryExclusive = async (
  sourceDirectory: string,
  destinationDirectory: string,
) => {
  const { FFIType, dlopen, ptr } = await import("bun:ffi");
  const system = dlopen("/usr/lib/libSystem.B.dylib", {
    renamex_np: {
      args: [FFIType.cstring, FFIType.cstring, FFIType.u32],
      returns: FFIType.i32,
    },
  });
  const source = Buffer.from(`${sourceDirectory}\0`);
  const destination = Buffer.from(`${destinationDirectory}\0`);
  let result: number;
  try {
    result = system.symbols.renamex_np(ptr(source), ptr(destination), RENAME_EXCL);
  } finally {
    system.close();
  }
  if (result === 0) return;
  if (await pathExists(destinationDirectory)) {
    throw new Error(
      `Music alternatives destination already exists and is immutable: ${inertPath(destinationDirectory)}`,
    );
  }
  throw new Error(
    `Exclusive music alternatives directory rename failed: ${inertPath(sourceDirectory)} -> ${inertPath(destinationDirectory)}`,
  );
};

export const createMusicAlternativesPublication = (
  platform: string = process.platform,
  renameExclusive: (
    sourceDirectory: string,
    destinationDirectory: string,
  ) => Promise<void> = darwinRenameDirectoryExclusive,
): MusicAlternativesPublication => ({
  preflight: async (parentDirectory) => {
    if (platform !== "darwin") {
      throw new Error(
        `Music alternatives generation is supported only on macOS; received platform ${JSON.stringify(platform)}. No paid request was made.`,
      );
    }
    const token = randomUUID();
    const source = join(parentDirectory, `.mapvest-publication-preflight-source-${token}`);
    const destination = join(
      parentDirectory,
      `.mapvest-publication-preflight-destination-${token}`,
    );
    await Promise.all([mkdir(source), mkdir(destination)]);
    try {
      let refusedExistingDestination = false;
      try {
        await renameExclusive(source, destination);
      } catch (error) {
        if (error instanceof Error && error.message.includes("already exists and is immutable")) {
          refusedExistingDestination = true;
        } else {
          throw error;
        }
      }
      if (!refusedExistingDestination) {
        throw new Error("Exclusive publication preflight replaced an existing directory.");
      }
      await rm(destination, { recursive: true, force: false });
      await renameExclusive(source, destination);
      if ((await pathExists(source)) || !(await pathExists(destination))) {
        throw new Error("Exclusive publication preflight did not complete its test rename.");
      }
    } finally {
      await Promise.all([
        rm(source, { recursive: true, force: true }),
        rm(destination, { recursive: true, force: true }),
      ]);
    }
  },
  publish: async (stagingDirectory, outputDirectory) => {
    if (platform !== "darwin") {
      throw new Error(
        `Music alternatives publication is supported only on macOS; received platform ${JSON.stringify(platform)}.`,
      );
    }
    await renameExclusive(stagingDirectory, outputDirectory);
  },
});

export const defaultMusicAlternativesPublication = createMusicAlternativesPublication();

export const acquireDestinationLock = async (
  outputDirectory: string,
  onAcquired?: (lock: DestinationLock) => void,
): Promise<DestinationLock> => {
  const lockPath = join(dirname(outputDirectory), `.${basename(outputDirectory)}.lock`);
  const token = randomUUID();
  try {
    await mkdir(lockPath, { recursive: false });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(
        `Music alternatives destination is locked. No generation was started. Lock directory (inert JSON): ${inertPath(lockPath)}. Confirm no generation process is running before removing that exact directory with trusted filesystem tooling.`,
      );
    }
    throw error;
  }
  const lock = { path: lockPath, token };
  onAcquired?.(lock);
  try {
    await writeFile(
      join(lockPath, "owner.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          pid: process.pid,
          token,
          createdAt: new Date().toISOString(),
          destination: outputDirectory,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
  return lock;
};

export const releaseDestinationLock = async (lock: DestinationLock) => {
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(join(lock.path, "owner.json"), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      if (!(await pathExists(lock.path))) return;
      throw new Error(`Destination lock ownership record is missing: ${inertPath(lock.path)}`);
    }
    throw error;
  }
  if (!isRecord(owner) || owner.token !== lock.token) {
    throw new Error(
      `Destination lock ownership changed; refusing to remove ${inertPath(lock.path)}.`,
    );
  }
  await rm(lock.path, { recursive: true, force: false });
};

export const quarantineFailedRun = async (stagingDirectory: string, outputDirectory: string) => {
  const failedDirectory = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.failed-${randomUUID()}`,
  );
  await rename(stagingDirectory, failedDirectory);
  return failedDirectory;
};
