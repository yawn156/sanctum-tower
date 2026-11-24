import path from "node:path";
import { WIKIRU_APPELLATIONS_URL, WIKIRU_CACHE_DIR } from "../config.js";
import { fetchCached } from "../utils/cache.js";

export interface WikiruRawData {
  html: string;
  url: string;
  fromCache: boolean;
}

export async function fetchWikiruAppellations(opts: {
  refresh?: boolean;
} = {}): Promise<WikiruRawData> {
  const cachePath = path.join(WIKIRU_CACHE_DIR, "appellations.html");
  const res = await fetchCached(WIKIRU_APPELLATIONS_URL, cachePath, {
    refresh: opts.refresh,
    delayMs: 500,
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ja,en-US;q=0.8,en;q=0.6",
    },
  });

  return {
    html: res.content,
    url: WIKIRU_APPELLATIONS_URL,
    fromCache: res.fromCache,
  };
}
