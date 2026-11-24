import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "../..");

export const DATA_RAW_DIR = path.join(ROOT_DIR, "data", "raw");
export const DATA_MANUAL_DIR = path.join(ROOT_DIR, "data", "manual");
export const DATA_OUTPUT_DIR = path.join(ROOT_DIR, "data", "output");

export const SCHALEDB_BASE = "https://schaledb.com";
export const WIKIRU_APPELLATIONS_URL =
  "https://bluearchive.wikiru.jp/?%E3%82%AD%E3%83%A3%E3%83%A9%E5%91%BC%E7%A7%B0%E8%A1%A8";
export const GAME_DATA_BASE =
  "https://raw.githubusercontent.com/arisu-archive/bluearchive-data";

export const USER_AGENT =
  "BlueArchiveAppellationPipeline/0.1 (+static-data-builder)";

export const COLLAB_SCHOOLS = new Set(["Tokiwadai", "Sakugawa", "ETC"]);

export const SCHALEDB_CACHE_DIR = path.join(DATA_RAW_DIR, "schaledb");
export const WIKIRU_CACHE_DIR = path.join(DATA_RAW_DIR, "wikiru");
export const GAME_CACHE_DIR = path.join(DATA_RAW_DIR, "game");
export const DIALOGUE_INDEX_PATH = path.join(
  GAME_CACHE_DIR,
  "dialogue_index.jsonl"
);
export const STORY_LABELS_PATH = path.join(
  GAME_CACHE_DIR,
  "story_labels.json"
);
