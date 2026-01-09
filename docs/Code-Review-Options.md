# Project Review & Refactoring Options

Generated: 2025-12-26
Scope: `main.ts`, `package.json`, project structure

## 1. Architecture & Organization

### Option A: Split `main.ts` into modules (Highly Recommended)
Currently, `main.ts` is a monolithic file handling configuration, UI (settings), file I/O, and business logic.
- **Why**: As features grow, a monolithic file becomes hard to navigate, test, and debug.
- **Action**:
  - Move `VerseFlowSettings`, `DEFAULT_SETTINGS`, and `VerseFlowSettingsTab` to a `settings.ts`.
  - Move helper functions like `collectChapterVerses`, `computeFromMap`, and `readProgress` to a `src/utils.ts` or `src/services/` directory.
  - Keep `main.ts` focused only on plugin lifecycle (`onload`, `onunload`) and wiring up commands.

### Option B: Adopt a standard folder structure
- **Why**: Keeps the root clean and separates source code from build config.
- **Action**: Move all source files into a `src/` folder (e.g., `src/main.ts`, `src/settings.ts`).
  - *Note: This requires updating `esbuild.config.mjs` entry point.*

## 2. Code Quality & Safety

### Option C: Improve Error Handling
There are empty catch blocks (swallowed errors) in `onload` and `addRibbonIcon`:
```typescript
try { ... } catch {} // Swallows errors silently
```
- **Why**: If setup fails, you won't know why, making debugging difficult.
- **Action**: Log errors to the console (`console.error`) or show a `Notice` to the user so issues are visible during development.

### Option D: Remove explicit `any` casts
Example: `(this.app.vault as any).createFolder(destDir)` in `appendNotesForChecked`.
- **Why**: `createFolder` is a standard method on `Vault` in recent Obsidian APIs. Using `any` bypasses type safety and hides potential API mismatches.
- **Action**: Ensure `@types` are correct and remove the cast.

## 3. Dependency Management

### Option E: Pin the `obsidian` package version
In `package.json`: `"obsidian": "latest"`.
- **Why**: "Latest" moves constantly. A future update to the Obsidian API types could break your build unexpectedly.
- **Action**: Pin it to a specific version (e.g., `"obsidian": "1.4.16"`) that matches your `minAppVersion` in `manifest.json`.

## 4. Logic Improvements

### Option F: Robust Verse Parsing
The regex logic in `collectChapterVerses` relies on specific string formats (e.g., `#^v(\d+)`).
- **Why**: Markdown links can vary (e.g., wikilinks vs markdown links, aliases).
- **Action**: Consider using Obsidian's metadata cache (`this.app.metadataCache.getFileCache(file)`) to inspect block IDs and headings reliably instead of raw string parsing.

### Option G: Async File Operations
Methods like `appendNotesForChecked` await file operations inside loops.
- **Why**: Serial processing is slower than necessary.
- **Action**: Use `Promise.all` for independent file reads/writes where safe to improve performance.
