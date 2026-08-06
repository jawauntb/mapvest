import type { CameraView } from "expo-camera";

export type CapturedStill = {
  uri: string;
  width?: number;
  height?: number;
};

const SETTLE_MS = 280;
const RETRY_DELAYS_MS = [0, 350, 700];

/** Minimal options — skip shutterSound/mode extras that race AVFoundation on iOS. */
const PICTURE_OPTS = {
  quality: 0.55,
  exif: false,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait after onCameraReady before the first shutter.
 * Fresh sessions often reject takePictureAsync for a few hundred ms.
 */
export async function waitForCameraSettle(
  readySince: number | null,
  minMs = SETTLE_MS,
): Promise<void> {
  if (readySince == null) return;
  const elapsed = Date.now() - readySince;
  if (elapsed < minMs) await sleep(minMs - elapsed);
}

/**
 * Capture a still with short retries. Surfaces the last native error if all fail.
 */
export async function captureStill(
  camera: CameraView,
  opts?: { readySince?: number | null },
): Promise<CapturedStill> {
  await waitForCameraSettle(opts?.readySince ?? null);

  let lastErr: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      const photo = await camera.takePictureAsync(PICTURE_OPTS);
      if (photo?.uri) {
        return { uri: photo.uri, width: photo.width, height: photo.height };
      }
      lastErr = new Error("No photo captured.");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(typeof lastErr === "string" ? lastErr : "Image could not be captured");
}
