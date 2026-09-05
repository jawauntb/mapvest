import {
  SITUATE_EXPORT_MIME,
  SITUATE_EXPORT_UTI,
  type SituateExportFormat,
  situateExportFilename,
  situateExportUrl,
} from "@/api/situate";
import { getDeviceId } from "@/util/deviceId";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Share } from "react-native";

/**
 * Download a packet export and hand it to the native share sheet.
 *
 * `expo-sharing` only accepts file URIs, so the bytes have to land on disk
 * first — the same shape as the Prism sibling, including the device-id header
 * so an anonymous caller is still recognised. The cache directory is the right
 * home: these are disposable research artifacts.
 */
export async function shareSituateExport(
  ticker: string,
  format: SituateExportFormat,
  token?: string,
): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("Export storage is unavailable.");
  const headers: Record<string, string> = { Accept: SITUATE_EXPORT_MIME[format] };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    headers["X-Device-Id"] = await getDeviceId();
  } catch {
    /* Signed-in requests are still authorized without a device id. */
  }
  const destination = `${FileSystem.cacheDirectory}${situateExportFilename(ticker, format)}`;
  const result = await FileSystem.downloadAsync(situateExportUrl(ticker, format), destination, {
    headers,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Export failed (${result.status}).`);
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(result.uri, {
      mimeType: SITUATE_EXPORT_MIME[format],
      UTI: SITUATE_EXPORT_UTI[format],
      dialogTitle: `Share ${ticker} Situate packet`,
    });
    return;
  }
  await Share.share({ url: result.uri });
}
