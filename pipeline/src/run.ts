import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_MANUAL_DIR,
  DATA_OUTPUT_DIR,
  DIALOGUE_INDEX_PATH,
  GAME_CACHE_DIR,
} from "./config.js";
import { fetchSchaleDb } from "./steps/01_fetch_schaledb.js";
import {
  buildPlayableCharacters,
  buildSchoolsAndClubs,
  createSpecialCharacters,
} from "./steps/02_build_characters.js";
import { fetchWikiruAppellations } from "./steps/03_fetch_wikiru.js";
import {
  parseWikiruHtml,
  resolveWikiruToRoster,
} from "./steps/04_parse_wikiru.js";
import { fetchNpcIcons } from "./steps/04b_fetch_npc_icons.js";
import { fetchGameScripts } from "./steps/05_fetch_game_scripts.js";
import { indexDialogues } from "./steps/05b_index_dialogues.js";
import { extractMultilangAppellations } from "./steps/06_extract_multilang.js";
import { compileOutputs } from "./steps/07_compile_outputs.js";
import type {
  BuildReport,
  CharactersOutput,
  FootnoteGlossary,
  JpAppellationsSeedOutput,
  NpcRosterConfig,
  WikiruAliasesConfig,
} from "./types.js";
import {
  fileExists,
  getNetworkFetchCount,
  readJson,
  resetNetworkFetchCount,
  writeJson,
} from "./utils/cache.js";

function parseArgs(argv: string[]): { milestone: string; refresh: boolean } {
  let milestone = "1";
  let refresh = false;
  for (const arg of argv) {
    if (arg.startsWith("--milestone=")) {
      milestone = arg.split("=")[1] || "1";
    } else if (arg === "--refresh") {
      refresh = true;
    }
  }
  return { milestone, refresh };
}

async function runMilestone1(refresh: boolean): Promise<void> {
  const startedAt = Date.now();
  resetNetworkFetchCount();

  console.log(`[M1] Loading manual configs from ${DATA_MANUAL_DIR}...`);
  const [npcRoster, wikiruAliases, footnoteGlossary] = await Promise.all([
    readJson<NpcRosterConfig>(path.join(DATA_MANUAL_DIR, "npc_roster.json")),
    readJson<WikiruAliasesConfig>(
      path.join(DATA_MANUAL_DIR, "wikiru_aliases.json")
    ),
    readJson<FootnoteGlossary>(
      path.join(DATA_MANUAL_DIR, "footnote_glossary.json")
    ),
  ]);

  console.log(
    `[M1] Step 01: Fetching SchaleDB (${refresh ? "refresh" : "cached"})...`
  );
  const schale = await fetchSchaleDb({ refresh });
  console.log(
    `     SchaleDB ready (cacheHits=${schale.cacheHits}, network=${schale.networkFetches})`
  );

  console.log("[M1] Step 02: Building canonical playable character roster...");
  const playable = buildPlayableCharacters(
    schale.students.en,
    schale.students.jp,
    schale.students.kr,
    npcRoster,
    schale.students.tw
  );
  const { schools, clubs } = buildSchoolsAndClubs(
    schale.localization.en,
    schale.localization.jp,
    schale.localization.kr,
    npcRoster,
    schale.localization.tw
  );
  const baseCharacters = [...createSpecialCharacters(), ...playable];
  console.log(
    `     Playable characters: ${playable.length} (from ${Object.keys(schale.students.en).length} SchaleDB variants)`
  );

  console.log(
    `[M1] Step 03: Fetching Blue Archive JP Wiki appellations (${refresh ? "refresh" : "cached"})...`
  );
  const wikiru = await fetchWikiruAppellations({ refresh });
  console.log(
    `     Wikiru HTML ready (${(wikiru.html.length / 1024).toFixed(1)} KB, fromCache=${wikiru.fromCache})`
  );

  console.log("[M1] Step 04: Parsing wikiru HTML & resolving entities...");
  const parsedWikiru = parseWikiruHtml(wikiru.html);
  const resolved = resolveWikiruToRoster({
    parsed: parsedWikiru,
    baseCharacters,
    npcRoster,
    wikiruAliases,
    footnoteGlossary,
  });

  console.log("[M1] Step 04b: Caching wikiru NPC portrait icons...");
  const iconStats = await fetchNpcIcons(
    resolved.characters,
    resolved.npcIconUrls,
    { refresh }
  );
  console.log(
    `     NPC icons: ${iconStats.total} mapped (cached=${iconStats.cached}, fetched=${iconStats.fetched}, failed=${iconStats.failed})`
  );

  const now = new Date().toISOString();
  const playableCount = resolved.characters.filter(
    (c) => c.kind === "student" || c.kind === "collab"
  ).length;
  const npcCount = resolved.characters.filter((c) => c.kind === "npc").length;
  const entityCount = resolved.characters.filter(
    (c) => c.kind === "entity"
  ).length;

  const charactersOutput: CharactersOutput = {
    meta: {
      generatedAt: now,
      schaleDbStudentCount: Object.keys(schale.students.en).length,
      playableCharacterCount: playableCount,
      npcCount,
      entityCount,
      totalCharacterCount: resolved.characters.length,
    },
    schools,
    clubs,
    characters: resolved.characters,
  };

  const seedOutput: JpAppellationsSeedOutput = {
    meta: {
      generatedAt: now,
      sourceUrl: wikiru.url,
      speakerTableCount: resolved.wikiruReport.speakerTableCount,
      totalPairs: resolved.seedEntries.length,
      totalTerms: resolved.wikiruReport.parsedTermCount,
    },
    entries: resolved.seedEntries,
  };

  const report: BuildReport = {
    generatedAt: now,
    milestone: 1,
    schaleDb: {
      rawStudentCount: Object.keys(schale.students.en).length,
      playableComponentCount: playable.length,
      schoolCount: Object.keys(schools).length,
      clubCount: Object.keys(clubs).length,
    },
    wikiru: resolved.wikiruReport,
  };

  await Promise.all([
    writeJson(path.join(DATA_OUTPUT_DIR, "characters.json"), charactersOutput),
    writeJson(
      path.join(DATA_OUTPUT_DIR, "jp_appellations_seed.json"),
      seedOutput
    ),
    writeJson(path.join(DATA_OUTPUT_DIR, "build_report.json"), report),
  ]);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[M1] Done in ${elapsedSec}s (total network fetches: ${getNetworkFetchCount()})`);
  console.log(
    `     characters.json: ${charactersOutput.meta.totalCharacterCount} total (${playableCount} playable, ${npcCount} NPCs, ${entityCount} entities)`
  );
  console.log(
    `     jp_appellations_seed.json: ${seedOutput.meta.speakerTableCount} tables, ${seedOutput.meta.totalPairs} pairs, ${seedOutput.meta.totalTerms} terms`
  );
  console.log(
    `     QA: ${report.wikiru.matchedPlayableSpeakers} playable speakers matched, ${report.wikiru.autoCreatedNpcSpeakers.length} NPC speakers, ${report.wikiru.unmappedFootnotes.length} unmapped footnotes`
  );
}

async function runMilestone2(refresh: boolean): Promise<void> {
  const startedAt = Date.now();
  resetNetworkFetchCount();

  const charsPath = path.join(DATA_OUTPUT_DIR, "characters.json");
  if (!(await fileExists(charsPath))) {
    console.log("[M2] characters.json missing; running Milestone 1 first...");
    await runMilestone1(refresh);
    resetNetworkFetchCount();
  }

  console.log(
    `[M2] Step 05: Fetching arisu-archive/bluearchive-data (${refresh ? "refresh" : "cached"})...`
  );
  const manifest = await fetchGameScripts({ refresh });
  console.log(
    `     Versions: global=${manifest.globalVersion}, japan=${manifest.japanVersion} (cacheHits=${manifest.cacheHits}, network=${manifest.networkFetches})`
  );

  console.log(
    "[M2] Step 05b: Resolving speakers, story labels & indexing dialogue lines..."
  );
  await indexDialogues(manifest);

  const report = await readJson<BuildReport>(
    path.join(DATA_OUTPUT_DIR, "build_report.json")
  );
  const gs = report.gameScripts!;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `[M2] Done in ${elapsedSec}s (total network fetches: ${getNetworkFetchCount()})`
  );
  console.log(
    `     dialogue_index.jsonl: ${gs.indexedLinesTotal} lines (jpOnlyDelta=${gs.jpOnlyDeltaLines})`
  );
  console.log(
    `     by source: main=${gs.bySourceType.main_story}, event=${gs.bySourceType.event_story}, bond=${gs.bySourceType.bond_story}, momotalk=${gs.bySourceType.momotalk}, dialog=${gs.bySourceType.dialog}`
  );
  console.log(
    `     scenario speakers: resolved=${gs.scenarioSpeechResolved}, unresolved=${gs.scenarioSpeechUnresolved}, enrichedNPCs=${gs.enrichedNpcCount}, storyLabels=${gs.storyLabelCount}`
  );
}

async function runMilestone3(refresh: boolean): Promise<void> {
  const startedAt = Date.now();
  resetNetworkFetchCount();

  if (!(await fileExists(DIALOGUE_INDEX_PATH))) {
    console.log("[M3] dialogue_index.jsonl missing; running Milestone 2 first...");
    await runMilestone2(refresh);
    resetNetworkFetchCount();
  }

  const [globalVersion, japanVersion] = await Promise.all([
    fs.readFile(path.join(GAME_CACHE_DIR, "global.txt"), "utf8").then((s) => s.trim()),
    fs.readFile(path.join(GAME_CACHE_DIR, "japan.txt"), "utf8").then((s) => s.trim()),
  ]);

  console.log("[M3] Step 06: Extracting EN & KR appellations, speech levels & citations...");
  const { appellations, zeroMatchPlayablePairs } =
    await extractMultilangAppellations({ globalVersion, japanVersion });

  console.log("[M3] Step 07: Applying manual_overrides.json & compiling final outputs...");
  const { outputSizeKb, report } = await compileOutputs({
    appellations,
    zeroMatchPlayablePairs,
  });

  const appStats = report.appellations!;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `[M3] Done in ${elapsedSec}s (total network fetches: ${getNetworkFetchCount()})`
  );
  console.log(
    `     appellations.json (${outputSizeKb} KB): ${appStats.totalPairs} pairs | status=${JSON.stringify(appStats.statusCounts)}`
  );
  console.log(
    `     coverage: krTerms=${appStats.pairsWithKrTerms}, enTerms=${appStats.pairsWithEnTerms}, citations=${appStats.pairsWithCitations} (${appStats.totalCitations} quotes)`
  );
  console.log(`     speechLevel=${JSON.stringify(appStats.speechLevelCounts)}`);
}

async function main(): Promise<void> {
  const { milestone, refresh } = parseArgs(process.argv.slice(2));
  if (milestone === "1") {
    await runMilestone1(refresh);
    return;
  }
  if (milestone === "2") {
    await runMilestone2(refresh);
    return;
  }
  if (milestone === "3") {
    await runMilestone3(refresh);
    return;
  }
  if (milestone === "all") {
    await runMilestone1(refresh);
    await runMilestone2(refresh);
    await runMilestone3(refresh);
    return;
  }
  throw new Error(`Milestone "${milestone}" is not implemented yet.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
