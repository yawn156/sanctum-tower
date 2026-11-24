import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { DATA_MANUAL_DIR, DATA_OUTPUT_DIR, DIALOGUE_INDEX_PATH } from "../config.js";
import type {
  AppellationEntry,
  AppellationsOutput,
  BuildReport,
  CharactersOutput,
  DialogueLineRecord,
  ManualOverridesConfig,
  SpeechLevel,
} from "../types.js";
import { readJson, writeJson } from "../utils/cache.js";

export function applyManualOverrides(
  charactersOutput: CharactersOutput,
  appellationsOutput: AppellationsOutput,
  overrides: ManualOverridesConfig
): {
  charactersOutput: CharactersOutput;
  appellationsOutput: AppellationsOutput;
  charactersModified: number;
  appellationsModified: number;
} {
  let charactersModified = 0;
  let appellationsModified = 0;

  const charOverrides = overrides.characters ?? {};
  const updatedCharacters = charactersOutput.characters.map((ch) => {
    const patch = charOverrides[ch.id];
    if (!patch) return ch;
    charactersModified++;
    return {
      ...ch,
      ...patch,
      name: patch.name ? { ...ch.name, ...patch.name } : ch.name,
      aliases: patch.aliases
        ? {
            jp: patch.aliases.jp ?? ch.aliases.jp,
            kr: patch.aliases.kr ?? ch.aliases.kr,
            en: patch.aliases.en ?? ch.aliases.en,
          }
        : ch.aliases,
    };
  });

  const appOverrides = overrides.appellations ?? {};
  const entryMap = new Map<string, AppellationEntry>();
  for (const e of appellationsOutput.entries) {
    entryMap.set(e.id, e);
  }

  for (const [id, patch] of Object.entries(appOverrides)) {
    if (patch.delete) {
      if (entryMap.delete(id)) {
        appellationsModified++;
      }
      continue;
    }

    const existing = entryMap.get(id);
    if (existing) {
      entryMap.set(id, {
        ...existing,
        ...patch,
        id: existing.id,
        kr: patch.kr ? { ...existing.kr, ...patch.kr } : existing.kr,
        en: patch.en ? { ...existing.en, ...patch.en } : existing.en,
        ...(patch.citations ? { citationCount: patch.citations.length } : {}),
        status: patch.status ?? "manual",
      });
      appellationsModified++;
    } else if (patch.speakerId && patch.targetId) {
      entryMap.set(id, {
        id,
        speakerId: patch.speakerId,
        targetId: patch.targetId,
        status: patch.status ?? "manual",
        jp: patch.jp ?? [],
        kr: patch.kr ?? { terms: [], speechLevel: "unknown" },
        en: patch.en ?? { terms: [], droppedCount: 0 },
        matchedLineCount: patch.matchedLineCount ?? 0,
        citations: patch.citations ?? [],
      });
      appellationsModified++;
    }
  }

  const entries = Array.from(entryMap.values());
  const statusCounts: Record<AppellationEntry["status"], number> = {
    verified: 0,
    jp_only_seed: 0,
    en_pending: 0,
    manual: 0,
  };
  for (const e of entries) {
    statusCounts[e.status]++;
  }

  return {
    charactersOutput: {
      ...charactersOutput,
      characters: updatedCharacters,
    },
    appellationsOutput: {
      meta: {
        ...appellationsOutput.meta,
        generatedAt: new Date().toISOString(),
        totalPairs: entries.length,
        statusCounts,
      },
      entries,
    },
    charactersModified,
    appellationsModified,
  };
}

export async function compileOutputs(params: {
  appellations: AppellationsOutput;
  zeroMatchPlayablePairs: Array<{
    id: string;
    jpTerms: string[];
    speakerLineCount: number;
  }>;
}): Promise<{ outputSizeKb: number; report: BuildReport }> {
  const charactersPath = path.join(DATA_OUTPUT_DIR, "characters.json");
  const appellationsPath = path.join(DATA_OUTPUT_DIR, "appellations.json");
  const reportPath = path.join(DATA_OUTPUT_DIR, "build_report.json");
  const overridesPath = path.join(DATA_MANUAL_DIR, "manual_overrides.json");

  const [charactersOutput, report, overrides] = await Promise.all([
    readJson<CharactersOutput>(charactersPath),
    readJson<BuildReport>(reportPath),
    readJson<ManualOverridesConfig>(overridesPath),
  ]);

  const merged = applyManualOverrides(
    charactersOutput,
    params.appellations,
    overrides
  );

  // Derive accurate released.global flags for NPCs from actual Global vs JP-only script appearances
  const globalSpeakingIds = new Set<string>();
  const jpOnlySpeakingIds = new Set<string>();
  try {
    await fs.access(DIALOGUE_INDEX_PATH);
    const rl = readline.createInterface({
      input: createReadStream(DIALOGUE_INDEX_PATH, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const raw of rl) {
      if (!raw) continue;
      const rec = JSON.parse(raw) as DialogueLineRecord;
      if (rec.jpOnly) jpOnlySpeakingIds.add(rec.speakerId);
      else globalSpeakingIds.add(rec.speakerId);
    }
  } catch {
    // Fallback gracefully if dialogue_index.jsonl is absent in unit tests
  }

  const verifiedGlobalIds = new Set<string>();
  for (const e of merged.appellationsOutput.entries) {
    if (e.status === "verified" || e.status === "manual") {
      verifiedGlobalIds.add(e.speakerId);
      verifiedGlobalIds.add(e.targetId);
    }
  }

  let npcFlagsUpdated = false;
  for (const ch of merged.charactersOutput.characters) {
    if (ch.kind !== "npc") continue;
    if (overrides.characters?.[ch.id]?.released) continue;
    const isGlobal =
      globalSpeakingIds.has(ch.id) ||
      (verifiedGlobalIds.has(ch.id) && !jpOnlySpeakingIds.has(ch.id));
    if (ch.released.global !== isGlobal) {
      ch.released = { ...ch.released, global: isGlobal };
      npcFlagsUpdated = true;
    }
  }

  await writeJson(appellationsPath, merged.appellationsOutput);
  if (merged.charactersModified > 0 || npcFlagsUpdated) {
    await writeJson(charactersPath, merged.charactersOutput);
  }

  const stat = await fs.stat(appellationsPath);
  const outputSizeKb = Number((stat.size / 1024).toFixed(1));

  const speechLevelCounts: Record<SpeechLevel, number> = {
    formal: 0,
    polite: 0,
    casual: 0,
    mixed: 0,
    unknown: 0,
  };
  let pairsWithKrTerms = 0;
  let pairsWithEnTerms = 0;
  let pairsWithCitations = 0;
  let totalCitations = 0;

  for (const e of merged.appellationsOutput.entries) {
    speechLevelCounts[e.kr.speechLevel]++;
    if (e.kr.terms.length > 0) pairsWithKrTerms++;
    if (e.en.terms.length > 0) pairsWithEnTerms++;
    if (e.citations.length > 0) pairsWithCitations++;
    totalCitations += e.citations.length;
  }

  report.milestone = 3;
  report.generatedAt = new Date().toISOString();
  report.appellations = {
    totalPairs: merged.appellationsOutput.meta.totalPairs,
    statusCounts: merged.appellationsOutput.meta.statusCounts,
    pairsWithKrTerms,
    pairsWithEnTerms,
    pairsWithCitations,
    totalCitations,
    speechLevelCounts,
    outputSizeKb,
    topZeroMatchPlayablePairs: params.zeroMatchPlayablePairs,
  };

  await writeJson(reportPath, report);
  return { outputSizeKb, report };
}
