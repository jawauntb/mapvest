import {
  PRISM_EXPORT_MIME,
  PRISM_EXPORT_UTI,
  type PrismExportFormat,
  prismExportFilename,
  prismExportUrl,
} from "@/api/prism";
import { getDeviceId } from "@/util/deviceId";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

/**
 * Download a packet export and hand it to the native share sheet.
 *
 * `expo-sharing` only accepts file URIs, so the bytes have to land on disk
 * first — the same shape as `util/share.ts::shareResearchMemo`, including the
 * device-id header so an anonymous caller is still recognised. The cache
 * directory is the right home: these are disposable research artifacts, not
 * documents we are keeping for the user.
 */
export async function sharePrismExport(
  ticker: string,
  format: PrismExportFormat,
  token?: string,
): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("Export storage is unavailable.");
  const headers: Record<string, string> = { Accept: PRISM_EXPORT_MIME[format] };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    headers["X-Device-Id"] = await getDeviceId();
  } catch {
    /* Signed-in requests are still authorized without a device id. */
  }
  const destination = `${FileSystem.cacheDirectory}${prismExportFilename(ticker, format)}`;
  const result = await FileSystem.downloadAsync(prismExportUrl(ticker, format), destination, {
    headers,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Export failed (${result.status}).`);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, {
      mimeType: PRISM_EXPORT_MIME[format],
      UTI: PRISM_EXPORT_UTI[format],
      dialogTitle: `Share ${ticker} Prism packet`,
    });
    return;
  }
  await Share.share({ url: result.uri });
}
