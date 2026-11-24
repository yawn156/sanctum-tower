import * as cheerio from "cheerio";
import type {
  BuildReport,
  Character,
  CharacterKind,
  FootnoteGlossary,
  JpAppellationSeedEntry,
  JpSeedTerm,
  NpcCuratedEntry,
  NpcRosterConfig,
  WikiruAliasesConfig,
} from "../types.js";

export interface ParsedWikiruTerm {
  term: string;
  rawFootnote?: string;
}

export interface ParsedWikiruRow {
  targetName: string;
  targetAnchor?: string;
  terms: ParsedWikiruTerm[];
}

export interface ParsedWikiruTable {
  schoolJp: string;
  clubJp: string;
  speakerName: string;
  speakerAnchor: string;
  speakerIconPath?: string;
  rows: ParsedWikiruRow[];
}

export interface ParsedWikiruPage {
  tables: ParsedWikiruTable[];
  footnotes: Record<string, string>;
  sectionAnchors: Set<string>;
}

function cleanHeadingText(el: cheerio.Cheerio<any>): string {
  const clone = el.clone();
  clone.find("a.anchor_super").remove();
  return clone
    .text()
    .replace(/†/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFootnotes($: cheerio.CheerioAPI): Record<string, string> {
  const notes: Record<string, string> = {};
  const noteContainer = $("#note");
  if (noteContainer.length === 0) return notes;

  noteContainer.find('a[id^="notefoot_"]').each((_idx, el) => {
    const id = $(el).attr("id");
    if (!id) return;

    let text = "";
    let cur = el.nextSibling;
    while (cur) {
      if (cur.type === "tag") {
        const tagName = cur.tagName?.toLowerCase();
        if (tagName === "br") break;
        if (
          tagName === "a" &&
          typeof cur.attribs?.id === "string" &&
          cur.attribs.id.startsWith("notefoot_")
        ) {
          break;
        }
        text += $(cur).text();
      } else if (cur.type === "text") {
        text += cur.data ?? "";
      }
      cur = cur.nextSibling;
    }

    const cleaned = text.replace(/\s+/g, " ").trim();
    if (cleaned) {
      notes[id] = cleaned;
    }
  });

  return notes;
}

export function parseWikiruHtml(html: string): ParsedWikiruPage {
  const $ = cheerio.load(html);
  const footnotes = extractFootnotes($);
  const candidates =
    $("#body").length > 0
      ? $("#body").find("h2, h3, h4, table.style_table")
      : $("h2, h3, h4, table.style_table");

  let currentSchoolJp = "";
  let currentClubJp = "";
  let pendingSpeakerName = "";
  let pendingSpeakerAnchor = "";

  const tables: ParsedWikiruTable[] = [];
  const sectionAnchors = new Set<string>();

  candidates.each((_idx, el) => {
    const tag = el.tagName.toLowerCase();
    const $el = $(el);

    if (tag === "h2") {
      currentSchoolJp = cleanHeadingText($el);
      const secId = $el.find("a.anchor_super[id]").first().attr("id")?.trim();
      if (secId) sectionAnchors.add(secId);
      currentClubJp = "";
      pendingSpeakerName = "";
      pendingSpeakerAnchor = "";
      return;
    }

    if (tag === "h3") {
      currentClubJp = cleanHeadingText($el);
      const secId = $el.find("a.anchor_super[id]").first().attr("id")?.trim();
      if (secId) sectionAnchors.add(secId);
      pendingSpeakerName = "";
      pendingSpeakerAnchor = "";
      return;
    }

    if (tag === "h4") {
      pendingSpeakerName = cleanHeadingText($el);
      pendingSpeakerAnchor =
        $el.find("a.anchor_super[id]").first().attr("id")?.trim() ?? "";
      return;
    }

    if (tag === "table") {
      const ths = $el
        .find("thead th")
        .map((_i, th) => $(th).text().trim())
        .get();
      if (
        !ths.includes("キャラクター") ||
        !ths.includes("相手") ||
        !ths.includes("呼称")
      ) {
        return;
      }

      let speakerName = pendingSpeakerName;
      const speakerAnchor = pendingSpeakerAnchor;
      let speakerIconPath: string | undefined;
      const rows: ParsedWikiruRow[] = [];

      $el.find("tbody tr").each((_rowIdx, tr) => {
        const tds = $(tr).children("td");
        let targetTd: cheerio.Cheerio<any>;
        let termTd: cheerio.Cheerio<any>;

        if (tds.length >= 3) {
          const speakerTd = tds.eq(0);
          const links = speakerTd.find("a");
          const linkText =
            links.length > 0
              ? links.last().text().trim()
              : speakerTd.text().trim();
          if (linkText) {
            speakerName = linkText;
          }
          const img = speakerTd.find("img").first();
          const imgSrc = (img.attr("data-src") || img.attr("src") || "").trim();
          const imgAlt = (img.attr("alt") || "").trim();
          if (imgSrc.startsWith("attach2/") && !imgAlt.includes("準備中")) {
            speakerIconPath = imgSrc;
          }
          targetTd = tds.eq(1);
          termTd = tds.eq(2);
        } else if (tds.length === 2) {
          targetTd = tds.eq(0);
          termTd = tds.eq(1);
        } else {
          return;
        }

        const targetClone = targetTd.clone();
        targetClone.find("a.note_super").remove();
        const rawHref =
          targetClone.find('a[href^="#"]').first().attr("href") ?? "";
        const targetAnchor = rawHref.startsWith("#")
          ? decodeURIComponent(rawHref.slice(1)).trim()
          : undefined;
        const targetName = targetClone.text().replace(/\s+/g, " ").trim();
        if (!targetName) return;

        const termHtml = termTd.html() ?? "";
        const segments = termHtml.split(/<br\b[^>]*\/?>/i);
        const terms: ParsedWikiruTerm[] = [];

        for (const seg of segments) {
          if (!seg.trim()) continue;
          const $seg = cheerio.load(`<div>${seg}</div>`);
          const noteTexts: string[] = [];

          $seg("a.note_super").each((_nIdx, a) => {
            const $a = $seg(a);
            const href = $a.attr("href") ?? "";
            const footId = href.startsWith("#") ? href.slice(1) : "";
            const title = $a.attr("title")?.trim() ?? "";
            const resolved = (footId && footnotes[footId]) || title;
            if (resolved) noteTexts.push(resolved);
            $a.remove();
          });

          const termText = $seg("div")
            .text()
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!termText) continue;

          const rawFootnote =
            noteTexts.length > 0 ? noteTexts.join("; ") : undefined;
          terms.push({
            term: termText,
            ...(rawFootnote ? { rawFootnote } : {}),
          });
        }

        if (terms.length > 0) {
          rows.push({
            targetName,
            ...(targetAnchor ? { targetAnchor } : {}),
            terms,
          });
        }
      });

      if (speakerName && rows.length > 0) {
        tables.push({
          schoolJp: currentSchoolJp,
          clubJp: currentClubJp,
          speakerName,
          speakerAnchor,
          ...(speakerIconPath ? { speakerIconPath } : {}),
          rows,
        });
      }
    }
  });

  return { tables, footnotes, sectionAnchors };
}

export function normalizeJpName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\s\u3000\u00b7・･＊*]/g, "")
    .toLowerCase();
}

function toSafeSlug(input: string): string {
  const ascii = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (ascii.length >= 2) return ascii;
  // Fallback deterministic hex slug for non-ASCII names without anchor
  const hex = Buffer.from(input, "utf8").toString("hex").slice(0, 12);
  return `jp_${hex}`;
}

const SPECIAL_JP_TARGETS: Record<string, string> = {
  自分: "special:self",
  一人称: "special:self",
  先生: "special:sensei",
  二人称: "special:you",
};

export interface ResolveWikiruParams {
  parsed: ParsedWikiruPage;
  baseCharacters: Character[];
  npcRoster: NpcRosterConfig;
  wikiruAliases: WikiruAliasesConfig;
  footnoteGlossary: FootnoteGlossary;
}

export interface ResolveWikiruResult {
  characters: Character[];
  seedEntries: JpAppellationSeedEntry[];
  wikiruReport: BuildReport["wikiru"];
  npcIconUrls: Record<string, string>;
}

export function resolveWikiruToRoster(
  params: ResolveWikiruParams
): ResolveWikiruResult {
  const { parsed, baseCharacters, npcRoster, wikiruAliases, footnoteGlossary } =
    params;

  const characters = baseCharacters.map((c) => ({
    ...c,
    aliases: {
      jp: [...c.aliases.jp],
      kr: [...c.aliases.kr],
      en: [...c.aliases.en],
    },
  }));

  const byId = new Map<string, Character>();
  const byJpExact = new Map<string, Character>();
  const byJpNorm = new Map<string, Character>();
  const byIdLower = new Map<string, Character>();

  const registerCharLookup = (char: Character) => {
    byId.set(char.id, char);
    byIdLower.set(char.id.toLowerCase(), char);
    const jpNames = [char.name.jp, char.fullName?.jp ?? "", ...char.aliases.jp];
    for (const jp of jpNames) {
      const trimmed = jp.trim();
      if (!trimmed) continue;
      if (!byJpExact.has(trimmed)) byJpExact.set(trimmed, char);
      const norm = normalizeJpName(trimmed);
      if (norm && !byJpNorm.has(norm)) byJpNorm.set(norm, char);
    }
  };

  for (const c of characters) {
    registerCharLookup(c);
  }

  // Index curated NPCs by JP name and anchor
  const curatedNpcByAnchor = new Map<string, NpcCuratedEntry>();
  const curatedNpcByJp = new Map<string, NpcCuratedEntry>();
  for (const npc of npcRoster.npcs) {
    if (npc.wikiruAnchor && !curatedNpcByAnchor.has(npc.wikiruAnchor)) {
      curatedNpcByAnchor.set(npc.wikiruAnchor, npc);
    }
    if (!curatedNpcByJp.has(npc.name.jp)) {
      curatedNpcByJp.set(npc.name.jp, npc);
    }
    for (const alias of npc.aliases?.jp ?? []) {
      if (!curatedNpcByJp.has(alias)) {
        curatedNpcByJp.set(alias, npc);
      }
    }
  }

  const anchorToCharId = new Map<string, string>();
  const warnings: string[] = [];
  const autoCreatedNpcSpeakers: BuildReport["wikiru"]["autoCreatedNpcSpeakers"] =
    [];
  const matchedPlayableSpeakerIds = new Set<string>();

  const ensureUniqueId = (preferredId: string): string => {
    if (!byId.has(preferredId)) return preferredId;
    let i = 2;
    while (byId.has(`${preferredId}_${i}`)) i++;
    return `${preferredId}_${i}`;
  };

  const resolveSchoolKey = (schoolJp: string): string =>
    npcRoster.schoolJpToKey[schoolJp] ?? "Unaffiliated";

  const resolveClubKey = (clubJp: string): string | undefined =>
    clubJp ? npcRoster.clubJpToKey[clubJp] : undefined;

  const createNpcOrEntity = (opts: {
    curated?: NpcCuratedEntry;
    defaultKind: CharacterKind;
    jpName: string;
    anchor?: string;
    schoolJp?: string;
    clubJp?: string;
  }): Character => {
    const { curated, defaultKind, jpName, anchor, schoolJp, clubJp } = opts;
    if (curated && byId.has(curated.id)) {
      return byId.get(curated.id)!;
    }

    const prefix = defaultKind === "entity" ? "entity" : "npc";
    const id = curated
      ? ensureUniqueId(curated.id)
      : ensureUniqueId(`${prefix}:${toSafeSlug(anchor || jpName)}`);

    const schoolKey =
      curated?.school ?? (schoolJp ? resolveSchoolKey(schoolJp) : "Unaffiliated");
    const clubKey =
      curated?.club ?? (clubJp ? resolveClubKey(clubJp) : undefined);

    const kind: CharacterKind =
      curated?.kind ??
      (schoolKey === "Collab" ? "collab" : defaultKind);

    const readingJp =
      curated?.reading?.jp ??
      npcRoster.readingsJp[jpName] ??
      (curated ? npcRoster.readingsJp[curated.name.jp] : undefined);

    const char: Character = {
      id,
      kind,
      ...(anchor ? { wikiruAnchor: anchor } : {}),
      name: curated?.name ?? {
        jp: jpName,
        en: anchor && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(anchor) ? anchor : "",
        kr: "",
      },
      ...(curated?.fullName ? { fullName: curated.fullName } : {}),
      ...(readingJp ? { reading: { jp: readingJp } } : {}),
      school: schoolKey,
      ...(clubKey ? { club: clubKey } : {}),
      released: { jp: true, global: false, cn: false },
      defaultImages: {
        icon: curated?.images?.icon ?? "",
        ...(curated?.images?.collection
          ? { collection: curated.images.collection }
          : {}),
        ...(curated?.images?.portrait
          ? { portrait: curated.images.portrait }
          : {}),
      },
      variants: [],
      aliases: {
        jp: Array.from(
          new Set([jpName, curated?.name.jp ?? "", ...(curated?.aliases?.jp ?? [])].filter(Boolean))
        ),
        kr: Array.from(
          new Set([curated?.name.kr ?? "", ...(curated?.aliases?.kr ?? [])].filter(Boolean))
        ),
        en: Array.from(
          new Set([curated?.name.en ?? "", ...(curated?.aliases?.en ?? [])].filter(Boolean))
        ),
      },
    };

    characters.push(char);
    registerCharLookup(char);
    return char;
  };

  // Pass 1: resolve every speaker table so anchorToCharId is populated across all 225 speakers
  const resolvedTableSpeakers: Array<{ table: ParsedWikiruTable; speaker: Character }> =
    [];
  const npcIconUrls: Record<string, string> = {};

  for (const table of parsed.tables) {
    const { speakerName, speakerAnchor, speakerIconPath, schoolJp, clubJp } =
      table;

    let matched: Character | undefined;
    const aliasId =
      (speakerAnchor && wikiruAliases.byAnchor[speakerAnchor]) ||
      wikiruAliases.byJpName[speakerName];
    if (aliasId) {
      matched = byId.get(aliasId);
      if (!matched) {
        warnings.push(
          `wikiru_aliases points "${speakerAnchor || speakerName}" to unknown character "${aliasId}"`
        );
      }
    }

    if (!matched) matched = byJpExact.get(speakerName);
    if (!matched) matched = byJpNorm.get(normalizeJpName(speakerName));
    if (!matched && speakerAnchor) {
      matched = byIdLower.get(speakerAnchor.toLowerCase());
    }

    if (matched) {
      if (speakerAnchor && !matched.wikiruAnchor) {
        matched.wikiruAnchor = speakerAnchor;
      }
      if (!matched.aliases.jp.includes(speakerName)) {
        matched.aliases.jp.push(speakerName);
      }
      if (matched.kind === "student" || matched.kind === "collab") {
        matchedPlayableSpeakerIds.add(matched.id);
      }
    } else {
      const curated =
        (speakerAnchor && curatedNpcByAnchor.get(speakerAnchor)) ||
        curatedNpcByJp.get(speakerName);
      matched = createNpcOrEntity({
        curated,
        defaultKind: "npc",
        jpName: speakerName,
        anchor: speakerAnchor || undefined,
        schoolJp,
        clubJp,
      });
      autoCreatedNpcSpeakers.push({
        id: matched.id,
        anchor: speakerAnchor,
        jpName: speakerName,
        schoolJp,
        clubJp,
        curated: Boolean(curated),
      });
    }

    if (speakerAnchor) {
      anchorToCharId.set(speakerAnchor, matched.id);
    }
    if (speakerIconPath && !matched.defaultImages.icon) {
      npcIconUrls[matched.id] = `https://bluearchive.wikiru.jp/${speakerIconPath}`;
    }
    resolvedTableSpeakers.push({ table, speaker: matched });
  }

  // Pass 2: resolve all targets & build merged seed entries
  const pairMap = new Map<string, JpAppellationSeedEntry>();
  const autoTargetTracker = new Map<
    string,
    { id: string; kind: CharacterKind; jpName: string; anchor?: string; occurrences: number; curated: boolean }
  >();
  const unmappedFootnotes = new Map<string, number>();

  let parsedRowCount = 0;
  let parsedTermCount = 0;

  for (const { table, speaker } of resolvedTableSpeakers) {
    for (const row of table.rows) {
      parsedRowCount++;
      const { targetName, targetAnchor, terms } = row;

      let target: Character | undefined;

      const specialId = SPECIAL_JP_TARGETS[targetName];
      if (specialId) {
        target = byId.get(specialId);
      }

      if (!target) {
        const curatedEntity = curatedNpcByJp.get(targetName);
        if (curatedEntity && curatedEntity.kind === "entity") {
          target =
            byId.get(curatedEntity.id) ??
            createNpcOrEntity({
              curated: curatedEntity,
              defaultKind: "entity",
              jpName: targetName,
            });
        }
      }

      if (!target) {
        const aliasId =
          (targetAnchor && wikiruAliases.byAnchor[targetAnchor]) ||
          wikiruAliases.byJpName[targetName];
        if (aliasId) target = byId.get(aliasId);
      }

      if (!target && targetAnchor) {
        const anchoredId = anchorToCharId.get(targetAnchor);
        if (anchoredId) target = byId.get(anchoredId);
      }

      if (!target) target = byJpExact.get(targetName);
      if (!target) target = byJpNorm.get(normalizeJpName(targetName));
      if (!target && targetAnchor) {
        target = byIdLower.get(targetAnchor.toLowerCase());
      }

      if (!target) {
        const curated =
          (targetAnchor && curatedNpcByAnchor.get(targetAnchor)) ||
          curatedNpcByJp.get(targetName);
        const isSectionGroup = Boolean(
          targetAnchor && parsed.sectionAnchors?.has(targetAnchor)
        );
        target = createNpcOrEntity({
          curated,
          defaultKind:
            curated?.kind ??
            (targetAnchor && !isSectionGroup ? "npc" : "entity"),
          jpName: targetName,
          anchor: targetAnchor,
        });
        if (targetAnchor) {
          anchorToCharId.set(targetAnchor, target.id);
        }
      }

      if (target.id.startsWith("npc:") || target.id.startsWith("entity:")) {
        const isSpeaker = autoCreatedNpcSpeakers.some((s) => s.id === target!.id);
        if (!isSpeaker) {
          const prev = autoTargetTracker.get(target.id);
          if (prev) {
            prev.occurrences++;
          } else {
            const curated =
              (targetAnchor && curatedNpcByAnchor.get(targetAnchor)) ||
              curatedNpcByJp.get(targetName);
            autoTargetTracker.set(target.id, {
              id: target.id,
              kind: target.kind,
              jpName: targetName,
              ...(targetAnchor ? { anchor: targetAnchor } : {}),
              occurrences: 1,
              curated: Boolean(curated),
            });
          }
        }
      }

      const mappedTerms: JpSeedTerm[] = terms.map((t) => {
        parsedTermCount++;
        if (!t.rawFootnote) return { term: t.term };

        const direct = footnoteGlossary[t.rawFootnote];
        if (direct) {
          return {
            term: t.term,
            rawFootnote: t.rawFootnote,
            notes: direct.text,
            contextTags: [direct.tag],
          };
        }

        const parts = t.rawFootnote.split("; ").map((p) => p.trim()).filter(Boolean);
        if (parts.length > 1 && parts.every((p) => Boolean(footnoteGlossary[p]))) {
          return {
            term: t.term,
            rawFootnote: t.rawFootnote,
            notes: {
              jp: parts.map((p) => footnoteGlossary[p].text.jp).join(" / "),
              en: parts.map((p) => footnoteGlossary[p].text.en).join(" / "),
              kr: parts.map((p) => footnoteGlossary[p].text.kr).join(" / "),
            },
            contextTags: parts.map((p) => footnoteGlossary[p].tag),
          };
        }

        unmappedFootnotes.set(
          t.rawFootnote,
          (unmappedFootnotes.get(t.rawFootnote) ?? 0) + 1
        );
        return {
          term: t.term,
          rawFootnote: t.rawFootnote,
        };
      });

      const pairId = `${speaker.id}->${target.id}`;
      const existing = pairMap.get(pairId);
      if (existing) {
        const seenTerms = new Set(existing.jpTerms.map((x) => x.term));
        for (const mt of mappedTerms) {
          if (!seenTerms.has(mt.term)) {
            existing.jpTerms.push(mt);
            seenTerms.add(mt.term);
          }
        }
      } else {
        pairMap.set(pairId, {
          id: pairId,
          speakerId: speaker.id,
          speakerWikiruName: table.speakerName,
          speakerWikiruAnchor: table.speakerAnchor,
          targetId: target.id,
          targetWikiruName: targetName,
          ...(targetAnchor ? { targetWikiruAnchor: targetAnchor } : {}),
          jpTerms: mappedTerms,
        });
      }
    }
  }

  for (const curated of npcRoster.npcs) {
    if (!curated.alwaysInclude) continue;
    if (characters.some((c) => c.id === curated.id)) continue;
    createNpcOrEntity({
      curated,
      defaultKind: curated.kind ?? "npc",
      jpName: curated.name.jp,
      anchor: curated.wikiruAnchor,
      schoolJp: curated.school,
      clubJp: curated.club,
    });
  }

  const unmatchedPlayableStudentsNotOnWikiru = characters
    .filter(
      (c) =>
        (c.kind === "student" || c.kind === "collab") &&
        !matchedPlayableSpeakerIds.has(c.id)
    )
    .map((c) => ({
      id: c.id,
      primaryStudentId: c.primaryStudentId,
      nameJp: c.name.jp,
      nameEn: c.name.en,
    }));

  const wikiruReport: BuildReport["wikiru"] = {
    speakerTableCount: parsed.tables.length,
    parsedRowCount,
    parsedTermCount,
    mergedPairCount: pairMap.size,
    matchedPlayableSpeakers: matchedPlayableSpeakerIds.size,
    autoCreatedNpcSpeakers,
    autoCreatedTargetEntities: Array.from(autoTargetTracker.values()).sort(
      (a, b) => b.occurrences - a.occurrences
    ),
    unmatchedPlayableStudentsNotOnWikiru,
    unmappedFootnotes: Array.from(unmappedFootnotes.entries())
      .map(([rawFootnote, count]) => ({ rawFootnote, count }))
      .sort((a, b) => b.count - a.count),
    warnings,
  };

  return {
    characters,
    seedEntries: Array.from(pairMap.values()),
    wikiruReport,
    npcIconUrls,
  };
}
