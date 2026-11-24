# Sanctum Tower

Data pipeline and manual curation rules behind the Sanctum Tower Blue Archive appellation table.

It builds a cross-language mapping (JP, EN, KR) of what characters call each other, along with Korean speech level stats and citation counts. Raw game text, scraped dialogue caches, generated outputs, and game images are not committed to this repo.

## Requirements

- Node.js 22 or newer

## Setup

```bash
npm install
```

## Running the pipeline

Run the full 3-step build (downloads SchaleDB, wikiru, and `arisu-archive/bluearchive-data` locally into `data/raw/`, then writes outputs to `data/output/`):

```bash
npm run pipeline:build
```

Or run each milestone on its own:

```bash
npm run pipeline:m1          # SchaleDB roster + wikiru JP seed table
npm run pipeline:m1:refresh  # Same, bypassing local cache

npm run pipeline:m2          # Fetch arisu-archive/bluearchive-data + index dialogue locally
npm run pipeline:m2:refresh  # Same, bypassing local cache

npm run pipeline:m3          # Extract EN/KR terms, speech levels, citations + compile outputs
```

Note: running Milestone 2 and Milestone 3 locally will fetch official script tables directly from `arisu-archive/bluearchive-data` and populate `data/output/appellations.json` with the full quote citations.

## Checks

```bash
npm run typecheck
npm test
```

## Project layout

- `pipeline/src/steps/`: Fetch, parse, index, extract, and compile steps.
- `pipeline/src/utils/`: Cache helpers, text normalization, and `xxhash32` speaker hash helper.
- `pipeline/tests/`: Unit tests for M1, M2, and M3 logic.
- `data/manual/`: Curated rules, NPC roster, footnote glossary, epithet rules, supplemental seeds, and manual overrides.
- `METHODOLOGY.md`: Short walkthrough of how each milestone works.

## Disclaimer and credits

Unofficial fan-made project. Blue Archive is copyright NEXON Korea Corp. and NEXON GAMES.

Data sources:
- SchaleDB
- Blue Archive JP Wiki (wikiru)
- arisu-archive/bluearchive-data
