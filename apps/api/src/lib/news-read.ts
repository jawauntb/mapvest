import { getContents } from "@mapvest/search";

export type NewsRead = {
  title?: string;
  url: string;
  text: string;
  source: "exa";
  fetchedAt: string;
  error?: "unavailable";
};

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local")) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export async function fetchArticle(rawUrl: string): Promise<NewsRead> {
  const url = safeHttpUrl(rawUrl);
  const fetchedAt = new Date().toISOString();
  if (!url) {
    return { url: rawUrl, text: "", source: "exa", fetchedAt, error: "unavailable" };
  }
  try {
    const hit = await getContents(url);
    const text = hit.text?.trim() ?? "";
    if (!text) {
      return {
        title: hit.title,
        url: hit.url,
        text: "",
        source: "exa",
        fetchedAt,
        error: "unavailable",
      };
    }
    return { title: hit.title, url: hit.url, text, source: "exa", fetchedAt };
  } catch {
    return { url, text: "", source: "exa", fetchedAt, error: "unavailable" };
  }
}
