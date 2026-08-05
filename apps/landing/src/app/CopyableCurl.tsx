"use client";

import { useState } from "react";

/**
 * A single API-playground row: a labeled endpoint, a copyable <pre> with
 * the curl command, and a small Copy button that flips to "Copied" for a
 * beat. Everything else on the page is server-rendered — this is the one
 * place we ship JS, kept intentionally tiny.
 */
export function CopyableCurl({
  label,
  path,
  command,
}: {
  label: string;
  path: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (older browsers, insecure context).
      // Fall back to a manual selection so the user can still copy.
      const range = document.createRange();
      const pre = document.getElementById(`curl-${label}`);
      if (pre) {
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <div className="curl">
      <div className="curl__head">
        <div className="curl__label">
          <span className="curl__method">GET</span>
          <code className="curl__path">{path}</code>
        </div>
        <button
          type="button"
          className="curl__copy"
          onClick={copy}
          aria-label={`Copy curl for ${path}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre id={`curl-${label}`} className="curl__code">
        <code>{command}</code>
      </pre>
    </div>
  );
}
