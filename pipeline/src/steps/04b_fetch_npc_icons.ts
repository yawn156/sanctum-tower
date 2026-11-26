import path from "node:path";
import { WIKIRU_CACHE_DIR } from "../config.js";
import type { Character } from "../types.js";
import { downloadFileCached } from "../utils/cache.js";

const CURATED_NPC_ICON_URLS: Record<string, string> = {
  "npc:gsc_president":
    "https://static.wikitide.net/bluearchivewiki/b/b5/Portrait_Student_Council_President.png",
  "npc:gsc_president_false":
    "https://static.wikitide.net/bluearchivewiki/c/c2/Portrait_Student_Council_President_%28False%29.png",
};

function npcIdToFilename(charId: string): string {
  const slug = charId.replace(/^npc:/, "").replace(/[^a-z0-9_-]/gi, "_");
  return `${slug}.png`;
}

export async function fetchNpcIcons(
  characters: Character[],
  npcIconUrls: Record<string, string>,
  opts: { refresh?: boolean } = {}
): Promise<{ total: number; cached: number; fetched: number; failed: number }> {
  const iconsDir = path.join(WIKIRU_CACHE_DIR, "icons");
  let cached = 0;
  let fetched = 0;
  let failed = 0;
  let total = 0;

  for (const ch of characters) {
    const url = npcIconUrls[ch.id] ?? CURATED_NPC_ICON_URLS[ch.id];
    if (!url || ch.defaultImages.icon) continue;
    total++;

    const filename = npcIdToFilename(ch.id);
    const cachePath = path.join(iconsDir, filename);

    try {
      const res = await downloadFileCached(url, cachePath, {
        refresh: opts.refresh,
        delayMs: 120,
      });
      if (res.fromCache) cached++;
      else fetched++;

      ch.defaultImages.icon = `/images/npc/${filename}`;
    } catch {
      failed++;
    }
  }

  return { total, cached, fetched, failed };
}
