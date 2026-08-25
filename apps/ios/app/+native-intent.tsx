import { redirectMapvestWebPath } from "@/util/shareLinks";

/** Keep recipient-facing web links aligned with the native detail route. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return redirectMapvestWebPath(path);
}
