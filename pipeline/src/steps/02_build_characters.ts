import { COLLAB_SCHOOLS, SCHALEDB_BASE } from "../config.js";
import type {
  Character,
  CharacterVariant,
  LocalizedText,
  NpcRosterConfig,
  ReleaseStatus,
  SchaleDbLocalization,
  SchaleDbStudent,
} from "../types.js";

function stripVariantParens(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*（[^）]*）\s*$/u, "")
    .trim();
}

function hasVariantParens(name: string): boolean {
  return /\([^)]*\)\s*$/u.test(name) || /（[^）]*）\s*$/u.test(name);
}

function toReleaseStatus(arr: [boolean, boolean, boolean]): ReleaseStatus {
  return {
    jp: Boolean(arr[0]),
    global: Boolean(arr[1]),
    cn: Boolean(arr[2]),
  };
}

function buildStudentImages(id: number): CharacterVariant["images"] {
  return {
    icon: `${SCHALEDB_BASE}/images/student/icon/${id}.webp`,
    collection: `${SCHALEDB_BASE}/images/student/collection/${id}.webp`,
    portrait: `${SCHALEDB_BASE}/images/student/portrait/${id}.webp`,
  };
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = (v ?? "").trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function buildSchoolsAndClubs(
  locEn: SchaleDbLocalization,
  locJp: SchaleDbLocalization,
  locKr: SchaleDbLocalization,
  npcRoster: NpcRosterConfig,
  locTw?: SchaleDbLocalization
): {
  schools: Record<string, LocalizedText>;
  clubs: Record<string, LocalizedText>;
} {
  const schools: Record<string, LocalizedText> = {};
  const schoolKeys = new Set([
    ...Object.keys(locEn.School ?? {}),
    ...Object.keys(locJp.School ?? {}),
    ...Object.keys(locKr.School ?? {}),
    ...Object.keys(locTw?.School ?? {}),
    ...Object.keys(npcRoster.schools ?? {}),
  ]);
  for (const key of schoolKeys) {
    const curated = npcRoster.schools[key];
    const zh = locTw?.School?.[key] ?? curated?.zh;
    schools[key] = {
      jp: locJp.School?.[key] ?? curated?.jp ?? key,
      en: locEn.School?.[key] ?? curated?.en ?? key,
      kr: locKr.School?.[key] ?? curated?.kr ?? key,
      ...(zh ? { zh } : {}),
    };
  }

  const clubs: Record<string, LocalizedText> = {};
  const clubKeys = new Set([
    ...Object.keys(locEn.Club ?? {}),
    ...Object.keys(locJp.Club ?? {}),
    ...Object.keys(locKr.Club ?? {}),
    ...Object.keys(locTw?.Club ?? {}),
    ...Object.keys(npcRoster.clubs ?? {}),
  ]);
  for (const key of clubKeys) {
    const curated = npcRoster.clubs[key];
    const zh = locTw?.Club?.[key] ?? curated?.zh;
    clubs[key] = {
      jp: locJp.Club?.[key] ?? curated?.jp ?? key,
      en: locEn.Club?.[key] ?? curated?.en ?? key,
      kr: locKr.Club?.[key] ?? curated?.kr ?? key,
      ...(zh ? { zh } : {}),
    };
  }

  return { schools, clubs };
}

export function createSpecialCharacters(): Character[] {
  return [
    {
      id: "special:self",
      kind: "special",
      name: { jp: "自分", en: "Self (1st Person)", kr: "자기 자신", zh: "自己" },
      reading: { jp: "じぶん" },
      school: "Special",
      released: { jp: true, global: true, cn: true },
      defaultImages: { icon: "" },
      variants: [],
      aliases: {
        jp: ["自分", "一人称"],
        kr: ["자기 자신", "자신", "1인칭"],
        en: ["Self", "Oneself"],
        zh: ["自己", "第一人稱"],
      },
    },
    {
      id: "special:sensei",
      kind: "special",
      name: { jp: "先生", en: "Sensei", kr: "선생님", zh: "老師" },
      reading: { jp: "せんせい" },
      school: "Special",
      club: "Schale",
      released: { jp: true, global: true, cn: true },
      defaultImages: { icon: "" },
      variants: [],
      aliases: {
        jp: ["先生", "シャーレの先生"],
        kr: ["선생님", "선생", "샬레의 선생님"],
        en: ["Sensei", "Teacher"],
        zh: ["老師", "夏萊的老師"],
      },
    },
    {
      id: "special:you",
      kind: "special",
      name: { jp: "二人称", en: "Second Person (You)", kr: "2인칭", zh: "第二人稱" },
      reading: { jp: "ににんしょう" },
      school: "Special",
      released: { jp: true, global: true, cn: true },
      defaultImages: { icon: "" },
      variants: [],
      aliases: {
        jp: ["二人称"],
        kr: ["2인칭"],
        en: ["You", "Second Person"],
        zh: ["第二人稱"],
      },
    },
  ];
}

export function buildPlayableCharacters(
  studentsEn: Record<string, SchaleDbStudent>,
  studentsJp: Record<string, SchaleDbStudent>,
  studentsKr: Record<string, SchaleDbStudent>,
  npcRoster: NpcRosterConfig,
  studentsTw?: Record<string, SchaleDbStudent>
): Character[] {
  const allIds = Object.keys(studentsEn)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  // Build undirected adjacency graph from FavorAlts
  const adj = new Map<number, Set<number>>();
  for (const id of allIds) {
    if (!adj.has(id)) adj.set(id, new Set());
    const stu = studentsEn[String(id)];
    for (const altId of stu.FavorAlts ?? []) {
      if (!studentsEn[String(altId)]) continue;
      adj.get(id)!.add(altId);
      if (!adj.has(altId)) adj.set(altId, new Set());
      adj.get(altId)!.add(id);
    }
  }

  // Extract connected components
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const id of allIds) {
    if (visited.has(id)) continue;
    const comp: number[] = [];
    const stack = [id];
    visited.add(id);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          stack.push(nxt);
        }
      }
    }
    comp.sort((a, b) => a - b);
    components.push(comp);
  }

  const seenCanonicalIds = new Set<string>();
  const characters: Character[] = [];

  for (const comp of components) {
    // Prefer a variant without parenthetical suffix; break ties by lowest Id
    const sortedForBase = [...comp].sort((a, b) => {
      const sa = studentsEn[String(a)];
      const sb = studentsEn[String(b)];
      const aNoParen =
        !hasVariantParens(sa.Name) &&
        !hasVariantParens(studentsJp[String(a)]?.Name ?? "");
      const bNoParen =
        !hasVariantParens(sb.Name) &&
        !hasVariantParens(studentsJp[String(b)]?.Name ?? "");
      if (aNoParen !== bNoParen) return aNoParen ? -1 : 1;
      return a - b;
    });

    const baseId = sortedForBase[0];
    const baseEn = studentsEn[String(baseId)];
    const baseJp = studentsJp[String(baseId)] ?? baseEn;
    const baseKr = studentsKr[String(baseId)] ?? baseEn;
    const baseTw = studentsTw?.[String(baseId)];

    const canonicalId = stripVariantParens(baseEn.PathName).toLowerCase();
    if (seenCanonicalIds.has(canonicalId)) {
      throw new Error(
        `Duplicate canonical character ID "${canonicalId}" from SchaleDB student ${baseId}`
      );
    }
    seenCanonicalIds.add(canonicalId);

    // Check duplicate EN variant names (e.g. Hoshino (Armed) Tank vs Dealer)
    const variantNameCounts = new Map<string, number>();
    for (const id of comp) {
      const n = studentsEn[String(id)].Name;
      variantNameCounts.set(n, (variantNameCounts.get(n) ?? 0) + 1);
    }

    const orderedVariantIds = [baseId, ...comp.filter((id) => id !== baseId)];
    const variants: CharacterVariant[] = orderedVariantIds.map((id) => {
      const sEn = studentsEn[String(id)];
      const sJp = studentsJp[String(id)] ?? sEn;
      const sKr = studentsKr[String(id)] ?? sEn;
      const sTw = studentsTw?.[String(id)];
      const hasDupName = (variantNameCounts.get(sEn.Name) ?? 0) > 1;
      const tag = hasDupName
        ? sEn.PathName.split("_").pop() || sEn.DevName
        : undefined;

      return {
        id,
        pathName: sEn.PathName,
        devName: sEn.DevName,
        name: {
          jp: sJp.Name,
          en: sEn.Name,
          kr: sKr.Name,
          ...(sTw?.Name ? { zh: sTw.Name } : {}),
        },
        ...(tag ? { variantTag: tag } : {}),
        isBase: id === baseId,
        isLimited: sEn.IsLimited ?? 0,
        released: toReleaseStatus(sEn.IsReleased),
        images: buildStudentImages(id),
      };
    });

    const displayZh = baseTw ? stripVariantParens(baseTw.Name) : undefined;
    const displayName: LocalizedText = {
      jp: stripVariantParens(baseJp.Name),
      en: stripVariantParens(baseEn.Name),
      kr: stripVariantParens(baseKr.Name),
      ...(displayZh ? { zh: displayZh } : {}),
    };

    const hasFamilyName = Boolean(
      (baseEn.FamilyName ?? "").trim() || (baseJp.FamilyName ?? "").trim()
    );
    const fullNameZh =
      baseTw && hasFamilyName
        ? `${(baseTw.FamilyName ?? "").trim()}${(baseTw.PersonalName ?? "").trim() || displayZh || ""}`.trim()
        : undefined;
    const fullName: LocalizedText | undefined = hasFamilyName
      ? {
          jp: `${(baseJp.FamilyName ?? "").trim()}${(baseJp.PersonalName ?? "").trim() || displayName.jp}`,
          en: `${(baseEn.FamilyName ?? "").trim()} ${(baseEn.PersonalName ?? "").trim() || displayName.en}`.trim(),
          kr: `${(baseKr.FamilyName ?? "").trim()} ${(baseKr.PersonalName ?? "").trim() || displayName.kr}`.trim(),
          ...(fullNameZh ? { zh: fullNameZh } : {}),
        }
      : undefined;

    const readingJp =
      npcRoster.readingsJp[displayName.jp] ??
      (fullName ? npcRoster.readingsJp[fullName.jp] : undefined);

    const anyJpReleased = variants.some((v) => v.released.jp);
    const anyGlobalReleased = variants.some((v) => v.released.global);
    const anyCnReleased = variants.some((v) => v.released.cn);

    const aliasesJp = uniqueStrings([
      displayName.jp,
      baseJp.PersonalName,
      fullName?.jp,
      ...variants.flatMap((v) => [
        stripVariantParens(v.name.jp),
        studentsJp[String(v.id)]?.PersonalName,
      ]),
    ]);
    const aliasesKr = uniqueStrings([
      displayName.kr,
      baseKr.PersonalName,
      fullName?.kr,
      ...variants.flatMap((v) => [
        stripVariantParens(v.name.kr),
        studentsKr[String(v.id)]?.PersonalName,
      ]),
    ]);
    const aliasesEn = uniqueStrings([
      displayName.en,
      baseEn.PersonalName,
      fullName?.en,
      ...variants.flatMap((v) => [
        stripVariantParens(v.name.en),
        studentsEn[String(v.id)]?.PersonalName,
      ]),
    ]);
    const aliasesZh = studentsTw
      ? uniqueStrings([
          displayName.zh,
          baseTw?.PersonalName,
          fullName?.zh,
          ...variants.flatMap((v) => [
            v.name.zh ? stripVariantParens(v.name.zh) : undefined,
            studentsTw[String(v.id)]?.PersonalName,
          ]),
        ])
      : [];

    const isCollab = COLLAB_SCHOOLS.has(baseEn.School);

    characters.push({
      id: canonicalId,
      kind: isCollab ? "collab" : "student",
      primaryStudentId: baseId,
      name: displayName,
      ...(fullName ? { fullName } : {}),
      ...(readingJp ? { reading: { jp: readingJp } } : {}),
      school: baseEn.School,
      ...(baseEn.Club ? { club: baseEn.Club } : {}),
      released: {
        jp: anyJpReleased,
        global: anyGlobalReleased,
        cn: anyCnReleased,
      },
      defaultImages: buildStudentImages(baseId),
      variants,
      aliases: {
        jp: aliasesJp,
        kr: aliasesKr,
        en: aliasesEn,
        ...(aliasesZh.length > 0 ? { zh: aliasesZh } : {}),
      },
    });
  }

  return characters;
}
