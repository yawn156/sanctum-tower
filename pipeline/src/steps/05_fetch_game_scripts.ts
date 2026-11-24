import fs from "node:fs/promises";
import path from "node:path";
import { GAME_CACHE_DIR, GAME_DATA_BASE } from "../config.js";
import { downloadFileCached, fetchCached, fileExists } from "../utils/cache.js";

const FIXED_EXCEL_TABLES = [
  "ScenarioCharacterNameExcel.json",
  "AcademyMessangerExcel.json",
  "CharacterDialogExcel.json",
  "CharacterDialogEventExcel.json",
  "ScenarioModeExcel.json",
  "AcademyFavorScheduleExcel.json",
  "EventContentScenarioExcel.json",
] as const;

export type FixedExcelTable = (typeof FIXED_EXCEL_TABLES)[number];

export interface BranchFiles {
  excelDir: string;
  tables: Record<FixedExcelTable, string>;
  scenarioScriptChunks: string[];
}

export interface GameScriptsManifest {
  globalVersion: string;
  japanVersion: string;
  global: BranchFiles;
  japan: BranchFiles;
  cacheHits: number;
  networkFetches: number;
}

async function listCachedScenarioChunks(excelDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(excelDir);
    const matched = entries
      .map((name) => {
        const m = /^ScenarioScriptExcel_(\d+)\.json$/.exec(name);
        return m ? { name, index: Number(m[1]) } : null;
      })
      .filter((x): x is { name: string; index: number } => x !== null)
      .sort((a, b) => a.index - b.index);
    return matched.map((x) => path.join(excelDir, x.name));
  } catch {
    return [];
  }
}

async function fetchBranchFiles(
  branch: "global" | "japan",
  refresh: boolean
): Promise<{ files: BranchFiles; cacheHits: number; networkFetches: number }> {
  const excelDir = path.join(GAME_CACHE_DIR, branch, "ExcelDB");
  const tables = {} as Record<FixedExcelTable, string>;
  let cacheHits = 0;
  let networkFetches = 0;

  for (const table of FIXED_EXCEL_TABLES) {
    const url = `${GAME_DATA_BASE}/${branch}/ExcelDB/${table}`;
    const cachePath = path.join(excelDir, table);
    const res = await downloadFileCached(url, cachePath, {
      refresh,
      delayMs: 150,
    });
    if (res.fromCache) cacheHits++;
    else networkFetches++;
    tables[table] = cachePath;
  }

  let scenarioScriptChunks: string[] = [];
  const firstChunkPath = path.join(excelDir, "ScenarioScriptExcel_0.json");

  if (!refresh && (await fileExists(firstChunkPath))) {
    scenarioScriptChunks = await listCachedScenarioChunks(excelDir);
    cacheHits += scenarioScriptChunks.length;
  } else {
    for (let i = 0; i < 20; i++) {
      const chunkName = `ScenarioScriptExcel_${i}.json`;
      const url = `${GAME_DATA_BASE}/${branch}/ExcelDB/${chunkName}`;
      const cachePath = path.join(excelDir, chunkName);
      const res = await downloadFileCached(url, cachePath, {
        refresh,
        delayMs: 150,
        allow404: true,
      });
      if (res.notFound) {
        break;
      }
      if (res.fromCache) cacheHits++;
      else networkFetches++;
      scenarioScriptChunks.push(cachePath);
    }
  }

  if (scenarioScriptChunks.length === 0) {
    throw new Error(`No ScenarioScriptExcel chunks found for branch "${branch}"`);
  }

  return {
    files: {
      excelDir,
      tables,
      scenarioScriptChunks,
    },
    cacheHits,
    networkFetches,
  };
}

export async function fetchGameScripts(opts: {
  refresh?: boolean;
} = {}): Promise<GameScriptsManifest> {
  const refresh = Boolean(opts.refresh);
  let cacheHits = 0;
  let networkFetches = 0;

  const globalVerRes = await fetchCached(
    `${GAME_DATA_BASE}/master/global.txt`,
    path.join(GAME_CACHE_DIR, "global.txt"),
    { refresh, delayMs: 100 }
  );
  if (globalVerRes.fromCache) cacheHits++;
  else networkFetches++;

  const japanVerRes = await fetchCached(
    `${GAME_DATA_BASE}/master/japan.txt`,
    path.join(GAME_CACHE_DIR, "japan.txt"),
    { refresh, delayMs: 100 }
  );
  if (japanVerRes.fromCache) cacheHits++;
  else networkFetches++;

  const globalBranch = await fetchBranchFiles("global", refresh);
  cacheHits += globalBranch.cacheHits;
  networkFetches += globalBranch.networkFetches;

  const japanBranch = await fetchBranchFiles("japan", refresh);
  cacheHits += japanBranch.cacheHits;
  networkFetches += japanBranch.networkFetches;

  return {
    globalVersion: globalVerRes.content.trim(),
    japanVersion: japanVerRes.content.trim(),
    global: globalBranch.files,
    japan: japanBranch.files,
    cacheHits,
    networkFetches,
  };
}
