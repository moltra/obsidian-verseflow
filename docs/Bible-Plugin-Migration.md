# Bible Reading Workflow – Migration to Standalone Plugin

This document explains how to move from the vault-embedded plugin to a standalone Obsidian plugin project, including zipping the existing code, recommended structure, data formats, and a roadmap. It also covers design decisions for improvements you requested.

---

## 1) Current State and What You Have

- Plugin location: `.obsidian/plugins/bible-reading-workflow/`
  - `manifest.json`
  - `main.js`
- Data files used by the plugin:
  - `chronological_plan.vault.json` (plan)
  - `Bible-Progress.md` (frontmatter)
  - `bible-read-map.json` (progress map)
  - `Bible-Read-Events.md` (event log table)
  - `Bible-Read-Log.md` (session summary table; plugin appends rows on Finalize)
- Dashboard: `Bible-Dashboard.md` (Dataview/DataviewJS based, updated)

Option C is enabled: Map is seeded and is the primary source of truth (useMap = true in plugin settings).

---

## 2) Zip the current embedded plugin (Windows PowerShell)

Run inside the vault root (`My brain/`):

```powershell
# Create a zip of JUST the plugin code
Compress-Archive -Path ".obsidian\plugins\bible-reading-workflow\*" `
  -DestinationPath "bible-reading-workflow.zip" -Force
```

To include migration docs and dashboard as well:
```powershell
Compress-Archive -Path ".obsidian\plugins\bible-reading-workflow\*","Bible-Plugin-Migration.md","Bible-Dashboard.md" `
  -DestinationPath "bible-reading-workflow-with-docs.zip" -Force
```

Now you can extract that zip into a new repository based on the official sample template.

---

## 3) Create a new standalone plugin project (TypeScript)

Recommended scaffold: Obsidian Sample Plugin (TypeScript)

```bash
# Option A: GitHub template (recommended)
# 1) Create a new repo using: https://github.com/obsidianmd/obsidian-sample-plugin
# 2) Clone your new repo locally:
#    git clone https://github.com/<you>/<repo>.git

# Option B: Clone and rename locally
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git bible-reading-workflow
cd bible-reading-workflow
```

Rename in `manifest.json`:
- `id`: `bible-reading-workflow` (or your final id)
- `name`: `Bible Reading Workflow`
- `description`, `version`, `minAppVersion`

Replace the sample’s `main.ts` logic with your current `main.js` features, ported to TypeScript:
- Commands:
  - Insert Today’s Target
  - Finalize Bible Read
  - Clear Bible Checkboxes
  - Seed Map From Progress
  - Recompute Progress From Map
  - Rebuild Map From Events
  - Open Bible Dashboard
  - Insert Progress Summary (read‑only)
- Settings:
  - `planPath`, `progressPath`, `mapPath`, `eventsPath`, `useMap`, `maxToday`, `previewCount`
- Logging to `logs/bible-plugin-log.md`

Build & test:
```bash
npm install
npm run dev   # or: npm run build
```

Copy the build output to a test vault’s `.obsidian/plugins/<your-id>/` or use the sample plugin dev flow.

---

## 4) Data formats (spec)

- Plan JSON: `chronological_plan.vault.json`
```json
[
  { "ref": "Genesis 1:1", "path": "bible/The Bible (KJV)/Genesis/Gen 1.md#^v1" },
  { "ref": "Genesis 1:2", "path": "bible/The Bible (KJV)/Genesis/Gen 1.md#^v2" }
]
```
- Progress frontmatter: `Bible-Progress.md`
```yaml
---
last_order: 106
verses_read: 106
total_verses: 31102
start_date: 2025-10-02
target_days: 365
---
```
- Map JSON: `bible-read-map.json` (index → timestamps array)
```json
{
  "0": ["2025-10-06T18:36:00"],
  "1": ["2025-10-06T18:36:00", "2025-10-07T07:12:00"],
  "106": ["2025-10-07T03:22:50"]
}
```
- Events log: `Bible-Read-Events.md` (table)
```
| timestamp | idx | ref | path |
|---|---:|---|---|
| 2025-10-07T03:24:46 | 106 | Genesis 5:1 | bible/The Bible (KJV)/Genesis/Gen 5.md#^v1 |
```
- Session log: `Bible-Read-Log.md` (table)
```
| date | start_ref | end_ref | count | last_order |
|---|---|---|---:|---:|
| 2025-10-07 | Genesis 5:1 | Genesis 6:8 | 40 | 146 |
```

---

## 5) Transfer plan for your logic (TS structure)

- `src/main.ts`
  - Load/save settings
  - Register commands (Insert/Finalize/Clear/Seed/Recompute/Rebuild/Open Dashboard/Insert Summary)
  - Logging helpers
  - JSON read/write utilities
  - Frontmatter update util
  - Compute functions (from map / pacing / today’s target)
- `src/settings.ts`
  - Settings tab with editable fields and validation
- Optional: `src/utils/` for plan parsing, path helpers, cross‑ref lookups later

---

## 6) Known issues and risks

- **Large plan JSON (~1.3MB):**
  - Keep one in‑memory parse per session; avoid frequent re‑reads.
  - Lazy load on first command call; cache until workspace unload.
- **Concurrent writes:**
  - Debounce updates to map and logs; ensure sequential writes during Finalize.
- **Frontmatter editing:**
  - Always preserve existing YAML/comments; error if file missing.
  - Consider backup/restore for `Bible-Progress.md` on first run.
- **Mobile performance:**
  - Avoid heavy operations per keystroke; only on explicit commands.
- **Path drift:**
  - Users moving folders can break paths. Provide settings for paths and a “validate paths” utility.
- **ID collisions:**
  - Ensure unique plugin `id`. Changing `id` breaks stored settings.
- **Indexing errors in other plugins:**
  - Your log shows some indexers failing on logs; keep logs simple Markdown files with a heading.

---

## 7) Improvements – Design and feedback

### 7.1 Select where the Bible files live in the vault
- **Setting**: `bibleRoot` (folder path). Not strictly required if plan JSON carries full `path`, but useful for validation and for creating verse notes.
- **Usage**:
  - Validate `plan.path` values start with this root (warning if not).
  - When creating per‑verse notes, place under `${bibleRoot}-notes/`.
- **Pros**: Clear organization, easier validation.
- **Cons**: Another knob to configure; plan paths must remain consistent.

### 7.2 Notes/questions during reading
- **Option A – Inline in verse files**
  - Append a callout under the verse header in the verse’s Markdown file.
  - Pros: Context stays with the verse; easy to see next time.
  - Cons: Modifies canonical Bible files; sync conflicts; harder to separate personal notes.
- **Option B – Per‑verse note files** (recommended)
  - Create `bible_notes/<Book>/<Chapter>/<Verse>.md` with frontmatter: `ref`, `idx`, backlinks to the verse.
  - Pros: Clean separation of content vs notes, easy Dataview queries; safe to share Bible files.
  - Cons: More files; need helpers to open/create quickly.
- **Option C – Central notes ledger**
  - Append rows to `Bible-Questions.md` with columns: date, idx, ref, question, link.
  - Pros: Simple, one file; easy dashboard table.
  - Cons: Less context; retrieval depends on indexes.

- **Recommended implementation**:
  - Add settings: `notesMode` = `inline | perVerse | ledger` and `notesFolder` (for B).
  - Commands:
    - “Add Note for Current Verse” → opens/creates the target note location based on mode.
    - “List Notes for Today’s Target” → inserts a table of notes for the current indices.

### 7.3 Different reading plans
- **Setting**: `currentPlanId` and `plans` as an array of `{ id, path, title }`.
- **UI**: Dropdown to switch plan; validate and cache.
- **Migration**: When switching plan, compute `last_order` via map vs frontmatter.
- **Format**: Stick with current `{ref, path}` array for simplicity; support CSV importer later.

### 7.4 Related verses for topical reading
- **Goal**: Show cross‑references for each verse.
- **Sources**:
  - Prepackaged dataset, e.g., Treasury of Scripture Knowledge (TSK). Check license before bundling.
  - External API (requires key): fetch on demand and cache offline.
- **Implementation**:
  - Map `ref` (e.g., `Genesis 1:1`) → related refs (array). Maintain a lookup index from `ref` to plan indices.
  - Command/toggle: “Include related verses” in the Insert output or separate callout.
  - Performance: lazy load `crossref.json` only when the feature is enabled; paginate if large.
- **Pros**: Deep study; keeps context.
- **Cons**: Data size; licensing; UI complexity (avoid clutter in daily note).

---

## 8) Minimal roadmap

- **Phase 1** (stabilize)
  - Port JS to TS; keep command parity.
  - Add `bibleRoot`, `notesMode`, `notesFolder` settings.
  - Add plan switcher (`plans` list + `currentPlanId`).
- **Phase 2** (UX)
  - Ribbon/status bar indicators; hotkeys defaults.
  - Note commands (create/open per‑verse note; list notes for target).
  - Read-only “Progress Summary” insertion polished.
- **Phase 3** (study aids)
  - Cross‑reference support (local JSON + license note).
  - Optional: verse text preview toggle (on/off for speed).
- **Phase 4** (maintenance)
  - CSV importer/exporter for events and map.
  - Health checks: validate paths, plan length vs map keys.

---

## 9) Moving code into the new repo

- Extract zip or copy files from `.obsidian/plugins/bible-reading-workflow/` into the sample plugin `src/` (porting `main.js` → `main.ts`).
- Update `manifest.json` to match your new repo id and name.
- Add a `README.md` in the new project with:
  - Setup, settings, commands, data file expectations, troubleshooting.
- Build and copy to a test vault for verification.

---

## 10) Extra zip commands

Zip plugin + data to hand over a reproducible test set:

```powershell
# Everything the plugin needs to run & verify
$items = @(
  ".obsidian\plugins\bible-reading-workflow\*",
  "chronological_plan.vault.json",
  "Bible-Progress.md",
  "bible-read-map.json",
  "Bible-Read-Events.md",
  "Bible-Read-Log.md",
  "Bible-Dashboard.md",
  "Bible-Plugin-Migration.md"
)
Compress-Archive -Path $items -DestinationPath "bible-reading-workflow-bundle.zip" -Force
```

---

## 11) Final checklist

- **Create new repo** (sample template TS).
- **Copy/port code** and data format assumptions.
- **Add settings**: `bibleRoot`, `notesMode`, `notesFolder`, plan switcher.
- **Decide notes model** (per‑verse recommended); implement command.
- **Consider cross‑refs**: pick dataset or API; add toggle and lazy load.
- **Write README** (commands, settings, data, troubleshooting).
- **Release**: Test in a clean vault; tag a release.

---

If you want, I can start the TypeScript project and port `main.js` logic over, adding the new settings and note commands next.

---

## 12) Related project: obsidian-bible-reference (external verse fetch)

Reference: https://github.com/tim-hub/obsidian-bible-reference

### What it does
- Fetches Bible verses from external websites/APIs and inserts text into notes.
- Focuses on reference→text retrieval, not plan scheduling/progress mapping.

### Pros
- Quick on-demand verse insertion by reference (many translations available).
- Minimal setup; convenient for ad‑hoc quotes.

### Cons / Risks
- Network dependency (offline fails); potential rate limits or site changes.
- Licensing/ToS considerations for source sites and translations.
- Formatting may differ from your local files; harder to align with `chronological_plan.vault.json` indices.
- Caching needed to avoid repeated fetches and to stabilize content.

### Integration patterns with this plugin
- Complementary (recommended): keep your local plan/progress as source of truth; add a command to insert externally fetched verse text when requested.
- Hybrid toggle: setting `preferExternalVerseText` (default off). If on, attempt external fetch first; if unavailable, fall back to local vault text.
- Caching: store fetched verses under `bible_text_cache/<translation>/<book>/<chapter>.md` and reference cached content on subsequent inserts.
- Mapping: build a `ref → index` map from `chronological_plan.vault.json` so fetched refs can be linked back to plan indices for context.

### Recommended defaults
- Keep progress and reading text sourced from local vault files for reliability and offline use.
- Offer external fetch as an optional, on-demand enrichment feature with clear labeling of translation/source.

### developer thoughts
