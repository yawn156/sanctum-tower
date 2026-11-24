import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_OUTPUT_DIR,
  DIALOGUE_INDEX_PATH,
  SCHALEDB_CACHE_DIR,
  STORY_LABELS_PATH,
} from "../config.js";
import type {
  AcademyFavorScheduleRow,
  AcademyMessangerRow,
  BuildReport,
  Character,
  CharacterDialogEventRow,
  CharacterDialogRow,
  CharactersOutput,
  DialogueLineRecord,
  EventContentScenarioRow,
  QuoteCitation,
  ScenarioCharNameRow,
  ScenarioModeRow,
  ScenarioScriptRow,
  SchaleDbLocalization,
  StoryLabelEntry,
} from "../types.js";
import { readJson, writeJson } from "../utils/cache.js";
import { cleanDialogueText, parseScriptKr } from "../utils/text.js";
import { xxhash32 } from "../utils/xxhash32.js";
import { normalizeJpName } from "./04_parse_wikiru.js";
import type { GameScriptsManifest } from "./05_fetch_game_scripts.js";

interface ExcelTableWrapper<T> {
  data_list: T[];
}

function stripParens(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*（[^）]*）\s*$/u, "")
    .trim();
}

export interface BuildStoryLabelMapParams {
  scenarioModes: ScenarioModeRow[];
  favorSchedules: AcademyFavorScheduleRow[];
  eventScenarios: EventContentScenarioRow[];
  eventNamesEn: Record<string, string>;
  eventNamesJp: Record<string, string>;
  eventNamesKr: Record<string, string>;
  charByStudentId: Map<number, Character>;
}

export function buildStoryLabelMap(
  params: BuildStoryLabelMapParams
): Record<string, StoryLabelEntry> {
  const {
    scenarioModes,
    favorSchedules,
    eventScenarios,
    eventNamesEn,
    eventNamesJp,
    eventNamesKr,
    charByStudentId,
  } = params;

  const map: Record<string, StoryLabelEntry> = {};

  const getEventName = (eventId: number) => {
    const k = String(eventId);
    return {
      jp: eventNamesJp[k] ?? `イベント ${eventId}`,
      en: eventNamesEn[k] ?? `Event ${eventId}`,
      kr: eventNamesKr[k] ?? `이벤트 ${eventId}`,
    };
  };

  // 1. Bond / Favor stories (AcademyFavorScheduleExcel)
  for (const row of favorSchedules) {
    const gid = row.scenario_sript_group_id;
    if (!gid) continue;
    const ch = charByStudentId.get(row.character_id);
    const charJp = ch?.name.jp ?? String(row.character_id);
    const charEn = ch?.name.en ?? String(row.character_id);
    const charKr = ch?.name.kr ?? String(row.character_id);
    const ep = row.order_in_group || 1;
    map[String(gid)] = {
      sourceType: "bond_story",
      sourceLabel: {
        jp: `${charJp} 絆ストーリー #${ep}`,
        en: `${charEn} Bond Story #${ep}`,
        kr: `${charKr} 인연 스토리 #${ep}`,
      },
    };
  }

  // 2. Event stories (EventContentScenarioExcel)
  for (const row of eventScenarios) {
    const ev = getEventName(row.event_content_id);
    for (const gid of row.scenario_group_id ?? []) {
      if (!gid || map[String(gid)]) continue;
      map[String(gid)] = {
        sourceType: "event_story",
        sourceLabel: {
          jp: `イベント「${ev.jp}」#${row.order}`,
          en: `Event: ${ev.en} #${row.order}`,
          kr: `이벤트 「${ev.kr}」 #${row.order}`,
        },
      };
    }
  }

  // 3. Main & Scenario modes (ScenarioModeExcel)
  for (const row of scenarioModes) {
    const gids = [
      ...(row.front_scenario_group_id ?? []),
      ...(row.back_scenario_group_id ?? []),
    ];
    for (const gid of gids) {
      if (!gid || map[String(gid)]) continue;
      if (row.event_content_id && row.event_content_id > 0) {
        const ev = getEventName(row.event_content_id);
        map[String(gid)] = {
          sourceType: "event_story",
          sourceLabel: {
            jp: `イベント「${ev.jp}」`,
            en: `Event: ${ev.en}`,
            kr: `이벤트 「${ev.kr}」`,
          },
        };
      } else if (row.mode_type === 6) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `プロローグ 第${row.episode_id}話`,
            en: `Prologue Ep.${row.episode_id}`,
            kr: `프롤로그 ${row.episode_id}화`,
          },
        };
      } else if (row.mode_type === 2) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `グループストーリー #${row.volume_id} 第${row.episode_id}話`,
            en: `Group Story #${row.volume_id} Ep.${row.episode_id}`,
            kr: `그룹 스토리 #${row.volume_id} ${row.episode_id}화`,
          },
        };
      } else if (row.mode_type === 4) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `ミニストーリー #${row.volume_id} 第${row.episode_id}話`,
            en: `Mini Story #${row.volume_id} Ep.${row.episode_id}`,
            kr: `미니 스토리 #${row.volume_id} ${row.episode_id}화`,
          },
        };
      } else if (row.mode_type === 5) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `特別作戦 デカグラマトン編 第${row.chapter_id}章 第${row.episode_id}話`,
            en: `Special Operation: Decagrammaton Ch.${row.chapter_id} Ep.${row.episode_id}`,
            kr: `특수작전 데카그라마톤 편 ${row.chapter_id}장 ${row.episode_id}화`,
          },
        };
      } else if (row.volume_id === 100) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `メインストーリー Final編 第${row.chapter_id}章 第${row.episode_id}話`,
            en: `Main Story Vol.F Ch.${row.chapter_id} Ep.${row.episode_id}`,
            kr: `메인 스토리 최종편 ${row.chapter_id}장 ${row.episode_id}화`,
          },
        };
      } else if (row.sub_type === 3) {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `メインストーリー Vol.EX 第${row.chapter_id}章 第${row.episode_id}話`,
            en: `Main Story Vol.EX Ch.${row.chapter_id} Ep.${row.episode_id}`,
            kr: `메인 스토리 Vol.EX ${row.chapter_id}장 ${row.episode_id}화`,
          },
        };
      } else if (row.volume_id > 0 || (row.display_volume_id ?? "").trim()) {
        const vol = (row.display_volume_id ?? "").trim() || String(row.volume_id);
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `メインストーリー Vol.${vol} 第${row.chapter_id}章 第${row.episode_id}話`,
            en: `Main Story Vol.${vol} Ch.${row.chapter_id} Ep.${row.episode_id}`,
            kr: `메인 스토리 Vol.${vol} ${row.chapter_id}장 ${row.episode_id}화`,
          },
        };
      } else {
        map[String(gid)] = {
          sourceType: "main_story",
          sourceLabel: {
            jp: `ストーリー #${row.mode_id}`,
            en: `Story #${row.mode_id}`,
            kr: `스토리 #${row.mode_id}`,
          },
        };
      }
    }
  }

  return map;
}

export interface SpeakerResolver {
  resolveByStudentId: (studentId: number) => string | undefined;
  resolveByScriptKrKey: (krKey: string) => {
    characterId?: string;
    entry?: ScenarioCharNameRow;
    hash: number;
  };
  enrichNpcs: (characters: Character[]) => number;
}

const KNOWN_SPECIAL_DIALOG_IDS: Record<number, string> = {
  9009000: "npc:arona",
  9009001: "npc:plana",
};

// Story scenario spines/portraits whose ScenarioCharacterName shares a JP display name with another character
const SPINE_ASSET_CHAR_OVERRIDES: Array<[RegExp, string]> = [
  [/(?:^|[^A-Za-z0-9])(?:CH0263|CH0199|NP0125|NP0231|NP0232)(?:[^A-Za-z0-9]|$)/i, "shiroko_terror"],
  [/(?:^|[^A-Za-z0-9])NP0040(?:[^A-Za-z0-9]|$)/i, "npc:gsc_president"],
  [/(?:^|[^A-Za-z0-9])NP0290(?:[^A-Za-z0-9]|$)/i, "npc:gsc_president_false"],
];

export function buildSpeakerResolver(
  characters: Character[],
  scenarioCharNamesGlobal: ScenarioCharNameRow[],
  scenarioCharNamesJapan: ScenarioCharNameRow[]
): SpeakerResolver {
  const studentIdToCharId = new Map<number, string>();
  const jpExact = new Map<string, Character>();
  const jpNorm = new Map<string, Character>();
  const enExact = new Map<string, Character>();
  const krExact = new Map<string, Character>();

  const registerNameMap = <K>(map: Map<K, Character>, key: K, char: Character) => {
    if (!map.has(key)) map.set(key, char);
  };

  for (const char of characters) {
    if (char.primaryStudentId) {
      studentIdToCharId.set(char.primaryStudentId, char.id);
    }
    for (const v of char.variants) {
      studentIdToCharId.set(v.id, char.id);
    }

    const jpList = [char.name.jp, char.fullName?.jp ?? "", ...char.aliases.jp];
    for (const jp of jpList) {
      const t = jp.trim();
      if (!t || char.id.startsWith("special:")) continue;
      registerNameMap(jpExact, t, char);
      const norm = normalizeJpName(t);
      if (norm) registerNameMap(jpNorm, norm, char);
    }

    const enList = [char.name.en, char.fullName?.en ?? "", ...char.aliases.en];
    for (const en of enList) {
      const t = en.trim().toLowerCase();
      if (!t || char.id.startsWith("special:")) continue;
      registerNameMap(enExact, t, char);
    }

    const krList = [char.name.kr, char.fullName?.kr ?? "", ...char.aliases.kr];
    for (const kr of krList) {
      const t = kr.trim();
      if (!t || char.id.startsWith("special:")) continue;
      registerNameMap(krExact, t, char);
    }
  }

  for (const [sid, cid] of Object.entries(KNOWN_SPECIAL_DIALOG_IDS)) {
    if (!studentIdToCharId.has(Number(sid)) && characters.some((c) => c.id === cid)) {
      studentIdToCharId.set(Number(sid), cid);
    }
  }

  // Merge ScenarioCharacterNameExcel (Global first, Japan fills gaps/new JP-only entries)
  const byHash = new Map<number, ScenarioCharNameRow>();
  for (const row of scenarioCharNamesGlobal) {
    byHash.set(row.character_name, row);
  }
  for (const row of scenarioCharNamesJapan) {
    if (!byHash.has(row.character_name)) {
      byHash.set(row.character_name, row);
    }
  }

  const validCharIds = new Set(characters.map((c) => c.id));

  const resolveCharFromRow = (row: ScenarioCharNameRow): Character | undefined => {
    const assetHint = `${row.spine_prefab_name ?? ""} ${row.small_portrait ?? ""}`;
    for (const [re, targetCharId] of SPINE_ASSET_CHAR_OVERRIDES) {
      if (re.test(assetHint) && validCharIds.has(targetCharId)) {
        return characters.find((c) => c.id === targetCharId);
      }
    }

    const jp = (row.name_jp ?? "").trim();
    const en = (row.name_en ?? "").trim();
    const kr = (row.name_kr ?? "").trim();

    if (jp) {
      const direct = jpExact.get(jp) ?? jpNorm.get(normalizeJpName(jp));
      if (direct) return direct;
      const stripped = stripParens(jp);
      if (stripped && stripped !== jp) {
        const sMatch =
          jpExact.get(stripped) ?? jpNorm.get(normalizeJpName(stripped));
        if (sMatch) return sMatch;
      }
    }

    if (en) {
      const enMatch = enExact.get(en.toLowerCase());
      if (enMatch) return enMatch;
      const strippedEn = stripParens(en).toLowerCase();
      if (strippedEn && strippedEn !== en.toLowerCase()) {
        const sMatch = enExact.get(strippedEn);
        if (sMatch) return sMatch;
      }
    }

    if (kr) {
      const krMatch = krExact.get(kr);
      if (krMatch) return krMatch;
      const strippedKr = stripParens(kr);
      if (strippedKr && strippedKr !== kr) {
        const sMatch = krExact.get(strippedKr);
        if (sMatch) return sMatch;
      }
    }

    return undefined;
  };

  const hashToCharId = new Map<number, string>();
  for (const [hash, row] of byHash.entries()) {
    const matched = resolveCharFromRow(row);
    if (matched) {
      hashToCharId.set(hash, matched.id);
    }
  }

  const resolveByStudentId = (studentId: number): string | undefined =>
    studentIdToCharId.get(studentId);

  const resolveByScriptKrKey = (
    krKey: string
  ): { characterId?: string; entry?: ScenarioCharNameRow; hash: number } => {
    const hash = xxhash32(krKey);
    const entry = byHash.get(hash);
    const mapped = hashToCharId.get(hash);
    if (mapped) {
      return { characterId: mapped, entry, hash };
    }

    // Fallback: direct KR match (handles cases where krKey is plain name)
    const directKr = krExact.get(krKey.trim());
    if (directKr) {
      return { characterId: directKr.id, entry, hash };
    }

    return { entry, hash };
  };

  const enrichNpcs = (targetCharacters: Character[]): number => {
    // Group ScenarioCharacterName rows by normalized JP name
    const rowsByJp = new Map<string, ScenarioCharNameRow[]>();
    for (const row of byHash.values()) {
      const jp = (row.name_jp ?? "").trim();
      if (!jp || jp === "？？？" || jp === "???") continue;
      const key = normalizeJpName(jp);
      if (!rowsByJp.has(key)) rowsByJp.set(key, []);
      rowsByJp.get(key)!.push(row);
    }

    let enrichedCount = 0;
    for (const char of targetCharacters) {
      if (char.kind !== "npc") continue;
      const key = normalizeJpName(char.name.jp);
      const rows = rowsByJp.get(key);
      if (!rows || rows.length === 0) continue;

      const krCounts = new Map<string, number>();
      const enCounts = new Map<string, number>();
      for (const r of rows) {
        const kr = (r.name_kr ?? "").trim();
        const en = (r.name_en ?? "").trim();
        if (kr && kr !== "???" && kr !== char.name.jp) {
          krCounts.set(kr, (krCounts.get(kr) ?? 0) + 1);
        }
        if (en && en !== "???" && en !== char.name.jp) {
          enCounts.set(en, (enCounts.get(en) ?? 0) + 1);
        }
      }

      const bestKr = [...krCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const bestEn = [...enCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      let updated = false;
      if (bestKr && (!char.name.kr || char.name.kr === char.name.jp)) {
        char.name.kr = bestKr;
        if (!char.aliases.kr.includes(bestKr)) char.aliases.kr.push(bestKr);
        updated = true;
      }
      if (
        bestEn &&
        (!char.name.en ||
          char.name.en === char.name.jp ||
          char.name.en === char.wikiruAnchor)
      ) {
        char.name.en = bestEn;
        if (!char.aliases.en.includes(bestEn)) char.aliases.en.push(bestEn);
        updated = true;
      }

      if (updated) {
        enrichedCount++;
        // Also ensure hashToCharId picks up any newly enriched matches
        for (const r of rows) {
          if (!hashToCharId.has(r.character_name)) {
            hashToCharId.set(r.character_name, char.id);
          }
        }
      }
    }

    return enrichedCount;
  };

  return { resolveByStudentId, resolveByScriptKrKey, enrichNpcs };
}

async function writeJsonlLine(
  stream: NodeJS.WritableStream,
  record: DialogueLineRecord
): Promise<void> {
  const line = JSON.stringify(record) + "\n";
  if (!stream.write(line)) {
    await new Promise<void>((resolve) => stream.once("drain", resolve));
  }
}

export async function indexDialogues(
  manifest: GameScriptsManifest
): Promise<void> {
  const charactersPath = path.join(DATA_OUTPUT_DIR, "characters.json");
  const reportPath = path.join(DATA_OUTPUT_DIR, "build_report.json");

  const [charactersOutput, report, locEn, locJp, locKr] = await Promise.all([
    readJson<CharactersOutput>(charactersPath),
    readJson<BuildReport>(reportPath),
    readJson<SchaleDbLocalization>(
      path.join(SCHALEDB_CACHE_DIR, "localization.en.json")
    ),
    readJson<SchaleDbLocalization>(
      path.join(SCHALEDB_CACHE_DIR, "localization.jp.json")
    ),
    readJson<SchaleDbLocalization>(
      path.join(SCHALEDB_CACHE_DIR, "localization.kr.json")
    ),
  ]);

  const [
    scnGlobal,
    scnJapan,
    modesGlobal,
    modesJapan,
    favorGlobal,
    favorJapan,
    eventGlobal,
    eventJapan,
  ] = await Promise.all([
    readJson<ExcelTableWrapper<ScenarioCharNameRow>>(
      manifest.global.tables["ScenarioCharacterNameExcel.json"]
    ),
    readJson<ExcelTableWrapper<ScenarioCharNameRow>>(
      manifest.japan.tables["ScenarioCharacterNameExcel.json"]
    ),
    readJson<ExcelTableWrapper<ScenarioModeRow>>(
      manifest.global.tables["ScenarioModeExcel.json"]
    ),
    readJson<ExcelTableWrapper<ScenarioModeRow>>(
      manifest.japan.tables["ScenarioModeExcel.json"]
    ),
    readJson<ExcelTableWrapper<AcademyFavorScheduleRow>>(
      manifest.global.tables["AcademyFavorScheduleExcel.json"]
    ),
    readJson<ExcelTableWrapper<AcademyFavorScheduleRow>>(
      manifest.japan.tables["AcademyFavorScheduleExcel.json"]
    ),
    readJson<ExcelTableWrapper<EventContentScenarioRow>>(
      manifest.global.tables["EventContentScenarioExcel.json"]
    ),
    readJson<ExcelTableWrapper<EventContentScenarioRow>>(
      manifest.japan.tables["EventContentScenarioExcel.json"]
    ),
  ]);

  const charByStudentId = new Map<number, Character>();
  for (const ch of charactersOutput.characters) {
    for (const v of ch.variants) {
      charByStudentId.set(v.id, ch);
    }
  }

  const storyLabels = buildStoryLabelMap({
    scenarioModes: [...modesGlobal.data_list, ...modesJapan.data_list],
    favorSchedules: [...favorGlobal.data_list, ...favorJapan.data_list],
    eventScenarios: [...eventGlobal.data_list, ...eventJapan.data_list],
    eventNamesEn: locEn.EventName ?? {},
    eventNamesJp: locJp.EventName ?? {},
    eventNamesKr: locKr.EventName ?? {},
    charByStudentId,
  });

  const resolver = buildSpeakerResolver(
    charactersOutput.characters,
    scnGlobal.data_list,
    scnJapan.data_list
  );
  const enrichedNpcCount = resolver.enrichNpcs(charactersOutput.characters);

  // Stream dialogue_index.jsonl to temp file then atomic rename
  await fs.mkdir(path.dirname(DIALOGUE_INDEX_PATH), { recursive: true });
  const tmpIndexPath = `${DIALOGUE_INDEX_PATH}.tmp`;
  const outStream = createWriteStream(tmpIndexPath, { encoding: "utf8" });

  let indexedLinesTotal = 0;
  let jpOnlyDeltaLines = 0;
  let scenarioSpeechResolved = 0;
  let scenarioSpeechUnresolved = 0;
  const unresolvedCounts = new Map<
    string,
    { krKey: string; jpName?: string; enName?: string; count: number }
  >();
  const bySourceType: Record<QuoteCitation["sourceType"], number> = {
    main_story: 0,
    event_story: 0,
    bond_story: 0,
    momotalk: 0,
    dialog: 0,
  };

  const seenGlobalGroupIds = new Set<number>();

  // 1. ScenarioScriptExcel chunks (global first, then japan delta)
  for (const branch of ["global", "japan"] as const) {
    const isJapan = branch === "japan";
    const chunks = manifest[branch].scenarioScriptChunks;
    for (const chunkPath of chunks) {
      const wrapper = await readJson<ExcelTableWrapper<ScenarioScriptRow>>(
        chunkPath
      );
      let prevGroupId = -1;
      let idxInGroup = 0;

      for (const row of wrapper.data_list) {
        if (row.group_id !== prevGroupId) {
          prevGroupId = row.group_id;
          idxInGroup = 0;
        } else {
          idxInGroup++;
        }

        if (!isJapan) {
          seenGlobalGroupIds.add(row.group_id);
        } else if (seenGlobalGroupIds.has(row.group_id)) {
          continue;
        }

        const jp = cleanDialogueText(row.text_jp ?? "");
        if (!jp) continue;
        const parsed = parseScriptKr(row.script_kr ?? "");
        if (parsed.kind !== "speech") continue;

        const resolved = resolver.resolveByScriptKrKey(parsed.speakerKey);
        if (!resolved.characterId) {
          scenarioSpeechUnresolved++;
          const prev = unresolvedCounts.get(parsed.speakerKey);
          if (prev) {
            prev.count++;
          } else {
            unresolvedCounts.set(parsed.speakerKey, {
              krKey: parsed.speakerKey,
              ...(resolved.entry?.name_jp
                ? { jpName: resolved.entry.name_jp }
                : {}),
              ...(resolved.entry?.name_en
                ? { enName: resolved.entry.name_en }
                : {}),
              count: 1,
            });
          }
          continue;
        }

        scenarioSpeechResolved++;
        const sourceType =
          storyLabels[String(row.group_id)]?.sourceType ?? "main_story";
        const en = cleanDialogueText(row.text_en ?? "");
        const jpOnly = isJapan || !en;

        await writeJsonlLine(outStream, {
          speakerId: resolved.characterId,
          sourceType,
          sourceRef: `script:${row.group_id}#${idxInGroup}`,
          groupId: row.group_id,
          jp,
          kr: parsed.textKr,
          ...(!isJapan && en ? { en } : {}),
          jpOnly,
        });

        indexedLinesTotal++;
        bySourceType[sourceType]++;
        if (isJapan) jpOnlyDeltaLines++;
      }
    }
  }

  // 2. AcademyMessangerExcel (Momotalk) — exclude message_condition === 3 (Sensei choices)
  const seenMomoKeys = new Set<string>();
  for (const branch of ["global", "japan"] as const) {
    const isJapan = branch === "japan";
    const momo = await readJson<ExcelTableWrapper<AcademyMessangerRow>>(
      manifest[branch].tables["AcademyMessangerExcel.json"]
    );
    for (const row of momo.data_list) {
      if (row.message_condition === 3) continue;
      const key = `${row.message_group_id}:${row.id}`;
      if (!isJapan) {
        seenMomoKeys.add(key);
      } else if (seenMomoKeys.has(key)) {
        continue;
      }

      const speakerId = resolver.resolveByStudentId(row.character_id);
      if (!speakerId) continue;

      const jp = cleanDialogueText(row.message_jp ?? "");
      const kr = cleanDialogueText(row.message_kr ?? "");
      const en = cleanDialogueText(row.message_en ?? "");
      if (!jp || !kr) continue;

      await writeJsonlLine(outStream, {
        speakerId,
        sourceType: "momotalk",
        sourceRef: `momo:${row.message_group_id}#${row.id}`,
        jp,
        kr,
        ...(!isJapan && en ? { en } : {}),
        jpOnly: isJapan || !en,
      });

      indexedLinesTotal++;
      bySourceType.momotalk++;
      if (isJapan) jpOnlyDeltaLines++;
    }
  }

  // 3. CharacterDialogExcel (Lobby / Cafe / Voice lines)
  const seenDialogKeys = new Set<string>();
  for (const branch of ["global", "japan"] as const) {
    const isJapan = branch === "japan";
    const dlg = await readJson<ExcelTableWrapper<CharacterDialogRow>>(
      manifest[branch].tables["CharacterDialogExcel.json"]
    );
    for (const row of dlg.data_list) {
      const key = `${row.character_id}:${row.dialog_category}:${row.group_id}:${row.display_order}`;
      if (!isJapan) {
        seenDialogKeys.add(key);
      } else if (seenDialogKeys.has(key)) {
        continue;
      }

      const speakerId = resolver.resolveByStudentId(row.character_id);
      if (!speakerId) continue;

      const jp = cleanDialogueText(row.localize_jp ?? "");
      const kr = cleanDialogueText(row.localize_kr ?? "");
      const en = cleanDialogueText(row.localize_en ?? "");
      if (!jp || !kr) continue;

      await writeJsonlLine(outStream, {
        speakerId,
        sourceType: "dialog",
        sourceRef: `dialog:${row.character_id}:${row.group_id}`,
        jp,
        kr,
        ...(!isJapan && en ? { en } : {}),
        jpOnly: isJapan || !en,
      });

      indexedLinesTotal++;
      bySourceType.dialog++;
      if (isJapan) jpOnlyDeltaLines++;
    }
  }

  // 4. CharacterDialogEventExcel (Event shop / menu lines)
  const seenEventDialogKeys = new Set<string>();
  for (const branch of ["global", "japan"] as const) {
    const isJapan = branch === "japan";
    const evDlg = await readJson<ExcelTableWrapper<CharacterDialogEventRow>>(
      manifest[branch].tables["CharacterDialogEventExcel.json"]
    );
    for (const row of evDlg.data_list) {
      if (!row.original_character_id) continue;
      const key = `${row.original_character_id}:${row.event_id}:${row.dialog_category}:${row.group_id}:${row.display_order}`;
      if (!isJapan) {
        seenEventDialogKeys.add(key);
      } else if (seenEventDialogKeys.has(key)) {
        continue;
      }

      const speakerId = resolver.resolveByStudentId(row.original_character_id);
      if (!speakerId) continue;

      const jp = cleanDialogueText(row.localize_jp ?? "");
      const kr = cleanDialogueText(row.localize_kr ?? "");
      const en = cleanDialogueText(row.localize_en ?? "");
      if (!jp || !kr) continue;

      await writeJsonlLine(outStream, {
        speakerId,
        sourceType: "dialog",
        sourceRef: `event_dialog:${row.original_character_id}:${row.event_id}:${row.group_id}`,
        jp,
        kr,
        ...(!isJapan && en ? { en } : {}),
        jpOnly: isJapan || !en,
      });

      indexedLinesTotal++;
      bySourceType.dialog++;
      if (isJapan) jpOnlyDeltaLines++;
    }
  }

  await new Promise<void>((resolve, reject) => {
    outStream.on("error", reject);
    outStream.end(resolve);
  });
  await fs.rename(tmpIndexPath, DIALOGUE_INDEX_PATH);

  const topUnresolvedSpeakers = Array.from(unresolvedCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  report.milestone = Math.max(report.milestone, 2);
  report.generatedAt = new Date().toISOString();
  report.gameScripts = {
    globalVersion: manifest.globalVersion,
    japanVersion: manifest.japanVersion,
    indexedLinesTotal,
    bySourceType,
    jpOnlyDeltaLines,
    scenarioSpeechResolved,
    scenarioSpeechUnresolved,
    topUnresolvedSpeakers,
    storyLabelCount: Object.keys(storyLabels).length,
    enrichedNpcCount,
  };

  await Promise.all([
    writeJson(STORY_LABELS_PATH, storyLabels, false),
    writeJson(charactersPath, charactersOutput),
    writeJson(reportPath, report),
  ]);
}
