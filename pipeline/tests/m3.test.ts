import assert from "node:assert/strict";
import test from "node:test";
import { buildSpeakerResolver } from "../src/steps/05b_index_dialogues.js";
import { xxhash32 } from "../src/utils/xxhash32.js";
import {
  classifyJpTermAmbiguity,
  classifyKrSpeechLevel,
  extractEnAppellations,
  extractKrAppellations,
  extractStandaloneVocative,
  extractZhAppellations,
  findMatchedJpTerms,
  isDirectSecondPersonAddressee,
  isGenericShirokoTerm,
  matchesDecagrammatonAnokata,
  matchesGscPresidentScene,
  matchesHomographPronounDirection,
  matchesShirokoVariantScene,
  mineSharedPhrasesForJpTerm,
  normalizeEnCaseVariants,
  normalizeEnStutters,
  selectCitations,
  selectPerTermCitations,
} from "../src/steps/06_extract_multilang.js";
import { applyManualOverrides } from "../src/steps/07_compile_outputs.js";
import type {
  AppellationsOutput,
  Character,
  CharactersOutput,
} from "../src/types.js";

function makeChar(overrides: Partial<Character>): Character {
  return {
    id: "hoshino",
    kind: "student",
    name: { jp: "ホシノ", en: "Hoshino", kr: "호시노" },
    school: "Abydos",
    released: { jp: true, global: true, cn: true },
    defaultImages: { icon: "" },
    variants: [],
    aliases: { jp: [], kr: [], en: [] },
    ...overrides,
  };
}

test("findMatchedJpTerms prioritizes longest matches and guards 1-char kanji pronouns", () => {
  assert.deepEqual(
    findMatchedJpTerms("シロコちゃん、シロコのバッグ", ["シロコ", "シロコちゃん"]),
    ["シロコちゃん", "シロコ"]
  );
  assert.deepEqual(
    findMatchedJpTerms("シロコちゃんおはよう", ["シロコ", "シロコちゃん"]),
    ["シロコちゃん"]
  );
  assert.deepEqual(
    findMatchedJpTerms("私立の私服で下僕になった", ["私", "僕"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("私は私達のために行く", ["私"]),
    ["私"]
  );
  assert.deepEqual(
    findMatchedJpTerms("アリス君は強い", ["君"], true),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("私は美食研究会です", ["私(わたくし)"]),
    ["私(わたくし)"]
  );
  assert.deepEqual(
    findMatchedJpTerms("[USERNAME]先生、準備できました", ["(○○)先生"]),
    ["(○○)先生"]
  );
});

test("findMatchedJpTerms guards singular pronouns against plural suffixes like 私たち / 私達 / 我々", () => {
  assert.deepEqual(
    findMatchedJpTerms(
      "私たち万魔殿と風紀委員会は、これまでいがみ合ってきましたね。",
      ["私"]
    ),
    []
  );
  assert.deepEqual(findMatchedJpTerms("私達のために行く", ["私"]), []);
  assert.deepEqual(
    findMatchedJpTerms("私共にお任せください", ["私(わたくし)"]),
    []
  );
  assert.deepEqual(findMatchedJpTerms("我々の勝利だ", ["我"]), []);
  assert.deepEqual(findMatchedJpTerms("僕たちは負けない", ["僕"]), []);
  assert.deepEqual(findMatchedJpTerms("俺らの出番だ", ["俺"]), []);
  assert.deepEqual(findMatchedJpTerms("あなた方の責任です", ["あなた"]), []);
  assert.deepEqual(
    findMatchedJpTerms("私らしいやり方でやります", ["私"]),
    ["私"]
  );
  assert.deepEqual(findMatchedJpTerms("私めにお任せを", ["私"]), ["私"]);
  assert.deepEqual(
    findMatchedJpTerms("私たちで行こう", ["私たち", "私"]),
    ["私たち"]
  );
});

test("classifyKrSpeechLevel classifies formal, polite, casual, mixed, and unknown", () => {
  assert.equal(
    classifyKrSpeechLevel([
      "제가 준비하겠습니다.",
      "확인했습니다!",
      "기다리겠습니다.",
    ]).speechLevel,
    "formal"
  );
  assert.equal(
    classifyKrSpeechLevel([
      "오늘 날씨가 좋네요.",
      "같이 가실래요?",
      "그렇군요.",
    ]).speechLevel,
    "polite"
  );
  assert.equal(
    classifyKrSpeechLevel([
      "오늘 날씨 좋네.",
      "같이 갈래?",
      "빨리 가자!",
    ]).speechLevel,
    "casual"
  );
  assert.equal(
    classifyKrSpeechLevel([
      "지금 가고 있어.",
      "조금만 기다려 주세요.",
    ]).speechLevel,
    "mixed"
  );
  assert.equal(classifyKrSpeechLevel(["……."]).speechLevel, "unknown");
});

test("extractKrAppellations extracts particles-stripped names, honorifics, sensei variants, and self-terms", () => {
  const hoshino = makeChar({});
  const shiroko = makeChar({
    id: "shiroko",
    name: { jp: "シロコ", en: "Shiroko", kr: "시로코" },
  });
  const hina = makeChar({
    id: "hina",
    name: { jp: "ヒナ", en: "Hina", kr: "히나" },
  });
  const nagisa = makeChar({
    id: "nagisa",
    name: { jp: "ナギサ", en: "Nagisa", kr: "나기사" },
  });
  const self = makeChar({ id: "special:self", kind: "special" });
  const sensei = makeChar({ id: "special:sensei", kind: "special" });

  assert.deepEqual(
    extractKrAppellations("이야, 시로코 쨩이 직접 바느질한 거야?", {
      speaker: hoshino,
      target: shiroko,
      matchedJpTerms: ["シロコちゃん"],
    }),
    ["시로코 쨩"]
  );

  assert.deepEqual(
    extractKrAppellations("히나 부장님은 지금 성소 공략전에 참가하셨어요.", {
      speaker: hoshino,
      target: hina,
      matchedJpTerms: ["ヒナ委員長"],
    }),
    ["히나 부장님"]
  );

  assert.deepEqual(
    extractKrAppellations("응, 잘 봐! 나기 쨩.", {
      speaker: hoshino,
      target: nagisa,
      matchedJpTerms: ["ナギちゃん"],
    }),
    ["나기 쨩"]
  );

  assert.deepEqual(
    extractKrAppellations("다음에 또 보지. 선생.", {
      speaker: hina,
      target: sensei,
      matchedJpTerms: ["先生"],
    }),
    ["선생"]
  );

  assert.deepEqual(
    extractKrAppellations("이 아저씨는 전혀 모르겠는데.", {
      speaker: hoshino,
      target: self,
      matchedJpTerms: ["おじさん"],
    }),
    ["이 아저씨"]
  );
});

test("extractEnAppellations normalizes stutters, matches nicknames, detects drops, and ignores generic 'I'", () => {
  const ako = makeChar({
    id: "ako",
    name: { jp: "アコ", en: "Ako", kr: "아코" },
  });
  const hina = makeChar({
    id: "hina",
    name: { jp: "ヒナ", en: "Hina", kr: "히나" },
  });
  const nagisa = makeChar({
    id: "nagisa",
    name: { jp: "ナギサ", en: "Nagisa", kr: "나기사" },
  });
  const aris = makeChar({
    id: "aris",
    name: { jp: "アリス", en: "Aris", kr: "아리스" },
  });
  const self = makeChar({ id: "special:self", kind: "special" });

  assert.deepEqual(
    extractEnAppellations("P-President Hina?!", {
      speaker: ako,
      target: hina,
      matchedJpTerms: ["ヒナ委員長"],
    }),
    ["President Hina"]
  );

  assert.deepEqual(
    extractEnAppellations("Hold on, Nagi. Are we going?", {
      speaker: ako,
      target: nagisa,
      matchedJpTerms: ["ナギちゃん"],
    }),
    ["Nagi"]
  );

  assert.deepEqual(
    extractEnAppellations("Wait, what did you just say?!", {
      speaker: ako,
      target: hina,
      matchedJpTerms: ["ヒナ委員長"],
    }),
    []
  );

  assert.deepEqual(
    extractEnAppellations("I am ready! Aris, starting game.", {
      speaker: aris,
      target: self,
      matchedJpTerms: ["アリス"],
    }),
    ["Aris"]
  );

  assert.deepEqual(
    extractEnAppellations("I am going to sleep now.", {
      speaker: ako,
      target: self,
      matchedJpTerms: ["私"],
    }),
    []
  );
});

test("applyManualOverrides patches, inserts, and deletes entries deterministically", () => {
  const charsOut: CharactersOutput = {
    meta: {
      generatedAt: "2026-01-01T00:00:00Z",
      schaleDbStudentCount: 1,
      playableCharacterCount: 1,
      npcCount: 0,
      entityCount: 0,
      totalCharacterCount: 1,
    },
    schools: {},
    clubs: {},
    characters: [makeChar({ id: "hoshino" })],
  };

  const appsOut: AppellationsOutput = {
    meta: {
      generatedAt: "2026-01-01T00:00:00Z",
      globalVersion: "1",
      japanVersion: "1",
      totalPairs: 2,
      statusCounts: { verified: 2, jp_only_seed: 0, en_pending: 0, manual: 0 },
    },
    entries: [
      {
        id: "hoshino->shiroko",
        speakerId: "hoshino",
        targetId: "shiroko",
        status: "verified",
        jp: [{ term: "シロコちゃん", count: 10, source: "wikiru" }],
        kr: { terms: [{ term: "시로코 쨩", count: 10, source: "extracted" }], speechLevel: "casual" },
        en: { terms: [{ term: "Shiroko", count: 9, source: "extracted" }], droppedCount: 1 },
        matchedLineCount: 10,
        citations: [],
      },
      {
        id: "hoshino->entity:junk",
        speakerId: "hoshino",
        targetId: "entity:junk",
        status: "verified",
        jp: [],
        kr: { terms: [], speechLevel: "unknown" },
        en: { terms: [], droppedCount: 0 },
        matchedLineCount: 0,
        citations: [],
      },
    ],
  };

  const merged = applyManualOverrides(charsOut, appsOut, {
    appellations: {
      "hoshino->entity:junk": { delete: true },
      "hoshino->shiroko": {
        en: { terms: [{ term: "Shiroko", count: 10, source: "manual" }], droppedCount: 0 },
      },
      "hoshino->custom": {
        speakerId: "hoshino",
        targetId: "custom",
        jp: [{ term: "カスタム", count: 0, source: "manual" }],
      },
    },
  });

  assert.equal(merged.appellationsModified, 3);
  assert.equal(merged.appellationsOutput.meta.totalPairs, 2);
  assert.equal(merged.appellationsOutput.meta.statusCounts.manual, 2);
  assert.equal(
    merged.appellationsOutput.entries.find((e) => e.id === "hoshino->entity:junk"),
    undefined
  );
  assert.equal(
    merged.appellationsOutput.entries.find((e) => e.id === "hoshino->shiroko")?.en.droppedCount,
    0
  );
});

test("extractKrAppellations and extractEnAppellations preserve [USERNAME] Sensei variants distinctly", () => {
  const sumika = makeChar({
    id: "npc:sumika",
    kind: "npc",
    name: { jp: "スミカ", en: "Sumika", kr: "스미카" },
  });
  const sensei = makeChar({ id: "special:sensei", kind: "special" });

  assert.deepEqual(
    extractKrAppellations("어머, [USERNAME] 선생님?! 어서 오세요!", {
      speaker: sumika,
      target: sensei,
      matchedJpTerms: ["(○○)先生"],
    }),
    ["[USERNAME] 선생님"]
  );

  assert.deepEqual(
    extractEnAppellations("Oh my, [USERNAME] Sensei! Welcome!", {
      speaker: sumika,
      target: sensei,
      matchedJpTerms: ["(○○)先生"],
    }),
    ["[USERNAME] Sensei"]
  );
});

test("selectCitations covers distinct KR/EN variants and prioritizes [USERNAME] lines for placeholder terms", () => {
  const citations = selectCitations(
    [
      {
        line: {
          speakerId: "npc:sumika",
          sourceType: "event_story",
          sourceRef: "script:1#1",
          jp: "先生、こちらへどうぞ！",
          kr: "선생님, 이쪽으로 오세요!",
          en: "Sensei, please come this way!",
          jpOnly: false,
        },
        matchedJpTerm: "(○○)先生",
        matchedKrTerm: "선생님",
        matchedEnTerm: "Sensei",
        hasKr: true,
        hasEn: true,
        hasUsernamePlaceholder: false,
      },
      {
        line: {
          speakerId: "npc:sumika",
          sourceType: "main_story",
          sourceRef: "script:2#1",
          jp: "え、そちらは[USERNAME]先生ですね！",
          kr: "어, 그쪽은 [USERNAME] 선생님이시군요!",
          en: "Oh, you must be [USERNAME] Sensei!",
          jpOnly: false,
        },
        matchedJpTerm: "(○○)先生",
        matchedKrTerm: "[USERNAME] 선생님",
        matchedEnTerm: "[USERNAME] Sensei",
        hasKr: true,
        hasEn: true,
        hasUsernamePlaceholder: true,
      },
    ],
    {},
    5
  );

  assert.equal(citations.length, 2);
  assert.equal(citations[0].matchedKrTerm, "[USERNAME] 선생님");
  assert.equal(citations[0].matchedEnTerm, "[USERNAME] Sensei");
  assert.equal(citations[1].matchedKrTerm, "선생님");
});

test("classifyJpTermAmbiguity separates pronouns, generic titles, and specific terms", () => {
  const maia = makeChar({
    id: "npc:maia",
    kind: "npc",
    name: { jp: "マイア", en: "Maia", kr: "마이아" },
  });
  const manami = makeChar({
    id: "npc:manami",
    kind: "npc",
    name: { jp: "マナミ", en: "Manami", kr: "마나미" },
  });
  const self = makeChar({ id: "special:self", kind: "special" });

  assert.equal(classifyJpTermAmbiguity("あなた", maia), "pronoun");
  assert.equal(classifyJpTermAmbiguity("先輩", maia), "generic_title");
  assert.equal(classifyJpTermAmbiguity("評議会長", manami), "specific");
  assert.equal(classifyJpTermAmbiguity("マイアちゃん", maia), "specific");
  assert.equal(classifyJpTermAmbiguity("私", self), "specific");
});

test("評議会長 extracts Assembly President and 평의회장님, and self-introductions do not false-match 3rd-person names", () => {
  const eri = makeChar({
    id: "eri",
    name: { jp: "エリ", en: "Eri", kr: "에리" },
  });
  const manami = makeChar({
    id: "npc:manami",
    kind: "npc",
    name: { jp: "マナミ", en: "Manami", kr: "마나미" },
  });
  const malkuth = makeChar({
    id: "npc:malkuth",
    kind: "npc",
    name: { jp: "マルクト", en: "Malkuth", kr: "말쿠트" },
  });
  const self = makeChar({ id: "special:self", kind: "special" });

  assert.deepEqual(
    extractKrAppellations("평의회장님께서 직접 전할 말이 있다 하시네요.", {
      speaker: eri,
      target: manami,
      matchedJpTerms: ["評議会長"],
    }),
    ["평의회장님"]
  );
  assert.deepEqual(
    extractEnAppellations("The Assembly President requests a word.", {
      speaker: eri,
      target: manami,
      matchedJpTerms: ["評議会長"],
    }),
    ["Assembly President"]
  );

  assert.deepEqual(
    extractEnAppellations("Hello, Ein's siblings and children. I am Malkuth.", {
      speaker: malkuth,
      target: self,
      matchedJpTerms: ["我"],
    }),
    []
  );
  assert.deepEqual(
    extractKrAppellations("저는 말쿠트라고 한답니다.", {
      speaker: malkuth,
      target: self,
      matchedJpTerms: ["我"],
    }),
    ["저"]
  );
});

test("バイト / アルバイト and ワニちゃん extract EN and KR titles cleanly", () => {
  const djbob = makeChar({
    id: "npc:djbob",
    kind: "npc",
    name: { jp: "DJ B.o.B", en: "DJ B.o.B", kr: "DJ B.o.B" },
  });
  const saori = makeChar({
    id: "saori",
    name: { jp: "サオリ", en: "Saori", kr: "사오리" },
  });
  const airi = makeChar({
    id: "airi",
    name: { jp: "アイリ", en: "Airi", kr: "아이리" },
  });
  const mechaCroc = makeChar({
    id: "entity:mecha_croc",
    kind: "entity",
    name: { jp: "メカワニ", en: "Mecha-Croc", kr: "메카 악어" },
  });

  assert.deepEqual(
    extractKrAppellations("야! 거기 알바! 그거 비싼 거니까 조심해서 옮겨!", {
      speaker: djbob,
      target: saori,
      matchedJpTerms: ["バイト"],
    }),
    ["알바"]
  );
  assert.deepEqual(
    extractKrAppellations("알바! 아니, 알바 양!", {
      speaker: djbob,
      target: saori,
      matchedJpTerms: ["バイト"],
    }),
    ["알바 양"]
  );
  assert.deepEqual(
    extractEnAppellations("Hey! Part-timer! Be careful with that. It's expensive!", {
      speaker: djbob,
      target: saori,
      matchedJpTerms: ["バイト"],
    }),
    ["Part-timer"]
  );
  assert.deepEqual(
    extractEnAppellations("Part-timer! Um, Miss Part-timer!", {
      speaker: djbob,
      target: saori,
      matchedJpTerms: ["バイト"],
    }),
    ["Miss Part-timer"]
  );

  assert.deepEqual(
    extractKrAppellations("그, 그래도 악어…… 꽤 귀여웠으니까! 난 좋았다고 생각해!", {
      speaker: airi,
      target: mechaCroc,
      matchedJpTerms: ["ワニちゃん"],
    }),
    ["악어"]
  );
  assert.deepEqual(
    extractEnAppellations("W-Well, the crocodile was cute! I kind of liked it!", {
      speaker: airi,
      target: mechaCroc,
      matchedJpTerms: ["ワニちゃん"],
    }),
    ["crocodile"]
  );
});

test("applyManualOverrides preserves patched citation matches and synced terms on recompile", () => {
  const charsOut: CharactersOutput = {
    meta: {
      generatedAt: "2026-01-01",
      schaleDbStudentCount: 1,
      playableCharacterCount: 1,
      npcCount: 0,
      entityCount: 0,
      totalCharacterCount: 1,
    },
    schools: {},
    clubs: {},
    characters: [
      makeChar({
        id: "aris",
        name: { jp: "アリス", en: "Aris", kr: "아리스" },
      }),
    ],
  };

  const appsOut: AppellationsOutput = {
    meta: {
      generatedAt: "2026-01-01",
      globalVersion: "1",
      japanVersion: "1",
      totalPairs: 1,
      statusCounts: { verified: 1, jp_only_seed: 0, en_pending: 0, manual: 0 },
    },
    entries: [
      {
        id: "aris->special:self",
        speakerId: "aris",
        targetId: "special:self",
        status: "verified",
        jp: [{ term: "アリス", count: 10, source: "wikiru" }],
        kr: { terms: [{ term: "저", count: 5, source: "extracted" }], speechLevel: "polite" },
        en: { terms: [{ term: "Aris", count: 8, source: "extracted" }], droppedCount: 0 },
        matchedLineCount: 10,
        citations: [
          {
            sourceType: "main_story",
            sourceLabel: { jp: "Main", en: "Main", kr: "Main" },
            sourceRef: "123",
            jp: "初めまして！天童アリスといいます！",
            kr: "안녕하세요! 저는 텐도 아리스라고 합니다!",
            en: "Hello! I am Tendou Aris!",
            matchedJpTerm: "アリス",
            matchedKrTerm: "저",
            matchedEnTerm: "Aris",
          },
        ],
      },
    ],
  };

  const merged = applyManualOverrides(charsOut, appsOut, {
    appellations: {
      "aris->special:self": {
        jp: [
          { term: "アリス", count: 10, source: "wikiru" },
          { term: "天童アリス", count: 1, source: "manual" },
        ],
        kr: {
          terms: [
            { term: "저", count: 5, source: "extracted" },
            { term: "텐도 아리스", count: 1, source: "manual" },
          ],
          speechLevel: "polite",
        },
        en: {
          terms: [
            { term: "Aris", count: 8, source: "extracted" },
            { term: "Tendou Aris", count: 1, source: "manual" },
          ],
          droppedCount: 0,
        },
        citations: [
          {
            ...appsOut.entries[0].citations[0],
            matchedJpTerm: "天童アリス",
            matchedKrTerm: "텐도 아리스",
            matchedEnTerm: "Tendou Aris",
          },
        ],
      },
    },
  });

  const updated = merged.appellationsOutput.entries[0];
  assert.equal(updated.status, "manual");
  assert.equal(updated.citations[0].matchedJpTerm, "天童アリス");
  assert.equal(updated.citations[0].matchedKrTerm, "텐도 아리스");
  assert.equal(updated.citations[0].matchedEnTerm, "Tendou Aris");
  assert.ok(updated.en.terms.some((t) => t.term === "Tendou Aris"));
  assert.ok(updated.kr.terms.some((t) => t.term === "텐도 아리스"));
});

test("Shuro's homograph 手前 is guarded against 手前さん/様 and separated between 1st-person and 2nd-person", () => {
  assert.deepEqual(findMatchedJpTerms("手前様の出番ですよぉ。", ["手前"]), []);
  assert.deepEqual(findMatchedJpTerms("手前さんにもお裾分けです。", ["手前"]), []);
  assert.deepEqual(findMatchedJpTerms("ナグサちゃん、特に手前。", ["手前"]), ["手前"]);

  const niya = makeChar({
    id: "niya",
    name: { jp: "ニヤ", en: "Niya", kr: "니야" },
  });
  assert.equal(classifyJpTermAmbiguity("手前(てめえ)", niya), "pronoun");

  const firstPersonLine = {
    jp: "手前の話をきち～んと、聞いてくださったこと。",
    kr: "저의 이야기를, 허투루 듣지 않아 주셔서~",
    en: "For being a witness to my story.",
  };
  assert.equal(
    matchesHomographPronounDirection(firstPersonLine, "special:self", "手前(てまえ)", true),
    true
  );
  assert.equal(
    matchesHomographPronounDirection(firstPersonLine, "nagusa", "手前", true),
    false
  );

  const secondPersonLine = {
    jp: "ナグサちゃん、手前はアヤメを助けられなかったのにねぇ？",
    kr: "정작 네놈이, 이미 아야메는 구할 수도 없었던 얼간이란 사실을 말이에요.",
    en: "After all, you're the coward who couldn't save Ayame.",
  };
  assert.equal(
    matchesHomographPronounDirection(secondPersonLine, "special:self", "手前(てまえ)", true),
    false
  );
  assert.equal(
    matchesHomographPronounDirection(secondPersonLine, "nagusa", "手前", true),
    true
  );

  const shuro = makeChar({
    id: "npc:shuro",
    kind: "npc",
    name: { jp: "シュロ", en: "Shuro", kr: "슈로" },
  });
  const nagusa = makeChar({
    id: "nagusa",
    name: { jp: "ナグサ", en: "Nagusa", kr: "나구사" },
  });
  assert.deepEqual(
    extractKrAppellations(secondPersonLine.kr, {
      speaker: shuro,
      target: nagusa,
      matchedJpTerms: ["手前(てめぇ)"],
    }),
    ["네놈"]
  );
  assert.deepEqual(
    extractEnAppellations(secondPersonLine.en, {
      speaker: shuro,
      target: nagusa,
      matchedJpTerms: ["手前(てめぇ)"],
    }),
    ["you"]
  );
});

test("isDirectSecondPersonAddressee avoids attributing Kikyou dialogue to Renge", () => {
  const gl = [
    { speakerId: "kikyou", jp: "あんたのその単純な思考を読み解くくらい、造作もない。" },
    { speakerId: "npc:shuro", jp: "笑わせないでくださいよぉ、桐生キキョウ……！" },
    { speakerId: "npc:shuro", jp: "手前の攻撃なんて、手前には通らない……！" },
    { speakerId: "renge", jp: "くっ……！" },
  ];
  // Immediately previous other speaker is Kikyou; only immediately next other speaker is Renge -> idx 2 touches Kikyou/Renge; if next is Shuro too:
  const glKikyouOnly = [
    { speakerId: "kikyou", jp: "あんたのその単純な思考を読み解くくらい、造作もない。" },
    { speakerId: "npc:shuro", jp: "笑わせないでくださいよぉ、桐生キキョウ……！" },
    { speakerId: "npc:shuro", jp: "手前の攻撃なんて、手前には通らない……！" },
    { speakerId: "npc:shuro", jp: "は……？床、が……！？" },
    { speakerId: "renge", jp: "今だ、ナグサ！" },
  ];
  assert.equal(
    isDirectSecondPersonAddressee(glKikyouOnly, 2, "npc:shuro", "kikyou"),
    true
  );
  assert.equal(
    isDirectSecondPersonAddressee(glKikyouOnly, 2, "npc:shuro", "renge"),
    true
  );
  // With another Kikyou reply in between, Renge is NOT adjacent
  const glKikyouReply = [
    { speakerId: "kikyou", jp: "あんた……" },
    { speakerId: "npc:shuro", jp: "笑わせないでくださいよぉ、桐生キキョウ……！" },
    { speakerId: "npc:shuro", jp: "手前の攻撃なんて、手前には通らない……！" },
    { speakerId: "kikyou", jp: "だから言ったはずよ。" },
    { speakerId: "renge", jp: "よし！" },
  ];
  assert.equal(
    isDirectSecondPersonAddressee(glKikyouReply, 2, "npc:shuro", "renge"),
    false
  );
});

test("selectPerTermCitations covers rare EN variants like Teacher and Omitted-in-EN", () => {
  const makeCand = (
    ref: string,
    jpTerm: string,
    krTerm: string | undefined,
    enTerm: string | undefined,
    enDropped = false
  ) => ({
    line: {
      sourceType: "main_story" as const,
      sourceRef: ref,
      speakerId: "npc:shuro",
      jp: `${jpTerm} ${ref}`,
      kr: `${krTerm ?? ""} ${ref}`,
      en: `${enTerm ?? "omitted"} ${ref}`,
      jpOnly: false,
    },
    matchedJpTerm: jpTerm,
    matchedKrTerm: krTerm,
    matchedEnTerm: enTerm,
    matchedJpTerms: [jpTerm],
    matchedKrTerms: krTerm ? [krTerm] : [],
    matchedEnTerms: enTerm ? [enTerm] : [],
    enDropped,
    hasKr: Boolean(krTerm),
    hasEn: Boolean(enTerm),
  });

  const cands = [
    makeCand("s1", "シャーレの先生", "샬레의 선생님", "Sensei"),
    makeCand("s2", "シャーレの先生", "샬레의 선생님", "Sensei"),
    makeCand("s3", "シャーレの先生", "샬레의 선생님", "Sensei"),
    makeCand("s4", "シャーレの先生", "샬레의 선생님", "Sensei"),
    makeCand("t1", "先生", "선생님", "Teacher"),
    makeCand("o1", "手前様", "당신", undefined, true),
  ];

  const picked = selectPerTermCitations(cands, {}, 3);
  assert.ok(picked.some((c) => c.matchedEnTerm === "Teacher"));
  assert.ok(picked.some((c) => c.sourceRef === "o1"));
  assert.equal(picked.filter((c) => c.matchedEnTerm === "Sensei").length, 3);
});

test("Phase 1 automation: 2-letter names, reversed fullName, codenames, vocatives, cross-quote mining, and extraTerms", () => {
  const hanako = makeChar({
    id: "hanako",
    name: { jp: "ハナコ", en: "Hanako", kr: "하나코" },
  });
  const ui = makeChar({
    id: "ui",
    name: { jp: "ウイ", en: "Ui", kr: "우이" },
    fullName: { jp: "古関ウイ", en: "Ui Kozeki", kr: "코제키 우이" },
  });
  const mika = makeChar({
    id: "mika",
    name: { jp: "ミカ", en: "Mika", kr: "미카" },
    fullName: { jp: "聖園ミカ", en: "Mika Misono", kr: "미소노 미카" },
  });
  const aris = makeChar({
    id: "aris",
    name: { jp: "アリス", en: "Aris", kr: "아리스" },
  });
  const neru = makeChar({
    id: "neru",
    name: { jp: "ネル", en: "Neru", kr: "네루" },
  });
  const aoba = makeChar({
    id: "aoba",
    name: { jp: "アオバ", en: "Aoba", kr: "아오바" },
  });
  const hikari = makeChar({
    id: "hikari",
    name: { jp: "ヒカリ", en: "Hikari", kr: "히카리" },
  });
  const yukino = makeChar({
    id: "npc:yukino",
    kind: "npc",
    name: { jp: "ユキノ", en: "Yukino", kr: "유키노" },
  });

  // 1. 2-letter name "Ui"
  assert.deepEqual(
    extractEnAppellations("Yes, that's why I came to see you, Ui.", {
      speaker: hanako,
      target: ui,
      matchedJpTerms: ["古関ウイさん"],
    }),
    ["Ui"]
  );

  // 2. Reversed 2-part fullName "Misono Mika"
  assert.deepEqual(
    extractEnAppellations("Oh! I understand. Misono Mika from the Tea Party!", {
      speaker: hanako,
      target: mika,
      matchedJpTerms: ["聖園ミカ様"],
    }),
    ["Misono Mika"]
  );

  // 3. ASCII codename "FOX1" / "FOX 1"
  assert.deepEqual(
    extractEnAppellations("Copy that, FOX 1!", {
      speaker: aoba,
      target: yukino,
      matchedJpTerms: ["FOX1"],
    }),
    ["FOX 1"]
  );

  // 4. Standalone vocative capture (Aris -> Neru)
  assert.deepEqual(
    extractStandaloneVocative(
      {
        jp: "チビネル先輩。",
        kr: "네루 꼬마 선배님.",
        en: "Little upperclassman Neru.",
      },
      ["チビネル先輩"],
      ["네루"],
      ["Neru"],
      neru
    ),
    {
      kr: "네루 꼬마 선배님",
      en: "Little upperclassman Neru",
    }
  );

  // 5. Cross-quote shared phrase mining (チビメイド様 -> 꼬마 메이드님 & little maid)
  const chibiMaidLines = [
    {
      kr: "고백입니다. 꼬마 메이드님은 아리스에게 반했습니다.",
      en: "It is a confession. The little maid is confessing to me.",
    },
    {
      kr: "네?! 꼬, 꼬마 메이드님이 아리스를 말인가요?!",
      en: "Huh?! Th-The little maid wants to see me?!",
    },
    {
      kr: "야, 야생의 꼬마 메이드님이 나타났습니다!",
      en: "Th-The wild little maid showed up!",
    },
  ];
  assert.equal(
    mineSharedPhrasesForJpTerm(chibiMaidLines, "kr", {
      speaker: aris,
      target: neru,
    }),
    "꼬마 메이드님"
  );
  assert.equal(
    mineSharedPhrasesForJpTerm(chibiMaidLines, "en", {
      speaker: aris,
      target: neru,
    }),
    "little maid"
  );

  // 6. Cross-quote mining for 幹部 -> officers & 간부님들
  const kanbuLines = [
    {
      kr: "두, 두 분은 간부잖아요?",
      en: "But you two are officers!",
    },
    {
      kr: "……간부님들도 고생 많으셨어요.",
      en: "...Thanks for all your hard work, officers.",
    },
    {
      kr: "으으……!! 간부님들이랑 엮여서 좋을 일이 없는데도!!",
      en: "Ugh! You KNEW you shouldn't get mixed up with officers!",
    },
  ];
  assert.equal(
    mineSharedPhrasesForJpTerm(kanbuLines, "en", {
      speaker: aoba,
      target: hikari,
    }),
    "officers"
  );
  assert.equal(
    mineSharedPhrasesForJpTerm(kanbuLines, "kr", {
      speaker: aoba,
      target: hikari,
    }),
    "간부님들"
  );

  // 7. Curated extraKrTerms/extraEnTerms supersede shorter base-name matches
  assert.deepEqual(
    extractEnAppellations("Hurry up, Little upperclassman Neru!", {
      speaker: aris,
      target: neru,
      matchedJpTerms: ["チビネル先輩"],
      extraEnTerms: ["Little upperclassman Neru"],
    }),
    ["Little upperclassman Neru"]
  );
});

test("Pics 2-5 fixes: plural title guard, tight generic_title context, strict vocatives, and EN case merging with ALL-CAPS preserved", () => {
  const kanoe = makeChar({
    id: "kanoe",
    name: { jp: "カノエ", en: "Kanoe", kr: "카노에" },
  });
  const kei = makeChar({
    id: "kei",
    name: { jp: "ケイ", en: "Kei", kr: "케이" },
  });
  const momoi = makeChar({
    id: "momoi",
    name: { jp: "モモイ", en: "Momoi", kr: "모모이" },
  });

  // 1. Singular 先輩 does not match plural 先輩たち
  assert.deepEqual(
    findMatchedJpTerms("それ、先輩たちと一緒じゃん。", ["先輩"], false, false),
    []
  );

  // 2. Tight generic_title context (distance 2): Rena talking directly with Eri rejects Kanoe
  const glEriOnly = [
    { speakerId: "eri", jp: "にゅふふ、もちろんです！" },
    { speakerId: "eri", jp: "爆発したらさらに完璧……。" },
    { speakerId: "rena", jp: "先輩……。" },
    { speakerId: "eri", jp: "あははっ！冗談ですよ！" },
    { speakerId: "kanoe", jp: "ふむ。" },
  ];
  assert.equal(
    isDirectSecondPersonAddressee(glEriOnly, 2, "rena", "kanoe", 2),
    false
  );
  assert.equal(
    isDirectSecondPersonAddressee(glEriOnly, 2, "rena", "eri", 2),
    true
  );

  // 3. Standalone vocative rejects omitted reaction sentences like Wh-What's wrong? / You BETTER NOT!!
  assert.deepEqual(
    extractStandaloneVocative(
      { jp: "ケイ……？", kr: "왜, 왜 그래?", en: "Wh-What's wrong?" },
      ["ケイ"],
      [],
      [],
      kei
    ),
    {}
  );
  assert.deepEqual(
    extractStandaloneVocative(
      { jp: "モモイ――！！！", kr: "쓰기만 해 봐요!!!", en: "You BETTER NOT!!" },
      ["モモイ"],
      [],
      [],
      momoi
    ),
    {}
  );

  // 4. EN case merging: merges you+You and sage+Sage while keeping ALL-CAPS YOU / KEI separate
  const enCounts = new Map<string, number>([
    ["you", 10],
    ["You", 5],
    ["YOU", 2],
    ["sage", 3],
    ["Sage", 1],
    ["Kei", 20],
    ["KEI", 3],
  ]);
  const cands = [
    {
      line: { sourceType: "main_story" as const, sourceRef: "r1", speakerId: "aris", jp: "x", kr: "x", en: "You...", jpOnly: false },
      matchedJpTerm: "あなた",
      matchedEnTerm: "You",
      matchedEnTerms: ["You"],
      hasKr: true,
      hasEn: true,
    },
    {
      line: { sourceType: "main_story" as const, sourceRef: "r2", speakerId: "aris", jp: "x", kr: "x", en: "YOU!", jpOnly: false },
      matchedJpTerm: "あなた",
      matchedEnTerm: "YOU",
      matchedEnTerms: ["YOU"],
      hasKr: true,
      hasEn: true,
    },
  ];
  const merged = normalizeEnCaseVariants(enCounts, cands);
  assert.equal(merged.get("you"), 15);
  assert.equal(merged.get("You"), undefined);
  assert.equal(merged.get("YOU"), 2);
  assert.equal(merged.get("sage"), 4);
  assert.equal(merged.get("Sage"), undefined);
  assert.equal(merged.get("Kei"), 20);
  assert.equal(merged.get("KEI"), 3);
  assert.equal(cands[0].matchedEnTerm, "you");
  assert.equal(cands[1].matchedEnTerm, "YOU");
});

test("Entity pronoun disambiguation, possessive particle rejection, and Red Winter extraction", () => {
  const hotSprings = makeChar({
    id: "entity:hotspringsdepartment",
    kind: "entity",
    name: { jp: "温泉開発部", en: "Hot Springs Department", kr: "온천개발부" },
  });
  const redWinter = makeChar({
    id: "entity:red_winter_school",
    kind: "entity",
    name: { jp: "レッドウィンター連邦学園", en: "Red Winter Federal Academy", kr: "붉은겨울 연방학원" },
  });
  const rio = makeChar({
    id: "rio",
    name: { jp: "リオ", en: "Rio", kr: "리오" },
  });
  const yakumo = makeChar({
    id: "yakumo",
    name: { jp: "ヤクモ", en: "Yakumo", kr: "야쿠모" },
  });

  // 1. Entity pronouns like あの子たち classify as "pronoun" so scene context filters them
  assert.equal(classifyJpTermAmbiguity("あの子たち", hotSprings), "pronoun");
  assert.equal(classifyJpTermAmbiguity("温泉開発部", hotSprings), "specific");

  // 2. Possessive particles like リオ会長の / 리오 회장의 / President Rio's are rejected by extractStandaloneVocative
  assert.deepEqual(
    extractStandaloneVocative(
      { jp: "リオ会長の……", kr: "리오 회장의…….", en: "President Rio's..." },
      ["リオ会長"],
      ["리오 회장"],
      ["President Rio"],
      rio
    ),
    {}
  );

  // 3. Red Winter extracts as "Red Winter" rather than "Red"
  assert.deepEqual(
    extractEnAppellations("...it could be an...important step for Red Winter!", {
      speaker: yakumo,
      target: redWinter,
      matchedJpTerms: ["レッドウィンター"],
    }),
    ["Red Winter"]
  );
});

test("Shiroko*Terror spine resolution and variant scene disambiguation", () => {
  const shiroko = makeChar({
    id: "shiroko",
    name: { jp: "シロコ", en: "Shiroko", kr: "시로코" },
  });
  const terror = makeChar({
    id: "shiroko_terror",
    name: { jp: "シロコ＊テラー", en: "Shiroko*Terror", kr: "시로코*테러" },
  });

  const resolver = buildSpeakerResolver(
    [shiroko, terror],
    [
      {
        character_name: xxhash32("k_normal"),
        name_jp: "シロコ",
        name_kr: "시로코",
        name_en: "Shiroko",
        spine_prefab_name: "UIs/03_Scenario/02_Character/CharacterSpine_shiroko",
      },
      {
        character_name: xxhash32("k_terror_ch0199"),
        name_jp: "シロコ",
        name_kr: "시로코",
        name_en: "Shiroko",
        spine_prefab_name: "UIs/03_Scenario/02_Character/CharacterSpine_CH0199",
      },
      {
        character_name: xxhash32("k_terror_ch0263"),
        name_jp: "シロコ",
        name_kr: "시로코",
        name_en: "Shiroko",
        spine_prefab_name: "UIs/03_Scenario/02_Character/CharacterSpine_CH0263",
      },
    ],
    []
  );
  assert.equal(resolver.resolveByScriptKrKey("k_normal").characterId, "shiroko");
  assert.equal(
    resolver.resolveByScriptKrKey("k_terror_ch0199").characterId,
    "shiroko_terror"
  );
  assert.equal(
    resolver.resolveByScriptKrKey("k_terror_ch0263").characterId,
    "shiroko_terror"
  );

  assert.equal(isGenericShirokoTerm("シロコ先輩"), true);
  assert.equal(isGenericShirokoTerm("もう一人のシロコさん"), false);

  const normalScene = [
    { speakerId: "shiroko", jp: "ん、銀行強盗しよう。", kr: "", en: "" },
    { speakerId: "ayane", jp: "シロコ先輩っ！", kr: "", en: "" },
  ];
  assert.equal(
    matchesShirokoVariantScene(
      {
        sourceType: "main_story",
        sourceRef: "script:11020#1",
        speakerId: "ayane",
        jp: "シロコ先輩っ！",
        kr: "",
        jpOnly: false,
      },
      "shiroko_terror",
      "シロコ先輩",
      normalScene,
      1
    ),
    false
  );

  const terrorScene = [
    { speakerId: "shiroko_terror", jp: "……遅い。", kr: "", en: "" },
    { speakerId: "ayane", jp: "シロコ先輩……どうして……", kr: "", en: "" },
  ];
  assert.equal(
    matchesShirokoVariantScene(
      {
        sourceType: "main_story",
        sourceRef: "script:13430#5",
        speakerId: "ayane",
        jp: "シロコ先輩……どうして……",
        kr: "",
        jpOnly: false,
      },
      "shiroko_terror",
      "シロコ先輩",
      terrorScene,
      1
    ),
    true
  );
});

test("13-issue regressions: バカな, Problem Solver, Madam Kisaki, Instructor Kokona, Sensei Boss/USERNAME, Waraku Festival, Golconde & Decalcomania, and verb stopword", () => {
  // 1. バカな exclamation vs あのバカ
  assert.deepEqual(
    findMatchedJpTerms("バカな……その右腕は、黄昏に呑まれたはず。", ["バカ"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("今すぐあのバカを黄昏に放り投げて", ["バカ"]),
    ["バカ"]
  );

  // 2. Problem Solver alias without 68
  const ako = makeChar({ id: "ako", name: { jp: "アコ", en: "Ako", kr: "아코" } });
  const ps68 = makeChar({
    id: "entity:problem_solver_68",
    kind: "entity",
    name: { jp: "便利屋68", en: "Problem Solver 68", kr: "흥신소 68" },
    aliases: { jp: ["便利屋"], en: ["Problem Solver"], kr: ["흥신소"] },
  });
  assert.deepEqual(
    extractEnAppellations(
      "I should've remembered that Problem Solver had someone like you in its ranks.",
      { speaker: ako, target: ps68, matchedJpTerms: ["便利屋"] }
    ),
    ["Problem Solver"]
  );

  // 3. キサキ門主 -> Madam (not Head inside Head Prefect)
  const kisaki = makeChar({
    id: "kisaki",
    name: { jp: "キサキ", en: "Kisaki", kr: "키사키" },
    fullName: { jp: "竜華キサキ", en: "Ryuuge Kisaki", kr: "류게 키사키" },
  });
  assert.deepEqual(
    extractEnAppellations("Then, happy birthday, Head Prefect, Madam!", {
      speaker: ako,
      target: kisaki,
      matchedJpTerms: ["キサキ門主"],
    }),
    ["Madam"]
  );

  // 4. ココナ教官 -> Instructor Kokona
  const cherino = makeChar({
    id: "cherino",
    name: { jp: "チェリノ", en: "Cherino", kr: "체리노" },
  });
  const kokona = makeChar({
    id: "kokona",
    name: { jp: "ココナ", en: "Kokona", kr: "코코나" },
  });
  assert.deepEqual(
    extractEnAppellations("You are Instructor Kokona, correct?", {
      speaker: cherino,
      target: kokona,
      matchedJpTerms: ["ココナ教官"],
    }),
    ["Instructor Kokona"]
  );

  // 5. Sensei: gate Boss/Instructor, allow bare [USERNAME]
  const aru = makeChar({ id: "aru", name: { jp: "アル", en: "Aru", kr: "아루" } });
  const pina = makeChar({ id: "pina", name: { jp: "フィーナ", en: "Pina", kr: "피나" } });
  const sensei = makeChar({ id: "special:sensei", kind: "special" });
  assert.deepEqual(
    extractEnAppellations("I'd like to make you an offer. Not as a student, but as a boss.", {
      speaker: aru,
      target: sensei,
      matchedJpTerms: ["先生"],
    }),
    []
  );
  assert.deepEqual(
    extractEnAppellations("Wow! That was amazing, Sens—I mean, Boss!", {
      speaker: pina,
      target: sensei,
      matchedJpTerms: ["お頭"],
    }),
    ["Boss"]
  );
  assert.deepEqual(
    extractKrAppellations("[USERNAME]. 그런가. 내가 모르는 것을 가지고 있구나.", {
      speaker: aru,
      target: sensei,
      matchedJpTerms: ["（先生のユーザー名）"],
    }),
    ["[USERNAME]"]
  );
  assert.deepEqual(
    extractEnAppellations("[USERNAME]. You possess something with which I am unfamiliar.", {
      speaker: aru,
      target: sensei,
      matchedJpTerms: ["（先生のユーザー名）"],
    }),
    ["[USERNAME]"]
  );

  // 6. Kaho -> Chise: Waraku Festival / 와라쿠 축제 excluded
  const kaho = makeChar({ id: "kaho", name: { jp: "カホ", en: "Kaho", kr: "카호" } });
  const chise = makeChar({
    id: "chise",
    name: { jp: "チセ", en: "Chise", kr: "치세" },
    fullName: { jp: "和楽チセ", en: "Waraku Chise", kr: "와라쿠 치세" },
  });
  assert.deepEqual(
    extractEnAppellations("I proposed the Waraku Festival to show off Chise's charm!", {
      speaker: kaho,
      target: chise,
      matchedJpTerms: ["チセちゃん"],
    }),
    ["Chise"]
  );
  assert.deepEqual(
    extractKrAppellations("네, 와라쿠 축제는 말 그대로 치세 쨩의 매력을 선보이기 위해 기획된 축제입니다.", {
      speaker: kaho,
      target: chise,
      matchedJpTerms: ["チセちゃん"],
    }),
    ["치세 쨩"]
  );

  // 7. Beatrice -> Golconde & Decalcomanie extracts both names from one line
  const beatrice = makeChar({
    id: "npc:beatrice",
    kind: "npc",
    name: { jp: "ベアトリーチェ", en: "Beatrice", kr: "베아트리체" },
  });
  const golconde = makeChar({
    id: "npc:golconde",
    kind: "npc",
    name: { jp: "ゴルコンダ＆デカルコマニー", en: "Golconde & Decalcomanie", kr: "골콩트 & 데칼코마니" },
    aliases: {
      jp: ["ゴルコンダ", "デカルコマニー"],
      en: ["Golconde", "Decalcomanie", "Decalcomania"],
      kr: ["골콩트", "데칼코마니"],
    },
  });
  assert.deepEqual(
    extractEnAppellations("I must thank you and Decalcomania again, Golconde.", {
      speaker: beatrice,
      target: golconde,
      matchedJpTerms: ["デカルコマニー", "ゴルコンダ"],
    }),
    ["Decalcomania", "Golconde"]
  );
  assert.deepEqual(
    extractKrAppellations("데칼코마니…… 아니, 골콩트에게도 감사드리죠.", {
      speaker: beatrice,
      target: golconde,
      matchedJpTerms: ["デカルコマニー", "ゴルコンダ"],
    }),
    ["데칼코마니", "골콩트"]
  );

  // 8. mineSharedPhrasesForJpTerm skips verb "understand"
  const eri = makeChar({ id: "eri", name: { jp: "エリ", en: "Eri", kr: "에리" } });
  const rena = makeChar({ id: "rena", name: { jp: "レナ", en: "Rena", kr: "레나" } });
  assert.equal(
    mineSharedPhrasesForJpTerm(
      [
        { kr: "", en: "I understand your concern completely." },
        { kr: "", en: "I totally understand how you feel." },
      ],
      "en",
      { speaker: eri, target: rena }
    ),
    undefined
  );
});

test("12-issue regressions: you guys/THEY, Vice Captain/Vice President, mystery prophet, Teach verb vs Kirara, Seeensei, Wh-What, and speaker/otherChar mining guards", () => {
  // 1. Fuuka -> Gourmet Research Society: "you guys" and ALL-CAPS "THEY"
  const fuuka = makeChar({ id: "fuuka", name: { jp: "フウカ", en: "Fuuka", kr: "후우카" } });
  const grs = makeChar({
    id: "entity:gourmet_research",
    kind: "entity",
    name: { jp: "美食研究会", en: "Gourmet Research Society", kr: "미식연구회" },
  });
  assert.deepEqual(
    extractEnAppellations("I'm not gonna ask why you guys are riding around in the truck.", {
      speaker: fuuka,
      target: grs,
      matchedJpTerms: ["あんた達"],
    }),
    ["you guys"]
  );
  assert.deepEqual(
    extractEnAppellations("...as long as THEY don't show up this time.", {
      speaker: fuuka,
      target: grs,
      matchedJpTerms: ["あいつら"],
    }),
    ["THEY"]
  );

  // 2. Fuyu -> Hiromi ("Vice Captain") and Noa -> Hasumi ("Vice President")
  const fuyu = makeChar({ id: "fuyu", name: { jp: "フユ", en: "Fuyu", kr: "후유" } });
  const hiromi = makeChar({
    id: "npc:hiromi",
    kind: "npc",
    name: { jp: "ヒロミ", en: "Hiromi", kr: "히로미" },
  });
  assert.deepEqual(
    extractEnAppellations("Why did the Prefectural Council Vice Captain show this to you?", {
      speaker: fuyu,
      target: hiromi,
      matchedJpTerms: ["寮監隊の副隊長"],
    }),
    ["Vice Captain"]
  );

  const noa = makeChar({ id: "noa", name: { jp: "ノア", en: "Noa", kr: "노아" } });
  const hasumi = makeChar({ id: "hasumi", name: { jp: "ハスミ", en: "Hasumi", kr: "하스미" } });
  assert.deepEqual(
    extractEnAppellations(
      "I had heard that the Vice President of Trinity's Justice Task Force was strict.",
      {
        speaker: noa,
        target: hasumi,
        matchedJpTerms: ["正義実現委員会の副委員長"],
      }
    ),
    ["Vice President"]
  );

  // 3. Himari -> Chokmah ("mystery prophet" / "prophet")
  const himari = makeChar({ id: "himari", name: { jp: "ヒマリ", en: "Himari", kr: "히마리" } });
  const chokmah = makeChar({
    id: "entity:chokmah",
    kind: "entity",
    name: { jp: "コクマー", en: "Chokmah", kr: "호크마" },
  });
  assert.deepEqual(
    extractEnAppellations("But for what reason is this mystery prophet mining resources?", {
      speaker: himari,
      target: chokmah,
      matchedJpTerms: ["船の預言者"],
    }),
    ["mystery prophet"]
  );

  // 4. Hifumi verb "teach" rejected; Kirara "TEACH" kept; Hikari "Seeensei" matched
  const hifumi = makeChar({ id: "hifumi", name: { jp: "ヒフミ", en: "Hifumi", kr: "히후미" } });
  const kirara = makeChar({ id: "kirara", name: { jp: "キララ", en: "Kirara", kr: "키라라" } });
  const hikari = makeChar({ id: "hikari", name: { jp: "ヒカリ", en: "Hikari", kr: "히카리" } });
  const sensei = makeChar({ id: "special:sensei", kind: "special" });
  assert.deepEqual(
    extractEnAppellations("I'm so happy you have time to teach me.", {
      speaker: hifumi,
      target: sensei,
      matchedJpTerms: ["先生"],
    }),
    []
  );
  assert.deepEqual(
    extractEnAppellations("Wait, TEACH?! What are you doing here?!", {
      speaker: kirara,
      target: sensei,
      matchedJpTerms: ["先生"],
    }),
    ["Teach"]
  );
  assert.deepEqual(
    extractEnAppellations("Hikari wants to play. So you have to, too, Seeensei.", {
      speaker: hikari,
      target: sensei,
      matchedJpTerms: ["せんせー"],
    }),
    ["Seeensei"]
  );

  // 5. Two-letter stutter normalization ("Wh-What" -> "What")
  assert.equal(normalizeEnStutters("Wh-What do we do now?"), "What do we do now?");

  // 6. mineSharedPhrasesForJpTerm blocks speaker's name and other characters' proper names
  const mika = makeChar({ id: "mika", name: { jp: "ミカ", en: "Mika", kr: "미카" } });
  const hanako = makeChar({ id: "hanako", name: { jp: "ハナコ", en: "Hanako", kr: "하나코" } });
  assert.equal(
    mineSharedPhrasesForJpTerm(
      [
        { kr: "", en: "Hikari wants to play today." },
        { kr: "", en: "Hikari wants snacks too." },
      ],
      "en",
      { speaker: hikari, target: sensei }
    ),
    undefined
  );
  assert.equal(
    mineSharedPhrasesForJpTerm(
      [
        { kr: "", en: "Say, how is Seia doing right now?" },
        { kr: "", en: "I was the one who gave the order to kill Seia!" },
      ],
      "en",
      { speaker: mika, target: hanako, otherCharNames: new Set(["seia"]) }
    ),
    undefined
  );
});

test("10-issue regressions: reject 'this one', add 'this old-timer', Another Shiroko*Terror, reject '*sniff*', strip verb 'miss ', and Juri dear customer", () => {
  const self = makeChar({ id: "special:self", kind: "special" });
  const hinata = makeChar({ id: "hinata", name: { jp: "ヒナタ", en: "Hinata", kr: "히나타" } });
  const hoshino = makeChar({ id: "hoshino", name: { jp: "ホシノ", en: "Hoshino", kr: "호시노" } });

  // 1. No false "this one" on special:self; Hoshino gets "this old-timer"
  assert.deepEqual(
    extractEnAppellations("On it! I'll take this one!", {
      speaker: hinata,
      target: self,
      matchedJpTerms: ["私"],
    }),
    []
  );
  assert.deepEqual(
    extractEnAppellations("This old-timer's gonna sit this one out, so I don't ruin the fun.", {
      speaker: hoshino,
      target: self,
      matchedJpTerms: ["おじさん"],
    }),
    ["this old-timer"]
  );

  // 2. Shiroko*Terror "Another <Name>" / "another <Name>" & "또 다른 <Name>"
  const hina = makeChar({ id: "hina", name: { jp: "ヒナ", en: "Hina", kr: "히나" } });
  const terror = makeChar({
    id: "shiroko_terror",
    name: { jp: "シロコ＊テラー", en: "Shiroko*Terror", kr: "시로코*테러" },
    fullName: { jp: "砂狼シロコ", en: "Sunaookami Shiroko", kr: "스나오오카미 시로코" },
    aliases: { jp: ["シロコ"], en: ["Shiroko"], kr: ["시로코"] },
  });
  assert.deepEqual(
    extractEnAppellations("Another Sunaookami Shiroko. The one Sensei assisted last time?", {
      speaker: hina,
      target: terror,
      matchedJpTerms: ["もう一人の砂狼シロコ"],
    }),
    ["Another Sunaookami Shiroko"]
  );
  assert.deepEqual(
    extractKrAppellations("또 다른 스나오오카미 시로코. 저번엔 선생님에게 신세를 졌다지?", {
      speaker: hina,
      target: terror,
      matchedJpTerms: ["もう一人の砂狼シロコ"],
    }),
    ["또 다른 스나오오카미 시로코"]
  );
  assert.deepEqual(
    extractEnAppellations("...and even another Shiroko. I got to meet my cute underclassmen.", {
      speaker: hoshino,
      target: terror,
      matchedJpTerms: ["もう一人のシロコちゃん"],
    }),
    ["another Shiroko"]
  );

  // 3. Reject asterisk stage actions in extractStandaloneVocative
  assert.deepEqual(
    extractStandaloneVocative(
      { jp: "ヒナさん……。", kr: "히나 씨…….", en: "*sniff* Hina..." },
      ["ヒナさん"],
      ["히나 씨"],
      ["Hina"],
      hina
    ),
    {}
  );

  // 4. Lowercase verb "miss <Name>" stripped to "<Name>", while capitalized "Miss <Name>" kept
  const ibuki = makeChar({ id: "ibuki", name: { jp: "イブキ", en: "Ibuki", kr: "이부키" } });
  const iroha = makeChar({ id: "iroha", name: { jp: "イロハ", en: "Iroha", kr: "이로하" } });
  assert.deepEqual(
    extractEnAppellations("Makoto, do you miss Iroha?", {
      speaker: ibuki,
      target: iroha,
      matchedJpTerms: ["イロハ先輩"],
    }),
    ["Iroha"]
  );
  assert.deepEqual(
    extractEnAppellations("Hello, Miss Iroha!", {
      speaker: ibuki,
      target: iroha,
      matchedJpTerms: ["イロハ先輩"],
    }),
    ["Miss Iroha"]
  );

  // 5. Juri -> Sensei "dear customer" and "손님" on お客様
  const juri = makeChar({ id: "juri", name: { jp: "ジュリ", en: "Juri", kr: "주리" } });
  const sensei = makeChar({ id: "special:sensei", kind: "special" });
  assert.deepEqual(
    extractEnAppellations('Welcome, dear "customer." What would you like to order?', {
      speaker: juri,
      target: sensei,
      matchedJpTerms: ["お客様"],
    }),
    ["dear customer"]
  );
  assert.deepEqual(
    extractKrAppellations("그러면…… '손님'. 주문은 무엇으로 하시겠습니까?", {
      speaker: juri,
      target: sensei,
      matchedJpTerms: ["お客様"],
    }),
    ["손님"]
  );
});

test("11-screenshot regressions: Nature's Beauty, 委員会 boundary, 皆さん pronoun, Schale's Sensei, Master gate, Great Makoto, Camp RABBIT callsigns", () => {
  // 1. Nature's Beauty alias
  const kikyou = makeChar({ id: "kikyou", name: { jp: "キキョウ", en: "Kikyou", kr: "키쿄" } });
  const naturesBeauty = makeChar({
    id: "entity:naturesbeauty",
    kind: "entity",
    name: { jp: "花鳥風月部", en: "Nature's Beauty Club", kr: "화조풍월부" },
    aliases: { jp: [], kr: [], en: ["Nature's Beauty"] },
  });
  assert.deepEqual(
    extractEnAppellations("...Yabuki Shuro of Nature's Beauty.", {
      speaker: kikyou,
      target: naturesBeauty,
      matchedJpTerms: ["花鳥風月部"],
    }),
    ["Nature's Beauty"]
  );

  // 2. Bare 委員会 boundary check against 図書委員会
  assert.deepEqual(findMatchedJpTerms("図書委員会のみんなへ", ["委員会"]), []);
  assert.deepEqual(findMatchedJpTerms("うちの委員会は大変だ", ["委員会"]), ["委員会"]);

  // 3. 皆さん / みんな classified as ambiguous pronoun
  const ariusSquad = makeChar({
    id: "entity:arius_squad",
    kind: "entity",
    name: { jp: "アリウススクワッド", en: "Arius Squad", kr: "아리우스 스쿼드" },
  });
  assert.equal(classifyJpTermAmbiguity("皆さん", ariusSquad), "pronoun");
  assert.equal(classifyJpTermAmbiguity("みんな", ariusSquad), "pronoun");

  // 4. Schale's Sensei & Master gating on special:sensei
  const sensei = makeChar({ id: "special:sensei", kind: "special" });
  const kokuriko = makeChar({
    id: "npc:kokuriko",
    kind: "npc",
    name: { jp: "コクリコ", en: "Kokuriko", kr: "코쿠리코" },
  });
  assert.deepEqual(
    extractEnAppellations("However, Schale's Sensei's capture is your triumph.", {
      speaker: kokuriko,
      target: sensei,
      matchedJpTerms: ["シャーレの先生"],
    }),
    ["Schale's Sensei"]
  );

  const momoi = makeChar({ id: "momoi", name: { jp: "モモイ", en: "Momoi", kr: "모모이" } });
  const mutsuki = makeChar({ id: "mutsuki", name: { jp: "ムツキ", en: "Mutsuki", kr: "무츠키" } });
  const karin = makeChar({ id: "karin", name: { jp: "カリン", en: "Karin", kr: "카린" } });
  assert.deepEqual(
    extractEnAppellations("Stand back and watch the master at work, Sensei!", {
      speaker: momoi,
      target: sensei,
      matchedJpTerms: ["先生"],
      jpLine: "ちゃんとこの雄姿を見ててね、先生！",
    }),
    ["Sensei"]
  );
  assert.deepEqual(
    extractEnAppellations("Man! Sensei, you really are the master of cheesiness!", {
      speaker: mutsuki,
      target: sensei,
      matchedJpTerms: ["先生"],
      jpLine: "やっぱり先生、時々本当にレベル高いねー！",
    }),
    ["Sensei"]
  );
  assert.deepEqual(
    extractEnAppellations("Sensei—I mean, Master—how often do you frequent maid cafes?", {
      speaker: karin,
      target: sensei,
      matchedJpTerms: ["先生"],
      jpLine: "先生、いや、ご主人様、もしかしてメイドカフェのマニア……？",
    }),
    ["Sensei", "Master"]
  );

  // 5. Self-reference: Great Makoto & Moe Camp RABBIT / RABBIT 3
  const self = makeChar({ id: "special:self", kind: "special" });
  const makoto = makeChar({ id: "makoto", name: { jp: "マコト", en: "Makoto", kr: "마코토" } });
  const moe = makeChar({ id: "moe", name: { jp: "モエ", en: "Moe", kr: "모에" } });
  assert.deepEqual(
    extractEnAppellations("The Great Makoto! I am destined to rule!", {
      speaker: makoto,
      target: self,
      matchedJpTerms: ["マコト様"],
    }),
    ["Great Makoto"]
  );
  assert.deepEqual(
    extractEnAppellations("This is Camp RABBIT. Affirmative.", {
      speaker: moe,
      target: self,
      matchedJpTerms: ["キャンプRABBIT"],
    }),
    ["Camp RABBIT"]
  );
  assert.deepEqual(
    extractKrAppellations("여기는 캠프 RABBIT. 통제권을 가져왔어.", {
      speaker: moe,
      target: self,
      matchedJpTerms: ["キャンプRABBIT"],
    }),
    ["캠프 RABBIT"]
  );
  assert.deepEqual(
    extractEnAppellations("RABBIT 3, reporting in.", {
      speaker: moe,
      target: self,
      matchedJpTerms: ["RABBIT3"],
    }),
    ["RABBIT 3"]
  );
  assert.deepEqual(
    extractKrAppellations("RABBIT 3, 지금 진입한다!", {
      speaker: moe,
      target: self,
      matchedJpTerms: ["RABBIT3"],
    }),
    ["RABBIT 3"]
  );
});

test("10-screenshot regressions: Schale's Sensei, Nozomi noob, Neru Chibi, Ohr anokata, Plana Shiroko split, Suzumi pink, comma names", () => {
  const sensei = makeChar({
    id: "special:sensei",
    kind: "special",
    name: { en: "Sensei", jp: "先生", kr: "선생님" },
  });
  const nozomi = makeChar({
    id: "nozomi",
    name: { en: "Nozomi", jp: "ノゾミ", kr: "노조미" },
  });
  const rio = makeChar({
    id: "rio",
    name: { en: "Rio", jp: "リオ", kr: "리오" },
    fullName: { en: "Tsukatsuki Rio", jp: "調月リオ", kr: "츠카츠키 리오" },
    aliases: { en: ["Tsukatsuki Rio"], jp: ["調月リオ"], kr: ["츠카츠키 리오"] },
  });
  const ein = makeChar({
    id: "npc:ein",
    kind: "npc",
    name: { en: "Ein", jp: "アイン", kr: "아인" },
  });

  // Pic 1: Sensei from Schale doesn't degrade to bare Sensei
  assert.deepEqual(
    extractEnAppellations("Are you the Sensei from Schale?", {
      speaker: nozomi,
      target: sensei,
      matchedJpTerms: ["シャーレの先生"],
    }),
    ["Sensei from Schale"]
  );

  // Pic 2 & 3: チビ rejects Neru's self-protests and compounds/plurals, keeps Aris kid
  assert.deepEqual(
    findMatchedJpTerms("あぁん？誰が野生のチビだ！？", ["チビ"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("チビを外せよ！", ["チビ"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("誰がチビだゴルァ！！", ["チビ"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("てめぇらチビたちは下がってな！", ["チビ"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("チビ、しっかりしろ。", ["チビ"]),
    ["チビ"]
  );
  assert.deepEqual(
    extractEnAppellations("Hey, kid, get it together.", {
      speaker: nozomi,
      target: makeChar({ id: "aris", name: { en: "Aris", jp: "アリス", kr: "아리스" } }),
      matchedJpTerms: ["チビ"],
    }),
    ["kid"]
  );

  // Pic 5: Nozomi's しろうと / 素人 -> Noob / 초짜 / 초ㅉ
  assert.deepEqual(
    extractEnAppellations("What a Noob.", {
      speaker: nozomi,
      target: sensei,
      matchedJpTerms: ["しろうと"],
    }),
    ["Noob"]
  );
  assert.deepEqual(
    extractKrAppellations("완전 초ㅉ~", {
      speaker: nozomi,
      target: sensei,
      matchedJpTerms: ["しろうと"],
    }),
    ["초ㅉ"]
  );
  assert.deepEqual(
    extractKrAppellations("완전 초짜네.", {
      speaker: nozomi,
      target: sensei,
      matchedJpTerms: ["素人"],
    }),
    ["초짜"]
  );

  // Pics 6 & 7: Ohr's あの方 splits Decagrammaton (master) vs Malkuth (!master)
  const ohrMasterLine = {
    sourceType: "main_story" as const,
    sourceRef: "main_ex1",
    storyKey: "main_ex1",
    groupId: 90001050,
    speakerId: "npc:ohr",
    speakerRaw: "オール",
    jp: "あの方のご計画を邪魔するとは。",
    kr: "그분의 계획을 방해하다니.",
    en: "To meddle with the master's operations...",
    jpOnly: false,
  };
  const ohrMalkuthLine = {
    sourceType: "main_story" as const,
    sourceRef: "main_ex1",
    storyKey: "main_ex1",
    groupId: 90002180,
    speakerId: "npc:ohr",
    speakerRaw: "オール",
    jp: "……あの方には、私たちなりの恩返しをしたいのです。",
    kr: "……그분께는 저희 나름의 보답을 하고 싶습니다.",
    en: "...We would like to repay that person, in a way only we can.",
    jpOnly: false,
  };
  assert.equal(matchesDecagrammatonAnokata(ohrMasterLine, "npc:decagrammaton", "あの方"), true);
  assert.equal(matchesDecagrammatonAnokata(ohrMasterLine, "npc:malkuth", "あの方"), false);
  assert.equal(matchesDecagrammatonAnokata(ohrMalkuthLine, "npc:decagrammaton", "あの方"), false);
  assert.equal(matchesDecagrammatonAnokata(ohrMalkuthLine, "npc:malkuth", "あの方"), true);

  // Pic 8: Plana Shiroko vs Shiroko*Terror timeline disambiguation
  const plana104010 = [
    { speakerId: "shiroko", jp: "……ん。", kr: "……응.", en: "...Mm." },
    {
      speakerId: "npc:plana",
      jp: "肯定。砂狼シロコ、別時間軸の同一存在。",
      kr: "긍정. 스나오오카미 시로코, 다른 시간축의 동일 존재.",
      en: "Affirmative. Sunaookami Shiroko, same entity from an alternate timeline.",
    },
  ];
  const plana13410 = [
    {
      speakerId: "npc:arona",
      jp: "ですが、もう一人のシロコさんは――",
      kr: "하지만 다른 한 명의 시로코 씨는――",
      en: "But what about the other Shiroko?",
    },
    {
      speakerId: "npc:plana",
      jp: "――確認。\n砂狼シロコさんとの接続が……。",
      kr: "――확인.\n스나오오카미 시로코 씨와의 접속이…….",
      en: "Confirmed. Connection with Sunaookami Shiroko...",
    },
  ];
  const plana104060 = [
    {
      speakerId: "npc:plana",
      jp: "砂狼シロコ、砂狼シロコ、[USERNAME]先生。全員死亡と予測します。",
      kr: "스나오오카미 시로코, 스나오오카미 시로코, [USERNAME] 선생님. 전원 사망으로 예측합니다.",
      en: "Sunaookami Shiroko, Sunaookami Shiroko, [USERNAME] Sensei. Outcome predicted: 100% fatality.",
    },
  ];
  const plana13350 = [
    {
      speakerId: "npc:plana",
      jp: "この色彩は、今の時間軸の「砂狼シロコ」が呼び寄せたものです。",
      kr: "이 색채는 지금 시간축의 「스나오오카미 시로코」가 불러온 것입니다.",
      en: "This Chroma was summoned by Sunaookami Shiroko of this timeline.",
    },
  ];
  const makePlanaRec = (
    groupId: number,
    row: { speakerId: string; jp: string; kr: string; en: string }
  ) => ({
    sourceType: "main_story" as const,
    sourceRef: "main_vf",
    storyKey: "main_vf",
    groupId,
    speakerRaw: "プラナ",
    jpOnly: false,
    ...row,
  });
  // 104010 ("別時間軸の同一存在") -> Terror only
  assert.equal(matchesShirokoVariantScene(makePlanaRec(104010, plana104010[1]), "shiroko_terror", "砂狼シロコ", plana104010, 1), true);
  assert.equal(matchesShirokoVariantScene(makePlanaRec(104010, plana104010[1]), "shiroko", "砂狼シロコ", plana104010, 1), false);
  // 13410 (after Arona's "もう一人のシロコさん") -> Terror only
  assert.equal(matchesShirokoVariantScene(makePlanaRec(13410, plana13410[1]), "shiroko_terror", "砂狼シロコ", plana13410, 1), true);
  assert.equal(matchesShirokoVariantScene(makePlanaRec(13410, plana13410[1]), "shiroko", "砂狼シロコ", plana13410, 1), false);
  // 104060 (both Shirokos named) -> Both
  assert.equal(matchesShirokoVariantScene(makePlanaRec(104060, plana104060[0]), "shiroko_terror", "砂狼シロコ", plana104060, 0), true);
  assert.equal(matchesShirokoVariantScene(makePlanaRec(104060, plana104060[0]), "shiroko", "砂狼シロコ", plana104060, 0), true);
  // 13350 ("今の時間軸の「砂狼シロコ」") -> Normal Shiroko only
  assert.equal(matchesShirokoVariantScene(makePlanaRec(13350, plana13350[0]), "shiroko", "砂狼シロコ", plana13350, 0), true);
  assert.equal(matchesShirokoVariantScene(makePlanaRec(13350, plana13350[0]), "shiroko_terror", "砂狼シロコ", plana13350, 0), false);

  // Pic 9: Suzumi -> Reisa ignores color Pink
  assert.deepEqual(
    findMatchedJpTerms("ホワイトの衣装がピンクである理由、知りませんか？", ["ピンク"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("ピンク色……ですね。", ["ピンク"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("ピンク、撃ってください！", ["ピンク"]),
    ["ピンク"]
  );

  // Pic 10: Comma-separated full name collapses to one full name label
  assert.deepEqual(
    extractEnAppellations("You underestimate us, Tsukatsuki, Rio.", {
      speaker: ein,
      target: rio,
      matchedJpTerms: ["調月リオ"],
    }),
    ["Tsukatsuki Rio"]
  );
  assert.deepEqual(
    extractKrAppellations("……츠카츠키, 리오.", {
      speaker: ein,
      target: rio,
      matchedJpTerms: ["調月リオ"],
    }),
    ["츠카츠키 리오"]
  );
});

test("final-caps regressions: Makoto vocative, Serika Terror Ep.36, Weak/Small Shiroko, Blue, Suzu interrupted, Toki nicknames, C&C callsigns, Tsurugi JTF president", () => {
  const self = makeChar({
    id: "special:self",
    kind: "special",
    name: { en: "Self", jp: "一人称", kr: "1인칭" },
  });
  const satsuki = makeChar({
    id: "satsuki",
    name: { en: "Satsuki", jp: "サツキ", kr: "サツキ" },
  });
  const makoto = makeChar({
    id: "makoto",
    name: { en: "Makoto", jp: "マコト", kr: "마코토" },
  });
  const shiroko = makeChar({
    id: "shiroko",
    name: { en: "Shiroko", jp: "シロコ", kr: "시로코" },
  });
  const suzumi = makeChar({
    id: "suzumi",
    name: { en: "Suzumi", jp: "スズミ", kr: "스즈미" },
  });
  const toki = makeChar({
    id: "toki",
    name: { en: "Toki", jp: "トキ", kr: "토키" },
  });
  const neru = makeChar({
    id: "neru",
    name: { en: "Neru", jp: "ネル", kr: "네루" },
  });
  const asuna = makeChar({
    id: "asuna",
    name: { en: "Asuna", jp: "アスナ", kr: "아스나" },
  });
  const karin = makeChar({
    id: "karin",
    name: { en: "Karin", jp: "カリン", kr: "카린" },
  });
  const akane = makeChar({
    id: "akane",
    name: { en: "Akane", jp: "アカネ", kr: "아카네" },
  });
  const tsurugi = makeChar({
    id: "tsurugi",
    name: { en: "Tsurugi", jp: "ツルギ", kr: "츠루기" },
  });

  // Cap 1: Satsuki -> Makoto does NOT treat "マコトちゃん、変ね。" -> "Makoto seems a bit off..." as vocative
  assert.deepEqual(
    extractStandaloneVocative(
      {
        jp: "マコトちゃん、変ね。",
        kr: "마코토 쨩, 이상해.",
        en: "Makoto seems a bit off...",
      },
      ["マコトちゃん"],
      ["마코토 쨩"],
      ["Makoto"],
      makoto
    ),
    {}
  );

  // Cap 3: Vol.1 Ch.3 Ep.36 normal Shiroko response is rejected for shiroko_terror
  const ep36Gl = [
    { speakerId: "shiroko_terror", jp: "……先生、どうだった？", kr: "...", en: "..." },
    { speakerId: "shiroko_terror", jp: "……これは、対策委員会にしかできない。", kr: "...", en: "..." },
    { speakerId: "shiroko", jp: "ん、あなたもアビドスでしょ。", kr: "...", en: "..." },
    { speakerId: "shiroko", jp: "……覆面水着団の一員として。", kr: "...", en: "..." },
    {
      speakerId: "serika",
      jp: "そういう意味じゃないから！\nシロコ先輩が調子に乗るじゃない！",
      kr: "그런 말에 일일이 반응해 주지 마!! 시로코 선배 버릇 나빠지잖아!",
      en: "Don't encourage her! You're being a bad influence on Shiroko!",
    },
  ];
  assert.equal(
    matchesShirokoVariantScene(
      {
        sourceType: "main_story",
        sourceRef: "script:13365#44",
        groupId: 13365,
        speakerId: "serika",
        jp: ep36Gl[4].jp,
        kr: ep36Gl[4].kr,
        en: ep36Gl[4].en,
        jpOnly: false,
      },
      "shiroko_terror",
      "シロコ先輩",
      ep36Gl,
      4
    ),
    false
  );

  // Caps 5 & 6: Codename "ブルー先輩" does not synthesize "Shiro", and interrupted "スズ――"/"Suzu..."/"스즈..." is not extracted
  assert.deepEqual(
    extractEnAppellations("Hey, Shiro—I mean, uh...Blue. You got the goods?", {
      speaker: satsuki,
      target: shiroko,
      matchedJpTerms: ["ブルー先輩"],
      extraEnTerms: ["Blue"],
    }),
    ["Blue"]
  );
  assert.deepEqual(
    extractKrAppellations("스즈…… 테르밋 화이트! 어디 가시는 건가요!", {
      speaker: satsuki,
      target: suzumi,
      matchedJpTerms: ["テルミットホワイト"],
    }),
    []
  );
  assert.deepEqual(
    extractEnAppellations("Suzu... Thermite White! Where are you going?!", {
      speaker: satsuki,
      target: suzumi,
      matchedJpTerms: ["テルミットホワイト"],
    }),
    []
  );

  // Cap 9: C&C Self-Reference Callsigns
  assert.deepEqual(
    extractEnAppellations("Affiliated with the C&C, I'm call sign Zero-Four.", {
      speaker: toki,
      target: self,
      matchedJpTerms: ["コールサインゼロフォー"],
    }),
    ["call sign Zero-Four"]
  );
  assert.deepEqual(
    extractKrAppellations("C&C소속, 콜사인 제로포. 인사드립니다.", {
      speaker: toki,
      target: self,
      matchedJpTerms: ["コールサインゼロフォー"],
    }),
    ["콜사인 제로포"]
  );
  assert.deepEqual(
    extractEnAppellations("But since I'm not C&C's president, or Call Sign Double O today...", {
      speaker: neru,
      target: self,
      matchedJpTerms: ["ダブルオー"],
    }),
    ["Call Sign Double O"]
  );
  assert.deepEqual(
    extractKrAppellations("지금의 나는 C&C의 부장도, 코드명 더블오도 아니니까…….", {
      speaker: neru,
      target: self,
      matchedJpTerms: ["ダブルオー"],
    }),
    ["나", "코드명 더블오"]
  );
  assert.deepEqual(
    extractEnAppellations("C&C's call sign Zero-One, Asuna, reporting for duty!", {
      speaker: asuna,
      target: self,
      matchedJpTerms: ["コールサイン・ゼロワン"],
    }),
    ["Asuna", "call sign Zero-One"]
  );
  assert.deepEqual(
    extractEnAppellations("This is call sign Zero-Two.", {
      speaker: karin,
      target: self,
      matchedJpTerms: ["コールサインゼロツー"],
    }),
    ["call sign Zero-Two"]
  );
  assert.deepEqual(
    extractEnAppellations("I'm C&C's call sign Zero-Three.", {
      speaker: akane,
      target: self,
      matchedJpTerms: ["コールサイン・ゼロスリー"],
    }),
    ["call sign Zero-Three"]
  );

  // Cap 10: Tsurugi full JTF president title
  assert.deepEqual(
    extractEnAppellations("Whoa, the president of the Justice Task Force is impressive!", {
      speaker: asuna,
      target: tsurugi,
      matchedJpTerms: ["正義実現委員会の委員長さん"],
    }),
    ["president of the Justice Task Force"]
  );
  assert.deepEqual(
    extractKrAppellations("헤에- 대단해. 저 정의실현부장.", {
      speaker: asuna,
      target: tsurugi,
      matchedJpTerms: ["正義実現委員会の委員長さん"],
    }),
    ["정의실현부장"]
  );
});

test("KR parity regressions: compound KR_HONORIFICS, copula/compound KR_PARTICLE_LOOKAHEAD, self 님, Toki 소란스러운 모모이, JP_TO_KR_TITLES, and adverb fragment guard", () => {
  const self = makeChar({
    id: "special:self",
    kind: "special",
    name: { en: "Self", jp: "一人称", kr: "1인칭" },
  });
  const speaker = makeChar({
    id: "marina",
    name: { en: "Marina", jp: "マリナ", kr: "마리나" },
  });
  const kisaki = makeChar({
    id: "kisaki",
    name: { en: "Kisaki", jp: "キサキ", kr: "키사키" },
  });
  const ako = makeChar({
    id: "ako",
    name: { en: "Ako", jp: "アコ", kr: "아코" },
  });
  const tomoe = makeChar({
    id: "tomoe",
    name: { en: "Tomoe", jp: "トモエ", kr: "토모에" },
  });
  const hasumi = makeChar({
    id: "hasumi",
    name: { en: "Hasumi", jp: "ハスミ", kr: "하스미" },
  });
  const mine = makeChar({
    id: "mine",
    name: { en: "Mine", jp: "ミネ", kr: "미네" },
  });
  const hina = makeChar({
    id: "hina",
    name: { en: "Hina", jp: "ヒナ", kr: "히나" },
  });
  const aru = makeChar({
    id: "aru",
    name: { en: "Aru", jp: "アル", kr: "아루" },
  });
  const rio = makeChar({
    id: "rio",
    name: { en: "Rio", jp: "リオ", kr: "리오" },
  });
  const koyuki = makeChar({
    id: "koyuki",
    name: { en: "Koyuki", jp: "コユキ", kr: "코유키" },
    aliases: { en: ["White Rabbit"], jp: ["白兎"], kr: ["백토"] },
  });
  const makoto = makeChar({
    id: "makoto",
    name: { en: "Makoto", jp: "マコト", kr: "마코토" },
  });
  const shiroko = makeChar({
    id: "shiroko",
    name: { en: "Shiroko", jp: "シロコ", kr: "시로코" },
  });
  const dorm = makeChar({
    id: "entity:dormitorysupervisor",
    kind: "entity",
    name: { en: "Dormitory Supervisor", jp: "寮監隊", kr: "사감대" },
  });

  // 1. Compound KR_HONORIFICS attached to character names
  assert.deepEqual(
    extractKrAppellations("우리가 만나 왔던 키사키 문주가 아니었나?", {
      speaker,
      target: kisaki,
      matchedJpTerms: ["キサキ門主"],
    }),
    ["키사키 문주"]
  );
  assert.deepEqual(
    extractKrAppellations("아코 선임행정관, 진심으로 말씀하시는 건가요?!", {
      speaker,
      target: ako,
      matchedJpTerms: ["アコ行政官"],
    }),
    ["아코 선임행정관"]
  );
  assert.deepEqual(
    extractKrAppellations("토모에 비서실장, 이번 쿠데타가 몇 번째지?", {
      speaker,
      target: tomoe,
      matchedJpTerms: ["トモエ秘書室長"],
    }),
    ["토모에 비서실장"]
  );
  assert.deepEqual(
    extractKrAppellations("정의실현부의 하스미 부부장님께서도 좋아하실 것 같아요!", {
      speaker,
      target: hasumi,
      matchedJpTerms: ["ハスミさん"],
    }),
    ["하스미 부부장님"]
  );
  assert.deepEqual(
    extractKrAppellations("미네 단장님이 알게 되신다면 분명 슬퍼하실 거라고요!", {
      speaker,
      target: mine,
      matchedJpTerms: ["ミネ団長"],
    }),
    ["미네 단장님"]
  );

  // 2. Copula and compound particles in KR_PARTICLE_LOOKAHEAD
  assert.deepEqual(
    extractKrAppellations("응? 선도부장이잖아. 무슨 일이야?", {
      speaker,
      target: hina,
      matchedJpTerms: ["風紀委員長"],
    }),
    ["선도부장"]
  );
  assert.deepEqual(
    extractKrAppellations("역시 뭐든지 알고 계시는 사장님이시군요…….", {
      speaker,
      target: aru,
      matchedJpTerms: ["社長"],
    }),
    ["사장님"]
  );
  assert.deepEqual(
    extractKrAppellations("정말이지 그런 오물에게는 어울리지 않는 메이드네요.", {
      speaker,
      target: rio,
      matchedJpTerms: ["あの陰気な女"],
      extraKrTerms: ["오물 같은 여자", "오물"],
    }),
    ["오물"]
  );
  assert.deepEqual(
    extractKrAppellations("저희의 목표는 어디까지나 백토입니다.", {
      speaker,
      target: koyuki,
      matchedJpTerms: ["白兎"],
    }),
    ["백토"]
  );

  // 3. Self-reference 님 honorific (Makoto -> 마코토 님)
  assert.deepEqual(
    extractKrAppellations("가장 위대한 지도자인 마코토 님이시다!", {
      speaker: makoto,
      target: self,
      matchedJpTerms: ["マコト様"],
    }),
    ["마코토 님"]
  );

  // 4. JP_TO_KR_TITLES expansions (사감대)
  assert.deepEqual(
    extractKrAppellations("위기의 순간 사감대의 추적을 따돌릴 수 있겠죠.", {
      speaker,
      target: dorm,
      matchedJpTerms: ["寮監隊"],
    }),
    ["사감대"]
  );

  // 5. Reject clause-adverb KR fragments ("거기다 시로코 선배까지")
  assert.deepEqual(
    extractStandaloneVocative(
      {
        jp: "シロコ先輩まで！",
        kr: "거기다 시로코 선배까지",
        en: "And Shiroko too!",
      },
      ["シロコ先輩"],
      ["시로코 선배"],
      ["Shiroko"],
      shiroko
    ),
    {}
  );
});

test("Vice/Deputy titles & Hoshino -> Ayane Student Council President regressions", () => {
  // 1. Bare title inside 副 compound must be skipped
  assert.deepEqual(findMatchedJpTerms("副生徒会長さん！", ["副生徒会長さん", "生徒会長"]), [
    "副生徒会長さん",
  ]);
  assert.deepEqual(findMatchedJpTerms("副部長としての命令だって。", ["副部長", "部長"]), [
    "副部長",
  ]);

  const speaker = makeChar({ id: "nonomi", name: { jp: "ノノミ", en: "Nonomi", kr: "노노미" } });
  const hoshino = makeChar({ id: "hoshino", name: { jp: "ホシノ", en: "Hoshino", kr: "호시노" } });
  const ayane = makeChar({ id: "ayane", name: { jp: "アヤネ", en: "Ayane", kr: "아야네" } });
  const konoka = makeChar({ id: "konoka", name: { jp: "コノカ", en: "Konoka", kr: "코노카" } });
  const niko = makeChar({ id: "niko", name: { jp: "ニコ", en: "Niko", kr: "니코" } });
  const himari = makeChar({ id: "himari", name: { jp: "ヒマリ", en: "Himari", kr: "히마리" } });

  // 2. Nonomi & Kaiser PMC Director -> Hoshino (Vice President, not bare President)
  assert.deepEqual(
    extractEnAppellations("I've been waiting for you, Vice President!", {
      speaker,
      target: hoshino,
      matchedJpTerms: ["副生徒会長さん"],
    }),
    ["Vice President"]
  );
  assert.deepEqual(
    extractEnAppellations("Wise decision, Vice President.", {
      speaker,
      target: hoshino,
      matchedJpTerms: ["副生徒会長"],
    }),
    ["Vice President"]
  );

  // 3. Deputy Director Konoka & 코노카 부국장
  assert.deepEqual(
    extractEnAppellations("I've been doing well. Deputy Director Konoka...was it?", {
      speaker,
      target: konoka,
      matchedJpTerms: ["コノカ副局長"],
    }),
    ["Deputy Director Konoka"]
  );
  assert.deepEqual(
    extractKrAppellations("잘 지내고 있다. 코노카 부국장…… 이었던가?", {
      speaker,
      target: konoka,
      matchedJpTerms: ["コノカ副局長"],
    }),
    ["코노카 부국장"]
  );

  // 4. Otogi -> Niko Deputy Squad Leader
  assert.deepEqual(
    extractEnAppellations("I'm technically outranked here, Deputy Squad Leader.", {
      speaker,
      target: niko,
      matchedJpTerms: ["副小隊長"],
    }),
    ["Deputy Squad Leader"]
  );

  // 5. Bare President must NOT match inside Vice President
  assert.deepEqual(
    extractEnAppellations("This is an order from the vice president.", {
      speaker,
      target: himari,
      matchedJpTerms: ["部長"],
    }),
    []
  );

  // 6. Hoshino -> Ayane Student Council President (アヤネ会長)
  assert.deepEqual(
    extractEnAppellations("Ayane... I mean, Student Council President.", {
      speaker: hoshino,
      target: ayane,
      matchedJpTerms: ["アヤネ会長"],
    }),
    ["Student Council President"]
  );
  assert.deepEqual(
    extractKrAppellations("아야네…… 아니, 학생회장님.", {
      speaker: hoshino,
      target: ayane,
      matchedJpTerms: ["アヤネ会長"],
    }),
    ["학생회장님"]
  );
});

test("GSC President (Original NP0040 vs False NP0290) split, acting guard, and scene routing", () => {
  // 1. Acting GSC President (連邦生徒会長代行) must NOT match 連邦生徒会長
  assert.deepEqual(
    findMatchedJpTerms("連邦生徒会長代行のリンから指示がありました。", ["連邦生徒会長"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("連邦生徒会長の行方を探しています。", ["連邦生徒会長"]),
    ["連邦生徒会長"]
  );

  // 2. Speaker resolver splits NP0040 vs NP0290 even when both share 連邦生徒会長
  const gscOrig = makeChar({
    id: "npc:gsc_president",
    kind: "npc",
    name: { jp: "連邦生徒会長", en: "GSC President", kr: "총학생회장" },
    school: "GSC",
  });
  const gscFalse = makeChar({
    id: "npc:gsc_president_false",
    kind: "npc",
    name: { jp: "連邦生徒会長（偽）", en: "GSC President (False)", kr: "총학생회장 (가짜)" },
    school: "GSC",
  });

  const resolver = buildSpeakerResolver(
    [gscOrig, gscFalse],
    [
      {
        character_name: xxhash32("총학생회장"),
        name_kr: "총학생회장",
        name_jp: "連邦生徒会長",
        name_en: "Student Council President",
        spine_prefab_name: "UIs/03_Scenario/02_Character/CharacterSpine_NP0040",
        small_portrait: "UIs/01_Common/01_Character/NPC_Portrait_NP0040",
      },
      {
        character_name: xxhash32("가짜 총학생회장"),
        name_kr: "총학생회장",
        name_jp: "連邦生徒会長",
        name_en: "General Student Council President",
        spine_prefab_name: "UIs/03_Scenario/02_Character/CharacterSpine_NP0290",
        small_portrait: "UIs/01_Common/01_Character/NPC_Portrait_NP0290",
      },
    ],
    []
  );
  assert.equal(resolver.resolveByScriptKrKey("총학생회장").characterId, "npc:gsc_president");
  assert.equal(resolver.resolveByScriptKrKey("가짜 총학생회장").characterId, "npc:gsc_president_false");

  // 3. Scene routing separates Act 2 False GSC President from original disappeared GSC President
  const sceneWithFalse = [
    { speakerId: "npc:gsc_president_false", jp: "ええ、そうですよ……どうされましたか、リン。", kr: "네." },
    { speakerId: "npc:rin", jp: "あなたが……連邦生徒会長？", kr: "당신이 총학생회장?" },
    { speakerId: "npc:rin", jp: "私の知る連邦生徒会長は、あなたではありません。", kr: "제가 아는 총학생회장은 당신이 아닙니다." },
  ];
  const ambigLine = {
    speakerId: "npc:rin",
    sourceType: "main_story" as const,
    sourceRef: "script:201050#2",
    groupId: 201050,
    jp: sceneWithFalse[1].jp,
    kr: sceneWithFalse[1].kr,
    jpOnly: false,
  };
  const realCueLine = {
    speakerId: "npc:rin",
    sourceType: "main_story" as const,
    sourceRef: "script:201050#3",
    groupId: 201050,
    jp: sceneWithFalse[2].jp,
    kr: sceneWithFalse[2].kr,
    jpOnly: false,
  };

  assert.equal(
    matchesGscPresidentScene(ambigLine, "npc:gsc_president_false", "連邦生徒会長", sceneWithFalse),
    true
  );
  assert.equal(
    matchesGscPresidentScene(ambigLine, "npc:gsc_president", "連邦生徒会長", sceneWithFalse),
    false
  );
  assert.equal(
    matchesGscPresidentScene(realCueLine, "npc:gsc_president", "連邦生徒会長", sceneWithFalse),
    true
  );
  assert.equal(
    matchesGscPresidentScene(realCueLine, "npc:gsc_president_false", "連邦生徒会長", sceneWithFalse),
    false
  );
});

test("extractZhAppellations handles self, sensei, you, named targets, 1-char stems, stutters, and title fallback", () => {
  const hoshino = makeChar({
    id: "hoshino",
    name: { jp: "ホシノ", en: "Hoshino", kr: "호시노", zh: "星野" },
    fullName: { jp: "小鳥遊ホシノ", en: "Takanashi Hoshino", kr: "타카나시 호시노", zh: "小鳥遊星野" },
  });
  const hina = makeChar({
    id: "hina",
    name: { jp: "ヒナ", en: "Hina", kr: "히나", zh: "陽奈" },
  });
  const rio = makeChar({
    id: "rio",
    name: { jp: "リオ", en: "Rio", kr: "리오", zh: "莉央" },
  });
  const midori = makeChar({
    id: "midori",
    name: { jp: "ミドリ", en: "Midori", kr: "미ドリ", zh: "綠" },
  });
  const selfChar = makeChar({ id: "special:self", kind: "special" });
  const senseiChar = makeChar({ id: "special:sensei", kind: "special" });
  const youChar = makeChar({ id: "special:you", kind: "special" });

  // special:self: 大叔我 should not double-count 我 or 大叔
  assert.deepEqual(
    extractZhAppellations("哎呀～大叔我偶爾也是會認真的呀～", {
      speaker: hoshino,
      target: selfChar,
      matchedJpTerms: ["おじさん"],
    }),
    ["大叔我"]
  );
  // special:self: self-intro guard avoids bare name
  assert.deepEqual(
    extractZhAppellations("我是星野，請多指教。", {
      speaker: hoshino,
      target: selfChar,
      matchedJpTerms: ["私"],
    }),
    ["我"]
  );

  // special:sensei: [USERNAME]老師 does not double-count 老師
  assert.deepEqual(
    extractZhAppellations("歡迎來到「希迪姆的箱子」，[USERNAME]老師。", {
      speaker: hoshino,
      target: senseiChar,
      matchedJpTerms: ["[USERNAME]先生"],
    }),
    ["[USERNAME]老師"]
  );
  assert.deepEqual(
    extractZhAppellations("對了，夏萊的老師來了嗎？", {
      speaker: hoshino,
      target: senseiChar,
      matchedJpTerms: ["シャーレの先生"],
    }),
    ["夏萊的老師"]
  );

  // special:you
  assert.deepEqual(
    extractZhAppellations("你們這些傢伙在說什麼？", {
      speaker: hoshino,
      target: youChar,
      matchedJpTerms: ["お前ら"],
    }),
    ["你們"]
  );

  // Stutter normalization + named suffix
  assert.deepEqual(
    extractZhAppellations("陽，陽，陽奈委員長！？", {
      speaker: hoshino,
      target: hina,
      matchedJpTerms: ["ヒナ委員長"],
    }),
    ["陽奈委員長"]
  );

  // 1-char stem guard (綠): rejects 綠色/綠茶, accepts boundary-framed 綠
  assert.deepEqual(
    extractZhAppellations("這杯綠茶是綠色的。", {
      speaker: hoshino,
      target: midori,
      matchedJpTerms: ["ミドリ"],
    }),
    []
  );
  assert.deepEqual(
    extractZhAppellations("哼～綠你還敢說，剛剛是誰先喊的？", {
      speaker: hoshino,
      target: midori,
      matchedJpTerms: ["ミドリ"],
    }),
    ["綠"]
  );

  // JP_TO_ZH_TITLES fallback (大姐頭, 淨化槽裡的汙水)
  assert.deepEqual(
    extractZhAppellations("別看大姐頭那樣，其實內心和淨化槽裡的汙水一樣唷。", {
      speaker: hoshino,
      target: rio,
      matchedJpTerms: ["ビッグシスター"],
    }),
    ["大姐頭"]
  );
  assert.deepEqual(
    extractZhAppellations("其實內心和淨化槽裡的汙水一樣唷。", {
      speaker: hoshino,
      target: rio,
      matchedJpTerms: ["浄化槽の濁った水"],
    }),
    ["淨化槽裡的汙水"]
  );
});

test("findMatchedJpTerms guards bare あなた against honorific あなた様 (Wakamo -> Sensei vs Kikyou)", () => {
  assert.deepEqual(
    findMatchedJpTerms("あなた様のため……必ずや勝利を掴んで見せますわ。", ["あなた"]),
    []
  );
  assert.deepEqual(
    findMatchedJpTerms("あなた様のため……必ずや勝利を掴んで見せますわ。", ["あなた様"]),
    ["あなた様"]
  );
  assert.deepEqual(
    findMatchedJpTerms("ふむ……\nそれにしても、あなた……。", ["あなた"]),
    ["あなた"]
  );
});

test("Reisa and Suzumi Magical Girl self-references extract Thermite Pink/White without double-counting", () => {
  const reisa = makeChar({
    id: "reisa",
    name: { jp: "レイサ", en: "Reisa", kr: "레이사", zh: "澪紗" },
  });
  const suzumi = makeChar({
    id: "suzumi",
    name: { jp: "スズミ", en: "Suzumi", kr: "스즈미", zh: "鈴美" },
  });
  const selfChar = makeChar({ id: "special:self", kind: "special" });

  assert.deepEqual(
    extractEnAppellations('And I am "Thermite Pink," Thermite White\'s best friend!', {
      speaker: reisa,
      target: selfChar,
      matchedJpTerms: ["テルミットピンク"],
      extraEnTerms: ["Thermite Pink", "Pink"],
    }),
    ["Thermite Pink"]
  );
  assert.deepEqual(
    extractKrAppellations("저는 <테르밋 핑크>! <테르밋 화이트>를 돕는 사이드킥입니다!", {
      speaker: reisa,
      target: selfChar,
      matchedJpTerms: ["テルミットピンク"],
      extraKrTerms: ["테르밋 핑크", "핑크"],
    }),
    ["저", "테르밋 핑크"]
  );
  assert.deepEqual(
    extractEnAppellations("Th-Thermite White has arrived!", {
      speaker: suzumi,
      target: selfChar,
      matchedJpTerms: ["テルミットホワイト"],
      extraEnTerms: ["Thermite White", "White"],
    }),
    ["Thermite White"]
  );
  assert.deepEqual(
    extractKrAppellations("테, 테르밋 화이트. 등장~!", {
      speaker: suzumi,
      target: selfChar,
      matchedJpTerms: ["テルミットホワイト"],
      extraKrTerms: ["테르밋 화이트", "화이트"],
    }),
    ["테르밋 화이트"]
  );
});
