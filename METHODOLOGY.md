# Methodology

This document explains how the Sanctum Tower appellation dataset is built from public game data and community curation files.

## Pipeline overview

The build runs in three milestones (`pipeline/src/run.ts`).

### Milestone 1: Character roster and JP seed table

1. `01_fetch_schaledb.ts` and `02_build_characters.ts` fetch student and localization JSON from SchaleDB and group alt variants (such as Swimsuit, Dress, or Cheer) under a single canonical character ID.
2. `03_fetch_wikiru.ts` and `04_parse_wikiru.ts` fetch the Blue Archive JP wiki (wikiru) character appellation table and parse each speaker-to-target row along with any inline footnotes.
3. Speakers, targets, and footnotes are matched against the canonical roster and the manual configs in `data/manual/`:
   - `npc_roster.json`: curated NPCs, school/club mappings, and JP reading hints.
   - `wikiru_aliases.json`: fallback mappings when a wikiru anchor or JP name does not match SchaleDB directly.
   - `footnote_glossary.json`: structured tags and EN/JP/KR translations for wikiru footnote markers.

### Milestone 2: Local dialogue index

1. `05_fetch_game_scripts.ts` fetches official game script and localization tables from the `arisu-archive/bluearchive-data` repository (Global and JP branches).
2. `05b_index_dialogues.ts` aligns KR, JP, and EN lines across main story, event story, bond story, MomoTalk, and lobby/character dialog tables, writing a local `dialogue_index.jsonl` file.
3. Story speaker IDs are resolved using `xxhash32` lookups against scenario character name hashes plus curated aliases.

### Milestone 3: Multilang extraction and compilation

1. `06_extract_multilang.ts` matches each JP seed term from Milestone 1 (plus `supplemental_seeds.json`) against the indexed JP dialogue lines.
2. From the aligned lines, it extracts the corresponding EN and KR address terms, tracks how often EN drops or paraphrases an honorific/name, and classifies Korean speech levels (`formal`, `polite`, `casual`, `mixed`, `unknown`) from sentence endings.
3. Epithet and title patterns in `auto_epithets.json` are used to normalize recurring non-name titles across languages.
4. `07_compile_outputs.ts` applies `manual_overrides.json` last so hand-verified fixes take precedence over automated extraction, then writes `characters.json`, `appellations.json`, and `build_report.json`.

## What is not bundled here

Neither the `sanctum-tower` repository nor the itch.io data pack includes raw game scripts, full dialogue quote citations, or game images. If you want the full `appellations.json` with line-by-line quote citations, clone the `sanctum-tower` repository and run `npm run pipeline:build` locally to fetch the scripts directly from `arisu-archive/bluearchive-data`.
