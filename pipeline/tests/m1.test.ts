import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayableCharacters } from "../src/steps/02_build_characters.js";
import {
  parseWikiruHtml,
  resolveWikiruToRoster,
} from "../src/steps/04_parse_wikiru.js";
import type { NpcRosterConfig, SchaleDbStudent } from "../src/types.js";

const EMPTY_NPC_ROSTER: NpcRosterConfig = {
  schools: {},
  clubs: {},
  schoolJpToKey: {},
  clubJpToKey: {},
  readingsJp: {
    御坂美琴: "みさかみこと",
  },
  npcs: [],
};

function makeStudent(overrides: Partial<SchaleDbStudent>): SchaleDbStudent {
  return {
    Id: 10000,
    IsReleased: [true, true, true],
    DefaultOrder: 0,
    PathName: "aru",
    DevName: "Aru",
    Name: "Aru",
    School: "Gehenna",
    Club: "Kohshinjo68",
    FamilyName: "Rikuhachima",
    PersonalName: "Aru",
    FavorAlts: [],
    IsLimited: 0,
    ...overrides,
  };
}

test("buildPlayableCharacters groups FavorAlts, keeps Shiroko*Terror separate, and disambiguates duplicate alt names", () => {
  const en: Record<string, SchaleDbStudent> = {
    "10005": makeStudent({
      Id: 10005,
      PathName: "hoshino",
      DevName: "Hoshino",
      Name: "Hoshino",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Takanashi",
      PersonalName: "Hoshino",
      FavorAlts: [10045, 10098],
    }),
    "10045": makeStudent({
      Id: 10045,
      PathName: "hoshino_swimsuit",
      DevName: "CH0091",
      Name: "Hoshino (Swimsuit)",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Takanashi",
      PersonalName: "Hoshino",
      FavorAlts: [10005, 10098],
      IsLimited: 1,
    }),
    "10098": makeStudent({
      Id: 10098,
      PathName: "hoshino_battle_tank",
      DevName: "CH0258_02",
      Name: "Hoshino (Armed)",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Takanashi",
      PersonalName: "Hoshino",
      FavorAlts: [10005, 10045],
      IsLimited: 1,
    }),
    "10099": makeStudent({
      Id: 10099,
      PathName: "hoshino_battle_dealer",
      DevName: "CH0258_01",
      Name: "Hoshino (Armed)",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Takanashi",
      PersonalName: "Hoshino",
      FavorAlts: [10005, 10045],
      IsReleased: [true, true, false],
      IsLimited: 1,
    }),
    "10010": makeStudent({
      Id: 10010,
      PathName: "shiroko",
      DevName: "Shiroko",
      Name: "Shiroko",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Sunaookami",
      PersonalName: "Shiroko",
      FavorAlts: [20027],
    }),
    "20027": makeStudent({
      Id: 20027,
      PathName: "shiroko_swimsuit",
      DevName: "CH0188",
      Name: "Shiroko (Swimsuit)",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Sunaookami",
      PersonalName: "Shiroko",
      FavorAlts: [10010],
    }),
    "10100": makeStudent({
      Id: 10100,
      PathName: "shiroko_terror",
      DevName: "CH0263",
      Name: "Shiroko*Terror",
      School: "Abydos",
      Club: "Countermeasure",
      FamilyName: "Sunaookami",
      PersonalName: "Shiroko",
      FavorAlts: [],
    }),
    "10011": makeStudent({
      Id: 10011,
      PathName: "shun",
      DevName: "Shun",
      Name: "Shun",
      School: "Shanhaijing",
      Club: "PlumBlossom",
      FamilyName: "Sunohara",
      PersonalName: "Shun",
      FavorAlts: [10025],
    }),
    "10025": makeStudent({
      Id: 10025,
      PathName: "shun_small",
      DevName: "CH0066",
      Name: "Shun (Small)",
      School: "Shanhaijing",
      Club: "PlumBlossom",
      FamilyName: "Sunohara",
      PersonalName: "Shun",
      FavorAlts: [10011],
    }),
    "10144": makeStudent({
      Id: 10144,
      PathName: "shunling_swimsuit",
      DevName: "CH0355_02",
      Name: "Shunling (Swimsuit)",
      School: "Shanhaijing",
      Club: "PlumBlossom",
      FamilyName: "",
      PersonalName: "Shunling",
      FavorAlts: [10011, 10025],
      IsReleased: [true, true, false],
    }),
    "26000": makeStudent({
      Id: 26000,
      PathName: "misaka_mikoto",
      DevName: "CH9999",
      Name: "Misaka Mikoto",
      School: "Tokiwadai",
      Club: "",
      FamilyName: "",
      PersonalName: "Mikoto",
      FavorAlts: [],
    }),
  };

  const jp: Record<string, SchaleDbStudent> = {
    ...en,
    "10005": { ...en["10005"], Name: "ホシノ", FamilyName: "小鳥遊", PersonalName: "ホシノ" },
    "10045": { ...en["10045"], Name: "ホシノ（水着）", FamilyName: "小鳥遊", PersonalName: "ホシノ" },
    "10098": { ...en["10098"], Name: "ホシノ（臨戦）", FamilyName: "小鳥遊", PersonalName: "ホシノ" },
    "10099": { ...en["10099"], Name: "ホシノ（臨戦）", FamilyName: "小鳥遊", PersonalName: "ホシノ" },
    "10010": { ...en["10010"], Name: "シロコ", FamilyName: "砂狼", PersonalName: "シロコ" },
    "20027": { ...en["20027"], Name: "シロコ（水着）", FamilyName: "砂狼", PersonalName: "シロコ" },
    "10100": { ...en["10100"], Name: "シロコ＊テラー", FamilyName: "砂狼", PersonalName: "シロコ" },
    "10011": { ...en["10011"], Name: "シュン", FamilyName: "春原", PersonalName: "シュン" },
    "10025": { ...en["10025"], Name: "シュン（幼女）", FamilyName: "春原", PersonalName: "シュン" },
    "10144": { ...en["10144"], Name: "シュン（水着）", FamilyName: "", PersonalName: "シュン" },
    "26000": { ...en["26000"], Name: "御坂美琴", FamilyName: "", PersonalName: "美琴" },
  };

  const chars = buildPlayableCharacters(en, jp, en, EMPTY_NPC_ROSTER);
  assert.equal(chars.length, 5);

  const hoshino = chars.find((c) => c.id === "hoshino");
  assert.ok(hoshino);
  assert.equal(hoshino.variants.length, 4);
  const tank = hoshino.variants.find((v) => v.id === 10098);
  const dealer = hoshino.variants.find((v) => v.id === 10099);
  assert.equal(tank?.variantTag, "tank");
  assert.equal(dealer?.variantTag, "dealer");
  assert.equal(dealer?.released.cn, false);

  const shiroko = chars.find((c) => c.id === "shiroko");
  const kuroko = chars.find((c) => c.id === "shiroko_terror");
  assert.ok(shiroko && kuroko);
  assert.equal(kuroko.name.jp, "シロコ＊テラー");
  assert.equal(kuroko.name.en, "Shiroko*Terror");

  const shun = chars.find((c) => c.id === "shun");
  assert.ok(shun);
  assert.equal(shun.variants.length, 3);
  assert.ok(shun.aliases.en.includes("Shunling"));

  const mikoto = chars.find((c) => c.id === "misaka_mikoto");
  assert.ok(mikoto);
  assert.equal(mikoto.kind, "collab");
  assert.equal(mikoto.reading?.jp, "みさかみこと");
});

test("parseWikiruHtml parses headings, multi-line terms, footnotes, anchors, and skips non-data tables", () => {
  const sampleHtml = `
  <div id="body">
    <h2 id="content_1_0">アビドス高等学校 <a class="anchor_super" id="abydos" href="#">&dagger;</a></h2>
    <h3 id="content_1_1">対策委員会 <a class="anchor_super" id="CountermeasuresCouncil" href="#">&dagger;</a></h3>
    <table class="style_table"><tbody><tr><td>TOC</td></tr></tbody></table>
    <h4 id="content_1_2">ホシノ <a class="anchor_super" id="Hoshino" href="#">&dagger;</a></h4>
    <div class="ie5">
      <table class="style_table">
        <thead><tr><th>キャラクター</th><th>相手</th><th>呼称</th></tr></thead>
        <tbody>
          <tr>
            <td rowspan="3"><a href="./?ホシノ">ホシノ</a></td>
            <td>自分</td>
            <td>私<br class="spacer" />おじさん</td>
          </tr>
          <tr>
            <td><a href="#Shiroko">シロコ</a></td>
            <td>シロコちゃん</td>
          </tr>
          <tr>
            <td><a href="#Nonomi">ノノミ</a></td>
            <td>ノノミちゃん<br class="spacer" />十六夜ノノミさん<a id="notetext_1" href="#notefoot_1" class="note_super" title="初対面時">*1</a><br class="spacer" />お嬢さん<a id="notetext_2" href="#notefoot_2" class="note_super" title="fallback">*2</a></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div id="note">
      <a id="notefoot_1" href="#notetext_1" class="note_super">*1</a>初対面時<br />
      <a id="notefoot_2" href="#notetext_2" class="note_super">*2</a><span>過去</span><br />
    </div>
  </div>`;

  const parsed = parseWikiruHtml(sampleHtml);
  assert.equal(parsed.tables.length, 1);
  const t = parsed.tables[0];
  assert.equal(t.schoolJp, "アビドス高等学校");
  assert.equal(t.clubJp, "対策委員会");
  assert.equal(t.speakerName, "ホシノ");
  assert.equal(t.speakerAnchor, "Hoshino");
  assert.equal(t.rows.length, 3);

  assert.deepEqual(t.rows[0], {
    targetName: "自分",
    terms: [{ term: "私" }, { term: "おじさん" }],
  });
  assert.deepEqual(t.rows[1], {
    targetName: "シロコ",
    targetAnchor: "Shiroko",
    terms: [{ term: "シロコちゃん" }],
  });
  assert.deepEqual(t.rows[2], {
    targetName: "ノノミ",
    targetAnchor: "Nonomi",
    terms: [
      { term: "ノノミちゃん" },
      { term: "十六夜ノノミさん", rawFootnote: "初対面時" },
      { term: "お嬢さん", rawFootnote: "過去" },
    ],
  });
});

test("resolveWikiruToRoster classifies section anchors as entities and splits compound footnotes", () => {
  const html = `
  <div id="body">
    <h2 id="content_1_0">トリニティ総合学園 <a class="anchor_super" id="trinity" href="#">&dagger;</a></h2>
    <h3 id="content_1_1">ティーパーティー <a class="anchor_super" id="TeaParty" href="#">&dagger;</a></h3>
    <h4 id="content_1_2">ホシノ <a class="anchor_super" id="Hoshino" href="#">&dagger;</a></h4>
    <table class="style_table">
      <thead><tr><th>キャラクター</th><th>相手</th><th>呼称</th></tr></thead>
      <tbody>
        <tr>
          <td rowspan="2"><a href="./?ホシノ">ホシノ</a></td>
          <td><a href="#TeaParty">ティーパーティー</a></td>
          <td>ティーパーティー<a href="#notefoot_1" class="note_super" title="覆面時">*1</a><a href="#notefoot_2" class="note_super" title="過去">*2</a></td>
        </tr>
        <tr>
          <td>先生</td>
          <td>先生</td>
        </tr>
      </tbody>
    </table>
    <div id="note">
      <a id="notefoot_1" href="#notetext_1" class="note_super">*1</a>覆面時<br />
      <a id="notefoot_2" href="#notetext_2" class="note_super">*2</a>過去<br />
    </div>
  </div>`;

  const parsed = parseWikiruHtml(html);
  assert.ok(parsed.sectionAnchors.has("trinity"));
  assert.ok(parsed.sectionAnchors.has("TeaParty"));

  const baseCharacters = buildPlayableCharacters(
    {
      "10005": makeStudent({
        Id: 10005,
        PathName: "hoshino",
        Name: "Hoshino",
        School: "Abydos",
        Club: "Countermeasure",
      }),
    },
    {
      "10005": makeStudent({
        Id: 10005,
        PathName: "hoshino",
        Name: "ホシノ",
        PersonalName: "ホシノ",
        School: "Abydos",
        Club: "Countermeasure",
      }),
    },
    {
      "10005": makeStudent({
        Id: 10005,
        PathName: "hoshino",
        Name: "호시노",
        PersonalName: "호시노",
        School: "Abydos",
        Club: "Countermeasure",
      }),
    },
    EMPTY_NPC_ROSTER
  );

  const res = resolveWikiruToRoster({
    parsed,
    baseCharacters,
    npcRoster: EMPTY_NPC_ROSTER,
    wikiruAliases: { byAnchor: {}, byJpName: {} },
    footnoteGlossary: {
      覆面時: { tag: "masked", text: { jp: "覆面時", en: "While masked", kr: "복면 착용 시" } },
      過去: { tag: "past", text: { jp: "過去", en: "In the past", kr: "과거" } },
    },
  });

  const teaParty = res.characters.find((c) => c.wikiruAnchor === "TeaParty");
  assert.equal(teaParty?.kind, "entity");
  assert.equal(res.wikiruReport.unmappedFootnotes.length, 0);
  const entry = res.seedEntries.find((e) => e.targetId === teaParty?.id);
  assert.deepEqual(entry?.jpTerms[0].contextTags, ["masked", "past"]);
  assert.equal(entry?.jpTerms[0].notes?.en, "While masked / In the past");

  // Also ensure uncurated entities with JP-only or Latin anchors keep missing EN/KR blank ("")
  const parsedBlank = parseWikiruHtml(`
  <div id="body">
    <h4 id="content_1_0">ヒフミ <a class="anchor_super" id="Hifumi" href="#">&dagger;</a></h4>
    <table class="style_table">
      <thead><tr><th>キャラクター</th><th>相手</th><th>呼称</th></tr></thead>
      <tbody>
        <tr>
          <td rowspan="2"><a href="./?ヒフミ">ヒフミ</a></td>
          <td>ペロロサウルス</td>
          <td>ペロロサウルス</td>
        </tr>
        <tr>
          <td><a href="#NaturesBeauty">花鳥風月部</a></td>
          <td>花鳥風月部</td>
        </tr>
      </tbody>
    </table>
  </div>`);
  const blankRes = resolveWikiruToRoster({
    parsed: parsedBlank,
    baseCharacters: [
      ...baseCharacters,
      {
        id: "hifumi",
        kind: "student",
        name: { jp: "ヒフミ", en: "Hifumi", kr: "히후미" },
        school: "Trinity",
        released: { jp: true, global: true, cn: true },
        defaultImages: { icon: "" },
        variants: [],
        aliases: { jp: ["ヒフミ"], kr: ["히후미"], en: ["Hifumi"] },
      },
    ],
    npcRoster: EMPTY_NPC_ROSTER,
    wikiruAliases: { byAnchor: {}, byJpName: {} },
    footnoteGlossary: {},
  });
  const perorosaurus = blankRes.characters.find((c) => c.name.jp === "ペロロサウルス");
  assert.equal(perorosaurus?.name.en, "");
  assert.equal(perorosaurus?.name.kr, "");
  const naturesBeauty = blankRes.characters.find((c) => c.name.jp === "花鳥風月部");
  assert.equal(naturesBeauty?.name.en, "NaturesBeauty");
  assert.equal(naturesBeauty?.name.kr, "");
});
