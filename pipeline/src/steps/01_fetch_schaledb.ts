import path from "node:path";
import { SCHALEDB_BASE, SCHALEDB_CACHE_DIR } from "../config.js";
import type { SchaleDbLocalization, SchaleDbStudent } from "../types.js";
import { fetchCached } from "../utils/cache.js";

export type LangCode = "en" | "jp" | "kr" | "tw";

export interface SchaleDbRawData {
  students: Record<LangCode, Record<string, SchaleDbStudent>>;
  localization: Record<LangCode, SchaleDbLocalization>;
  cacheHits: number;
  networkFetches: number;
}

function normalizeStudentMap(
  parsed: SchaleDbStudent[] | Record<string, SchaleDbStudent>
): Record<string, SchaleDbStudent> {
  if (!Array.isArray(parsed)) {
    return parsed;
  }
  const map: Record<string, SchaleDbStudent> = {};
  for (const student of parsed) {
    map[String(student.Id)] = student;
  }
  return map;
}

export async function fetchSchaleDb(opts: {
  refresh?: boolean;
} = {}): Promise<SchaleDbRawData> {
  const langs: LangCode[] = ["en", "jp", "kr", "tw"];
  const students = {} as Record<LangCode, Record<string, SchaleDbStudent>>;
  const localization = {} as Record<LangCode, SchaleDbLocalization>;

  let cacheHits = 0;
  let networkFetches = 0;

  for (const lang of langs) {
    const stuUrl = `${SCHALEDB_BASE}/data/${lang}/students.min.json`;
    const stuPath = path.join(SCHALEDB_CACHE_DIR, `students.${lang}.json`);
    const stuRes = await fetchCached(stuUrl, stuPath, {
      refresh: opts.refresh,
      delayMs: 250,
    });
    if (stuRes.fromCache) cacheHits++;
    else networkFetches++;
    students[lang] = normalizeStudentMap(
      JSON.parse(stuRes.content) as
        | SchaleDbStudent[]
        | Record<string, SchaleDbStudent>
    );

    const locUrl = `${SCHALEDB_BASE}/data/${lang}/localization.min.json`;
    const locPath = path.join(SCHALEDB_CACHE_DIR, `localization.${lang}.json`);
    const locRes = await fetchCached(locUrl, locPath, {
      refresh: opts.refresh,
      delayMs: 250,
    });
    if (locRes.fromCache) cacheHits++;
    else networkFetches++;
    localization[lang] = JSON.parse(locRes.content) as SchaleDbLocalization;
  }

  return { students, localization, cacheHits, networkFetches };
}
