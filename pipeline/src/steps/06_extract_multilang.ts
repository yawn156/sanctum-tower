import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  DATA_MANUAL_DIR,
  DATA_OUTPUT_DIR,
  DIALOGUE_INDEX_PATH,
  STORY_LABELS_PATH,
} from "../config.js";
import type {
  AppellationEntry,
  AppellationsOutput,
  Character,
  CharactersOutput,
  DialogueLineRecord,
  JpAppellationsSeedOutput,
  LocalizedText,
  QuoteCitation,
  QuoteContextLine,
  SpeechLevel,
  StoryLabelEntry,
  TermVariant,
} from "../types.js";
import { readJson } from "../utils/cache.js";

const KANJI_RE = /[\u4E00-\u9FFF]/;
const SINGLE_KANJI_PRONOUNS = new Set(["私", "僕", "俺", "我", "君", "妾"]);
const ALLOWED_KANJI_PRONOUN_SUFFIX = new Set(["め"]);
const SINGULAR_GENERIC_TITLES = new Set([
  "先輩",
  "後輩",
  "会長",
  "副会長",
  "委員長",
  "部長",
  "隊長",
  "団長",
  "お嬢さん",
  "お嬢様",
  "お姉さん",
  "お姉ちゃん",
  "お姉様",
  "先生",
  "チビ",
]);
const SINGULAR_TITLE_PLURAL_SUFFIXES = [
  "たち",
  "タチ",
  "達",
  "方",
  "がた",
  "ガタ",
  "ら",
  "ども",
  "ドモ",
  "共",
  "皆さん",
  "の皆様",
];
const SINGULAR_JP_PRONOUNS = new Set([
  "私",
  "わたし",
  "ワタシ",
  "わたくし",
  "ワタクシ",
  "あたし",
  "アタシ",
  "僕",
  "ぼく",
  "ボク",
  "俺",
  "おれ",
  "オレ",
  "我",
  "われ",
  "妾",
  "わらわ",
  "自分",
  "あなた",
  "アナタ",
  "貴方",
  "あんた",
  "アンタ",
  "お前",
  "おまえ",
  "オマエ",
  "君",
  "きみ",
  "キミ",
  "貴様",
  "きさま",
]);
const PLURAL_PRONOUN_SUFFIXES = [
  "たち",
  "タチ",
  "達",
  "ら",
  "ラ",
  "共",
  "ども",
  "ドモ",
  "等",
  "々",
  "方",
  "がた",
  "ガタ",
];
const KANA_OR_KANJI_RE = /[\u3040-\u30FF\u4E00-\u9FFF]/;

export function expandJpTermNeedles(term: string): string[] {
  const needles = new Set<string>([term]);
  if (/[()（）○〇]/.test(term)) {
    if (term === "（先生のユーザー名）") {
      needles.add("[USERNAME]");
    } else {
      // 1. Replace placeholder circles with [USERNAME], and also try stripping them
      const withUser = term
        .replace(/[（(]?[○〇]{2,}[)）]?/g, "[USERNAME]")
        .trim();
      if (withUser) needles.add(withUser);

      // 2. Strip all parenthesized furigana/notes (e.g. 私(わたくし) -> 私, (ココロ)部長 -> 部長)
      const strippedParens = term
        .replace(/[（(][^）)]*[)）]/g, "")
        .replace(/[○〇]{2,}/g, "")
        .trim();
      if (strippedParens && strippedParens.length >= 1) {
        needles.add(strippedParens);
      }

      // 3. Remove paren characters only (e.g. (護守)ナナミ -> 護守ナナミ, ショウコ(ちゃん) -> ショウコちゃん)
      const unparen = term.replace(/[()（）○〇]/g, "").trim();
      if (unparen && unparen.length >= 2) {
        needles.add(unparen);
      }
    }
  }
  return Array.from(needles).filter(Boolean);
}

export function findMatchedJpTerms(
  jpLine: string,
  jpTerms: string[],
  isSpecialYou = false,
  isEntityTarget = false
): string[] {
  if (!jpLine || jpTerms.length === 0) return [];

  // Build (needle -> canonical wikiru term) pairs sorted by descending needle length
  const needlePairs: Array<{ needle: string; canonical: string }> = [];
  for (const canonical of Array.from(new Set(jpTerms)).filter(Boolean)) {
    for (const needle of expandJpTermNeedles(canonical)) {
      needlePairs.push({ needle, canonical });
    }
  }
  needlePairs.sort((a, b) => b.needle.length - a.needle.length);

  const occupied: Array<[number, number]> = [];
  const matchedSet = new Set<string>();
  const matched: string[] = [];

  const overlaps = (start: number, end: number) =>
    occupied.some(([s, e]) => start < e && end > s);

  for (const { needle, canonical } of needlePairs) {
    let idx = 0;
    let termMatched = false;
    while (idx < jpLine.length) {
      const pos = jpLine.indexOf(needle, idx);
      if (pos === -1) break;
      const end = pos + needle.length;

      if (!overlaps(pos, end)) {
        let valid = true;
        if (SINGLE_KANJI_PRONOUNS.has(needle)) {
          const prev = pos > 0 ? jpLine[pos - 1] : "";
          const next = end < jpLine.length ? jpLine[end] : "";
          if (KANJI_RE.test(prev)) valid = false;
          if (
            valid &&
            KANJI_RE.test(next) &&
            !ALLOWED_KANJI_PRONOUN_SUFFIX.has(next)
          ) {
            valid = false;
          }
          if (
            valid &&
            needle === "君" &&
            (isSpecialYou || true) &&
            KANA_OR_KANJI_RE.test(prev)
          ) {
            // Avoid matching name + 君 (-kun) as standalone 君 (kimi)
            valid = false;
          }
        }
        if (valid && SINGULAR_JP_PRONOUNS.has(needle)) {
          for (const suffix of PLURAL_PRONOUN_SUFFIXES) {
            if (jpLine.startsWith(suffix, end)) {
              if (
                (suffix === "ら" && jpLine.startsWith("らし", end)) ||
                (suffix === "ラ" && jpLine.startsWith("ラシ", end))
              ) {
                continue;
              }
              valid = false;
              break;
            }
          }
        }
        if (valid && /^[\u30A0-\u30FF]{1,2}$/.test(needle)) {
          const prev = pos > 0 ? jpLine[pos - 1] : "";
          const next = end < jpLine.length ? jpLine[end] : "";
          if (/[\u30A0-\u30FFー]/.test(prev) || /[\u30A0-\u30FFー]/.test(next)) {
            valid = false;
          }
        }
        if (valid && !isEntityTarget && SINGULAR_GENERIC_TITLES.has(needle)) {
          for (const suffix of SINGULAR_TITLE_PLURAL_SUFFIXES) {
            if (jpLine.startsWith(suffix, end)) {
              valid = false;
              break;
            }
          }
        }
        if (
          valid &&
          needle === "手前" &&
          (jpLine.startsWith("さん", end) || jpLine[end] === "様")
        ) {
          // Avoid matching polite 2nd-person 手前さん / 手前様 as bare 手前
          valid = false;
        }
        if (
          valid &&
          (needle === "バカ" || needle === "ばか" || needle === "馬鹿") &&
          (jpLine.startsWith("な", end) ||
            jpLine.startsWith("に", end) ||
            jpLine.startsWith("みたい", end) ||
            jpLine.startsWith("らしい", end) ||
            jpLine.startsWith("げた", end))
        ) {
          // Avoid matching exclamations like バカな ("Impossible!") or バカに ("ridiculous / mockingly")
          valid = false;
        }
        if (valid && needle === "委員会" && pos > 0 && KANJI_RE.test(jpLine[pos - 1])) {
          // Avoid matching generic "委員会" inside specific club names like 図書委員会 / 風紀委員会
          valid = false;
        }
        if (valid && needle === "チビ") {
          const prevCtx = jpLine.slice(Math.max(0, pos - 16), pos);
          if (
            jpLine.startsWith("メイド", end) ||
            jpLine.startsWith("扱い", end) ||
            jpLine.startsWith("を外せ", end) ||
            jpLine.startsWith("じゃ", end) ||
            /誰が[^。！？\n]{0,16}$/.test(prevCtx)
          ) {
            // Reject compound nouns ("チビメイド") and self-defensive protests ("誰がチビだ！？", "チビを外せよ！")
            valid = false;
          }
        }
        if (valid) {
          const prevChar = pos > 0 ? jpLine[pos - 1] : "";
          if (
            needle === "ピンク" &&
            (prevChar === "が" ||
              jpLine.startsWith("色", end) ||
              jpLine.startsWith("の", end) ||
              jpLine.startsWith("であ", end) ||
              jpLine.startsWith("だ", end) ||
              jpLine.startsWith("っぽ", end) ||
              jpLine.startsWith("に", end))
          ) {
            // Avoid matching literal color descriptions ("ピンク色", "衣装がピンクである理由")
            valid = false;
          }
        }
          if (
            valid &&
            !needle.startsWith("副") &&
            /^(?:生徒会長|会長|部長|委員長|隊長|小隊長|局長)$/.test(needle) &&
            pos > 0 &&
            jpLine[pos - 1] === "副"
          ) {
            // Avoid matching bare title inside Vice/Deputy compound titles (e.g., 副生徒会長 -> 生徒会長)
            valid = false;
          }
          if (
            valid &&
            needle === "連邦生徒会長" &&
            jpLine.startsWith("代行", end)
          ) {
            // Avoid matching "連邦生徒会長代行" (Acting GSC President) as GSC President
            valid = false;
          }
          if (valid) {
            occupied.push([pos, end]);
            termMatched = true;
          }
      }
      idx = pos + 1;
    }
    if (termMatched && !matchedSet.has(canonical)) {
      matchedSet.add(canonical);
      matched.push(canonical);
    }
  }

  return matched;
}

const EXCLUDED_POLITE_NOUNS = /(?:일요일|월요일|화요일|수요일|목요일|금요일|토요일|필요|중요|개요|강요|주요|소요|요구)$/;
const FORMAL_END_RE =
  /(?:[가-힣](?:ㅂ|습)니다|(?:ㅂ|습)니까|십시오|(?:시|으시)오|옵니다|올시다|하옵니다|소서)$/;
const POLITE_END_RE =
  /[가-힣]+(?:예요|이에요|네요|군요|죠|지요|어요|아요|해요|돼요|래요|가요|나요|까요|세요|으세요|게요|을게요|거든요|잖아요|는데요|은데요|요)$/;
const CASUAL_END_RE =
  /[가-힣]+(?:이야|야|어|아|해|돼|지|네|군|구나|거든|잖아|는데|은데|냐|니|을까|ㄹ까|자|어라|아라|해라|는다|ㄴ다|겠다|었다|았다|했다|다|줘|봐|마)$/;

export function classifyKrSpeechLevel(krLines: string[]): {
  speechLevel: SpeechLevel;
  counts: { formal: number; polite: number; casual: number };
} {
  let formal = 0;
  let polite = 0;
  let casual = 0;

  for (const line of krLines) {
    const segments = line.split(/[.!?…\n]+/);
    for (const rawSeg of segments) {
      const seg = rawSeg.replace(/[~♡♥♪"'\)\]\s—\-–]+$/g, "").trim();
      if (seg.length < 2 || !/[가-힣]/.test(seg)) continue;

      if (FORMAL_END_RE.test(seg)) {
        formal++;
      } else if (POLITE_END_RE.test(seg) && !EXCLUDED_POLITE_NOUNS.test(seg)) {
        polite++;
      } else if (CASUAL_END_RE.test(seg)) {
        casual++;
      }
    }
  }

  const total = formal + polite + casual;
  if (total < 2) {
    return { speechLevel: "unknown", counts: { formal, polite, casual } };
  }

  const honorific = formal + polite;
  if (honorific / total >= 0.8) {
    const level: SpeechLevel =
      formal / honorific >= 0.45 ? "formal" : "polite";
    return { speechLevel: level, counts: { formal, polite, casual } };
  }
  if (casual / total >= 0.8) {
    return { speechLevel: "casual", counts: { formal, polite, casual } };
  }
  return { speechLevel: "mixed", counts: { formal, polite, casual } };
}

const TERROR_SPECIFIC_JP_RE =
  /もう一人|テラー|クロコ|アヌビス|死の神|覆面ライダー/;
const TERROR_SCENE_CONTEXT_RE =
  /もう一人のシロコ|シロコ[＊*]テラー|テラー|クロコ|アヌビス|死の神|プレナパテス|別のシロコ|違うシロコ|別時間軸の同一存在/;

export function isGenericShirokoTerm(term: string): boolean {
  const bare = stripJpParens(term);
  return bare.includes("シロコ") && !TERROR_SPECIFIC_JP_RE.test(bare);
}

/**
 * Prevents generic "シロコ / シロコ先輩 / シロコちゃん" lines about normal
 * Shiroko from being attributed to Shiroko*Terror unless Terror or her scene
 * context is actually present (and vice versa).
 */
export function matchesShirokoVariantScene(
  line: DialogueLineRecord,
  targetId: string,
  matchedTerm: string,
  gl?: Array<{ speakerId: string; jp: string; kr: string; en?: string }>,
  idx?: number
): boolean {
  if (!isGenericShirokoTerm(matchedTerm)) return true;

  const isCurrentTimelineOnly = /今の時間軸の/.test(line.jp);
  const isOtherTimelineIdentity = /別時間軸の同一存在/.test(line.jp);
  const mentionsShirokoMultipleTimes = (line.jp.match(/シロコ/g) ?? []).length >= 2;

  if (targetId === "shiroko_terror") {
    if (line.sourceType === "momotalk" || line.sourceType === "dialog") {
      return false;
    }
    if (isCurrentTimelineOnly && !mentionsShirokoMultipleTimes) {
      return false;
    }
    if (isOtherTimelineIdentity || mentionsShirokoMultipleTimes) {
      return true;
    }
    if (!gl || idx === undefined) return false;

    const startNear = Math.max(0, idx - 3);
    const endNear = Math.min(gl.length - 1, idx + 3);
    let normalShirokoNear = false;
    let terrorShirokoNear = false;
    for (let k = startNear; k <= endNear; k++) {
      if (gl[k].speakerId === "shiroko") normalShirokoNear = true;
      if (gl[k].speakerId === "shiroko_terror") terrorShirokoNear = true;
    }
    if (normalShirokoNear && !terrorShirokoNear) return false;
    if (normalShirokoNear && terrorShirokoNear) {
      const startTight = Math.max(0, idx - 2);
      const endTight = Math.min(gl.length - 1, idx + 2);
      let normalTight = false;
      let terrorTight = false;
      for (let k = startTight; k <= endTight; k++) {
        if (gl[k].speakerId === "shiroko") normalTight = true;
        if (gl[k].speakerId === "shiroko_terror") terrorTight = true;
      }
      if (
        normalTight &&
        !terrorTight &&
        !TERROR_SCENE_CONTEXT_RE.test(line.jp) &&
        !/この人/.test(line.jp)
      ) {
        return false;
      }
    }

    const startScene = Math.max(0, idx - 12);
    const endScene = Math.min(gl.length - 1, idx + 12);
    for (let k = startScene; k <= endScene; k++) {
      if (gl[k].speakerId === "shiroko_terror") return true;
      if (TERROR_SCENE_CONTEXT_RE.test(gl[k].jp)) return true;
    }
    return false;
  }

  if (targetId === "shiroko") {
    if (isOtherTimelineIdentity && !mentionsShirokoMultipleTimes) {
      return false;
    }
    if (mentionsShirokoMultipleTimes || isCurrentTimelineOnly) {
      return true;
    }
    if (!gl || idx === undefined) return true;
    const startNear = Math.max(0, idx - 3);
    const endNear = Math.min(gl.length - 1, idx + 3);
    let normalNear = false;
    let terrorNear = false;
    for (let k = startNear; k <= endNear; k++) {
      if (gl[k].speakerId === "shiroko") normalNear = true;
      if (gl[k].speakerId === "shiroko_terror") terrorNear = true;
    }
    if (terrorNear && !normalNear) return false;

    if (!normalNear) {
      const startCtx = Math.max(0, idx - 2);
      const endCtx = Math.min(gl.length - 1, idx + 2);
      for (let k = startCtx; k <= endCtx; k++) {
        if (TERROR_SCENE_CONTEXT_RE.test(gl[k].jp)) return false;
      }
    }
  }

  return true;
}

const DECAGRAMMATON_ANOKATA_SPEAKERS = new Set([
  "npc:ohr",
  "npc:ein",
  "npc:sof",
  "npc:malkuth",
]);

export function matchesDecagrammatonAnokata(
  line: DialogueLineRecord,
  targetId: string,
  matchedTerm: string
): boolean {
  if (stripJpParens(matchedTerm) !== "あの方") return true;
  if (!DECAGRAMMATON_ANOKATA_SPEAKERS.has(line.speakerId)) return true;
  const hasMasterEn = Boolean(line.en && /\bmaster\b/i.test(line.en));
  if (targetId === "npc:decagrammaton") {
    return hasMasterEn;
  }
  if (targetId === "npc:malkuth") {
    return !hasMasterEn;
  }
  return true;
}

const REAL_GSC_PRESIDENT_CUE_RE =
  /本物の連邦生徒会長|私の知る連邦生徒会長|前の連邦生徒会長|連邦生徒会長が残した|連邦生徒会長の行方|失踪|消えた|いなくなった|帰ってこない/;
const FALSE_GSC_PRESIDENT_CUE_RE = /詐称|偽物/;

export function matchesGscPresidentScene(
  line: DialogueLineRecord,
  targetId: string,
  matchedTerm: string,
  gl?: Array<{ speakerId: string; jp: string; kr: string; en?: string }>
): boolean {
  if (
    targetId !== "npc:gsc_president" &&
    targetId !== "npc:gsc_president_false"
  ) {
    return true;
  }
  const isFalseCue = FALSE_GSC_PRESIDENT_CUE_RE.test(line.jp);
  if (!matchedTerm.includes("連邦生徒会長")) {
    return targetId === "npc:gsc_president_false" ? true : !isFalseCue;
  }

  const isRealCue = REAL_GSC_PRESIDENT_CUE_RE.test(line.jp);
  const gidStr = line.groupId !== undefined ? String(line.groupId) : "";
  const isAct2FalseArc = gidStr.startsWith("221") || gidStr.startsWith("90102");
  const hasOrigSpeaker = Boolean(
    gl?.some((x) => x.speakerId === "npc:gsc_president")
  );
  const hasFalseSpeaker = Boolean(
    gl?.some((x) => x.speakerId === "npc:gsc_president_false")
  );

  if (targetId === "npc:gsc_president_false") {
    if (isFalseCue) return true;
    if (isRealCue) return false;
    return hasFalseSpeaker || isAct2FalseArc;
  }

  // targetId === "npc:gsc_president"
  if (isFalseCue) return false;
  if (isRealCue) return true;
  if (hasFalseSpeaker && !hasOrigSpeaker) return false;
  if (isAct2FalseArc && !hasOrigSpeaker) return false;
  return true;
}

export interface ExtractionContext {
  speaker: Character;
  target: Character;
  matchedJpTerms: string[];
  extraKrTerms?: string[];
  extraEnTerms?: string[];
  jpLine?: string;
}

export interface AutoEpithetsConfig {
  version: 1;
  global?: Record<string, { kr?: string[]; en?: string[] }>;
  pairs: Record<string, Record<string, { kr?: string[]; en?: string[] }>>;
}

function loadAutoEpithets(): AutoEpithetsConfig {
  const filePath = path.join(DATA_MANUAL_DIR, "auto_epithets.json");
  if (!fs.existsSync(filePath)) {
    return { version: 1, global: {}, pairs: {} };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as AutoEpithetsConfig;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KR_HONORIFICS = [
  "부학생회장님",
  "부학생회장",
  "학생회장님",
  "학생회장",
  "꼬마 선배님",
  "꼬마 선배",
  "총학생회장님",
  "선임행정관님",
  "선임행정관",
  "비서실장님",
  "비서실장",
  "부위원장님",
  "부위원장",
  "부부장님",
  "부부장",
  "부단장님",
  "부단장",
  "부대장님",
  "부대장",
  "부소대장님",
  "부소대장",
  "부국장님",
  "부국장",
  "소대장님",
  "소대장",
  "선도부장님",
  "선도부장",
  "선배님",
  "위원장님",
  "부회장님",
  "부장님",
  "회장님",
  "사장님",
  "실장님",
  "이사님",
  "교수님",
  "문주님",
  "서기장님",
  "대장님",
  "단장님",
  "공주님",
  "여왕님",
  "행정관님",
  "의장님",
  "국장님",
  "교관님",
  "선배",
  "위원장",
  "부회장",
  "부장",
  "회장",
  "사장",
  "서기장",
  "행정관",
  "의장",
  "국장",
  "실장",
  "교관",
  "대장",
  "단장",
  "문주",
  "아가씨",
  "언니",
  "누나",
  "오빠",
  "형님",
  "동지",
  "쨩",
  "짱",
  "님",
  "씨",
  "군",
  "양",
  "형",
].join("|");

const KR_SENSEI_TERMS = [
  "샬레의 선생님",
  "샬레의 선생",
  "초짜 선생님",
  "선생님",
  "선생",
  "지휘관님",
  "교관님",
  "고문님",
  "주인님",
  "프로듀서",
  "달링",
  "어른",
  "마스코트",
  "당신",
  "그쪽",
  "자네",
  "오빠",
  "손님",
  "초짜",
  "초ㅉ",
  "쌩초보",
  "너",
  "형",
];

export type JpTermAmbiguity = "specific" | "generic_title" | "pronoun";

const AMBIGUOUS_PRONOUNS = new Set([
  "あなた",
  "あんた",
  "お前",
  "おまえ",
  "君",
  "キミ",
  "貴様",
  "貴方",
  "てめえ",
  "てめぇ",
  "手前",
  "其方",
  "そなた",
  "そち",
  "御主",
  "お主",
  "おのし",
  "あいつ",
  "あの人",
  "あの子",
  "この子",
  "彼女",
  "彼",
  "そっち",
  "そいつ",
  "こいつ",
  "あの子たち",
  "この子たち",
  "あの人たち",
  "あいつら",
  "アイツら",
  "彼女たち",
  "奴ら",
  "あっちの子",
  "あなた達",
  "あなたたち",
  "あなた方",
  "お前たち",
  "お前ら",
  "あんた達",
  "あんたたち",
  "皆さん",
  "皆様",
  "みなさん",
  "みなさま",
  "みんな",
]);

const THIRD_PERSON_PRONOUNS = new Set([
  "あいつ",
  "あの人",
  "あの子",
  "この子",
  "彼女",
  "彼",
  "そいつ",
  "こいつ",
  "あの子たち",
  "この子たち",
  "あの人たち",
  "あいつら",
  "アイツら",
  "彼女たち",
  "奴ら",
  "あっちの子",
]);

const GENERIC_TITLES = new Set([
  "先輩",
  "後輩",
  "会長",
  "副会長",
  "委員長",
  "副委員長",
  "部長",
  "副部長",
  "副長",
  "社長",
  "店長",
  "隊長",
  "団長",
  "長官",
  "室長",
  "所長",
  "書記長",
  "監督",
  "ボス",
  "リーダー",
  "マスター",
  "お嬢さん",
  "お嬢様",
  "お姉ちゃん",
  "お姉さん",
  "姉さん",
  "お兄さん",
  "お兄ちゃん",
  "姫",
  "先生",
  "お師匠様",
  "師匠",
  "博士",
  "教授",
  "同志",
  "女将",
  "チビ",
  "裏切り者",
]);

export function classifyJpTermAmbiguity(
  term: string,
  target: Character
): JpTermAmbiguity {
  if (
    target.id === "special:self" ||
    target.id === "special:sensei" ||
    target.id === "special:you"
  ) {
    return "specific";
  }

  for (const needle of expandJpTermNeedles(term)) {
    if (AMBIGUOUS_PRONOUNS.has(needle)) {
      return "pronoun";
    }
  }

  if (target.kind === "entity") {
    return "specific";
  }

  const targetJp = target.name.jp.trim();
  const includesTargetName =
    targetJp.length >= 2 &&
    (term.includes(targetJp) ||
      target.aliases.jp.some((a) => a.length >= 2 && term.includes(a)));

  if (!includesTargetName && GENERIC_TITLES.has(term.trim())) {
    return "generic_title";
  }

  return "specific";
}

export function stripJpParens(term: string): string {
  return term.replace(/[（(][^）)]*[)）]/g, "").trim();
}

const KR_FIRST_PERSON_RE =
  /(?:^|[\s,"'(])(?:저는|제가|나는|내가|저도|나도|저를|나를|저의|나의|제\s|내\s|소녀|저희|우리)/;
const KR_SECOND_PERSON_RE =
  /(?:^|[\s,"'(])(?:당신들?|네놈|네\s*녀석|너희|너는|너를|너의|너도|네가|니가|그쪽|자네|너(?=[\s,.!?…~]|$))/;
const EN_SECOND_PERSON_RE =
  /\b(?:you|your|yours|yourself|you're|you've|you'll|you'd)\b/i;

export function matchesHomographPronounDirection(
  line: { jp: string; kr: string; en?: string },
  targetId: string,
  matchedTerm: string,
  isHomograph: boolean
): boolean {
  if (!isHomograph) return true;
  if (/^手前(?:さん|様)/.test(matchedTerm)) {
    return targetId !== "special:self";
  }

  const hasKrFirst = KR_FIRST_PERSON_RE.test(line.kr);
  const hasKrSecond = KR_SECOND_PERSON_RE.test(line.kr);
  const isPluralTemee = line.jp.includes("手前ら");

  if (targetId === "special:self") {
    if (isPluralTemee) return false;
    if (hasKrSecond && !hasKrFirst) return false;
    return true;
  }

  return (
    hasKrSecond ||
    isPluralTemee ||
    (!hasKrFirst && Boolean(line.en && EN_SECOND_PERSON_RE.test(line.en)))
  );
}

const JP_TO_KR_TITLES: Array<[RegExp, string[]]> = [
  [/連邦生徒会長/, ["총학생회장님", "총학생회장", "회장님"]],
  [/評議会長/, ["평의회장님", "평의회장"]],
  [/副生徒会長/, ["부학생회장님", "부학생회장"]],
  [/生徒会長/, ["총학생회장님", "학생회장님", "학생회장"]],
  [/ゲヘナの風紀委員長|風紀委員長/, ["선도부장님", "선도부장", "위원장님", "위원장"]],
  [/防衛室長/, ["방위실장님", "방위실장", "실장님", "실장"]],
  [/財務室長/, ["재무실장님", "재무실장", "실장님", "실장"]],
  [/副局長/, ["부국장님", "부국장"]],
  [/公安局長/, ["공안국장님", "공안국장", "국장님"]],
  [/行政官/, ["선임행정관님", "선임행정관", "행정관님", "행정관"]],
  [/万魔殿の議長|議長/, ["의장님", "의장"]],
  [/先輩/, ["선배님", "선배"]],
  [/正義実現(?:委員会の)?委員長/, ["정의실현부장", "정의실현부 부장", "정의실현부의 부장", "정의부 부장"]],
  [/副委員長/, ["부위원장님", "부위원장", "부부장님", "부부장"]],
  [/委員長/, ["위원장님", "위원장", "부장님", "부장"]],
  [/副会長/, ["부회장님", "부회장"]],
  [/会長/, ["학생회장님", "학생회장", "회장님", "회장"]],
  [/社長/, ["사장님", "사장"]],
  [/門主様?/, ["문주님", "문주"]],
  [/お嬢様|お嬢さん/, ["아가씨"]],
  [/姫/, ["공주님", "공주"]],
  [/お姉|姉/, ["언니", "누나"]],
  [/副小隊長/, ["부소대장님", "부소대장"]],
  [/小隊長/, ["소대장님", "소대장"]],
  [/副隊長/, ["부대장님", "부대장", "부단장님", "부단장"]],
  [/隊長/, ["대장님", "대장"]],
  [/書記長/, ["서기장님", "서기장"]],
  [/同志/, ["동지"]],
  [/ボス/, ["보스"]],
  [/マスター|主/, ["마스터", "주인님"]],
  [/教授/, ["교수님", "교수"]],
  [/教官/, ["교관님", "교관"]],
  [/秘書室長/, ["비서실장님", "비서실장"]],
  [/室長/, ["실장님", "실장"]],
  [/監督官/, ["감리감독관", "감독관님", "감독관"]],
  [/監督/, ["감독님", "감독"]],
  [/副部長/, ["부부장님", "부부장"]],
  [/副長/, ["부장님", "부단장님", "부단장", "부장"]],
  [/部長/, ["부장님", "부장"]],
  [/団長/, ["단장님", "단장"]],
  [/長官/, ["장관님", "장관"]],
  [/リーダー/, ["리더님", "리더"]],
  [/幹部/, ["간부님들", "간부님", "간부들", "간부"]],
  [/お二人/, ["두 분", "두 사람"]],
  [/ビッグシスター/, ["빅 시스터"]],
  [/(?<!ビッグ)シスター/, ["수녀님", "시스터"]],
  [/勇者/, ["용사"]],
  [/裏切り者/, ["배신자", "스파이"]],
  [/氷の魔女/, ["얼음마녀"]],
  [/変態/, ["변태"]],
  [/腹黒/, ["시커멓게 속을 숨기던 여자"]],
  [/あのバカ/, ["그 멍청한 여자"]],
  [/おバカなサキ/, ["바보 사키"]],
  [/おバカさん/, ["얼간이"]],
  [/無能/, ["무능"]],
  [/「天才」/, ["천재"]],
  [/最後の天使/, ["마지막 천사"]],
  [/天才戦略家/, ["천재 전략가"]],
  [/百鬼夜行最強の読心術師/, ["백귀야행 학원 최강의 독심술사", "최강의 독심술사"]],
  [/浄化槽の濁った水/, ["정화조 같은 사람", "정화조"]],
  [/美少女|ハッカー|美人部長/, ["초천재병약미소녀해커", "초천재병약미소녀", "천재병약미소녀해커", "천재병약미소녀", "청순한 미소녀 해커", "병약 미소녀", "병약미소녀", "미소녀 해커", "미소녀해커", "초천재미소녀", "천재미소녀", "초천재해커", "천재 해커", "미인 부장"]],
  [/女将/, ["여주인님", "여주인", "안주인", "주인장"]],
  [/マダム/, ["마담"]],
  [/ジェネラル/, ["제너럴"]],
  [/チビメイド/, ["꼬마 메이드님", "꼬마 메이드"]],
  [/メイド/, ["꼬마 메이드님", "메이드님", "메이드"]],
  [/チビ/, ["꼬마 선배님", "꼬마 메이드님", "꼬맹이", "꼬마"]],
  [/タヌキ/, ["너구리"]],
  [/シーフ王/, ["왕도적"]],
  [/シーフ/, ["왕도적", "도적님", "도적"]],
  [/慈愛の怪盗/, ["자애의 괴도", "괴도"]],
  [/ファウスト/, ["파우스트 님", "파우스트"]],
  [/パンちゃん/, ["판쨩", "판 쨩", "팬 쨩", "팬쨩"]],
  [/サッちゃん/, ["삿 쨩", "삿쨩"]],
  [/温泉開発部/, ["온천개발부"]],
  [/自警団/, ["자경단"]],
  [/出版部/, ["출판부"]],
  [/事務局/, ["사무국"]],
  [/寮監隊/, ["사감대", "선도부", "규율부", "기숙사 감찰팀"]],
  [/オカルト研究会/, ["오컬트 연구회"]],
  [/特殊交易部/, ["특수교역부"]],
  [/救急医学部/, ["응급의학부"]],
  [/便利屋68/, ["흥신소 68", "흥신소"]],
  [/ヘルメット団/, ["헬멧단"]],
  [/レッドウィンター/, ["붉은겨울 연방학원", "붉은겨울"]],
  [/ブルー先輩/, ["블루 선배"]],
  [/^ピンク$/, ["핑크"]],
  [/先生/, ["선생님", "선생"]],
  [/(?:アル)?バイト/, ["알바 양", "알바생", "알바"]],
  [/ワニ/, ["메카 악어", "악어"]],
  [/^(?:私たち|我々)$/, ["우리들", "저희", "우리"]],
  [/^(?:みんな|皆さん)$/, ["여러분", "모두"]],
  [/^(?:あなた達|あなたたち|あなた方|お前たち|お前ら|あんたたち|あんたら)$/, ["당신들", "너희들", "너희"]],
  [/^(?:あの子|この子)$/, ["그 아이", "이 아이", "그 애", "이 애"]],
  [/^(?:あの方|あの人)$/, ["그분", "저분", "그 사람"]],
  [/^あいつら$/, ["그 녀석들", "저 녀석들"]],
  [/^(?:あいつ|あの女)$/, ["그 녀석", "저 녀석", "그 여자"]],
  [/^貴女$/, ["당신", "그대"]],
  [/^手前(?:さん|様)?(?:\([^)]*\))?$/, ["당신들", "당신", "네놈", "네 녀석", "자네", "그쪽", "너"]],
  [
    /^(?:あなた|あんた|お前|おまえ|君|キミ|貴様|貴方|其方|そなた|御主|お主|おのし|そち)$/,
    ["당신", "자네", "그쪽", "그대", "너"],
  ],
];

function uniqueOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const clean = item.replace(/\s+/g, " ").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

const KR_PARTICLE_LOOKAHEAD =
  "(?=(?:은|는|이|가|을|를|의|에게는|에게|에겐|께서는|께서|께|한테는|한테|에서도|에서|에도|에|도|만|까지는|까지|부터는|부터|이랑도|이랑|랑도|랑|와도|와|과도|과|으로도|으로|로도|로|야|아|여|시여|이라고|라고|이라는|라는|이라니|라니|처럼|보다|마다|조차|마저|밖에|뿐|입니다|입니까|이시군요|이셨던|이셨|이시네요|이시죠|이세요|이잖아요|이잖아|이라면|이에요|예요|이군요|이네요|이구나|이지요|이지|이죠|인가요|인가|인데요|인데|이야|이었|였|이시다|이시|이다|인|잖아|잖아요|니까요|니까|라면)?(?![가-힣]))";

function normalizeKrStutters(text: string): string {
  return text.replace(
    /(?<![가-힣])([가-힣])(?:,|…+|\.\.\.|~)+\s*(?=\1[가-힣])/g,
    ""
  );
}

export function extractKrAppellations(
  rawKrLine: string,
  ctx: ExtractionContext
): string[] {
  if (!rawKrLine) return [];
  const krLine = normalizeKrStutters(rawKrLine);
  const { speaker, target, matchedJpTerms } = ctx;

  if (target.id === "special:self") {
    const found: string[] = [];
    const specialSelfTerms = [
      "이 아저씨",
      "아저씨",
      "이 몸",
      "본기",
      "본인",
      "소녀",
      "소인",
      "이 언니",
      ...(speaker.id === "himari"
        ? [
            "초천재병약만능전투미소녀해커",
            "초천재병약만능미소녀해커",
            "초천재병약청초계쿨뷰티미소녀",
            "초천재병약청초계미소녀",
            "초천재병약미소녀해커이자 라이프 스태프",
            "초천재병약미소녀 라이프 스태프",
            "초천재청초계병약 미소녀",
            "초천재 청초계 병약 미소녀",
            "초천재 청초계 병약미소녀",
            "초천재병약미소녀해커",
            "초천재병약미소녀",
            "초절정미소녀해커",
            "천재병약미소녀해커",
            "천재병약미소녀",
            "청초계 병약 미소녀 해커",
            "청초병약계열의 천재 해커",
            "청초병약계열의 미소녀",
            "청순한 미소녀 해커",
            "만능전투미소녀",
            "병약 미소녀",
            "병약미소녀",
            "완벽한 미소녀",
            "비운의 미소녀",
            "은둔형 미소녀",
            "희대의 미소녀",
            "미소녀 해커",
            "미소녀해커",
            "초천재미소녀",
            "천재미소녀",
            "초천재해커",
            "천재 해커",
            "미인 부장",
            "전뇌요정",
            "과학소녀",
            "천재 소녀",
            "한 떨기의 청초한 꽃",
            "한 떨기 꽃",
            "1급 미네랄 워터",
            "전지",
          ]
        : speaker.id === "toki"
          ? [
              "퍼펙트 큐트 미소녀 메이드",
              "큐트 창백 계열 퍼펙트 미소녀",
              "완벽한 메이드이자 최고의 요원",
              "완벽한 최고의 메이드이자 요원",
              "완벽한 메이드이자 에이전트",
              "하이퍼 퍼펙트 메이드",
              "키보토스 최강의 메이드",
              "메이드 중의 메이드",
              "퍼펙트 메이드",
              "완벽한 메이드",
              "우수한 메이드",
              "최고의 메이드",
              "최강의 메이드",
              "완벽한 특수요원",
              "최고의 에이전트",
              "최고의 요원",
              "완벽한 에이전트",
              "우수한 저",
            ]
          : speaker.id === "reisa"
            ? [
                "자경단의 슈퍼스타",
                "모두의 슈퍼스타",
                "슈퍼스타",
              ]
            : []),
    ];
    let krSelfLine = krLine;
    if (
      speaker.name.kr &&
      /[가-힣]{2,}/.test(speaker.name.kr) &&
      !speaker.name.kr.includes(" ")
    ) {
      const escName = escapeRegExp(speaker.name.kr);
      krSelfLine = krSelfLine
        .replace(
          new RegExp(
            `(?:저는|제가|나는|내가|내 이름은|제 이름은)\\s*${escName}(?:이?라고|입니다|예요|이에요|야|이야)`,
            "g"
          ),
          " "
        )
        .replace(
          new RegExp(`${escName}(?:이?라고 합니다|이?라고 한답니다|입니다)`, "g"),
          " "
        );
      specialSelfTerms.unshift(
        ...(speaker.fullName?.kr
          ? [
              `${speaker.fullName.kr} 님`,
              `${speaker.fullName.kr}님`,
              speaker.fullName.kr,
            ]
          : []),
        `${speaker.name.kr} 님`,
        `${speaker.name.kr}님`,
        speaker.name.kr
      );
    }
    for (const term of specialSelfTerms) {
      if (term === "아저씨" && found.includes("이 아저씨")) continue;
      if (term === "언니" && found.includes("이 언니")) continue;
      if (
        term === speaker.name.kr &&
        (found.includes(`${speaker.name.kr} 님`) ||
          found.includes(`${speaker.name.kr}님`) ||
          (speaker.fullName?.kr &&
            (found.includes(speaker.fullName.kr) ||
              found.includes(`${speaker.fullName.kr} 님`) ||
              found.includes(`${speaker.fullName.kr}님`))))
      ) {
        continue;
      }
      const re = new RegExp(
        `(?<![가-힣])${escapeRegExp(term)}${KR_PARTICLE_LOOKAHEAD}`
      );
      if (re.test(krSelfLine)) {
        found.push(term);
      }
    }
    if (/(?:^|[\s,"'(])(?:저는|제가|저도|저를|저에게|저한테|저의)/.test(krLine)) {
      found.push("저");
    } else if (/(?:^|[\s,"'(])제(?=\s)/.test(krLine)) {
      found.push("저");
    }
    if (/(?:^|[\s,"'(])(?:나는|내가|나도|나를|나에게|나한테|나의)/.test(krLine)) {
      found.push("나");
    } else if (/(?:^|[\s,"'(])내(?=\s)/.test(krLine)) {
      found.push("나");
    }
    if (/(?:^|[\s,"'(])저희(?:가|는|도|를|의)?(?=[\s,.!?…]|$)/.test(krLine)) {
      found.push("저희");
    }
    if (/(?:^|[\s,"'(])우리(?:가|는|도|를|의)?(?=[\s,.!?…]|$)/.test(krLine)) {
      found.push("우리");
    }
    for (const extra of ctx.extraKrTerms ?? []) {
      const cleanExtra = extra.trim();
      if (!cleanExtra) continue;
      const re = new RegExp(
        `(?<![가-힣])${escapeRegExp(cleanExtra)}${KR_PARTICLE_LOOKAHEAD}`
      );
      if (re.test(krLine)) found.push(cleanExtra);
    }
    for (const jt of matchedJpTerms) {
      if (/^[A-Za-z][A-Za-z0-9& -]{1,}$/.test(jt)) {
        const m = krLine.match(
          new RegExp(`\\b${escapeRegExp(jt).replace(/(\d+)/, "\\s*$1")}\\b`, "i")
        );
        if (m) found.push(m[0].replace(/\s+/g, " ").trim());
      } else if (jt.includes("キャンプRABBIT") && /캠프\s*RABBIT/i.test(krLine)) {
        found.push("캠프 RABBIT");
      } else if (
        (jt.includes("コールサイン04") || jt.includes("コールサインゼロフォー")) &&
        (/콜사인\s*04/.test(krLine) || /콜사인\s*제로포/.test(krLine))
      ) {
        if (/콜사인\s*04/.test(krLine)) found.push("콜사인 04");
        if (/콜사인\s*제로포/.test(krLine)) found.push("콜사인 제로포");
      } else if (jt.includes("ダブルオー")) {
        if (/코드명\s*더블오/.test(krLine)) found.push("코드명 더블오");
        else if (/콜사인\s*더블오/.test(krLine)) found.push("콜사인 더블오");
      } else if (jt.includes("コールサイン・ゼロワン") && /콜사인\s*제로원/.test(krLine)) {
        found.push("콜사인 제로원");
      } else if (jt.includes("コールサインゼロツー") && /콜사인\s*제로투/.test(krLine)) {
        found.push("콜사인 제로투");
      } else if (
        (jt.includes("コールサイン・ゼロスリー") || jt.includes("コールサインゼロスリー")) &&
        /콜사인\s*제로쓰리/.test(krLine)
      ) {
        found.push("콜사인 제로쓰리");
      }
    }
    return uniqueOrdered(found);
  }

  if (target.id === "special:sensei") {
    const found: string[] = [];
    let remaining = krLine;

    if (/샬레의\s*\[USERNAME\]\s*선생님/.test(remaining)) {
      found.push("[USERNAME] 선생님");
      remaining = remaining.replace(/샬레의\s*\[USERNAME\]\s*선생님/g, " ");
    } else if (/\[USERNAME\]\s*선생님/.test(remaining)) {
      found.push("[USERNAME] 선생님");
      remaining = remaining.replace(/\[USERNAME\]\s*선생님/g, " ");
    }

    if (/샬레의\s*\[USERNAME\]\s*선생(?![가-힣])/.test(remaining)) {
      found.push("[USERNAME] 선생");
      remaining = remaining.replace(/샬레의\s*\[USERNAME\]\s*선생(?![가-힣])/g, " ");
    } else if (/\[USERNAME\]\s*선생(?![가-힣])/.test(remaining)) {
      found.push("[USERNAME] 선생");
      remaining = remaining.replace(/\[USERNAME\]\s*선생(?![가-힣])/g, " ");
    }

    if (/\[USERNAME\]/.test(remaining)) {
      found.push("[USERNAME]");
    }

    const cleaned = remaining.replace(/\[USERNAME\]\s*/g, "");
    for (const term of KR_SENSEI_TERMS) {
      const lookahead =
        term === "초짜" || term === "쌩초보"
          ? "(?=(?:으니까|니까|지|네|네요|다|야|예요|에요|군요|구나|잖아|잖아요|거든|거든요|이라고|라고|이란|란|은|는|이|가|을|를|의|에|에게|에겐|께|께서|한테|도|만|까지|부터|랑|이랑|와|과|처럼|보다)?(?![가-힣]))"
          : KR_PARTICLE_LOOKAHEAD;
      const re = new RegExp(`(?<![가-힣])${escapeRegExp(term)}${lookahead}`);
      if (re.test(cleaned)) {
        // Avoid double-matching 선생 when 선생님 already matched
        if (
          term === "선생" &&
          found.some((f) => f === "선생님" || f === "샬레의 선생님" || f === "초짜 선생님")
        ) {
          continue;
        }
        if (
          term === "선생님" &&
          (found.includes("샬레의 선생님") || found.includes("초짜 선생님"))
        ) {
          continue;
        }
        if (term === "초짜" && found.includes("초짜 선생님")) {
          continue;
        }
        if (term === "손님" && !matchedJpTerms.some((t) => /お客様|お客さん/.test(t))) {
          continue;
        }
        if (term === "마스코트" && !matchedJpTerms.some((t) => /マスコット/.test(t))) {
          continue;
        }
        if (
          (term === "초짜 선생님" || term === "초짜" || term === "초ㅉ" || term === "쌩초보") &&
          !matchedJpTerms.some((t) => /素人|しろうと/.test(t))
        ) {
          continue;
        }
        found.push(term);
      }
    }
    return uniqueOrdered(found);
  }

  if (target.id === "special:you") {
    const youTerms = [
      "당신들",
      "당신",
      "네놈",
      "네 녀석",
      "그쪽",
      "자네",
      "너희",
      "너",
      "그대",
      "귀하",
    ];
    const found: string[] = [];
    for (const term of youTerms) {
      const re = new RegExp(`(?<![가-힣])${escapeRegExp(term)}(?![가-힣])`);
      if (re.test(krLine)) found.push(term);
    }
    return uniqueOrdered(found);
  }

  // Named character / NPC / entity
  const stemCandidates: string[] = [
    target.name.kr,
    target.fullName?.kr ?? "",
    ...target.aliases.kr,
  ];

  // Add space-split parts (e.g. family / given name)
  for (const s of [...stemCandidates]) {
    for (const part of s.split(/\s+/)) {
      if (/[가-힣]{2,}/.test(part)) stemCandidates.push(part);
    }
  }

  // Add 2-char nickname prefix when JP term uses that shortened prefix (e.g., 나기사 -> 나기 for ナギちゃん)
  const baseKr = target.name.kr.replace(/\s+/g, "");
  const isShortenedJp =
    target.name.jp.length >= 3 &&
    matchedJpTerms.some((t) => {
      const bare = stripJpParens(t);
      return !bare.includes(target.name.jp) && bare.includes(target.name.jp.slice(0, 2));
    });
  const shortenedKrPrefixStems = new Set<string>();
  if (/^[가-힣]{3,}$/.test(baseKr) && isShortenedJp) {
    const shortKr = baseKr.slice(0, 2);
    stemCandidates.push(shortKr);
    shortenedKrPrefixStems.add(shortKr);
  }

  const stems = uniqueOrdered(stemCandidates)
    .filter((s) => s.length >= 2 || (s.length === 1 && target.name.kr === s))
    .sort((a, b) => b.length - a.length);

  const krSurnameOnlyStems = new Set<string>();
  if (target.kind !== "entity" && target.fullName?.kr) {
    const primaryKr = target.name.kr.trim();
    for (const part of target.fullName.kr.split(/\s+/)) {
      const cleanPart = part.trim();
      if (cleanPart.length >= 2 && cleanPart !== primaryKr) {
        krSurnameOnlyStems.add(cleanPart);
      }
    }
  }

  const found: string[] = [];
  for (const extra of ctx.extraKrTerms ?? []) {
    const cleanExtra = extra.trim();
    if (!cleanExtra) continue;
    const re = new RegExp(
      `(?<![가-힣])${escapeRegExp(cleanExtra)}${KR_PARTICLE_LOOKAHEAD}`
    );
    if (re.test(krLine)) {
      const coveredByFuller = found.some(
        (f) => f !== cleanExtra && f.includes(cleanExtra)
      );
      if (!coveredByFuller) {
        found.push(cleanExtra);
      }
    }
  }

  for (const jt of matchedJpTerms) {
    if (/^[A-Za-z][A-Za-z0-9& -]{1,}$/.test(jt)) {
      const m = krLine.match(
        new RegExp(`\\b${escapeRegExp(jt).replace(/(\d+)/, "\\s*$1")}\\b`, "i")
      );
      if (m) found.push(m[0].replace(/\s+/g, " ").trim());
    }
  }

  const hasAnotherVariantPrefix =
    target.id === "shiroko_terror" ||
    matchedJpTerms.some((t) => /もう一人|別の|違う/.test(t));
  const krPrefixTitles = hasAnotherVariantPrefix
    ? "또 다른|시스터|꼬마|미스|마담|교수|박사|대장|리더|캡틴"
    : "시스터|꼬마|미스|마담|교수|박사|대장|리더|캡틴";

  for (const stem of stems) {
    const eventGuard = krSurnameOnlyStems.has(stem)
      ? "(?!\\s*(?:축제|학원|학교|동아리|위원회|상점|가게|카페|신사|거리|광장|역|관))"
      : "";
    const interruptedGuard = shortenedKrPrefixStems.has(stem)
      ? "(?!\\s*(?:\\.\\.\\.|…|—|―|--))"
      : "";
    const stemPattern =
      target.kind !== "entity"
        ? escapeRegExp(stem).replace(/ +/g, "(?:\\s*,\\s*|\\s+)")
        : escapeRegExp(stem);
    const actingGuard = target.id.startsWith("npc:gsc_president") ? "(?!\\s*대행)" : "";
    const re = new RegExp(
      `(?<![가-힣])(?:(?:${krPrefixTitles})\\s+)?${stemPattern}${eventGuard}${interruptedGuard}(?:\\s*(?:${KR_HONORIFICS}))?${actingGuard}`,
      "g"
    );
    const matches = krLine.match(re);
    if (matches) {
      for (const m of matches) {
        const cleanMatch = m.replace(/\s*,\s+/g, " ").replace(/\s+/g, " ").trim();
        const coveredByFuller = found.some(
          (f) => f !== cleanMatch && f.includes(cleanMatch)
        );
        if (!coveredByFuller) {
          found.push(cleanMatch);
        }
      }
    }
  }

  const hasExplicitTitleInJp = matchedJpTerms.some((t) =>
    /(?:副?生徒会長|副?会長|副?委員長|副?部長|副?局長|副?小?隊長|副長|社長|室長|議長|行政官|書記長|教授|教官|勇者|裏切り者|氷の魔女|変態|腹黒|あのバカ|おバカなサキ|おバカさん|無能|「天才」|最後の天使|天才戦略家|百鬼夜行最強の読心術師|浄化槽の濁った水)/.test(
      t
    )
  );
  const stemSet = new Set(stems.map((s) => s.trim()));
  const onlyBareStemFound =
    !target.id.startsWith("npc:gsc_president") &&
    found.length > 0 &&
    found.every((f) => stemSet.has(f.trim()));

  if (found.length === 0 || (hasExplicitTitleInJp && onlyBareStemFound)) {
    // Fallback: standalone title equivalents when JP term uses a title
    const titleCandidates: string[] = [];
    for (const [jpRe, krTitles] of JP_TO_KR_TITLES) {
      if (matchedJpTerms.some((t) => jpRe.test(t))) {
        titleCandidates.push(...krTitles);
      }
    }
    for (const title of uniqueOrdered(titleCandidates)) {
      const re = new RegExp(
        `(?<![가-힣])${escapeRegExp(title)}${KR_PARTICLE_LOOKAHEAD}`
      );
      if (re.test(krLine)) {
        if (onlyBareStemFound) {
          found.splice(0, found.length, title);
        } else {
          found.push(title);
        }
        break;
      }
    }
  }
  if (
    matchedJpTerms.some((t) => /浄化槽の濁った水/.test(t)) &&
    /정화조 같은 사람/.test(krLine) &&
    !found.includes("정화조 같은 사람")
  ) {
    found.push("정화조 같은 사람");
  }

  return uniqueOrdered(found);
}

const EN_PREFIX_TITLES = [
  "Head Prefect",
  "Vice President",
  "Vice Chairwoman",
  "Vice Chairman",
  "Vice Chair",
  "Vice Captain",
  "Vice Squad Leader",
  "Deputy Director",
  "Deputy Squad Leader",
  "Deputy Captain",
  "Club President",
  "Squad Leader",
  "Comrade Chairman",
  "Student Council President",
  "Assembly President",
  "Chief Administrator",
  "Chief of Defense",
  "Chief of Finance",
  "Defense Director",
  "Director of Defense",
  "Director of Finance",
  "Bureau Director",
  "Little upperclassman",
  "Little",
  "Tiny",
  "Great",
  "Young Lady",
  "My Lady",
  "Big Sis",
  "Acting President",
  "Chairwoman",
  "President",
  "Chairman",
  "Chair",
  "Administrator",
  "Director",
  "Captain",
  "Chief",
  "Boss",
  "Madame",
  "Madam",
  "Lady",
  "Miss",
  "Ms\\.",
  "Mr\\.",
  "Master",
  "Lord",
  "Princess",
  "Queen",
  "Sister",
  "Head Instructor",
  "Chief Instructor",
  "Instructor",
  "Professor",
  "Doctor",
  "Dr\\.",
  "Comrade",
  "Secretary",
  "General",
  "Commander",
  "Officer",
  "Agent",
  "Senior",
  "Senpai",
].join("|");

const EN_SENSEI_TERMS: Array<[string, RegExp]> = [
  ["Schale's Sensei", /\bSchale['’]s\s+Sensei\b/i],
  ["Sensei of Schale", /\bSensei\s+of\s+Schale\b/i],
  ["Sensei from Schale", /\bSensei\s+from\s+Schale\b/i],
  ["Noob Sensei", /\bNoob\s+Sensei\b/i],
  ["Sensei", /\bSensei\b/i],
  ["Seeensei", /\bSe{2,}nsei\b|\bSense{2,}i\b/i],
  ["Teacher", /\bTeacher\b/i],
  ["Master", /\bMaster\b/i],
  ["Boss", /\bBoss\b/i],
  [
    "Teach",
    /\b(?:Teach|TEACH)\b(?!\s+(?:me|you|us|him|her|them|it|a|an|the|how|about|for|high|some|this|that|everything|anything|nothing|someone|anyone|everyone|my|your|our|their|his|her)\b)/,
  ],
  ["Instructor", /\bInstructor\b/i],
  ["Advisor", /\bAdvisor\b/i],
  ["Commander", /\bCommander\b/i],
  ["Darling", /\bDarling\b/i],
  ["Honey", /\bHoney\b/i],
  ["My Lord", /\bMy Lord\b/i],
  ["Sir", /\bSir\b/i],
  ["Grown-up", /\bGrown-up\b/i],
  ["Adult", /\bAdult\b/i],
  ["dear customer", /\bdear\s+["'“]?\bcustomer\b/i],
  ["customer", /\bcustomer\b/i],
  ["Noob", /\bNoob\b/i],
  ["newbie", /\bnewbie\b/i],
];

const JP_TO_EN_TITLES: Array<[RegExp, Array<[string, RegExp]>]> = [
  [
    /連邦生徒会長/,
    [
      [
        "General Student Council President",
        /(?<!\bacting[\s-]+)\bGeneral Student Council President\b/i,
      ],
      ["GSC President", /(?<!\bacting[\s-]+)\bGSC President\b/i],
      [
        "Student Council President",
        /(?<!\bacting[\s-]+|\bvice[\s-]+|\bdeputy[\s-]+)\bStudent Council President\b/i,
      ],
      [
        "President",
        /(?<!\bacting[\s-]+|\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i,
      ],
    ],
  ],
  [
    /評議会長/,
    [
      ["Assembly President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bAssembly President\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [
    /副生徒会長/,
    [
      ["Student Council Vice President", /\bStudent Council Vice President\b/i],
      ["Vice President", /\bVice President\b/i],
    ],
  ],
  [
    /生徒会長/,
    [
      ["Student Council President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bStudent Council President\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [
    /ゲヘナの風紀委員長|風紀委員長/,
    [
      ["Head Prefect", /\bHead Prefect\b/i],
      ["Prefect Chair", /\bPrefect Chair\b/i],
    ],
  ],
  [
    /防衛室長/,
    [
      ["Chief of Defense", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChief of Defense\b/i],
      ["Director of Defense", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDirector of Defense\b/i],
      ["Defense Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDefense Director\b/i],
      ["Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDirector\b/i],
    ],
  ],
  [
    /財務室長/,
    [
      ["Chief of Finance", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChief of Finance\b/i],
      ["Director of Finance", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDirector of Finance\b/i],
      ["Finance Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bFinance Director\b/i],
      ["Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDirector\b/i],
    ],
  ],
  [
    /副局長/,
    [
      ["Deputy Director", /\bDeputy Director\b/i],
      ["Vice Director", /\bVice Director\b/i],
    ],
  ],
  [
    /公安局長/,
    [
      ["Bureau Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bBureau Director\b/i],
      ["Director", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bDirector\b/i],
    ],
  ],
  [
    /行政官/,
    [
      ["Chief Administrator", /\bChief Administrator\b/i],
      ["Administrator", /\bAdministrator\b/i],
    ],
  ],
  [
    /万魔殿の議長|議長/,
    [
      ["Chairwoman", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChairwoman\b/i],
      ["Chairman", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChairman\b/i],
      ["Chair", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChair\b/i],
    ],
  ],
  [/先輩/, [["Senpai", /\bSenpai\b/i], ["Senior", /\bSenior\b/i]]],
  [
    /正義実現(?:委員会の)?委員長/,
    [
      ["president of the Justice Task Force", /\bpresident of the Justice Task Force\b/i],
      ["Justice Task Force president", /\bJustice Task Force president\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [
    /副委員長/,
    [
      ["Vice President", /\bVice President\b/i],
      ["Vice Chairwoman", /\bVice Chairwoman\b/i],
      ["Vice Chairman", /\bVice Chairman\b/i],
      ["Vice Chair", /\bVice Chair\b/i],
    ],
  ],
  [
    /委員長/,
    [
      ["Chairwoman", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChairwoman\b/i],
      ["Chairman", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChairman\b/i],
      ["Chair", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bChair\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [/副会長/, [["Vice President", /\bVice President\b/i]]],
  [/副部長/, [["Vice President", /\bVice President\b/i], ["Vice Club President", /\bVice Club President\b/i]]],
  [
    /部長/,
    [
      ["Club President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bClub President\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [
    /会長/,
    [
      ["Student Council President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bStudent Council President\b/i],
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
    ],
  ],
  [
    /社長/,
    [
      ["President", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPresident\b/i],
      ["Boss", /\bBoss\b/i],
      ["CEO", /\bCEO\b/],
    ],
  ],
  [
    /お嬢様|お嬢さん/,
    [
      ["Young Lady", /\bYoung Lady\b/i],
      ["My Lady", /\bMy Lady\b/i],
      ["Milady", /\bMilady\b/i],
      ["Miss", /\bMiss\b/i],
    ],
  ],
  [
    /お嬢ちゃん/,
    [
      ["Tea Party girl", /\bTea Party girl\b/i],
      ["little lady", /\blittle lady\b/i],
      ["young lady", /\byoung lady\b/i],
    ],
  ],
  [
    /おてんば娘/,
    [
      ["petulant princess", /\bpetulant princess\b/i],
      ["little princess", /\blittle princess\b/i],
      ["troublemaker", /\btroublemaker\b/i],
      ["princess", /\bprincess\b/i],
    ],
  ],
  [
    /門主様?/,
    [
      ["Madam", /\bMadam\b/i],
      ["Madame", /\bMadame\b/i],
      ["Lady", /\bLady\b/i],
      ["Head", /\bHead\b(?!\s+Prefect\b)/i],
      ["Master", /\bMaster\b/i],
    ],
  ],
  [/姫/, [["Princess", /\bPrincess\b/i]]],
  [
    /お姉|姉/,
    [
      ["Big Sis", /\bBig Sis\b/i],
      ["Sister", /\bSister\b/i],
      ["Sis", /\bSis\b/i],
    ],
  ],
  [
    /副小隊長/,
    [
      ["Deputy Squad Leader", /\bDeputy Squad Leader\b/i],
      ["Vice Squad Leader", /\bVice Squad Leader\b/i],
      ["second-in-command", /\bsecond-in-command\b/i],
    ],
  ],
  [
    /小隊長/,
    [
      ["Squad Leader", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bSquad Leader\b/i],
      ["Platoon Leader", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bPlatoon Leader\b/i],
    ],
  ],
  [
    /副隊長/,
    [
      ["Vice Captain", /\bVice Captain\b/i],
      ["Vice Squad Leader", /\bVice Squad Leader\b/i],
      ["Deputy Captain", /\bDeputy Captain\b/i],
    ],
  ],
  [
    /隊長/,
    [
      ["Squad Leader", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bSquad Leader\b/i],
      ["Captain", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bCaptain\b/i],
    ],
  ],
  [
    /団長/,
    [
      ["Squad Leader", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bSquad Leader\b/i],
      ["Captain", /(?<!\bvice[\s-]+|\bdeputy[\s-]+)\bCaptain\b/i],
      ["Leader", /(?<!\bvice[\s-]+|\bdeputy[\s-]+|\bsquad[\s-]+)\bLeader\b/i],
    ],
  ],
  [
    /預言者/,
    [
      ["Prophet of Trinity", /\bProphet of Trinity\b/i],
      ["Great Prophet", /\bGreat Prophet\b/i],
      ["mystery prophet", /\bmystery prophet\b/i],
      ["prophet", /\bprophet\b/i],
    ],
  ],
  [
    /書記長/,
    [
      ["Comrade Chairman", /\bComrade Chairman\b/i],
      ["Chairman", /\bChairman\b/i],
      ["Secretary", /\bSecretary\b/i],
    ],
  ],
  [/同志/, [["Comrade", /\bComrade\b/i]]],
  [/ボス/, [["Boss", /\bBoss\b/i]]],
  [/マスター|主/, [["Master", /\bMaster\b/i]]],
  [/教授/, [["Professor", /\bProfessor\b/i]]],
  [/教官/, [["Instructor", /\bInstructor\b/i]]],
  [/リーダー/, [["Leader", /\bLeader\b/i]]],
  [/幹部/, [["higher-ups", /\bhigher-ups\b/i], ["executives", /\bexecutives?\b/i], ["officers", /\bofficers?\b/i]]],
  [/お二人/, [["both of you", /\bboth of you\b/i], ["the two of you", /\bthe two of you\b/i], ["you two", /\byou two\b/i]]],
  [/ビッグシスター/, [["Big Sister", /\bBig Sister\b/i]]],
  [/(?<!ビッグ)シスター/, [["Sister", /\bSister\b/i]]],
  [/勇者/, [["hero", /\bhero\b/i]]],
  [/裏切り者/, [["traitor", /\btraitor\b/i]]],
  [/氷の魔女/, [["ice queen", /\bice queen\b/i]]],
  [/変態/, [["pervert", /\bperverts?\b/i]]],
  [/腹黒/, [["malicious", /\bmalicious\b/i]]],
  [/あのバカ/, [["that foolish girl", /\bthat foolish girl\b/i], ["foolish girl", /\bfoolish girl\b/i]]],
  [/おバカなサキ/, [["idiot", /\bidiot\b/i]]],
  [/おバカさん/, [["imposter", /\bimposter\b/i]]],
  [/無能/, [["incompetent", /\bincompetent\b/i], ["incompetence", /\bincompetence\b/i]]],
  [/「天才」/, [["genius hacker", /\bgenius hacker\b/i], ["genius", /\bgenius\b/i]]],
  [/最後の天使/, [["final angel", /\bfinal angel\b/i]]],
  [/天才戦略家/, [["genius strategist", /\bgenius strategist\b/i]]],
  [/百鬼夜行最強の読心術師/, [["Mind Reader of Hyakkiyako", /\bMind Reader of Hyakkiyako\b/i]]],
  [/浄化槽の濁った水/, [["septic tank", /\bseptic tank\b/i]]],
  [
    /美少女|ハッカー|美人部長/,
    [
      ["delicate yet beautiful super-genius hacker", /\bdelicate(?:,)? yet beautiful(?:,)? super[- ]?genius hacker\b/i],
      ["delicate and beautiful super-genius hacker", /\bdelicate and beautiful super[- ]?genius hacker\b/i],
      ["beautiful super-genius hacker", /\bbeautiful super[- ]?genius hacker\b/i],
      ["delicate genius hacker", /\bdelicate(?:,)? genius hacker\b/i],
      ["super-genius hacker", /\bsuper[- ]?genius hacker\b/i],
      ["genius hacker", /\bgenius hacker\b/i],
      ["beautiful hacker", /\bbeautiful(?: and alluring)? hacker\b/i],
      ["super-genius, elegant, delicate beauty", /\bsuper[- ]?genius, elegant, delicate beauty\b/i],
      ["super-genius delicate beauty", /\bsuper[- ]?genius delicate beauty\b/i],
      ["delicate super-genius beauty", /\bdelicate super[- ]?genius beauty\b/i],
      ["delicate genius beauty", /\bdelicate genius beauty\b/i],
      ["delicate beauty", /\bdelicate beauty\b/i],
      ["super-genius and delicate, beautiful flower", /\bsuper[- ]?genius and delicate, beautiful flower\b/i],
      ["delicate flower", /\bdelicate(?:, beautiful)? flower\b/i],
      ["beautiful genius", /\bbeautiful genius\b/i],
      ["beautiful president", /\bbeautiful president\b/i],
    ],
  ],
  [
    /女将/,
    [
      ["Proprietress", /\bProprietress\b/i],
      ["Landlady", /\bLandlady\b/i],
      ["Owner", /\bOwner\b/i],
      ["Madam", /\bMadam\b/i],
    ],
  ],
  [/マダム/, [["Madame", /\bMadame\b/i], ["Madam", /\bMadam\b/i]]],
  [/ジェネラル/, [["General", /\bGeneral\b/i]]],
  [/チビメイド|メイド/, [["little maid", /\blittle maid\b/i], ["tiny maid", /\btiny maid\b/i], ["maid", /\bmaid\b/i]]],
  [
    /チビ/,
    [
      ["pip-squeak", /\bpip-?squeak\b/i],
      ["little one", /\blittle one\b/i],
      ["shorty", /\bshorty\b/i],
      ["shrimp", /\bshrimp\b/i],
      ["runt", /\brunt\b/i],
      ["kid", /\bkid\b/i],
    ],
  ],
  [/タヌキ/, [["raccoon", /\braccoon\b/i], ["tanuki", /\btanuki\b/i]]],
  [/シーフ王/, [["Thief King", /\bThief King\b/i]]],
  [/シーフ/, [["Thief King", /\bThief King\b/i], ["thief", /\bthief\b/i]]],
  [/慈愛の怪盗/, [["Phantom Thief of Affection", /\bPhantom Thief of Affection\b/i], ["Phantom Thief", /\bPhantom Thief\b/i]]],
  [/ファウスト/, [["Faust", /\bFaust\b/i]]],
  [/パンちゃん/, [["Pan-chan", /\bPan-chan\b/i]]],
  [/温泉開発部/, [["Hot Springs Department", /\bHot Springs Department\b/i]]],
  [/自警団/, [["Vigilante Crew", /\bVigilante Crew\b/i]]],
  [/出版部/, [["Publishing Department", /\bPublishing Department\b/i]]],
  [/事務局/, [["Red Winter Office", /\bRed Winter Office\b/i], ["Secretariat", /\bSecretariat\b/i]]],
  [/寮監隊/, [["Prefect Team", /\bPrefect Team\b/i], ["Disciplinary Committee", /\bDisciplinary Committee\b/i]]],
  [/オカルト研究会/, [["Occult Research Society", /\bOccult Research Society\b/i]]],
  [/特殊交易部/, [["Special Trade Department", /\bSpecial Trade Department\b/i]]],
  [/救急医学部/, [["Medical Emergency Club", /\bMedical Emergency Club\b/i]]],
  [/便利屋(?:68)?/, [["Problem Solver 68", /\bProblem Solver 68\b/i], ["Problem Solver", /\bProblem Solver\b/i]]],
  [/ヘルメット団/, [["Helmet Gang", /\bHelmet Gang\b/i]]],
  [
    /レッドウィンター/,
    [
      ["Red Winter Federal Academy", /\bRed Winter Federal Academy\b/i],
      ["Red Winter", /\bRed Winter\b/i],
    ],
  ],
  [/ブルー先輩/, [["Blue", /\bBlue\b/]]],
  [/^ピンク$/, [["Pink", /\bPink\b/]]],
  [/先生/, [["Sensei", /\bSensei\b/i], ["Teacher", /\bTeacher\b/i]]],
  [
    /(?:アル)?バイト/,
    [
      ["Miss Part-timer", /\bMiss\s+Part-timer\b/i],
      ["Part-timer", /\bPart-timer\b/i],
    ],
  ],
  [
    /ワニ/,
    [
      ["Mecha-Croc", /\bMecha-?Croc\b/i],
      ["crocodile", /\bcrocodile\b/i],
      ["alligator", /\balligator\b/i],
    ],
  ],
  [/^(?:私たち|我々)$/, [["us", /\bus\b/i], ["we", /\bwe\b/i]]],
  [/^(?:みんな|皆さん)$/, [["everyone", /\beveryone\b/i], ["everybody", /\beverybody\b/i]]],
  [
    /^(?:あなた達|あなたたち|あなた方|お前たち|お前達|お前ら|あんたたち|あんた達|あんたら|君たち|君達)$/,
    [["all of you", /\ball of you\b/i], ["you guys", /\byou guys\b/i], ["you all", /\byou all\b/i], ["you", /\byou\b(?!['’])/i]],
  ],
  [
    /^(?:あの子|この子)$/,
    [["that girl", /\bthat girl\b/i], ["this girl", /\bthis girl\b/i], ["that kid", /\bthat kid\b/i]],
  ],
  [/^(?:あの方|あの人)$/, [["that person", /\bthat person\b/i]]],
  [/^あいつら$/, [["those guys", /\bthose guys\b/i], ["them", /\bthem\b/i], ["they", /\bthey\b/i]]],
  [/^(?:あいつ|あの女)$/, [["that woman", /\bthat woman\b/i], ["she", /\bshe\b/i]]],
  [/^貴女$/, [["you", /\byou\b/i]]],
  [/^手前(?:さん|様)?(?:\([^)]*\))?$/, [["you", /\byou\b/i]]],
  [
    /^(?:あなた|あんた|お前|おまえ|君|キミ|貴様|貴方|其方|そなた|御主|お主|おのし|そち)$/,
    [["you", /\byou\b/i]],
  ],
];

export function normalizeEnStutters(text: string): string {
  return text
    .replace(/\b([A-Za-z])-\1-([A-Za-z]+)/g, "$2")
    .replace(/\b([A-Za-z])-(\1[A-Za-z]+)/g, "$2")
    .replace(/\b([A-Za-z]{2})-(\1[A-Za-z]+)/gi, "$2");
}

export function extractEnAppellations(
  enLine: string,
  ctx: ExtractionContext
): string[] {
  if (!enLine) return [];
  const normalized = normalizeEnStutters(enLine);
  const { speaker, target, matchedJpTerms } = ctx;

  if (target.id === "special:self") {
    const found: string[] = [];
    const specialSelfPhrases: Array<[string, RegExp]> = [
      ["this unit", /\bthis unit\b/i],
      ["this old man", /\bthis old man\b/i],
      ["old man", /\bold man\b/i],
      ["this old-timer", /\bthis old[- ]?timer\b/i],
      ["old-timer", /\bold[- ]?timer\b/i],
      ["your big sis", /\byour big sis\b/i],
      ["big sis", /\bbig sis\b/i],
      ["yours truly", /\byours truly\b/i],
      ["moi", /\bmoi\b/i],
      ...(speaker.id === "himari"
        ? ([
            ["delicate yet beautiful super-genius hacker", /\bdelicate(?:,)? yet beautiful(?:,)? super[- ]?genius hacker\b/i],
            ["delicate and beautiful super-genius hacker", /\bdelicate and beautiful super[- ]?genius hacker\b/i],
            ["beautiful, super-genius, and delicate omniscient hacker", /\bbeautiful, super[- ]?genius, and delicate omniscient hacker\b/i],
            ["delicate, intelligent, elegant, super-genius hacker", /\bdelicate, intelligent, elegant, super[- ]?genius hacker\b/i],
            ["delicately chic and beautiful super genius hacker", /\bdelicately chic and beautiful super[- ]?genius hacker\b/i],
            ["leading beautiful super genius delicate hacker", /\bleading beautiful super[- ]?genius delicate hacker\b/i],
            ["multifaceted super genius hacker", /\bmultifaceted super[- ]?genius hacker\b/i],
            ["super genius hacker of ethereal beauty", /\bsuper[- ]?genius hacker of ethereal beauty\b/i],
            ["transcendentally beautiful hacker heroine", /\btranscendentally beautiful hacker heroine\b/i],
            ["beautiful super-genius hacker", /\bbeautiful super[- ]?genius hacker\b/i],
            ["delicate genius hacker", /\bdelicate(?:,)? genius hacker\b/i],
            ["super-genius hacker", /\bsuper[- ]?genius hacker\b/i],
            ["genius hacker", /\bgenius hacker\b/i],
            ["beautiful hacker", /\bbeautiful(?: and alluring)? hacker\b/i],
            ["delicate, beautiful, super-genius, chic, cool beauty", /\bdelicate, beautiful, super[- ]?genius, chic, cool beauty\b/i],
            ["super-genius, delicate, chic beauty", /\bsuper[- ]?genius, delicate, chic beauty\b/i],
            ["super-genius, elegant, delicate beauty", /\bsuper[- ]?genius, elegant, delicate beauty\b/i],
            ["super-genius delicate beauty", /\bsuper[- ]?genius delicate beauty\b/i],
            ["delicate super-genius beauty", /\bdelicate super[- ]?genius beauty\b/i],
            ["delicate genius beauty", /\bdelicate genius beauty\b/i],
            ["jack-of-all-trades battle beauty", /\bjack-of-all-trades battle beauty\b/i],
            ["most stunning, delicate beauty", /\bmost stunning, delicate beauty\b/i],
            ["rare, delicate beauty", /\brare, delicate beauty\b/i],
            ["omnipotent AND omniscient beauty", /\bomnipotent AND omniscient beauty\b/i],
            ["flawless beauty", /\bflawless beauty\b/i],
            ["delicate beauty", /\bdelicate beauty\b/i],
            ["beautiful, delicate, genius life support girl", /\bbeautiful, delicate, genius life support girl\b/i],
            ["alabaster-white, ever-blooming fragile flower", /\balabaster-white, ever-blooming fragile flower\b/i],
            ["super-genius and delicate, beautiful flower", /\bsuper[- ]?genius and delicate, beautiful flower\b/i],
            ["pure and delicate flower", /\bpure and delicate flower\b/i],
            ["sickly and dainty flower", /\bsickly and dainty flower\b/i],
            ["delicate flower", /\bdelicate(?:, beautiful)? flower\b/i],
            ["super-genius beauty biker", /\bsuper[- ]?genius beauty biker\b/i],
            ["super-genius, beautifully delicate, beautiful maiden", /\bsuper[- ]?genius, beautifully delicate, beautiful maiden\b/i],
            ["quintessential docile maiden", /\bquintessential docile maiden\b/i],
            ["solitary recluse of a girl", /\bsolitary recluse of a girl\b/i],
            ["lady of the century", /\blady of the century\b/i],
            ["Millennium's Resident Genius", /\bMillennium's Resident Genius\b/i],
            ["beautiful genius", /\bbeautiful genius\b/i],
            ["beautiful president", /\bbeautiful president\b/i],
            ["cyber fairy", /\bcyber fairy\b/i],
            ["science girl", /\bscience girl\b/i],
            ["mineral water from an ice cap", /\bmineral water from an ice cap\b/i],
            ["crystal-clear pure mineral water", /\bcrystal-clear pure mineral water\b/i],
            ["Omniscient being", /\bOmniscient being\b/i],
            ["omniscient", /\bomniscient\b/i],
          ] as Array<[string, RegExp]>)
        : speaker.id === "toki"
          ? ([
              ["platonically perfect, cute maid of unparalleled beauty", /\bplatonically perfect, cute maid of unparalleled beauty\b/i],
              ["preeminent cute, pale, perfect beauty", /\bpreeminent cute, pale, perfect beauty\b/i],
              ["perfect maid and agent", /\bperfect maid and (?:perfect )?agent\b/i],
              ["hyper-perfect maid", /\bhyper-perfect maid\b/i],
              ["best maid in Kivotos", /\bbest maid in Kivotos\b/i],
              ["maid of all maids", /\bmaid of all maids\b/i],
              ["kind and perfect maid", /\bkind and perfect maid\b/i],
              ["perfect, wonderful maid", /\bperfect, wonderful maid\b/i],
              ["perfect maid", /\bperfect maid\b/i],
              ["superior maid", /\bsuperior maid\b/i],
              ["excellent maid", /\bexcellent maid\b/i],
              ["capable maid", /\bcapable maid\b/i],
              ["perfect special agent", /\bperfect special agent\b/i],
              ["perfect agent", /\bperfect agent\b/i],
              ["best agent", /\bbest agent\b/i],
            ] as Array<[string, RegExp]>)
          : speaker.id === "reisa"
            ? ([
                ["Superstar of the Vigilante Crew", /\bSuperstar of the Vigilante Crew\b/i],
                ["Vigilante Crew's Superstar", /\bVigilante Crew'?s Superstar\b/i],
                ["everyone's superstar", /\beveryone'?s superstar\b/i],
                ["Superstar", /\bSuperstar\b/i],
              ] as Array<[string, RegExp]>)
            : []),
    ];
    for (const [label, re] of specialSelfPhrases) {
      if (re.test(normalized)) {
        if (label === "old man" && found.includes("this old man")) continue;
        if (label === "old-timer" && found.includes("this old-timer")) continue;
        if (label === "big sis" && found.includes("your big sis")) continue;
        found.push(label);
      }
    }
    const selfFullEn = speaker.fullName?.en?.trim() ?? "";
    const selfEn = speaker.name.en.trim();
    if (
      selfEn.length >= 3 &&
      /^[A-Za-z0-9* .'-]+$/.test(selfEn) &&
      !["Self", "You"].includes(selfEn)
    ) {
      const escEn = escapeRegExp(selfEn);
      const fullVariants: string[] = [];
      if (selfFullEn && selfFullEn.includes(" ")) {
        fullVariants.push(selfFullEn);
        const parts = selfFullEn.split(/\s+/);
        if (parts.length === 2) {
          fullVariants.push(`${parts[1]} ${parts[0]}`);
        }
      }
      let withoutSelfIntro = normalized;
      for (const fv of [...fullVariants, selfEn]) {
        const escFv = escapeRegExp(fv);
        withoutSelfIntro = withoutSelfIntro.replace(
          new RegExp(
            `\\b(?:I am|I'm|my name is|name's|call me|known as)\\s+${escFv}\\b`,
            "gi"
          ),
          " "
        );
      }
      let matchedFullSelf = false;
      for (const fv of fullVariants) {
        const fvRe = new RegExp(`\\b${escapeRegExp(fv)}\\b`);
        if (fvRe.test(withoutSelfIntro)) {
          found.push(fv);
          matchedFullSelf = true;
          break;
        }
      }
      if (!matchedFullSelf) {
        const greatRe = new RegExp(`\\bGreat\\s+${escEn}\\b`, "i");
        if (greatRe.test(withoutSelfIntro)) {
          found.push(`Great ${selfEn}`);
          withoutSelfIntro = withoutSelfIntro.replace(
            new RegExp(`\\bGreat\\s+${escEn}\\b`, "gi"),
            " "
          );
        }
        const re = new RegExp(`\\b${escEn}\\b`);
        if (re.test(withoutSelfIntro)) {
          found.push(selfEn);
        }
      }
    }
    for (const extra of ctx.extraEnTerms ?? []) {
      const cleanExtra = extra.trim();
      if (!cleanExtra) continue;
      const m = normalized.match(new RegExp(`\\b${escapeRegExp(cleanExtra)}\\b`, "i"));
      if (m) found.push(m[0].replace(/\s+/g, " ").trim());
    }
    for (const jt of matchedJpTerms) {
      if (/^[A-Za-z][A-Za-z0-9& -]{1,}$/.test(jt)) {
        const m = normalized.match(
          new RegExp(`\\b${escapeRegExp(jt).replace(/(\d+)/, "\\s*$1")}\\b`, "i")
        );
        if (m) found.push(m[0].replace(/\s+/g, " ").trim());
      } else if (jt.includes("キャンプRABBIT") && /\bCamp\s+RABBIT\b/i.test(normalized)) {
        found.push("Camp RABBIT");
      } else if (jt.includes("コールサイン04") || jt.includes("コールサインゼロフォー")) {
        const m04 = normalized.match(/\bcall\s*sign\s*04\b/i);
        if (m04) found.push("Callsign 04");
        const mzf = normalized.match(/\bcall\s*sign\s+Zero[- ]?Four\b/i);
        if (mzf) found.push("call sign Zero-Four");
      } else if (jt.includes("ダブルオー")) {
        const mdo = normalized.match(/\bCall\s*Sign\s+Double\s+O\b/i);
        if (mdo) found.push("Call Sign Double O");
      } else if (jt.includes("コールサイン・ゼロワン")) {
        const mzo = normalized.match(/\bcall\s*sign\s+Zero[- ]?One\b/i);
        if (mzo) found.push("call sign Zero-One");
      } else if (jt.includes("コールサインゼロツー")) {
        const mzt = normalized.match(/\bcall\s*sign\s+Zero[- ]?Two\b/i);
        if (mzt) {
          found.push("call sign Zero-Two");
        } else {
          const m2 = normalized.match(/\bZero[- ]?Two\b/i);
          if (m2) found.push("Zero-Two");
        }
      } else if (jt.includes("コールサイン・ゼロスリー") || jt.includes("コールサインゼロスリー")) {
        const mzs = normalized.match(/\bcall\s*sign\s+Zero[- ]?Three\b/i);
        if (mzs) found.push("call sign Zero-Three");
        const maz = normalized.match(/\bAgent\s+Zero[- ]?Three\b/i);
        if (maz) found.push("Agent Zero-Three");
      }
    }
    return uniqueOrdered(found);
  }

  if (target.id === "special:sensei") {
    const found: string[] = [];
    let remaining = normalized;
    if (/\[USERNAME\]\s*,?\s*Sensei\b/i.test(remaining)) {
      found.push("[USERNAME] Sensei");
      remaining = remaining.replace(/\[USERNAME\]\s*,?\s*Sensei\b/gi, " ");
    }
    if (/\[USERNAME\]/.test(remaining)) {
      found.push("[USERNAME]");
    }
    const cleaned = remaining.replace(/\[USERNAME\]\s*/g, "");
    for (const [label, re] of EN_SENSEI_TERMS) {
      if (label === "Boss" && !matchedJpTerms.some((t) => /お頭|ボス|親分|大将|頭/.test(t))) {
        continue;
      }
      if (
        label === "Master" &&
        !(
          matchedJpTerms.some((t) => /ご主人様|マスター|お頭/.test(t)) ||
          Boolean(ctx.jpLine && /ご主人様/.test(ctx.jpLine))
        )
      ) {
        continue;
      }
      if (
        label === "Master" &&
        (/\b(?:puppet|festival)\s+master\b|\bmaster\s+of\b|\b(?:to|will|'ll|can|could|should|would)\s+master\b/i.test(
          cleaned
        ))
      ) {
        continue;
      }
      if (
        label === "Instructor" &&
        !matchedJpTerms.some((t) => /教官|インストラクター/.test(t))
      ) {
        continue;
      }
      if (
        (label === "dear customer" || label === "customer") &&
        !matchedJpTerms.some((t) => /お客様|お客さん/.test(t))
      ) {
        continue;
      }
      if (label === "customer" && found.includes("dear customer")) {
        continue;
      }
      if (
        (label === "Noob Sensei" || label === "Noob" || label === "newbie") &&
        !matchedJpTerms.some((t) => /素人|しろうと/.test(t))
      ) {
        continue;
      }
      if (label === "Noob" && found.includes("Noob Sensei")) {
        continue;
      }
      if (
        label === "Sensei" &&
        (found.includes("Schale's Sensei") ||
          found.includes("Sensei of Schale") ||
          found.includes("Sensei from Schale") ||
          found.includes("Noob Sensei"))
      ) {
        continue;
      }
      if (re.test(cleaned)) {
        if (label === "Teach" && found.includes("Teacher")) continue;
        found.push(label);
      }
    }
    return uniqueOrdered(found);
  }

  if (target.id === "special:you") {
    const found: string[] = [];
    if (/\byou\b/i.test(normalized)) found.push("you");
    return found;
  }

  const stemCandidates: string[] = [
    target.name.en,
    target.fullName?.en ?? "",
    ...target.aliases.en,
  ];
  const fullParts = (target.fullName?.en ?? "").trim().split(/\s+/);
  if (
    fullParts.length === 2 &&
    fullParts.every((p) => /^[A-Za-z][A-Za-z'-]{1,}$/.test(p))
  ) {
    stemCandidates.push(`${fullParts[1]} ${fullParts[0]}`);
  }
  if (target.kind !== "entity" && !target.id.startsWith("npc:gsc_president")) {
    for (const s of [...stemCandidates]) {
      for (const part of s.split(/[\s*]+/)) {
        if (part.length >= 3 && /^[A-Za-z][A-Za-z'-]+$/.test(part)) {
          stemCandidates.push(part);
        }
      }
    }
  }

  // Shortened nickname prefixes when JP term uses that shortened prefix (e.g. Nagisa -> Nagi for ナギちゃん)
  const baseEn = target.name.en.trim();
  const isShortenedJp =
    target.name.jp.length >= 3 &&
    matchedJpTerms.some((t) => {
      const bare = stripJpParens(t);
      return !bare.includes(target.name.jp) && bare.includes(target.name.jp.slice(0, 2));
    });
  const shortenedEnPrefixStems = new Set<string>();
  if (/^[A-Za-z]{5,}$/.test(baseEn) && isShortenedJp) {
    const p4 = baseEn.slice(0, 4);
    const p5 = baseEn.slice(0, 5);
    stemCandidates.push(p4, p5);
    shortenedEnPrefixStems.add(p4.toLowerCase());
    shortenedEnPrefixStems.add(p5.toLowerCase());
  }

  const stems = uniqueOrdered(stemCandidates)
    .filter(
      (s) =>
        /^[A-Za-z0-9* .'-]+$/.test(s) &&
        (s.length >= 3 ||
          (s.length === 2 && s.toLowerCase() === baseEn.toLowerCase()))
    )
    .sort((a, b) => b.length - a.length);

  const enSurnameOnlyStems = new Set<string>();
  if (target.kind !== "entity" && target.fullName?.en) {
    const primaryEnLower = baseEn.toLowerCase();
    for (const part of target.fullName.en.trim().split(/\s+/)) {
      const cleanPart = part.trim();
      if (
        cleanPart.length >= 3 &&
        /^[A-Za-z][A-Za-z'-]+$/.test(cleanPart) &&
        cleanPart.toLowerCase() !== primaryEnLower
      ) {
        enSurnameOnlyStems.add(cleanPart.toLowerCase());
      }
    }
  }

  const found: string[] = [];
  for (const extra of ctx.extraEnTerms ?? []) {
    const cleanExtra = extra.trim();
    if (!cleanExtra) continue;
    const m = normalized.match(new RegExp(`\\b${escapeRegExp(cleanExtra)}\\b`, "i"));
    if (m) {
      const mStr = m[0].replace(/\s+/g, " ").trim();
      const coveredByFuller = found.some(
        (f) =>
          f.toLowerCase() !== mStr.toLowerCase() &&
          f.toLowerCase().includes(mStr.toLowerCase())
      );
      if (!coveredByFuller) {
        found.push(mStr);
      }
    }
  }

  for (const jt of matchedJpTerms) {
    if (/^[A-Za-z][A-Za-z0-9& -]{1,}$/.test(jt)) {
      const m = normalized.match(
        new RegExp(`\\b${escapeRegExp(jt).replace(/(\d+)/, "\\s*$1")}\\b`, "i")
      );
      if (m) found.push(m[0].replace(/\s+/g, " ").trim());
    }
  }

  const hasAnotherVariantPrefix =
    target.id === "shiroko_terror" ||
    matchedJpTerms.some((t) => /もう一人|別の|違う/.test(t));
  const enPrefixTitlesForPair = hasAnotherVariantPrefix
    ? `Another|The other|${EN_PREFIX_TITLES}`
    : EN_PREFIX_TITLES;

  for (const stem of stems) {
    const eventGuard = enSurnameOnlyStems.has(stem.toLowerCase())
      ? "(?!\\s+(?:Festival|Fest|Academy|School|High|Club|Committee|Department|Society|Shop|Store|Cafe|Clinic|Temple|Shrine|District|Street|Square|Park|Hall|Building|Tower|Station|Line)\\b)"
      : "";
    const interruptedGuard = shortenedEnPrefixStems.has(stem.toLowerCase())
      ? "(?!\\s*(?:\\.\\.\\.|…|—|―|--))"
      : "";
    const stemPattern =
      target.kind !== "entity"
        ? escapeRegExp(stem).replace(/ +/g, "(?:\\s*,\\s*|\\s+)")
        : escapeRegExp(stem);
    const gscActingLookbehind = target.id.startsWith("npc:gsc_president")
      ? "(?<!\\bacting[\\s-]+|\\bvice[\\s-]+|\\bdeputy[\\s-]+)"
      : "";
    const re = new RegExp(
      `${gscActingLookbehind}\\b(?:(?:${enPrefixTitlesForPair})\\s+)?${stemPattern}${eventGuard}(?:-(?:chan|san|kun|sama|senpai|sensei|onee-chan|onee-san)|\\s+(?:Senpai|President|Boss|Chief))?\\b${interruptedGuard}`,
      "gi"
    );
    const matches = normalized.match(re);
    if (matches) {
      for (const m of matches) {
        let cleanMatch = m.replace(/\s*,\s+/g, " ").replace(/\s+/g, " ").trim();
        if (/^miss\s+/.test(cleanMatch)) {
          cleanMatch = cleanMatch.replace(/^miss\s+/, "");
        }
        const coveredByFuller = found.some(
          (f) =>
            f.toLowerCase() !== cleanMatch.toLowerCase() &&
            f.toLowerCase().includes(cleanMatch.toLowerCase())
        );
        if (!coveredByFuller) {
          found.push(cleanMatch);
        }
      }
    }
  }

  const hasExplicitTitleInJp = matchedJpTerms.some((t) =>
    /(?:副?生徒会長|副?会長|副?委員長|副?部長|副?局長|副?小?隊長|副長|社長|室長|議長|行政官|書記長|教授|教官|勇者|裏切り者|氷の魔女|変態|腹黒|あのバカ|おバカなサキ|おバカさん|無能|「天才」|最後の天使|天才戦略家|百鬼夜行最強の読心術師|浄化槽の濁った水)/.test(
      t
    )
  );
  const stemLowerSet = new Set(stems.map((s) => s.trim().toLowerCase()));
  const onlyBareStemFound =
    !target.id.startsWith("npc:gsc_president") &&
    found.length > 0 &&
    found.every((f) => stemLowerSet.has(f.trim().toLowerCase()));

  const onlyBareStemOrYou =
    !target.id.startsWith("npc:gsc_president") &&
    found.length > 0 &&
    found.every(
      (f) =>
        stemLowerSet.has(f.trim().toLowerCase()) ||
        (matchedJpTerms.some((t) => /お嬢ちゃん/.test(t)) &&
          f.trim().toLowerCase() === "you")
    );

  if (
    matchedJpTerms.some((t) => /浄化槽の濁った水/.test(t)) &&
    /\bseptic tank\b/i.test(normalized) &&
    !found.some((f) => f.toLowerCase() === "septic tank")
  ) {
    found.push("septic tank");
  }

  if (found.length === 0 || (hasExplicitTitleInJp && onlyBareStemFound) || onlyBareStemOrYou) {
    for (const [jpRe, enTitles] of JP_TO_EN_TITLES) {
      if (matchedJpTerms.some((t) => jpRe.test(t))) {
        for (const [label, re] of enTitles) {
          const m = normalized.match(re);
          if (m) {
            const matchedLower = m[0].toLowerCase();
            const picked = matchedLower === label.toLowerCase() ? m[0] : label;
            if (onlyBareStemFound) {
              found.splice(0, found.length, picked);
            } else if (!found.some((f) => f.toLowerCase() === picked.toLowerCase())) {
              found.push(picked);
            }
            break;
          }
        }
        if (found.length > 0 && !onlyBareStemFound) break;
        if (onlyBareStemFound && found.some((f) => !stemLowerSet.has(f.trim().toLowerCase()))) {
          break;
        }
      }
    }
  }

  return uniqueOrdered(found);
}

const KR_VOCATIVE_NOUN_END_RE =
  /(?:선배님|선배|위원장님|위원장|부장님|부장|회장님|회장|사장님|사장|실장님|실장|대장님|대장|단장님|단장|의장님|의장|국장님|국장|행정관님|행정관|교관님|교관|선생님|선생|아가씨|공주님|공주|여왕님|언니|누나|오빠|형님|아저씨|님|씨|쨩|짱|군|양)$/;
const KR_VERB_CLAUSE_END_RE =
  /(?:습니다|ㅂ니다|습니까|ㅂ니까|세요|어요|아요|해요|네요|군요|죠|지요|거든요|잖아요|는데요|은데요|구나|냐|니|을까|ㄹ까|자|다|라|요)$/;
const EN_FINITE_VERB_RE =
  /\b(?:is|are|was|were|am|be|been|have|has|had|do|does|did|can|could|will|would|shall|should|may|might|must|don't|doesn't|didn't|can't|won't|I'm|you're|we're|they're|it's|she's|he's|seems|seemed|looks|looked|feels|felt|sounds|sounded|gets|got|becomes|became|acts|acted|appears|appeared|keeps|kept|goes|went|comes|came|makes|made|takes|took|turns|turned|needs|needed|wants|wanted|knows|knew|thinks|thought|says|said|likes|liked|loves|loved|hates|hated|means|meant|tries|tried|gives|gave|tells|told)\b/i;

const EN_QUESTION_OR_CLAUSE_RE =
  /\b(?:what|what's|where|where's|who|who's|why|how|hey|oh|ah|wait|well|about|let's|that's|now|better|not|good|point|and|then|there's|with|for|to|wrong)\b/i;

export function extractStandaloneVocative(
  line: { jp: string; kr: string; en?: string },
  matchedJpTerms: string[],
  existingKr: string[],
  existingEn: string[],
  target?: Character
): { kr?: string; en?: string } {
  const cleanJp = line.jp
    .replace(/([ぁ-んァ-ン])[、,]\s*(?=[ぁ-んァ-ン])/g, "")
    .replace(/[。！？…・、,\s「」『』()（）"'\-~!?]/g, "")
    .trim();
  if (!cleanJp) return {};

  const isStandaloneJp = matchedJpTerms.some((jt) =>
    expandJpTermNeedles(jt).some((needle) => {
      const cleanNeedle = needle.replace(/[。！？…・、,\s「」『』()（）"'\-~!?]/g, "");
      if (!cleanNeedle) return false;
      if (cleanJp === cleanNeedle) return true;
      if (cleanJp.includes(cleanNeedle) && cleanJp.length - cleanNeedle.length <= 2) {
        // Reject full clause lines like "マコトちゃん、変ね。" where a comma follows the address
        if (/[、,]/.test(line.jp.replace(/([ぁ-んァ-ン])[、,]\s*(?=[ぁ-んァ-ン])/g, ""))) {
          return false;
        }
        return true;
      }
      return false;
    })
  );
  if (!isStandaloneJp) return {};

  // Only allow vocative expansion when JP term has modifier text beyond the bare target name/title
  const plainSet = new Set<string>([
    target?.name.jp ?? "",
    target?.fullName?.jp ?? "",
    ...(target?.aliases.jp ?? []),
  ]);
  const matchedSimple = matchedJpTerms.some((jt) =>
    expandJpTermNeedles(jt).some((n) => {
      const cn = n.replace(/[。！？…・、,\s「」『』()（）"'\-~!?]/g, "");
      if (!cn || cleanJp !== `${cn}の`) return false;
      return true;
    })
  );
  if (matchedSimple || /[のがはをにへとでも]$/.test(cleanJp)) {
    const endedWithSameParticle = matchedJpTerms.some((jt) =>
      jt.endsWith(cleanJp[cleanJp.length - 1])
    );
    if (!endedWithSameParticle) return {};
  }

  const hasModifiedJpTerm = matchedJpTerms.some((jt) => {
    const bare = stripJpParens(jt);
    return bare && !plainSet.has(bare) && !GENERIC_TITLES.has(bare);
  });
  if (!hasModifiedJpTerm) return {};

  const out: { kr?: string; en?: string } = {};

  if (line.kr && existingKr.length > 0) {
    const cleanKr = line.kr
      .replace(/^[\s「」『』"'.,!?…~]+|[\s「」『』"'.,!?…~]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const endsWithKrParticle =
      /(?:까지|마저|조차|부터|[의은는이가을를에에도만와과랑])$/.test(cleanKr) &&
      !existingKr.some((k) => k.endsWith(cleanKr[cleanKr.length - 1]));
    const startsWithAdverb =
      /^(?:거기다|게다가|그런데|하지만|아니|그냥|정말|진짜|혹시|아마|일단|우선|역시|결국|그래도|어차피)\s+/.test(
        cleanKr
      );
    const hasStemExtension = existingKr.every(
      (k) => cleanKr.includes(k) && cleanKr.length > k.length
    );
    const looksLikeClause =
      /[,.!?]/.test(cleanKr) ||
      endsWithKrParticle ||
      startsWithAdverb ||
      (KR_VERB_CLAUSE_END_RE.test(cleanKr) &&
        !KR_VOCATIVE_NOUN_END_RE.test(cleanKr) &&
        !hasStemExtension);

    if (
      cleanKr.length >= 2 &&
      cleanKr.length <= 22 &&
      !looksLikeClause &&
      !KR_STOP_WORDS.has(cleanKr) &&
      hasStemExtension
    ) {
      out.kr = cleanKr;
    }
  }

  if (line.en && existingEn.length > 0 && !/\?/.test(line.en)) {
    const cleanEn = normalizeEnStutters(line.en)
      .replace(/^[\s"'.,!?…~\-]+|[\s"'.,!?…~]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = cleanEn.split(/\s+/).filter(Boolean);
    const hasStemExtension = existingEn.every(
      (e) =>
        cleanEn.toLowerCase().includes(e.toLowerCase()) &&
        cleanEn.length > e.length
    );
    if (
      cleanEn.length >= 2 &&
      cleanEn.length <= 42 &&
      words.length >= 1 &&
      words.length <= 5 &&
      !/\*/.test(cleanEn) &&
      !/['’]s$/i.test(cleanEn) &&
      !/[,;:.!?]/.test(cleanEn) &&
      !EN_STOP_WORDS.has(cleanEn.toLowerCase()) &&
      !EN_QUESTION_OR_CLAUSE_RE.test(cleanEn) &&
      !EN_FINITE_VERB_RE.test(cleanEn) &&
      hasStemExtension
    ) {
      out.en = cleanEn;
    }
  }

  return out;
}

const EN_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "so", "for", "of", "to", "in", "on", "at", "by", "with", "from", "as", "into", "like",
  "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "us", "they", "them", "their", "he", "him", "his", "she", "her", "hers", "it", "its",
  "this", "that", "these", "those", "here", "there", "what", "which", "who", "whom", "when", "where", "why", "how",
  "is", "are", "was", "were", "am", "be", "been", "being", "have", "has", "had", "do", "does", "did", "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "not", "no", "yes", "yeah", "well", "oh", "ah", "um", "uh", "hmm", "huh", "hey", "hi", "hello", "wait", "hold", "look", "see", "know", "think", "say", "said", "want", "need", "make", "made", "take", "took", "come", "came", "go", "went", "got", "get", "just", "now", "then", "still", "even", "also", "very", "too", "really", "actually", "anyway", "about", "all", "one", "two", "more", "most", "much", "many", "some", "any", "never", "always", "right", "okay", "ok", "sorry", "please", "thank", "thanks", "problem", "explanation", "something", "anything", "everything", "someone", "anyone", "nothing", "different", "today", "tomorrow", "maybe", "don't", "didn't", "doesn't", "can't", "won't", "i'm", "you're", "we're", "they're", "it's", "that's", "there's", "what's", "isn't", "aren't", "wasn't", "weren't",
  "time", "help", "feeling", "way", "day", "part", "place", "moment", "reason", "matter", "case", "point", "fact", "idea", "world", "life", "work", "word", "words", "voice", "hand", "name", "story", "news", "report", "chance", "hope", "dream", "plan", "order", "rule", "trouble", "mistake", "fault", "understood",
  "understand", "understands", "understanding", "feel", "feels", "felt", "believe", "remember", "forget", "realize", "notice", "wonder", "guess", "suppose", "mean", "means", "meant", "seem", "seems", "try", "tried", "keep", "kept", "let", "give", "gave", "tell", "told", "ask", "asked", "call", "called", "hear", "heard", "talk", "speak", "start", "stop", "leave", "left", "stay", "bring", "brought", "find", "found", "show", "turn", "move", "play", "run", "walk", "read", "write", "use", "put", "set", "send", "care", "worry", "agree", "accept", "refuse", "promise", "decide", "choose", "check", "confirm", "explain", "protect", "save", "fight", "win", "lose", "meet", "love", "like", "hate", "wish", "expect", "happen", "allow", "follow", "watch", "listen", "return", "continue", "become", "remain", "appear", "exist", "change", "create", "destroy", "finish", "complete", "prepare", "trust",
  "totally", "definitely", "probably", "certainly", "obviously", "especially", "already", "almost", "enough", "together", "before", "after", "again", "since", "while", "until", "though", "although", "because", "however", "without", "within", "through", "between", "among", "amongst", "across", "against", "during", "around", "behind", "beyond", "beside", "besides", "inside", "outside", "toward", "towards", "under", "above", "below", "onto", "upon", "via",
  "wants", "wanted", "wanting", "needs", "needed", "knows", "knew", "thinks", "thought", "says", "saying", "makes", "making", "takes", "taking", "comes", "coming", "goes", "going", "gets", "getting", "looks", "looking", "sees", "seeing", "likes", "liked", "loves", "loved", "hates", "hated", "tries", "trying", "keeps", "keeping", "gives", "giving", "tells", "telling", "asks", "asking", "calls", "calling", "hears", "hearing", "talks", "talking", "speaks", "speaking", "starts", "starting", "stops", "stopping", "leaves", "leaving", "stays", "staying", "brings", "bringing", "finds", "finding", "shows", "showing", "turns", "turning", "moves", "moving", "plays", "playing", "runs", "running", "walks", "walking", "reads", "reading", "writes", "writing", "uses", "using", "puts", "putting", "sets", "setting", "sends", "sending", "cares", "caring", "worries", "worrying", "hopes", "hoping", "wishes", "wishing", "expects", "expecting", "happens", "happening", "allows", "allowed", "allowing", "follows", "following", "watches", "watching", "listens", "listening", "returns", "returning", "continues", "continuing", "becomes", "becoming", "remains", "remaining", "appears", "appearing", "exists", "existing", "changes", "changing", "creates", "creating", "destroys", "destroying", "finishes", "finishing", "completes", "completing", "prepares", "preparing", "trusts", "trusting",
  "only", "fun", "proposal", "proposals", "mining", "resources", "resource", "customers", "people", "controls",
]);

const KR_STOP_WORDS = new Set([
  "나", "저", "내", "제", "우리", "저희", "너", "그", "이", "저거", "이거", "그거", "그것", "이것", "저것", "여기", "거기", "저기",
  "뭐", "왜", "어디", "언제", "누구", "어떻게", "무슨", "어떤", "이런", "그런", "저런", "그래", "아니", "응", "네", "예", "어", "아", "음", "으음", "잠깐",
  "진짜", "정말", "너무", "조금", "많이", "다시", "지금", "오늘", "내일", "이제", "이미", "아직", "벌써", "그냥", "혹시", "역시", "사실", "원래", "당연히", "물론",
  "그런데", "하지만", "그래서", "그러면", "그러게", "아무튼", "하아", "후우", "어머", "아이고",
  "하고", "하는", "해서", "했다", "한다", "있다", "없다", "있는", "없는", "있어", "없어", "같아", "같은", "것", "거", "수", "때", "일", "말", "분", "사람", "곳", "위해", "대한", "같이", "함께",
]);

function stripKrTrailingParticleForMining(token: string): string {
  return token.replace(
    /(?:이랑|랑|에게|에겐|께서|한테|까지|부터|처럼|보다|마다|조차|마저|밖에|이라도|라고|이라는|라는|이라니|라니|이에요|예요|입니다|잖아요|이잖아요|은|는|이|가|을|를|의|에|께|도|만|와|과|야|아|여)$/,
    ""
  );
}

export function mineSharedPhrasesForJpTerm(
  lines: Array<{ kr: string; en?: string }>,
  lang: "kr" | "en",
  opts: { speaker: Character; target: Character; otherCharNames?: Set<string> }
): string | undefined {
  if (lines.length < 2) return undefined;
  const minCount = Math.max(2, Math.ceil(lines.length * 0.5));

  if (lang === "en") {
    const enLines = lines.map((l) => l.en ?? "").filter(Boolean);
    if (enLines.length < 2) return undefined;
    const minEnCount = Math.max(2, Math.ceil(enLines.length * 0.5));
    const speakerNameLower = opts.speaker.name.en.trim().toLowerCase();

    const docFreq = new Map<string, { count: number; display: string; words: number }>();
    for (const rawLine of enLines) {
      const normalized = normalizeEnStutters(rawLine);
      const tokens = (normalized.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((t) =>
        t.replace(/['’]s$/i, "")
      );
      const seenInLine = new Set<string>();

      for (let i = 0; i < tokens.length; i++) {
        for (let len = 1; len <= 3 && i + len <= tokens.length; len++) {
          const slice = tokens.slice(i, i + len);
          const lowerSlice = slice.map((w) => w.toLowerCase());
          if (EN_STOP_WORDS.has(lowerSlice[0]) || EN_STOP_WORDS.has(lowerSlice[len - 1])) {
            continue;
          }
          if (lowerSlice.every((w) => EN_STOP_WORDS.has(w))) continue;
          if (len === 2 && EN_STOP_WORDS.has(lowerSlice[1])) continue;
          if (len === 3 && EN_STOP_WORDS.has(lowerSlice[1]) && lowerSlice[1] !== "of") {
            continue;
          }
          const phraseLower = lowerSlice.join(" ");
          if (phraseLower.length < 3) continue;
          if (speakerNameLower && lowerSlice.includes(speakerNameLower)) continue;
          if (opts.otherCharNames?.has(phraseLower)) continue;
          if (
            opts.target.id !== "special:sensei" &&
            (phraseLower === "sensei" || phraseLower === "teacher")
          ) {
            continue;
          }
          if (seenInLine.has(phraseLower)) continue;
          seenInLine.add(phraseLower);

          const display = slice.join(" ");
          const prev = docFreq.get(phraseLower);
          if (!prev) {
            docFreq.set(phraseLower, { count: 1, display, words: len });
          } else {
            prev.count++;
          }
        }
      }
    }

    const candidates = Array.from(docFreq.values()).filter(
      (c) => c.count >= minEnCount
    );
    if (candidates.length === 0) return undefined;

    const maxCount = Math.max(...candidates.map((c) => c.count));
    const minMultiCount = Math.max(minEnCount, Math.floor(maxCount * 0.75));
    const finalists = candidates.filter(
      (c) => c.count >= maxCount - 1 || (c.words >= 2 && c.count >= minMultiCount)
    );
    finalists.sort(
      (a, b) => b.words - a.words || b.count - a.count || b.display.length - a.display.length
    );
    return finalists[0]?.display;
  }

  const krLines = lines.map((l) => l.kr).filter(Boolean);
  if (krLines.length < 2) return undefined;
  const speakerKr = opts.speaker.name.kr.trim();

  const docFreq = new Map<string, { count: number; display: string; words: number }>();
  for (const rawLine of krLines) {
    const rawTokens = rawLine
      .replace(/[.,!?…"'\[\]()~]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    const cleanedTokens = rawTokens
      .map((t) => stripKrTrailingParticleForMining(t))
      .filter((t) => /[가-힣]{2,}/.test(t));

    const seenInLine = new Set<string>();
    for (let i = 0; i < cleanedTokens.length; i++) {
      for (let len = 1; len <= 2 && i + len <= cleanedTokens.length; len++) {
        const slice = cleanedTokens.slice(i, i + len);
        if (slice.some((w) => KR_STOP_WORDS.has(w))) continue;
        if (slice.some((w) => KR_VERB_CLAUSE_END_RE.test(w) && !KR_VOCATIVE_NOUN_END_RE.test(w))) {
          continue;
        }
        const phrase = slice.join(" ");
        if (phrase.length < 2) continue;
        if (speakerKr && slice.includes(speakerKr)) continue;
        if (opts.otherCharNames?.has(phrase)) continue;
        if (
          opts.target.id !== "special:sensei" &&
          (phrase === "선생님" || phrase === "선생")
        ) {
          continue;
        }
        if (seenInLine.has(phrase)) continue;
        seenInLine.add(phrase);
        const prev = docFreq.get(phrase);
        if (!prev) {
          docFreq.set(phrase, { count: 1, display: phrase, words: len });
        } else {
          prev.count++;
        }
      }
    }
  }

  const candidates = Array.from(docFreq.values()).filter((c) => c.count >= minCount);
  if (candidates.length === 0) return undefined;

  const maxCount = Math.max(...candidates.map((c) => c.count));
  const finalists = candidates.filter((c) => c.count >= maxCount - 1);
  finalists.sort(
    (a, b) => b.words - a.words || b.count - a.count || b.display.length - a.display.length
  );
  return finalists[0]?.display;
}

export interface CitationCandidate {
  line: DialogueLineRecord;
  matchedJpTerm: string;
  matchedKrTerm?: string;
  matchedEnTerm?: string;
  matchedJpTerms?: string[];
  matchedKrTerms?: string[];
  matchedEnTerms?: string[];
  enDropped?: boolean;
  hasKr: boolean;
  hasEn: boolean;
  hasUsernamePlaceholder?: boolean;
}

const STATIC_SOURCE_LABELS: Record<
  "momotalk" | "dialog",
  LocalizedText
> = {
  momotalk: { jp: "モモトーク", en: "MomoTalk", kr: "모모톡" },
  dialog: { jp: "ロビー・ボイス", en: "Lobby / Voice", kr: "로비 · 보이스" },
};

const FALLBACK_STORY_LABEL: LocalizedText = {
  jp: "ストーリー",
  en: "Story",
  kr: "스토리",
};

export function selectCitations(
  candidates: CitationCandidate[],
  storyLabels: Record<string, StoryLabelEntry>,
  maxCitations = 5
): QuoteCitation[] {
  if (candidates.length === 0) return [];

  const chosen: QuoteCitation[] = [];
  const usedRefs = new Set<string>();
  const usedJpTerms = new Set<string>();
  const usedKrTerms = new Set<string>();
  const usedEnTerms = new Set<string>();
  const usedSourceTypes = new Set<string>();

  const remaining = [...candidates];

  while (chosen.length < maxCitations && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestHasNewVariant = false;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      if (usedRefs.has(c.line.sourceRef)) continue;

      const hasNewJp = !usedJpTerms.has(c.matchedJpTerm);
      const hasNewKr = Boolean(c.matchedKrTerm && !usedKrTerms.has(c.matchedKrTerm));
      const hasNewEn = Boolean(c.matchedEnTerm && !usedEnTerms.has(c.matchedEnTerm));
      const hasNewVariant = hasNewJp || hasNewKr || hasNewEn;

      let score = 0;
      if (c.hasKr && (c.line.jpOnly || c.hasEn)) score += 45;
      else if (c.hasKr) score += 20;

      const len = c.line.jp.length;
      if (len >= 12 && len <= 130) score += 20;
      else if (len >= 6 && len <= 200) score += 8;

      if (hasNewJp) score += 32;
      if (hasNewKr) score += 28;
      if (hasNewEn) score += 28;
      if (
        c.hasUsernamePlaceholder &&
        /[○〇]|\[USERNAME\]/.test(c.matchedJpTerm)
      ) {
        score += 45;
      }
      if (!usedSourceTypes.has(c.line.sourceType)) score += 12;
      if (!c.line.jp.includes("[USERNAME]")) score += 3;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        bestHasNewVariant = hasNewVariant;
      }
    }

    if (bestIdx === -1) break;
    // After 3 quotes, only continue up to 5 if this quote introduces a new JP/KR/EN variant
    if (chosen.length >= 3 && !bestHasNewVariant) break;

    const picked = remaining.splice(bestIdx, 1)[0];
    usedRefs.add(picked.line.sourceRef);
    usedJpTerms.add(picked.matchedJpTerm);
    if (picked.matchedKrTerm) usedKrTerms.add(picked.matchedKrTerm);
    if (picked.matchedEnTerm) usedEnTerms.add(picked.matchedEnTerm);
    usedSourceTypes.add(picked.line.sourceType);

    let sourceLabel: LocalizedText;
    if (
      picked.line.sourceType === "momotalk" ||
      picked.line.sourceType === "dialog"
    ) {
      sourceLabel = STATIC_SOURCE_LABELS[picked.line.sourceType];
    } else if (
      picked.line.groupId &&
      storyLabels[String(picked.line.groupId)]
    ) {
      sourceLabel = storyLabels[String(picked.line.groupId)].sourceLabel;
    } else {
      sourceLabel = FALLBACK_STORY_LABEL;
    }

    chosen.push({
      sourceType: picked.line.sourceType,
      sourceLabel,
      sourceRef: picked.line.sourceRef,
      jp: picked.line.jp,
      kr: picked.line.kr,
      ...(picked.line.en ? { en: picked.line.en } : {}),
      matchedJpTerm: picked.matchedJpTerm,
      ...(picked.matchedKrTerm ? { matchedKrTerm: picked.matchedKrTerm } : {}),
      ...(picked.matchedEnTerm ? { matchedEnTerm: picked.matchedEnTerm } : {}),
    });
  }

  return chosen;
}

export function selectPerTermCitations(
  candidates: CitationCandidate[],
  storyLabels: Record<string, StoryLabelEntry>,
  perTermLimit = 3
): QuoteCitation[] {
  if (candidates.length === 0) return [];

  const getBuckets = (c: CitationCandidate): string[] => {
    const out: string[] = [];
    const jps = c.matchedJpTerms?.length ? c.matchedJpTerms : [c.matchedJpTerm];
    const krs = c.matchedKrTerms?.length
      ? c.matchedKrTerms
      : c.matchedKrTerm
        ? [c.matchedKrTerm]
        : [];
    const ens = c.matchedEnTerms?.length
      ? c.matchedEnTerms
      : c.matchedEnTerm
        ? [c.matchedEnTerm]
        : [];
    for (const t of jps) if (t) out.push(`jp:${t}`);
    for (const t of krs) if (t) out.push(`kr:${t}`);
    for (const t of ens) if (t) out.push(`en:${t}`);
    if (c.enDropped) out.push("en_omitted");
    return Array.from(new Set(out));
  };

  // Track up to `perTermLimit` quotes for every distinct JP, KR, EN, and omitted bucket
  const remainingQuota = new Map<string, number>();
  for (const c of candidates) {
    for (const b of getBuckets(c)) {
      if (!remainingQuota.has(b)) {
        remainingQuota.set(b, perTermLimit);
      }
    }
  }

  const chosen: QuoteCitation[] = [];
  const usedRefs = new Set<string>();
  const remaining = candidates.map((c) => ({ c, buckets: getBuckets(c) }));

  while (true) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i];
      const c = item.c;
      if (usedRefs.has(c.line.sourceRef)) continue;

      let neededCount = 0;
      for (const b of item.buckets) {
        if ((remainingQuota.get(b) ?? 0) > 0) neededCount++;
      }
      if (neededCount === 0) continue;

      let score = neededCount * 40;
      if (c.hasKr && (c.line.jpOnly || c.hasEn)) score += 30;
      else if (c.hasKr) score += 12;

      const len = c.line.jp.length;
      if (len >= 12 && len <= 130) score += 18;
      else if (len >= 6 && len <= 200) score += 6;

      if (
        c.hasUsernamePlaceholder &&
        item.buckets.some((b) => /[○〇]|\[USERNAME\]/.test(b))
      ) {
        score += 36;
      }
      if (
        c.line.sourceType === "main_story" ||
        c.line.sourceType === "event_story" ||
        c.line.sourceType === "bond_story"
      ) {
        score += 6;
      }
      if (!c.line.jp.includes("[USERNAME]")) score += 2;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const picked = remaining.splice(bestIdx, 1)[0];
    const c = picked.c;
    usedRefs.add(c.line.sourceRef);
    for (const b of picked.buckets) {
      const rem = remainingQuota.get(b) ?? 0;
      if (rem > 0) remainingQuota.set(b, rem - 1);
    }

    let sourceLabel: LocalizedText;
    if (
      c.line.sourceType === "momotalk" ||
      c.line.sourceType === "dialog"
    ) {
      sourceLabel = STATIC_SOURCE_LABELS[c.line.sourceType];
    } else if (
      c.line.groupId &&
      storyLabels[String(c.line.groupId)]
    ) {
      sourceLabel = storyLabels[String(c.line.groupId)].sourceLabel;
    } else {
      sourceLabel = FALLBACK_STORY_LABEL;
    }

    const jps = c.matchedJpTerms?.length ? c.matchedJpTerms : [c.matchedJpTerm];
    const krs = c.matchedKrTerms?.length
      ? c.matchedKrTerms
      : c.matchedKrTerm
        ? [c.matchedKrTerm]
        : [];
    const ens = c.matchedEnTerms?.length
      ? c.matchedEnTerms
      : c.matchedEnTerm
        ? [c.matchedEnTerm]
        : [];

    chosen.push({
      sourceType: c.line.sourceType,
      sourceLabel,
      sourceRef: c.line.sourceRef,
      jp: c.line.jp,
      kr: c.line.kr,
      ...(c.line.en ? { en: c.line.en } : {}),
      matchedJpTerm: jps[0],
      ...(krs[0] ? { matchedKrTerm: krs[0] } : {}),
      ...(ens[0] ? { matchedEnTerm: ens[0] } : {}),
      ...(jps.length > 1 ? { matchedJpTerms: jps } : {}),
      ...(krs.length > 1 ? { matchedKrTerms: krs } : {}),
      ...(ens.length > 1 ? { matchedEnTerms: ens } : {}),
    });
  }

  return chosen;
}

export function isDirectSecondPersonAddressee(
  gl: Array<{ speakerId: string; jp: string }>,
  idx: number,
  speakerId: string,
  targetId: string,
  maxDistance = 4
): boolean {
  let prevOtherSpeaker: string | undefined;
  for (let k = idx - 1; k >= Math.max(0, idx - maxDistance); k--) {
    const sp = gl[k].speakerId;
    if (sp === speakerId) continue;
    if (sp && sp !== "unknown") {
      prevOtherSpeaker = sp;
      break;
    }
  }
  if (prevOtherSpeaker === targetId) return true;

  let nextOtherSpeaker: string | undefined;
  for (let k = idx + 1; k <= Math.min(gl.length - 1, idx + maxDistance); k++) {
    const sp = gl[k].speakerId;
    if (sp === speakerId) continue;
    if (sp && sp !== "unknown") {
      nextOtherSpeaker = sp;
      break;
    }
  }
  return nextOtherSpeaker === targetId;
}

const EN_ACRONYMS = new Set([
  "CEO",
  "DJ",
  "CCC",
  "C&C",
  "FOX",
  "RABBIT",
  "GSC",
  "JTF",
  "PR",
  "SRT",
  "PS68",
]);

const LOWERCASE_PRONOUN_BUCKET = new Set([
  "you",
  "we",
  "us",
  "everyone",
  "everybody",
  "they",
  "them",
  "you two",
  "all of you",
  "you guys",
  "you all",
  "both of you",
  "the two of you",
]);

function hasAllCapsEmphasis(term: string): boolean {
  const words = term
    .split(/[\s-]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length >= 2);
  return words.some((w) => w === w.toUpperCase() && !EN_ACRONYMS.has(w));
}

export function normalizeEnCaseVariants(
  enCounts: Map<string, number>,
  candidates: CitationCandidate[]
): Map<string, number> {
  const buckets = new Map<string, Array<[string, number]>>();
  for (const [term, count] of enCounts.entries()) {
    const key = hasAllCapsEmphasis(term)
      ? `CAPS:${term}`
      : term.toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push([term, count]);
    buckets.set(key, list);
  }

  const remap = new Map<string, string>();
  const merged = new Map<string, number>();

  for (const [key, items] of buckets.entries()) {
    let canonical = items[0][0];
    let total = 0;
    for (const [, c] of items) total += c;

    if (!key.startsWith("CAPS:") && items.length > 1) {
      if (LOWERCASE_PRONOUN_BUCKET.has(key)) {
        const lowerMatch = items.find(([t]) => t === key);
        canonical = lowerMatch ? lowerMatch[0] : key;
      } else {
        const sorted = [...items].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
        );
        canonical = sorted[0][0];
      }
    }

    merged.set(canonical, (merged.get(canonical) ?? 0) + total);
    for (const [term] of items) {
      remap.set(term, canonical);
    }
  }

  for (const c of candidates) {
    if (c.matchedEnTerm && remap.has(c.matchedEnTerm)) {
      c.matchedEnTerm = remap.get(c.matchedEnTerm);
    }
    if (c.matchedEnTerms && c.matchedEnTerms.length > 0) {
      c.matchedEnTerms = uniqueOrdered(
        c.matchedEnTerms.map((t) => remap.get(t) ?? t)
      );
      if (c.matchedEnTerms[0]) {
        c.matchedEnTerm = c.matchedEnTerms[0];
      }
    }
  }

  return merged;
}

function toSortedTermVariants(
  counts: Map<string, number>,
  limit = 12
): TermVariant[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({
      term,
      count,
      source: "extracted" as const,
    }));
}

export async function extractMultilangAppellations(versions: {
  globalVersion: string;
  japanVersion: string;
}): Promise<{
  appellations: AppellationsOutput;
  zeroMatchPlayablePairs: Array<{
    id: string;
    jpTerms: string[];
    speakerLineCount: number;
  }>;
}> {
  const [charactersOut, seedOut, storyLabels] = await Promise.all([
    readJson<CharactersOutput>(path.join(DATA_OUTPUT_DIR, "characters.json")),
    readJson<JpAppellationsSeedOutput>(
      path.join(DATA_OUTPUT_DIR, "jp_appellations_seed.json")
    ),
    readJson<Record<string, StoryLabelEntry>>(STORY_LABELS_PATH),
  ]);

  const charById = new Map<string, Character>();
  for (const ch of charactersOut.characters) {
    charById.set(ch.id, ch);
  }

  const seedEntriesWithAutoSensei: Array<
    (typeof seedOut.entries)[number] & { autoSeeded?: boolean }
  > = [...seedOut.entries];

  const hasSenseiSeed = new Set(
    seedOut.entries
      .filter((e) => e.targetId === "special:sensei")
      .map((e) => e.speakerId)
  );
  const allSpeakerIds = new Set([
    ...seedOut.entries.map((e) => e.speakerId),
    ...charactersOut.characters
      .filter(
        (c) => c.kind === "student" || c.kind === "npc" || c.kind === "collab"
      )
      .map((c) => c.id),
  ]);

  for (const spId of allSpeakerIds) {
    if (hasSenseiSeed.has(spId)) continue;
    const sp = charById.get(spId);
    if (!sp) continue;
    seedEntriesWithAutoSensei.push({
      id: `${spId}->special:sensei`,
      speakerId: spId,
      speakerWikiruName: sp.name.jp,
      speakerWikiruAnchor: sp.wikiruAnchor ?? sp.id,
      targetId: "special:sensei",
      targetWikiruName: "先生",
      jpTerms: [{ term: "[USERNAME]先生" }, { term: "先生" }],
      autoSeeded: true,
    });
  }

  const cncSelfCallsigns: Record<string, string[]> = {
    toki: ["コールサイン04", "コールサインゼロフォー"],
    neru: ["ダブルオー"],
    asuna: ["コールサイン・ゼロワン"],
    karin: ["コールサインゼロツー"],
    akane: ["コールサイン・ゼロスリー", "コールサインゼロスリー"],
  };
  for (const [spId, csTerms] of Object.entries(cncSelfCallsigns)) {
    const existingSelf = seedEntriesWithAutoSensei.find(
      (e) => e.speakerId === spId && e.targetId === "special:self"
    );
    if (existingSelf) {
      for (const term of csTerms) {
        if (!existingSelf.jpTerms.some((t) => stripJpParens(t.term) === term)) {
          existingSelf.jpTerms.push({ term });
        }
      }
    } else {
      const sp = charById.get(spId);
      if (sp) {
        seedEntriesWithAutoSensei.push({
          id: `${spId}->special:self`,
          speakerId: spId,
          speakerWikiruName: sp.name.jp,
          speakerWikiruAnchor: sp.wikiruAnchor ?? sp.id,
          targetId: "special:self",
          targetWikiruName: "一人称",
          jpTerms: csTerms.map((term) => ({ term })),
          autoSeeded: true,
        });
      }
    }
  }

  // Merge manual supplemental seeds (e.g., GSC President & Fake GSC President pairs not on Wikiru yet)
  const supplementalPath = path.join(DATA_MANUAL_DIR, "supplemental_seeds.json");
  if (fs.existsSync(supplementalPath)) {
    const sup = JSON.parse(fs.readFileSync(supplementalPath, "utf8")) as {
      entries?: Array<{ speakerId: string; targetId: string; jpTerms: string[] }>;
    };
    for (const item of sup.entries ?? []) {
      const sp = charById.get(item.speakerId);
      const tg = charById.get(item.targetId);
      if (!sp || !tg) continue;
      const pairId = `${item.speakerId}->${item.targetId}`;
      const existing = seedEntriesWithAutoSensei.find((e) => e.id === pairId);
      if (existing) {
        if (pairId === "himari->special:self") {
          existing.jpTerms = existing.jpTerms.filter(
            (t) => t.term !== "他自己賛美多数"
          );
        }
        for (const term of item.jpTerms) {
          if (!existing.jpTerms.some((t) => stripJpParens(t.term) === term)) {
            existing.jpTerms.push({ term });
          }
        }
      } else {
        seedEntriesWithAutoSensei.push({
          id: pairId,
          speakerId: item.speakerId,
          speakerWikiruName: sp.name.jp,
          speakerWikiruAnchor: sp.wikiruAnchor ?? sp.id,
          targetId: item.targetId,
          targetWikiruName: tg.name.jp,
          jpTerms: item.jpTerms.map((term) => ({ term })),
          autoSeeded: true,
        });
      }
    }
  }

  const neededSpeakers = new Set(
    seedEntriesWithAutoSensei.map((e) => e.speakerId)
  );

  const speakerSelfBaseNeedles = new Map<string, Set<string>>();
  const speakerNonSelfBaseNeedles = new Map<string, Set<string>>();
  for (const seed of seedEntriesWithAutoSensei) {
    const targetMap =
      seed.targetId === "special:self"
        ? speakerSelfBaseNeedles
        : speakerNonSelfBaseNeedles;
    let set = targetMap.get(seed.speakerId);
    if (!set) {
      set = new Set<string>();
      targetMap.set(seed.speakerId, set);
    }
    for (const jt of seed.jpTerms) {
      const bare = stripJpParens(jt.term);
      if (bare) set.add(bare);
    }
  }
  const speakerHomographNeedles = new Map<string, Set<string>>();
  for (const spId of neededSpeakers) {
    const selfSet = speakerSelfBaseNeedles.get(spId);
    const nonSelfSet = speakerNonSelfBaseNeedles.get(spId);
    if (!selfSet || !nonSelfSet) continue;
    const overlap = new Set<string>();
    for (const n of selfSet) {
      if (nonSelfSet.has(n)) overlap.add(n);
    }
    if (overlap.size > 0) {
      speakerHomographNeedles.set(spId, overlap);
    }
  }
  const validCharTargets = charactersOut.characters.filter(
    (c) =>
      (c.kind === "student" || c.kind === "npc" || c.kind === "collab") &&
      c.id !== "npc:gsc_president" &&
      c.id !== "npc:gsc_president_false"
  );
  const validSpeakerIds = new Set(
    charactersOut.characters
      .filter(
        (c) => c.kind === "student" || c.kind === "npc" || c.kind === "collab"
      )
      .map((c) => c.id)
  );
  const existingSeedPairIds = new Set(
    seedEntriesWithAutoSensei.map((e) => e.id)
  );
  const autoTargetMatchers = validCharTargets
    .map((tg) => {
      const jpStems = uniqueOrdered([tg.fullName?.jp ?? "", tg.name.jp]).filter(
        (s) => s.length >= 2
      );
      const enFull = tg.fullName?.en?.trim() || "";
      const enGiven = tg.name.en.trim();
      const enPatterns: RegExp[] = [];
      if (enFull && enFull.includes(" ")) {
        enPatterns.push(new RegExp(`\\b${escapeRegExp(enFull)}\\b`, "i"));
        const parts = enFull.split(/\s+/);
        if (parts.length === 2) {
          enPatterns.push(
            new RegExp(`\\b${escapeRegExp(`${parts[1]} ${parts[0]}`)}\\b`, "i")
          );
        }
      }
      if (
        enGiven.length >= 3 &&
        !/^(?:president|chairman|chairwoman|boss|master|leader|captain|director|professor|doctor|sister|sensei|teacher|advisor|instructor|black|white|blue|red|member|student|guard|maid|admin|other)$/i.test(
          enGiven
        )
      ) {
        enPatterns.push(new RegExp(`\\b${escapeRegExp(enGiven)}\\b`, "i"));
      }
      if (jpStems.length === 0 || enPatterns.length === 0) return null;
      const jpSurfaceRe = new RegExp(
        `(?:${jpStems.map(escapeRegExp).join("|")})(?:さん|ちゃん|くん|君|様|殿|先輩|先生|社長|議長|委員長|会長|部長)?`,
        "g"
      );
      return { tg, jpStems, enPatterns, jpSurfaceRe };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const linesBySpeaker = new Map<string, DialogueLineRecord[]>();
  const groupLinesMap = new Map<
    number,
    Array<{ speakerId: string; jp: string; kr: string; en?: string }>
  >();
  const lineSceneIdx = new WeakMap<DialogueLineRecord, number>();

  const rl = readline.createInterface({
    input: fs.createReadStream(DIALOGUE_INDEX_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const discoveredSeeds = new Map<
    string,
    { speakerId: string; target: Character; jpTerms: Set<string> }
  >();

  for await (const rawLine of rl) {
    if (!rawLine) continue;
    const rec = JSON.parse(rawLine) as DialogueLineRecord;
    if (rec.groupId !== undefined) {
      let gl = groupLinesMap.get(rec.groupId);
      if (!gl) {
        gl = [];
        groupLinesMap.set(rec.groupId, gl);
      }
      const idx = gl.length;
      gl.push({
        speakerId: rec.speakerId,
        jp: rec.jp,
        kr: rec.kr,
        ...(rec.en ? { en: rec.en } : {}),
      });
      if (validSpeakerIds.has(rec.speakerId)) {
        lineSceneIdx.set(rec, idx);
      }
    }
    if (!validSpeakerIds.has(rec.speakerId)) continue;
    let list = linesBySpeaker.get(rec.speakerId);
    if (!list) {
      list = [];
      linesBySpeaker.set(rec.speakerId, list);
    }
    list.push(rec);

    // Auto-discover unseeded speaker->target pairs when both JP and EN name match
    if (rec.en && !rec.jpOnly) {
      for (const m of autoTargetMatchers) {
        if (m.tg.id === rec.speakerId) continue;
        const pairId = `${rec.speakerId}->${m.tg.id}`;
        if (existingSeedPairIds.has(pairId)) continue;
        if (
          m.tg.id === "shiroko" &&
          /テラー|＊|クロコ|Terror/i.test(`${rec.jp} ${rec.en}`)
        ) {
          continue;
        }
        if (
          m.tg.id === "shiroko_terror" &&
          !/テラー|Terror/i.test(`${rec.jp} ${rec.en}`)
        ) {
          continue;
        }
        if (!m.jpStems.some((js) => rec.jp.includes(js))) continue;
        if (!m.enPatterns.some((re) => re.test(rec.en!))) continue;

        const hits = rec.jp.match(m.jpSurfaceRe);
        if (!hits || hits.length === 0) continue;
        let entry = discoveredSeeds.get(pairId);
        if (!entry) {
          entry = {
            speakerId: rec.speakerId,
            target: m.tg,
            jpTerms: new Set<string>(),
          };
          discoveredSeeds.set(pairId, entry);
        }
        for (const h of hits) entry.jpTerms.add(h);
      }
    }
  }

  for (const [pairId, info] of discoveredSeeds) {
    const sp = charById.get(info.speakerId);
    if (!sp || info.jpTerms.size === 0) continue;
    existingSeedPairIds.add(pairId);
    seedEntriesWithAutoSensei.push({
      id: pairId,
      speakerId: info.speakerId,
      speakerWikiruName: sp.name.jp,
      speakerWikiruAnchor: sp.wikiruAnchor ?? sp.id,
      targetId: info.target.id,
      targetWikiruName: info.target.name.jp,
      jpTerms: Array.from(info.jpTerms).map((term) => ({ term })),
      autoSeeded: true,
    });
  }
  console.log(`     auto-discovered unseeded pairs: ${discoveredSeeds.size}`);

  const entityMemberIds = new Map<string, Set<string>>();
  for (const ent of charactersOut.characters) {
    if (ent.kind !== "entity") continue;
    const entJpTerms = new Set(
      [ent.name.jp, ...(ent.aliases?.jp ?? [])]
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
    );
    const members = new Set<string>();
    for (const ch of charactersOut.characters) {
      if (ch.kind === "entity" || ch.kind === "special") continue;
      const clubJp = ch.club ? charactersOut.clubs[ch.club]?.jp?.trim() : "";
      const schoolJp = ch.school ? charactersOut.schools[ch.school]?.jp?.trim() : "";
      if ((clubJp && entJpTerms.has(clubJp)) || (schoolJp && entJpTerms.has(schoolJp))) {
        members.add(ch.id);
      }
    }
    if (members.size > 0) {
      entityMemberIds.set(ent.id, members);
    }
  }

  const GENERIC_ROLE_EN = new Set([
    "president",
    "general",
    "boss",
    "master",
    "leader",
    "captain",
    "director",
    "professor",
    "doctor",
    "sister",
    "sensei",
    "teacher",
    "advisor",
    "instructor",
    "chairman",
    "chairwoman",
  ]);
  const GENERIC_ROLE_KR = new Set([
    "회장",
    "총학생회장",
    "대장",
    "부장",
    "선생님",
    "선생",
    "교수",
    "박사",
    "리더",
    "보스",
    "의장",
  ]);
  const allProperEnNames = new Set<string>();
  const allProperKrNames = new Set<string>();
  for (const ch of charactersOut.characters) {
    if (ch.kind !== "student" && ch.kind !== "npc") continue;
    const enLow = ch.name.en.trim().toLowerCase();
    if (enLow.length >= 2 && !GENERIC_ROLE_EN.has(enLow)) {
      allProperEnNames.add(enLow);
    }
    const krTrim = ch.name.kr.trim();
    if (krTrim.length >= 2 && !GENERIC_ROLE_KR.has(krTrim)) {
      allProperKrNames.add(krTrim);
    }
  }

  const isTargetPresentInScene = (
    line: DialogueLineRecord,
    target: Character,
    ambiguity: JpTermAmbiguity,
    matchedTerm: string,
    specificEntityNeedles: string[] = []
  ): boolean => {
    if (
      target.id === "special:sensei" &&
      AMBIGUOUS_PRONOUNS.has(stripJpParens(matchedTerm)) &&
      !THIRD_PERSON_PRONOUNS.has(matchedTerm)
    ) {
      if (line.jp.includes("先生")) return false;
      if (
        line.speakerId === "hina" &&
        /(?:^|[\s,'"])너(?:는|가|를|도|의|에게|한테|와|랑)?(?![가-힣])/.test(
          line.kr
        )
      ) {
        return false;
      }
      for (const ch of charactersOut.characters) {
        if (
          ch.id !== line.speakerId &&
          ch.kind !== "special" &&
          ch.fullName?.jp &&
          ch.fullName.jp.length >= 4 &&
          line.jp.includes(ch.fullName.jp)
        ) {
          return false;
        }
      }
      if (line.sourceType === "momotalk" || line.sourceType === "dialog") {
        return true;
      }
      if (line.groupId === undefined) return false;
      const glSensei = groupLinesMap.get(line.groupId);
      const idxSensei = lineSceneIdx.get(line);
      if (!glSensei || idxSensei === undefined) return false;
      return isDirectSecondPersonAddressee(
        glSensei,
        idxSensei,
        line.speakerId,
        "special:sensei"
      );
    }
    if (ambiguity === "specific") return true;
    if (line.sourceType === "momotalk" || line.sourceType === "dialog") {
      return false;
    }
    if (line.groupId === undefined) return false;
    const gl = groupLinesMap.get(line.groupId);
    if (!gl || gl.length === 0) return false;

    const targetNamesJp = Array.from(
      new Set([target.name.jp, ...target.aliases.jp].filter((n) => n.length >= 2))
    );

    const idx = lineSceneIdx.get(line);
    if (idx === undefined) return false;

    if (ambiguity === "generic_title") {
      if (matchedTerm === "先生" && line.jp.includes("シャーレの先生")) {
        return false;
      }
      if (isDirectSecondPersonAddressee(gl, idx, line.speakerId, target.id, 2)) {
        return true;
      }
      if (matchedTerm === "先生") return false;
      const win = matchedTerm === "チビ" ? 3 : 2;
      const start = Math.max(0, idx - win);
      const end = Math.min(gl.length - 1, idx + win);
      for (let k = start; k <= end; k++) {
        if (targetNamesJp.some((n) => gl[k].jp.includes(n))) {
          return true;
        }
      }
      return false;
    }

    // ambiguity === "pronoun"
    if (line.jp.includes("先生")) return false;

    if (target.kind === "entity") {
      const entityNeedles = Array.from(
        new Set([...targetNamesJp, ...specificEntityNeedles].filter((n) => n.length >= 2))
      );
      const members = entityMemberIds.get(target.id);
      const start = Math.max(0, idx - 6);
      const end = Math.min(gl.length - 1, idx + 6);
      for (let k = start; k <= end; k++) {
        if (k !== idx && gl[k].speakerId !== line.speakerId && members?.has(gl[k].speakerId)) {
          return true;
        }
        if (entityNeedles.some((n) => gl[k].jp.includes(n))) {
          return true;
        }
      }
      return false;
    }

    const isThirdPerson = THIRD_PERSON_PRONOUNS.has(matchedTerm);
    if (!isThirdPerson) {
      return isDirectSecondPersonAddressee(gl, idx, line.speakerId, target.id);
    }

    const start = Math.max(0, idx - 8);
    const end = Math.min(gl.length - 1, idx + 8);
    for (let k = start; k <= end; k++) {
      if (gl[k].speakerId === target.id) return true;
      if (targetNamesJp.some((n) => gl[k].jp.includes(n))) {
        return true;
      }
    }
    return false;
  };

  const autoEpithets = loadAutoEpithets();
  const entries: AppellationEntry[] = [];
  const zeroMatchPlayablePairs: Array<{
    id: string;
    jpTerms: string[];
    speakerLineCount: number;
  }> = [];

  for (const seed of seedEntriesWithAutoSensei) {
    const speaker = charById.get(seed.speakerId);
    const target = charById.get(seed.targetId);
    if (!speaker || !target) continue;

    const speakerLines = linesBySpeaker.get(seed.speakerId) ?? [];
    const seedTermStrings = seed.jpTerms.map((t) => t.term);
    const pairEpithets = autoEpithets.pairs[seed.id] ?? {};
    const globalEpithets = autoEpithets.global ?? {};
    const termAmbiguity = new Map<string, JpTermAmbiguity>();
    for (const t of seedTermStrings) {
      termAmbiguity.set(t, classifyJpTermAmbiguity(t, target));
    }
    const specificEntityNeedles: string[] = [];
    if (target.kind === "entity") {
      for (const t of seedTermStrings) {
        const bare = stripJpParens(t);
        if (
          bare.length >= 2 &&
          termAmbiguity.get(t) === "specific" &&
          !GENERIC_TITLES.has(bare)
        ) {
          specificEntityNeedles.push(bare);
          const stripped = bare
            .replace(/フッド$/, "")
            .replace(/(?:開発部|研究部|研究会|委員会|制作部|スクワッド|団|組)$/, "")
            .trim();
          if (stripped.length >= 3) specificEntityNeedles.push(stripped);
        }
      }
    }

    const jpCounts = new Map<string, number>();
    const krCounts = new Map<string, number>();
    const enCounts = new Map<string, number>();
    const matchedKrLinesForSpeech: string[] = [];
    const citationCandidates: CitationCandidate[] = [];

    let matchedLineCount = 0;
    let enEligibleLineCount = 0;
    let droppedCount = 0;

    const speakerHomographs = speakerHomographNeedles.get(seed.speakerId);
    for (const line of speakerLines) {
      const rawMatchedJp = findMatchedJpTerms(
        line.jp,
        seedTermStrings,
        target.id === "special:you",
        target.kind === "entity"
      );
      if (rawMatchedJp.length === 0) continue;

      const matchedJp = rawMatchedJp.filter(
        (jt) =>
          !(
            stripJpParens(jt) === "委員長" &&
            target.id !== "hina" &&
            /風紀委員長/.test(line.jp) &&
            !line.jp.includes(target.name.jp)
          ) &&
          isTargetPresentInScene(
            line,
            target,
            termAmbiguity.get(jt) ?? "specific",
            jt,
            specificEntityNeedles
          ) &&
          matchesShirokoVariantScene(
            line,
            target.id,
            jt,
            line.groupId !== undefined ? groupLinesMap.get(line.groupId) : undefined,
            lineSceneIdx.get(line)
          ) &&
          matchesGscPresidentScene(
            line,
            target.id,
            jt,
            line.groupId !== undefined ? groupLinesMap.get(line.groupId) : undefined
          ) &&
          matchesDecagrammatonAnokata(line, target.id, jt) &&
          matchesHomographPronounDirection(
            line,
            target.id,
            jt,
            Boolean(speakerHomographs?.has(stripJpParens(jt)))
          )
      );
      if (matchedJp.length === 0) continue;

      matchedLineCount++;
      for (const jt of matchedJp) {
        jpCounts.set(jt, (jpCounts.get(jt) ?? 0) + 1);
      }
      matchedKrLinesForSpeech.push(line.kr);

      const extraKrTerms: string[] = [];
      const extraEnTerms: string[] = [];
      for (const jt of matchedJp) {
        const pMap = pairEpithets[jt];
        const gMap = globalEpithets[jt];
        if (pMap?.kr) extraKrTerms.push(...pMap.kr);
        if (gMap?.kr) extraKrTerms.push(...gMap.kr);
        if (pMap?.en) extraEnTerms.push(...pMap.en);
        if (gMap?.en) extraEnTerms.push(...gMap.en);
      }

      const ctx: ExtractionContext = {
        speaker,
        target,
        matchedJpTerms: matchedJp,
        jpLine: line.jp,
        ...(extraKrTerms.length > 0 ? { extraKrTerms: uniqueOrdered(extraKrTerms) } : {}),
        ...(extraEnTerms.length > 0 ? { extraEnTerms: uniqueOrdered(extraEnTerms) } : {}),
      };
      let krExtracted = extractKrAppellations(line.kr, ctx);
      let enExtracted =
        line.en && !line.jpOnly ? extractEnAppellations(line.en, ctx) : [];

      if (target.id !== "special:self") {
        const voc = extractStandaloneVocative(
          line,
          matchedJp,
          krExtracted,
          enExtracted,
          target
        );
        if (voc.kr && !krExtracted.includes(voc.kr)) {
          const supersedesExisting =
            krExtracted.length > 0 &&
            krExtracted.every((k) => voc.kr!.includes(k) && voc.kr!.length > k.length);
          krExtracted = supersedesExisting ? [voc.kr] : [...krExtracted, voc.kr];
        }
        if (voc.en && line.en && !line.jpOnly && !enExtracted.includes(voc.en)) {
          const supersedesExisting =
            enExtracted.length > 0 &&
            enExtracted.every(
              (e) =>
                voc.en!.toLowerCase().includes(e.toLowerCase()) &&
                voc.en!.length > e.length
            );
          enExtracted = supersedesExisting ? [voc.en] : [...enExtracted, voc.en];
        }
      }

      for (const kt of krExtracted) {
        krCounts.set(kt, (krCounts.get(kt) ?? 0) + 1);
      }

      let hasEn = false;
      let matchedEnTerm: string | undefined;
      if (line.en && !line.jpOnly) {
        enEligibleLineCount++;
        if (enExtracted.length > 0) {
          hasEn = true;
          matchedEnTerm = enExtracted[0];
          for (const et of enExtracted) {
            enCounts.set(et, (enCounts.get(et) ?? 0) + 1);
          }
        } else if (target.id !== "special:self") {
          droppedCount++;
        }
      }

      citationCandidates.push({
        line,
        matchedJpTerm: matchedJp[0],
        ...(krExtracted[0] ? { matchedKrTerm: krExtracted[0] } : {}),
        ...(matchedEnTerm ? { matchedEnTerm } : {}),
        matchedJpTerms: matchedJp,
        matchedKrTerms: krExtracted,
        matchedEnTerms: enExtracted,
        enDropped: Boolean(
          line.en &&
            !line.jpOnly &&
            !hasEn &&
            target.id !== "special:self"
        ),
        hasKr: krExtracted.length > 0,
        hasEn,
        hasUsernamePlaceholder:
          line.jp.includes("[USERNAME]") ||
          line.kr.includes("[USERNAME]") ||
          Boolean(line.en?.includes("[USERNAME]")),
      });
    }

    if (
      target.id !== "special:self" &&
      target.id !== "special:sensei" &&
      citationCandidates.length >= 2
    ) {
      const targetOwnEnLower = new Set(
        [target.name.en, target.fullName?.en ?? "", ...target.aliases.en]
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
      const targetOwnKr = new Set(
        [target.name.kr, target.fullName?.kr ?? "", ...target.aliases.kr]
          .map((s) => s.trim())
          .filter(Boolean)
      );
      const otherCharEnNames = new Set(
        Array.from(allProperEnNames).filter((n) => !targetOwnEnLower.has(n))
      );
      const otherCharKrNames = new Set(
        Array.from(allProperKrNames).filter((n) => !targetOwnKr.has(n))
      );
      const SKIP_MINING_TERMS = new Set([
        "あの方", "この方", "あの人", "この人", "皆さん", "皆様", "みんな",
        "門主", "門主様", "門主さん",
      ]);
      for (const jpTerm of seedTermStrings) {
        const amb = termAmbiguity.get(jpTerm);
        if (amb === "pronoun" || amb === "generic_title") continue;
        const bareJp = stripJpParens(jpTerm);
        if (SKIP_MINING_TERMS.has(bareJp)) continue;
        const bareNoHon = bareJp.replace(
          /(?:ちゃん|さん|様|くん|君|先輩|殿|氏|たん|ちん|っち)$/,
          ""
        );
        const isTargetOwnPlainName =
          bareJp === target.name.jp ||
          bareJp === target.fullName?.jp ||
          target.aliases.jp.includes(bareJp) ||
          bareNoHon === target.name.jp ||
          bareNoHon === target.fullName?.jp ||
          target.aliases.jp.includes(bareNoHon);

        const termCites = citationCandidates.filter((c) =>
          c.matchedJpTerms?.includes(jpTerm)
        );
        const noKrCites = termCites.filter((c) => !c.hasKr);
        if (noKrCites.length >= 2 && !(isTargetOwnPlainName && krCounts.size > 0)) {
          const minedKr = mineSharedPhrasesForJpTerm(
            noKrCites.map((c) => c.line),
            "kr",
            { speaker, target, otherCharNames: otherCharKrNames }
          );
          if (minedKr) {
            const krRe = new RegExp(
              `(?<![가-힣])${escapeRegExp(minedKr)}${KR_PARTICLE_LOOKAHEAD}`
            );
            for (const c of noKrCites) {
              if (krRe.test(c.line.kr)) {
                c.hasKr = true;
                c.matchedKrTerm = minedKr;
                c.matchedKrTerms = uniqueOrdered([
                  ...(c.matchedKrTerms ?? []),
                  minedKr,
                ]);
                krCounts.set(minedKr, (krCounts.get(minedKr) ?? 0) + 1);
              }
            }
          }
        }

        const noEnCites = termCites.filter(
          (c) => Boolean(c.line.en && !c.line.jpOnly && !c.hasEn)
        );
        if (noEnCites.length >= 2 && !(isTargetOwnPlainName && enCounts.size > 0)) {
          const minedEn = mineSharedPhrasesForJpTerm(
            noEnCites.map((c) => c.line),
            "en",
            { speaker, target, otherCharNames: otherCharEnNames }
          );
          if (minedEn) {
            const enRe = new RegExp(`\\b${escapeRegExp(minedEn)}\\b`, "i");
            for (const c of noEnCites) {
              const m = normalizeEnStutters(c.line.en ?? "").match(enRe);
              if (m) {
                const matchedForm = m[0].replace(/\s+/g, " ").trim();
                c.hasEn = true;
                c.enDropped = false;
                c.matchedEnTerm = matchedForm;
                c.matchedEnTerms = uniqueOrdered([
                  ...(c.matchedEnTerms ?? []),
                  matchedForm,
                ]);
                enCounts.set(matchedForm, (enCounts.get(matchedForm) ?? 0) + 1);
                droppedCount = Math.max(0, droppedCount - 1);
              }
            }
          }
        }
      }
    }

    if (seed.autoSeeded && matchedLineCount === 0) {
      continue;
    }

    const jpVariants: TermVariant[] = seed.jpTerms
      .filter((t) => !seed.autoSeeded || (jpCounts.get(t.term) ?? 0) > 0)
      .map((t) => ({
        term: t.term,
        count: jpCounts.get(t.term) ?? 0,
        ...(t.notes ? { notes: t.notes } : {}),
        ...(t.contextTags ? { contextTags: t.contextTags } : {}),
        source: seed.autoSeeded ? ("extracted" as const) : ("wikiru" as const),
      }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

    const normalizedEnCounts = normalizeEnCaseVariants(
      enCounts,
      citationCandidates
    );
    const termLimit = target.id === "special:self" ? 60 : 12;
    const krTerms = toSortedTermVariants(krCounts, termLimit);
    const enTerms = toSortedTermVariants(normalizedEnCounts, termLimit);

    const speech =
      target.id === "special:self"
        ? { speechLevel: "unknown" as const, counts: { formal: 0, polite: 0, casual: 0 } }
        : classifyKrSpeechLevel(matchedKrLinesForSpeech);

    const citations = selectPerTermCitations(citationCandidates, storyLabels, 3);

    {
      const lineByRef = new Map<string, DialogueLineRecord>();
      for (const c of citationCandidates) {
        lineByRef.set(c.line.sourceRef, c.line);
      }
      for (const cit of citations) {
        if (cit.sourceType === "momotalk" || cit.sourceType === "dialog") {
          continue;
        }
        const srcLine = lineByRef.get(cit.sourceRef);
        if (!srcLine || srcLine.groupId === undefined) continue;
        const idx = lineSceneIdx.get(srcLine);
        const gl = groupLinesMap.get(srcLine.groupId);
        if (idx === undefined || !gl) continue;

        const before: QuoteContextLine[] = [];
        for (let k = Math.max(0, idx - 2); k < idx; k++) {
          before.push({
            speakerId: gl[k].speakerId,
            jp: gl[k].jp,
            kr: gl[k].kr,
            ...(gl[k].en ? { en: gl[k].en } : {}),
          });
        }
        const after: QuoteContextLine[] = [];
        if (idx + 1 < gl.length) {
          after.push({
            speakerId: gl[idx + 1].speakerId,
            jp: gl[idx + 1].jp,
            kr: gl[idx + 1].kr,
            ...(gl[idx + 1].en ? { en: gl[idx + 1].en } : {}),
          });
        }
        if (before.length > 0) cit.contextBefore = before;
        if (after.length > 0) cit.contextAfter = after;
      }
    }

    let status: AppellationEntry["status"];
    if (matchedLineCount === 0) {
      status =
        !speaker.released.global && (speaker.kind === "student" || speaker.kind === "collab")
          ? "en_pending"
          : "jp_only_seed";
    } else if (enEligibleLineCount === 0) {
      status = "en_pending";
    } else {
      status = "verified";
    }

    if (
      matchedLineCount === 0 &&
      (speaker.kind === "student" || speaker.kind === "collab") &&
      (target.kind === "student" || target.kind === "special") &&
      speakerLines.length > 0
    ) {
      zeroMatchPlayablePairs.push({
        id: seed.id,
        jpTerms: seedTermStrings,
        speakerLineCount: speakerLines.length,
      });
    }

    entries.push({
      id: seed.id,
      speakerId: seed.speakerId,
      targetId: seed.targetId,
      status,
      jp: jpVariants,
      kr: {
        terms: krTerms,
        speechLevel: speech.speechLevel,
        ...(speech.speechLevel !== "unknown"
          ? { speechLevelCounts: speech.counts }
          : {}),
      },
      en: {
        terms: enTerms,
        droppedCount,
      },
      matchedLineCount,
      citationCount: citations.length,
      citations,
    });
  }

  // Deterministic ordering
  const targetRank = (id: string) =>
    id === "special:self" ? 0 : id === "special:sensei" ? 1 : 2;
  entries.sort((a, b) => {
    const spCmp = a.speakerId.localeCompare(b.speakerId);
    if (spCmp !== 0) return spCmp;
    const rankDiff = targetRank(a.targetId) - targetRank(b.targetId);
    if (rankDiff !== 0) return rankDiff;
    return a.targetId.localeCompare(b.targetId);
  });

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
    appellations: {
      meta: {
        generatedAt: new Date().toISOString(),
        globalVersion: versions.globalVersion,
        japanVersion: versions.japanVersion,
        totalPairs: entries.length,
        statusCounts,
      },
      entries,
    },
    zeroMatchPlayablePairs: zeroMatchPlayablePairs.slice(0, 40),
  };
}
