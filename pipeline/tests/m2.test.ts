import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpeakerResolver,
  buildStoryLabelMap,
} from "../src/steps/05b_index_dialogues.js";
import type { Character } from "../src/types.js";
import { cleanDialogueText, parseScriptKr } from "../src/utils/text.js";
import { xxhash32 } from "../src/utils/xxhash32.js";

test("xxhash32 matches verified Blue Archive ScenarioCharacterName hashes", () => {
  assert.equal(xxhash32("유우카"), 4283125014);
  assert.equal(xxhash32("통신린"), 221034629);
  assert.equal(xxhash32("와카모 마스크"), 664677038);
  assert.equal(xxhash32("하스미"), 3571276574);
  assert.equal(xxhash32("호시노"), 85542774);
  assert.equal(xxhash32("카구야"), 306877243);
  assert.equal(xxhash32("키사키"), 536816420);
  assert.equal(xxhash32("루미"), 4143878150);
});

test("cleanDialogueText strips markup while preserving [USERNAME] and line breaks", () => {
  const raw =
    "[FF6666]……[ruby=われわれ]我々[/ruby]は望む#n[USERNAME]先生！[-]";
  assert.equal(cleanDialogueText(raw), "……我々は望む\n[USERNAME]先生！");
});

test("parseScriptKr distinguishes speech, multi-line expression+speech, #na, Sensei choices, and directives", () => {
  assert.deepEqual(
    parseScriptKr("3;유우카;05;샬레의 동아리 실은 이제 눈 앞이야!\n#3;em;[반응]"),
    {
      kind: "speech",
      speakerKey: "유우카",
      textKr: "샬레의 동아리 실은 이제 눈 앞이야!",
    }
  );

  assert.deepEqual(
    parseScriptKr("3;키사키;05\n1;루미;00;자, 자; 잠깐만!"),
    {
      kind: "speech",
      speakerKey: "루미",
      textKr: "자, 자; 잠깐만!",
    }
  );

  assert.deepEqual(
    parseScriptKr(
      "3;와카모 마스크;01\n#na;통신린;와카모. 백귀야행 연합 학원에서...\n#3;h"
    ),
    {
      kind: "speech",
      speakerKey: "통신린",
      textKr: "와카모. 백귀야행 연합 학원에서...",
    }
  );

  assert.deepEqual(parseScriptKr("#NA;호시노;잠깐만 기다려"), {
    kind: "speech",
    speakerKey: "호시노",
    textKr: "잠깐만 기다려",
  });

  assert.deepEqual(parseScriptKr("#na;그렇게 하루가 저물었다."), {
    kind: "narration",
    textKr: "그렇게 하루가 저물었다.",
  });

  assert.deepEqual(parseScriptKr("[s1] 고개를 끄덕인다."), {
    kind: "sensei_choice",
    textKr: "고개를 끄덕인다.",
  });

  assert.deepEqual(parseScriptKr("[ns2] 대책위원회를 버린다."), {
    kind: "sensei_choice",
    textKr: "대책위원회를 버린다.",
  });

  assert.deepEqual(parseScriptKr("#all;hide\n#wait;1500\n#bgshake"), {
    kind: "directive",
  });
});

test("buildStoryLabelMap maps bond, event, and main story group IDs in 3 languages", () => {
  const hoshino: Character = {
    id: "hoshino",
    kind: "student",
    primaryStudentId: 10005,
    name: { jp: "ホシノ", en: "Hoshino", kr: "호시노" },
    school: "Abydos",
    released: { jp: true, global: true, cn: true },
    defaultImages: { icon: "" },
    variants: [],
    aliases: { jp: [], kr: [], en: [] },
  };

  const labels = buildStoryLabelMap({
    favorSchedules: [
      {
        id: 1,
        character_id: 10005,
        order_in_group: 2,
        scenario_sript_group_id: 1000502,
      },
    ],
    eventScenarios: [
      {
        id: 2,
        event_content_id: 801,
        order: 3,
        scenario_group_id: [10000005],
      },
    ],
    scenarioModes: [
      {
        mode_id: 11010,
        mode_type: 1,
        volume_id: 1,
        chapter_id: 1,
        episode_id: 2,
        front_scenario_group_id: [11002],
        back_scenario_group_id: [],
      },
      {
        mode_id: 10000,
        mode_type: 6,
        volume_id: 1,
        chapter_id: 1,
        episode_id: 1,
        front_scenario_group_id: [11000],
        back_scenario_group_id: [],
      },
      {
        mode_id: 101010,
        mode_type: 1,
        volume_id: 100,
        chapter_id: 3,
        episode_id: 7,
        front_scenario_group_id: [101037],
        back_scenario_group_id: [],
      },
      {
        mode_id: 1701,
        mode_type: 2,
        volume_id: 7,
        chapter_id: 1,
        episode_id: 1,
        front_scenario_group_id: [1701],
        back_scenario_group_id: [],
      },
      {
        mode_id: 201010,
        mode_type: 1,
        sub_type: 3,
        display_volume_id: "0",
        volume_id: 1,
        chapter_id: 1,
        episode_id: 1,
        front_scenario_group_id: [201010],
        back_scenario_group_id: [],
      },
      {
        mode_id: 90002210,
        mode_type: 5,
        sub_type: 2,
        volume_id: 1,
        chapter_id: 2,
        episode_id: 21,
        front_scenario_group_id: [90002210],
        back_scenario_group_id: [],
      },
      {
        mode_id: 90100020,
        mode_type: 5,
        sub_type: 3,
        volume_id: 1,
        chapter_id: 1,
        episode_id: 2,
        front_scenario_group_id: [90100020],
        back_scenario_group_id: [],
      },
      {
        mode_id: 200001,
        mode_type: 6,
        sub_type: 3,
        volume_id: 1,
        chapter_id: 1,
        episode_id: 1,
        front_scenario_group_id: [200001],
        back_scenario_group_id: [],
      },
    ],
    eventNamesEn: { "801": "Cherry Blossom Festival Commotion!" },
    eventNamesJp: { "801": "桜花爛漫お祭り騒ぎ！" },
    eventNamesKr: { "801": "벚꽃만발 축제대소동!" },
    charByStudentId: new Map([[10005, hoshino]]),
  });

  assert.equal(labels["1000502"]?.sourceType, "bond_story");
  assert.equal(labels["1000502"]?.sourceLabel.en, "Hoshino Bond Story #2");
  assert.equal(labels["10000005"]?.sourceType, "event_story");
  assert.equal(
    labels["10000005"]?.sourceLabel.jp,
    "イベント「桜花爛漫お祭り騒ぎ！」#3"
  );
  assert.equal(labels["11002"]?.sourceType, "main_story");
  assert.equal(labels["11002"]?.sourceLabel.kr, "메인 스토리 Vol.1 1장 2화");
  assert.equal(labels["11000"]?.sourceLabel.en, "Prologue Ep.1");
  assert.equal(labels["101037"]?.sourceLabel.en, "Main Story Vol.F Ch.3 Ep.7");
  assert.equal(labels["1701"]?.sourceLabel.en, "Group Story #7 Ep.1");
  assert.equal(labels["201010"]?.sourceLabel.en, "Main Story Part 2 Vol.0 Ch.1 Ep.1");
  assert.equal(labels["90002210"]?.sourceLabel.en, "Main Story Vol.EX (Decagrammaton) Ch.2 Ep.21");
  assert.equal(labels["90100020"]?.sourceLabel.en, "Main Story Part 2 Vol.EX Ch.1 Ep.2");
  assert.equal(labels["200001"]?.sourceLabel.en, "Main Story Part 2 Prologue Ep.1");
});

test("buildSpeakerResolver resolves masked/comms speakers via hash and enriches NPC names", () => {
  const wakamo: Character = {
    id: "wakamo",
    kind: "student",
    primaryStudentId: 10035,
    name: { jp: "ワカモ", en: "Wakamo", kr: "와카모" },
    school: "Hyakkiyako",
    released: { jp: true, global: true, cn: true },
    defaultImages: { icon: "" },
    variants: [
      {
        id: 10035,
        pathName: "wakamo",
        devName: "Wakamo",
        name: { jp: "ワカモ", en: "Wakamo", kr: "와카모" },
        isBase: true,
        isLimited: 1,
        released: { jp: true, global: true, cn: true },
        images: { icon: "", collection: "", portrait: "" },
      },
    ],
    aliases: { jp: ["ワカモ"], kr: ["와카모"], en: ["Wakamo"] },
  };
  const kaguya: Character = {
    id: "npc:kaguya",
    kind: "npc",
    wikiruAnchor: "Kaguya",
    name: { jp: "カグヤ", en: "Kaguya", kr: "カグヤ" },
    school: "Shanhaijing",
    released: { jp: true, global: false, cn: false },
    defaultImages: { icon: "" },
    variants: [],
    aliases: { jp: ["カグヤ"], kr: [], en: [] },
  };

  const resolver = buildSpeakerResolver(
    [wakamo, kaguya],
    [
      {
        character_name: 664677038,
        name_kr: "와카모",
        name_jp: "ワカモ",
        name_en: "Wakamo",
      },
      {
        character_name: 306877243,
        name_kr: "카구야",
        name_jp: "カグヤ",
        name_en: "Kaguya",
      },
    ],
    []
  );

  assert.equal(resolver.resolveByScriptKrKey("와카모 마스크").characterId, "wakamo");
  assert.equal(resolver.resolveByScriptKrKey("카구야").characterId, "npc:kaguya");

  const enriched = resolver.enrichNpcs([wakamo, kaguya]);
  assert.equal(enriched, 1);
  assert.equal(kaguya.name.kr, "카구야");
});
