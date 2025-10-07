# VerseFlow – Bible Reading & Notes for Obsidian

VerseFlow helps you plan, read, and study Scripture in Obsidian with daily targets, per‑verse notes, progress tracking, and Dataview dashboards.

- Plugin ID: `verse-flow`
- Minimum Obsidian: `1.4.16`

## Features
- Daily targets from a plan with pacing and catch‑up.
- Finalize to log: updates a per‑verse read map, appends events and session summaries.
- Dataview dashboards for progress, reading history, and analytics.
- Designed to be offline‑first. Optional online enrichments (e.g., cross‑refs) can be added later.
- Per‑verse chapter notes with pre‑created stubs per chapter and anchors (#v-<n>), plus dual verse+notes links in Today’s list.
- Notes link modes: `verse`, `chapter`, or `dual` (default `dual`).

Planned (roadmap):
- Multiple plans and quick switching.
- Optional external verse text fetch with local caching.

## Installation
### From a release (recommended)
1. Download the release zip for your version (e.g., `verseflow-0.1.0.zip`).
2. Extract into your vault: `YourVault/.obsidian/plugins/verse-flow/` so it contains:
   - `manifest.json`
   - `main.js`
   - `styles.css` (optional)
3. Reload Obsidian → Settings → Community plugins → Enable VerseFlow.

### Manual (development build)
1. From the repo root:
   ```bash
   npm install
   npm run build
   ```
2. Copy `manifest.json` and `main.js` to your vault folder: `.obsidian/plugins/verse-flow/`.
3. Enable VerseFlow in Obsidian.

## Settings
- `planPath`: vault‑relative path to the plan JSON (e.g., `chronological_plan.vault.json`).
- `progressPath`: path to `Bible-Progress.md` (frontmatter snapshot).
- `mapPath`: path to `bible-read-map.json` (index → timestamps[]).
- `eventsPath`: path to `Bible-Read-Events.md` (Markdown table log).
- `useMap`: prefer deriving progress from the map (recommended after seeding).
- `maxToday`: cap for today’s target list (e.g., 40).
- `previewCount`: how many verses to preview after today’s target.
- `notesBasePath`: base folder for chapter notes (default: `VerseNotes`).
- `notesSuffix`: filename suffix for chapter notes (default: `_notes.md`).
- `notesLinkMode`: how links appear in Today’s list (`verse` | `chapter` | `dual`; default: `dual`).

Planned settings:
- `notesMode` (perVerse | inline | ledger), `notesFolder`, `noteFilenamePattern`.
- `linkTo` (verseNote | verseFile), `embedVerseText`.
- `showRelatedVerses`, `crossRefPath` (local JSON dataset),
- `preferExternalVerseText`, `externalCacheRoot`.

## Commands
- Insert Today’s Target
- Finalize Bible Read
- Clear Bible Checkboxes
- Seed Map From Progress
- Recompute Progress From Map
- Rebuild Map From Events
- Open Bible Dashboard
- Insert Progress Summary (read‑only)
- Scaffold Chapter Notes From Plan (creates chapter notes with all per‑verse stubs)
- Open Chapter Note at Cursor (ensures `### v-<n> — <ref>` and opens at anchor)
- Append Notes For Checked Verses (adds missing per‑verse stubs for all checked items)
- Regenerate Bible Dashboard (writes brace‑wrapped DataviewJS blocks)

Planned:
- Create/Open Verse Note (for current index)
- Insert Notes Table for Today
- Toggle Link Target (verseNote ↔ verseFile)

## Quick start
- Ensure your plan JSON is set under Settings → VerseFlow (supports anchors like `#^v1`).
- Run “Scaffold Chapter Notes From Plan” to create chapter notes under `VerseNotes/<Book>/<Chapter>_notes.md` with all per‑verse stubs.
- Run “Insert Today’s Target”. In `dual` mode you’ll see both the verse link and a small “notes” link (`#v-<n>`).
- Click the “notes” link to jump straight to the per‑verse section in the chapter note.
- After reading and checking items, run “Append Notes For Checked Verses” to ensure stubs exist for everything you completed.

## Data files
- `chronological_plan.vault.json`: array of `{ ref, path }` (index is canonical order).
- `Bible-Progress.md`: YAML frontmatter (`last_order`, `verses_read`, `total_verses`, `start_date`, `target_days`).
- `bible-read-map.json`: `{ [idx: number]: string[] }` timestamps of reads.
- `Bible-Read-Events.md`: table of per‑verse read events.
- `Bible-Read-Log.md`: session summary rows: date, start_ref, end_ref, count, last_order.
- Optional dashboards: `Bible-Dashboard.md` (Dataview/DataviewJS snippets).

## Privacy & security
- No telemetry. No network calls by default.
- All operations are local to your vault unless you explicitly enable online features.

## Compatibility
- Requires Obsidian `>= 1.4.16`.
- Desktop and mobile compatible. Avoids desktop‑only APIs by default.

## Development
- Node v18+ LTS recommended.
- Commands:
  - `npm run dev` – watch build (esbuild)
  - `npm run build` – typecheck then build `main.js` at repo root
  - `npm version patch|minor|major` – bumps versions and updates `versions.json`

### Project layout
- `manifest.json`, `main.js`, `styles.css` (optional) at repo root for distribution.
- In this repo, source lives at the repo root (`main.ts`). If you adopt a `src/` layout, update build scripts accordingly.
- Do not include `node_modules/` or build artifacts in releases.

## Releasing (per Obsidian plugin guidelines)
- Ensure fields are aligned:
  - `manifest.json`: id `verse-flow`, name `VerseFlow`, version matches `package.json`, accurate `minAppVersion`.
  - `versions.json`: map new version → minimum Obsidian version.
- Tag a GitHub Release using the exact version (no leading `v`).
- Attach these files as release assets (top‑level, no folders):
  - `manifest.json`
  - `main.js`
  - `styles.css` (if present)
- Guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

## Contributing
- Issues and PRs welcome. Keep core offline‑first. Gate online features behind explicit settings and document sources/licensing.

## License
MIT

## API Docs
See https://github.com/obsidianmd/obsidian-api
