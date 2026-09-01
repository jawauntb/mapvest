/** Keep opaque installation identifiers out of request-log URLs. */
export function redactPushLogLine(line: string): string {
  return line
    .replace(/(\/v1\/push\/token\/)[^?\s]+/g, "$1[redacted]")
    .replace(/([?&]tokenId=)[^&\s]+/g, "$1[redacted]");
}

export function printRedactedRequestLog(line: string): void {
  console.log(redactPushLogLine(line));
}
