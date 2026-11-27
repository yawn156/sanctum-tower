export interface LocalizedText {
  jp: string;
  en: string;
  kr: string;
  zh?: string;
}

export interface ReleaseStatus {
  jp: boolean;
  global: boolean;
  cn: boolean;
}

export interface CharacterVariant {
  id: number;
  pathName: string;
  devName: string;
  name: LocalizedText;
  variantTag?: string;
  isBase: boolean;
  isLimited: number;
  released: ReleaseStatus;
  images: {
    icon: string;
    collection: string;
    portrait: string;
  };
}

export type CharacterKind = "student" | "npc" | "collab" | "entity" | "special";

export interface Character {
  id: string;
  kind: CharacterKind;
  primaryStudentId?: number;
  wikiruAnchor?: string;
  name: LocalizedText;
  fullName?: LocalizedText;
  reading?: {
    jp?: string;
  };
  school: string;
  club?: string;
  released: ReleaseStatus;
  defaultImages: {
    icon: string;
    collection?: string;
    portrait?: string;
  };
  variants: CharacterVariant[];
  aliases: {
    jp: string[];
    kr: string[];
    en: string[];
    zh?: string[];
  };
}

export interface CharactersOutput {
  meta: {
    generatedAt: string;
    schaleDbStudentCount: number;
    playableCharacterCount: number;
    npcCount: number;
    entityCount: number;
    totalCharacterCount: number;
  };
  schools: Record<string, LocalizedText>;
  clubs: Record<string, LocalizedText>;
  characters: Character[];
}

export interface TermVariant {
  term: string;
  count: number;
  notes?: LocalizedText;
  contextTags?: string[];
  source: "wikiru" | "extracted" | "manual";
}

export type SpeechLevel = "formal" | "polite" | "casual" | "mixed" | "unknown";

export interface JpSeedTerm {
  term: string;
  rawFootnote?: string;
  notes?: LocalizedText;
  contextTags?: string[];
}

export interface JpAppellationSeedEntry {
  id: string;
  speakerId: string;
  speakerWikiruName: string;
  speakerWikiruAnchor: string;
  targetId: string;
  targetWikiruName: string;
  targetWikiruAnchor?: string;
  jpTerms: JpSeedTerm[];
}

export interface JpAppellationsSeedOutput {
  meta: {
    generatedAt: string;
    sourceUrl: string;
    speakerTableCount: number;
    totalPairs: number;
    totalTerms: number;
  };
  entries: JpAppellationSeedEntry[];
}

export interface QuoteContextLine {
  speakerId: string;
  jp: string;
  kr: string;
  en?: string;
  zh?: string;
}

export interface QuoteCitation {
  sourceType: "main_story" | "event_story" | "bond_story" | "momotalk" | "dialog";
  sourceLabel: LocalizedText;
  sourceRef: string;
  jp: string;
  kr: string;
  en?: string;
  zh?: string;
  matchedJpTerm: string;
  matchedKrTerm?: string;
  matchedEnTerm?: string;
  matchedZhTerm?: string;
  matchedJpTerms?: string[];
  matchedKrTerms?: string[];
  matchedEnTerms?: string[];
  matchedZhTerms?: string[];
  contextBefore?: QuoteContextLine[];
  contextAfter?: QuoteContextLine[];
}

export interface AppellationEntry {
  id: string;
  speakerId: string;
  targetId: string;
  status: "verified" | "jp_only_seed" | "en_pending" | "manual";
  jp: TermVariant[];
  kr: {
    terms: TermVariant[];
    speechLevel: SpeechLevel;
    speechLevelCounts?: {
      formal: number;
      polite: number;
      casual: number;
    };
  };
  en: {
    terms: TermVariant[];
    droppedCount: number;
  };
  zh?: {
    terms: TermVariant[];
    droppedCount: number;
  };
  matchedLineCount: number;
  citationCount?: number;
  citations: QuoteCitation[];
}

export interface AppellationsOutput {
  meta: {
    generatedAt: string;
    globalVersion: string;
    japanVersion: string;
    totalPairs: number;
    statusCounts: Record<AppellationEntry["status"], number>;
  };
  entries: AppellationEntry[];
}

export interface BuildReport {
  generatedAt: string;
  milestone: number;
  schaleDb: {
    rawStudentCount: number;
    playableComponentCount: number;
    schoolCount: number;
    clubCount: number;
  };
  wikiru: {
    speakerTableCount: number;
    parsedRowCount: number;
    parsedTermCount: number;
    mergedPairCount: number;
    matchedPlayableSpeakers: number;
    autoCreatedNpcSpeakers: Array<{
      id: string;
      anchor: string;
      jpName: string;
      schoolJp: string;
      clubJp: string;
      curated: boolean;
    }>;
    autoCreatedTargetEntities: Array<{
      id: string;
      kind: CharacterKind;
      jpName: string;
      anchor?: string;
      occurrences: number;
      curated: boolean;
    }>;
    unmatchedPlayableStudentsNotOnWikiru: Array<{
      id: string;
      primaryStudentId?: number;
      nameJp: string;
      nameEn: string;
    }>;
    unmappedFootnotes: Array<{
      rawFootnote: string;
      count: number;
    }>;
    warnings: string[];
  };
  gameScripts?: {
    globalVersion: string;
    japanVersion: string;
    indexedLinesTotal: number;
    bySourceType: Record<QuoteCitation["sourceType"], number>;
    jpOnlyDeltaLines: number;
    scenarioSpeechResolved: number;
    scenarioSpeechUnresolved: number;
    topUnresolvedSpeakers: Array<{
      krKey: string;
      jpName?: string;
      enName?: string;
      count: number;
    }>;
    storyLabelCount: number;
    enrichedNpcCount: number;
  };
  appellations?: {
    totalPairs: number;
    statusCounts: Record<AppellationEntry["status"], number>;
    pairsWithKrTerms: number;
    pairsWithEnTerms: number;
    pairsWithCitations: number;
    totalCitations: number;
    speechLevelCounts: Record<SpeechLevel, number>;
    outputSizeKb: number;
    topZeroMatchPlayablePairs: Array<{
      id: string;
      jpTerms: string[];
      speakerLineCount: number;
    }>;
  };
}

export interface ManualOverridesConfig {
  characters?: Record<string, Partial<Character>>;
  appellations?: Record<
    string,
    Partial<AppellationEntry> & { delete?: boolean }
  >;
}

export interface DialogueLineRecord {
  speakerId: string;
  sourceType: QuoteCitation["sourceType"];
  sourceRef: string;
  groupId?: number;
  jp: string;
  kr: string;
  en?: string;
  zh?: string;
  jpOnly: boolean;
}

export interface StoryLabelEntry {
  sourceType: QuoteCitation["sourceType"];
  sourceLabel: LocalizedText;
}

export interface ScenarioCharNameRow {
  character_name: number;
  name_kr: string;
  nickname_kr?: string;
  name_jp: string;
  nickname_jp?: string;
  name_en?: string;
  nickname_en?: string;
  name_tw?: string;
  nickname_tw?: string;
  spine_prefab_name?: string;
  small_portrait?: string;
}

export interface ScenarioScriptRow {
  group_id: number;
  selection_group?: number;
  script_kr?: string;
  text_jp?: string;
  text_en?: string;
  text_tw?: string;
}

export interface AcademyMessangerRow {
  message_group_id: number;
  id: number;
  character_id: number;
  message_condition: number;
  message_type: number;
  message_kr?: string;
  message_jp?: string;
  message_en?: string;
  message_tw?: string;
}

export interface CharacterDialogRow {
  character_id: number;
  display_order: number;
  dialog_category: number;
  group_id: number;
  localize_kr?: string;
  localize_jp?: string;
  localize_en?: string;
  localize_tw?: string;
}

export interface CharacterDialogEventRow {
  costume_unique_id: number;
  original_character_id: number;
  display_order: number;
  event_id: number;
  dialog_category: number;
  group_id: number;
  localize_kr?: string;
  localize_jp?: string;
  localize_en?: string;
  localize_tw?: string;
}

export interface ScenarioModeRow {
  mode_id: number;
  mode_type: number;
  sub_type?: number;
  display_volume_id?: string;
  volume_id: number;
  chapter_id: number;
  episode_id: number;
  front_scenario_group_id?: number[];
  back_scenario_group_id?: number[];
  event_content_id?: number;
}

export interface AcademyFavorScheduleRow {
  id: number;
  character_id: number;
  order_in_group: number;
  scenario_sript_group_id: number;
}

export interface EventContentScenarioRow {
  id: number;
  event_content_id: number;
  order: number;
  scenario_group_id?: number[];
}

// Raw input data shapes
export interface SchaleDbStudent {
  Id: number;
  IsReleased: [boolean, boolean, boolean];
  DefaultOrder: number;
  PathName: string;
  DevName: string;
  Name: string;
  Icon?: string | null;
  School: string;
  Club: string;
  FamilyName?: string;
  PersonalName?: string;
  FavorAlts?: number[];
  IsLimited?: number;
}

export interface SchaleDbLocalization {
  School?: Record<string, string>;
  SchoolLong?: Record<string, string>;
  Club?: Record<string, string>;
  EventName?: Record<string, string>;
}

export interface FootnoteGlossaryEntry {
  tag: string;
  text: LocalizedText;
}

export type FootnoteGlossary = Record<string, FootnoteGlossaryEntry>;

export interface NpcCuratedEntry {
  id: string;
  kind?: CharacterKind;
  alwaysInclude?: boolean;
  name: LocalizedText;
  fullName?: LocalizedText;
  reading?: { jp?: string };
  school?: string;
  club?: string;
  wikiruAnchor?: string;
  aliases?: Partial<{ jp: string[]; kr: string[]; en: string[] }>;
  images?: { icon?: string; collection?: string; portrait?: string };
}

export interface NpcRosterConfig {
  schools: Record<string, LocalizedText>;
  clubs: Record<string, LocalizedText>;
  schoolJpToKey: Record<string, string>;
  clubJpToKey: Record<string, string>;
  readingsJp: Record<string, string>;
  npcs: NpcCuratedEntry[];
}

export interface WikiruAliasesConfig {
  byAnchor: Record<string, string>;
  byJpName: Record<string, string>;
}
