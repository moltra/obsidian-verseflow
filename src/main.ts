import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { VerseFlowSettings, DEFAULT_SETTINGS, VerseFlowSettingsTab } from "./settings";
import { 
  todayISO, 
  parseDateISO, 
  readJson, 
  writeJson, 
  readText, 
  upsertText, 
  computeFromMap, 
  collectChapterVerses, 
  buildChapterNoteContent,
  np
} from "./utils";

/**
 * VerseFlow – Bible reading workflow for Obsidian.
 */
export default class VerseFlowPlugin extends Plugin {
  settings: VerseFlowSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new VerseFlowSettingsTab(this.app, this));

    // Optional first-time setup
    try {
      if (this.settings.setupOnFirstEnable && !this.settings.initialized) {
        await this.setupVerseFlowFiles();
        this.settings.initialized = true; 
        await this.saveSettings();
      }
    } catch (error) {
      console.error("VerseFlow: First-time setup failed", error);
      new Notice("VerseFlow: Setup failed. Check console for details.");
    }

    // Core commands (editor-only use editorCallback)
    this.addCommand({ id: "vf-insert-today-target", name: "Insert Today’s Target", editorCallback: () => this.insertTodayTarget() });
    this.addCommand({ id: "vf-finalize", name: "Finalize Bible Read", editorCallback: () => this.finalizeBibleRead() });
    this.addCommand({ id: "vf-clear-checkboxes", name: "Clear Bible Checkboxes", editorCallback: () => this.clearBibleCheckboxes() });

    // Maintenance
    this.addCommand({ id: "vf-seed-map-from-progress", name: "Seed Map From Progress", callback: () => this.seedMapFromProgress() });
    this.addCommand({ id: "vf-recompute-progress-from-map", name: "Recompute Progress From Map", callback: () => this.recomputeProgressFromMapCommand() });
    this.addCommand({ id: "vf-rebuild-map-from-events", name: "Rebuild Map From Events", callback: () => this.rebuildMapFromEventsCommand() });

    // Convenience
    this.addCommand({ id: "vf-open-dashboard", name: "Open Bible Dashboard", callback: () => this.openBibleDashboard() });
    this.addCommand({ id: "vf-insert-progress-summary", name: "Insert Progress Summary (read-only)", callback: () => this.insertProgressSummary() });
    this.addCommand({ id: "vf-setup-notes", name: "Setup VerseFlow Files", callback: () => this.setupVerseFlowFiles() });
    this.addCommand({ id: "vf-scaffold-chapter-notes", name: "Scaffold Chapter Notes From Plan", callback: () => this.scaffoldChapterNotesCommand() });
    this.addCommand({ id: "vf-open-chapter-note-at-cursor", name: "Open Chapter Note at Cursor", editorCallback: () => this.openChapterNoteAtCursor() });
    this.addCommand({ id: "vf-append-notes-for-checked", name: "Append Notes For Checked Verses", editorCallback: () => this.appendNotesForChecked() });
    this.addCommand({ id: "vf-regenerate-dashboard", name: "Regenerate Bible Dashboard", callback: () => this.regenerateBibleDashboard() });

    // Ribbon (best-effort, no-op on mobile)
    try { this.addRibbonIcon("checkmark", "VerseFlow: Finalize Bible Read", () => this.finalizeBibleRead()); } catch (e) { console.debug("VerseFlow: Could not add ribbon icon", e); }
    try { this.addRibbonIcon("document", "VerseFlow: Insert Today’s Target", () => this.insertTodayTarget()); } catch (e) { console.debug("VerseFlow: Could not add ribbon icon", e); }
    try { this.addRibbonIcon("trash", "VerseFlow: Clear Bible Checkboxes", () => this.clearBibleCheckboxes()); } catch (e) { console.debug("VerseFlow: Could not add ribbon icon", e); }
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  getActiveEditor(): Editor | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.editor) return view.editor;
    return this.app.workspace.activeEditor?.editor ?? null;
  }

  /** Read progress frontmatter snapshot. */
  async readProgress(): Promise<{ last_order: number; verses_read: number; total_verses: number; start_date: string; target_days: number; }> {
    const { progressPath } = this.settings;
    const f = this.app.vault.getAbstractFileByPath(progressPath) as TFile | null;
    if (!f) return { last_order: 0, verses_read: 0, total_verses: 31102, start_date: todayISO(), target_days: 365 };
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {} as any;
    return {
      last_order: Number.parseInt(fm.last_order ?? 0) || 0,
      verses_read: Number.parseInt(fm.verses_read ?? 0) || 0,
      total_verses: Number.parseInt(fm.total_verses ?? 31102) || 31102,
      start_date: typeof fm.start_date === "string" ? fm.start_date : todayISO(),
      target_days: Number.parseInt(fm.target_days ?? 365) || 365,
    };
  }

  // ---------- Commands ----------
  async insertTodayTarget() {
    const { planPath, useMap, maxToday, previewCount } = this.settings;
    const plan: Array<{ ref: string; path: string }> | null = await readJson(this.app, planPath);
    if (!Array.isArray(plan) || plan.length === 0) { new Notice("VerseFlow: plan not found"); return; }

    const prog = await this.readProgress();
    let versesRead = prog.verses_read;
    let lastOrder = prog.last_order;

    const mapObj = await readJson<Record<string, unknown>>(this.app, this.settings.mapPath);
    if (useMap && mapObj) {
      const c = computeFromMap(mapObj, plan.length);
      versesRead = c.uniqueRead; lastOrder = c.firstUnread;
    }

    const total = prog.total_verses ?? plan.length;
    const start = parseDateISO(prog.start_date ?? todayISO());
    const today = parseDateISO(todayISO());
    let daysElapsed = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
    if (!Number.isFinite(daysElapsed) || daysElapsed < 1) daysElapsed = 1;
    const targetDays = prog.target_days ?? 365;
    let expected = Math.ceil((total * daysElapsed) / targetDays);
    if (!Number.isFinite(expected) || expected < 0) expected = 0;
    const remaining = Math.max(0, total - versesRead);
    const daysRemaining = Math.max(1, targetDays - daysElapsed);
    let pace = Math.ceil(remaining / daysRemaining); if (!Number.isFinite(pace) || pace < 1) pace = 1;

    const defaultToday = Math.max(1, expected - versesRead || pace);
    const todayCount = Math.min(defaultToday, maxToday, Math.max(0, plan.length - lastOrder));

    const editor = this.getActiveEditor();
    if (!editor) { new Notice("VerseFlow: no active editor"); return; }

    const fileName = (p: string) => p.split("#")[0].split("/").pop() ?? "";
    const chapterLink = (p: string) => p.split("#")[0].replace(/\.md$/, "");

    const out: string[] = [];

    // Progress summary at the beginning
    const pctNow = total ? (((versesRead ?? 0) / total) * 100).toFixed(1) : "0.0";
    out.push(`Progress: ${versesRead}/${total} (${pctNow}%). Target ${targetDays} days from ${prog.start_date}. Today's pace: ${pace}.`);

    // Callout header
    out.push(`> [!abstract]+ Today's target to stay on schedule (${todayCount})`);
    out.push(`> `);
    let lastLbl = "";
    for (let i = 0; i < todayCount; i++) {
      const v = plan[lastOrder + i] as { ref: string; path: string } | undefined; if (!v) break;
      const lbl = fileName(v.path); const chap = chapterLink(v.path);
      if (lbl !== lastLbl) { out.push(`> **[[${chap}|${lbl}]]**`); lastLbl = lbl; }
      const idx = lastOrder + i;

      // Build links per notesLinkMode
      const verseLink = `[[${v.path}|${v.ref}]]`;
      const src = (v.path || '').split('#')[0];
      const parts2 = src.split('/');
      const fileName2 = parts2.pop() || '';
      const bookName2 = parts2.pop() || 'Bible';
      const chapterBase2 = fileName2.replace(/\.md$/i, '');
      const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const chapterSlug2 = slug(chapterBase2);
      const notesPath = `${this.settings.notesBasePath}/${bookName2}/${chapterSlug2}${this.settings.notesSuffix}`;
      const verseNum = Number(((v.ref || '').match(/:(\d+)/) || [])[1]);
      const anchor = Number.isFinite(verseNum) ? `#v-${verseNum}` : `#i-${idx}`;

      const mode = this.settings.notesLinkMode ?? 'dual';
      let linkText = verseLink;
      if (mode === 'chapter') linkText = `[[${notesPath}${anchor}|${v.ref} notes]]`;
      else if (mode === 'dual') linkText = `${verseLink} • [[${notesPath}${anchor}|notes]]`;

      out.push(`> - [ ] ${linkText} (idx:${idx})`);
    }

    const nextStart = lastOrder + todayCount;
    const nextArr = plan.slice(nextStart, Math.min(nextStart + previewCount, plan.length));
    out.push(`\n> [!abstract]- Next ${nextArr.length} verses after today's target (boundaries shown)`);
    lastLbl = "";
    for (let i = 0; i < nextArr.length; i++) {
      const v = nextArr[i] as { ref: string; path: string };
      const lbl = fileName(v.path); const chap = chapterLink(v.path);
      if (lbl !== lastLbl) { out.push(`> **[[${chap}|${lbl}]]**`); lastLbl = lbl; }
      const idx = nextStart + i;
      const verseLink = `[[${v.path}|${v.ref}]]`;
      const src = (v.path || '').split('#')[0];
      const parts2 = src.split('/');
      const fileName2 = parts2.pop() || '';
      const bookName2 = parts2.pop() || 'Bible';
      const chapterBase2 = fileName2.replace(/\.md$/i, '');
      const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const chapterSlug2 = slug(chapterBase2);
      const notesPath = `${this.settings.notesBasePath}/${bookName2}/${chapterSlug2}${this.settings.notesSuffix}`;
      const verseNum = Number(((v.ref || '').match(/:(\d+)/) || [])[1]);
      const anchor = Number.isFinite(verseNum) ? `#v-${verseNum}` : `#i-${idx}`;
      const mode = this.settings.notesLinkMode ?? 'dual';
      let linkText = verseLink;
      if (mode === 'chapter') linkText = `[[${notesPath}${anchor}|${v.ref} notes]]`;
      else if (mode === 'dual') linkText = `${verseLink} • [[${notesPath}${anchor}|notes]]`;
      out.push(`> - [ ] ${linkText} (idx:${idx})`);
    }

    editor.replaceSelection(out.join("\n") + "\n");
  }

  async setupVerseFlowFiles() {
    const { progressPath, eventsPath, mapPath } = this.settings;
    const ensure = async (path: string, content: string) => {
      const f = this.app.vault.getAbstractFileByPath(path) as TFile | null;
      if (!f) await this.app.vault.create(path, content);
    };

    // Progress frontmatter
    const today = todayISO();
    const progressFm = `---\nlast_order: 0\nverses_read: 0\ntotal_verses: 31102\nstart_date: ${today}\ntarget_days: 365\n---\n`;
    await ensure(progressPath, progressFm);

    // Events and log tables
    await ensure(eventsPath, `| timestamp | idx | ref | path |\n|---|---:|---|---|\n`);
    await ensure("Bible-Read-Log.md", `| date | start_ref | end_ref | count | last_order |\n|---|---|---|---:|---:|\n`);

    // Map JSON
    const mapF = this.app.vault.getAbstractFileByPath(mapPath) as TFile | null;
    if (!mapF) await this.app.vault.create(mapPath, "{}\n");

    // Minimal dashboard if missing (requires Dataview)
    const dashPath = "Bible-Dashboard.md";
    const dash = this.app.vault.getAbstractFileByPath(dashPath) as TFile | null;
    if (!dash) { await this.app.vault.create(dashPath, this.getDashboardContent()); }

    new Notice("VerseFlow: setup complete");
  }

  async scaffoldChapterNotesCommand() {
    const { planPath, notesBasePath, notesSuffix } = this.settings;
    const plan: Array<{ ref?: string; path?: string }> | null = await readJson(this.app, planPath);
    if (!Array.isArray(plan) || plan.length === 0) { new Notice("VerseFlow: plan not found"); return; }

    // Ensure base folder exists
    try { 
      if (!this.app.vault.getAbstractFileByPath(notesBasePath)) {
        await this.app.vault.createFolder(notesBasePath);
      }
    } catch (e) {
      console.warn("VerseFlow: createFolder error", e);
    }

    // Pre-group verses by chapter for efficiency
    const byChapter = new Map<string, { book: string; base: string; verses: Array<{ num: number; ref: string }> }>();
    for (const v of plan) {
      const p = v.path || ""; if (!p) continue;
      const src = p.split('#')[0];
      const segs = src.split('/'); const fn = segs.pop() || ''; const bk = segs.pop() || 'Bible';
      const base = fn.replace(/\.md$/i, '');
      const ref = v.ref || '';
      const num = Number(((ref.match(/:(\d+)/) || [])[1]));
      if (!Number.isFinite(num)) continue;
      const key = `${bk}/${base}`;
      const entry = byChapter.get(key) || { book: bk, base, verses: [] };
      entry.verses.push({ num, ref });
      byChapter.set(key, entry);
    }

    const created = new Set<string>();
    let newCount = 0;
    for (const v of plan) {
      const src = (v.path || '').split('#')[0]; if (!src) continue;
      const parts = src.split('/');
      const fileName = parts.pop() || '';
      const bookName = parts.pop() || 'Bible'; // last folder segment as book name
      const chapterBase = fileName.replace(/\.md$/i, '');
      const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const chapterSlug = slug(chapterBase);
      const destDir = `${notesBasePath}/${bookName}`;
      const destPath = `${destDir}/${chapterSlug}${notesSuffix}`;
      if (created.has(destPath)) continue;
      created.add(destPath);

      // ensure folder
      try { 
        if (!this.app.vault.getAbstractFileByPath(destDir)) {
          await this.app.vault.createFolder(destDir);
        }
      } catch {}

      // create file if missing (with all verse stubs)
      const f = this.app.vault.getAbstractFileByPath(destPath) as TFile | null;
      if (!f) {
        const key = `${bookName}/${chapterBase}`;
        const verses = byChapter.get(key)?.verses || collectChapterVerses(plan, bookName, chapterBase);
        const content = buildChapterNoteContent(bookName, chapterBase, verses);
        await this.app.vault.create(destPath, content);
        newCount++;
      }
    }
    new Notice(`VerseFlow: scaffolded ${newCount} chapter note(s) under ${notesBasePath}`);
  }

  async openChapterNoteAtCursor() {
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line) || '';
    // Extract the primary [[path|ref]] and idx
    const linkMatch = line.match(/\[\[([^\]|]+)\|([^\]]+)\]\]/);
    const idxMatch = line.match(/\(idx:(\d+)\)/);
    if (!linkMatch) { new Notice("VerseFlow: no verse link on this line"); return; }
    const path = linkMatch[1];
    const ref = linkMatch[2];
    const verseNum = Number(((ref || '').match(/:(\d+)/) || [])[1]);
    const src = (path || '').split('#')[0];
    const parts = src.split('/');
    const fileName = parts.pop() || '';
    const bookName = parts.pop() || 'Bible';
    const chapterBase = fileName.replace(/\.md$/i, '');
    const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const chapterSlug = slug(chapterBase);
    const destDir = `${this.settings.notesBasePath}/${bookName}`;
    const destPath = `${destDir}/${chapterSlug}${this.settings.notesSuffix}`;

    try { 
      if (!this.app.vault.getAbstractFileByPath(destDir)) {
        await this.app.vault.createFolder(destDir);
      }
    } catch {}
    
    let f = this.app.vault.getAbstractFileByPath(destPath) as TFile | null;
    if (!f) {
      const plan = (await readJson<Array<{ ref: string; path: string }>>(this.app, this.settings.planPath)) || [];
      const verses = collectChapterVerses(plan, bookName, chapterBase);
      const content = buildChapterNoteContent(bookName, chapterBase, verses);
      await this.app.vault.create(destPath, content);
      f = this.app.vault.getAbstractFileByPath(destPath) as TFile;
    }

    // Ensure verse heading exists
    const anchor = Number.isFinite(verseNum) ? `v-${verseNum}` : (idxMatch ? `i-${idxMatch[1]}` : `v-1`);
    let text = await this.app.vault.read(f);
    if (!new RegExp(`^#{1,6}\\s+${anchor}\\b`, 'm').test(text)) {
      const heading = `\n### ${anchor} — ${ref}\n\n`;
      text += heading;
      await this.app.vault.modify(f, text);
    }

    const leaf = this.app.workspace.getLeaf(true) as any;
    await leaf.openFile(f);
    new Notice(`VerseFlow: opened ${chapterSlug}${this.settings.notesSuffix} at ${anchor}`);
  }

  async finalizeBibleRead() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const content = editor.getValue();
    const re = /\[[xX]\][^\n]*\(idx:(\d+)\)/g;
    let m: RegExpExecArray | null; const indices = new Set<number>();
    while ((m = re.exec(content)) !== null) { const n = Number.parseInt(m[1]); if (!Number.isNaN(n)) indices.add(n); }
    if (indices.size === 0) { new Notice("VerseFlow: no checked items found"); return; }

    let mapObj: Record<string, string[]> = (await readJson(this.app, mapPath)) || {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    const sorted = [...indices].sort((a, b) => a - b);
    for (const idx of sorted) {
      if (!Array.isArray(mapObj[idx])) mapObj[idx] = [] as any;
      const arr = mapObj[idx]; if (arr[arr.length - 1] !== localISO) arr.push(localISO);
    }
    await writeJson(this.app, mapPath, mapObj);

    const plan = (await readJson<Array<{ ref: string; path: string }>>(this.app, planPath)) || [];
    const c = computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);

    // events
    const header = `| timestamp | idx | ref | path |\n|---|---:|---|---|\n`;
    let rows = "";
    for (const idx of sorted) { const v = plan[idx]; if (!v) continue; rows += `| ${localISO} | ${idx} | ${v.ref} | ${v.path} |\n`; }
    const f = this.app.vault.getAbstractFileByPath(eventsPath) as TFile | null;
    if (f) {
      const existing = await this.app.vault.read(f);
      if (/\n\|\s*timestamp\s*\|/.test(existing)) await this.app.vault.modify(f, existing + rows);
      else await this.app.vault.modify(f, existing + "\n" + header + rows);
    } else {
      await this.app.vault.create(eventsPath, header + rows);
    }

    // session summary
    try {
      const logPath = "Bible-Read-Log.md";
      const logHeader = `| date | start_ref | end_ref | count | last_order |\n|---|---|---|---:|---:|\n`;
      const first = sorted[0]; const last = sorted[sorted.length - 1];
      const startRef = plan[first]?.ref ?? ""; const endRef = plan[last]?.ref ?? "";
      const row = `| ${localISO.slice(0, 10)} | ${startRef} | ${endRef} | ${sorted.length} | ${c.firstUnread} |\n`;
      const lf = this.app.vault.getAbstractFileByPath(logPath) as TFile | null;
      if (lf) {
        const prev = await this.app.vault.read(lf);
        if (/\n\|\s*date\s*\|/.test(prev)) await this.app.vault.modify(lf, prev + row);
        else await this.app.vault.modify(lf, prev + "\n" + logHeader + row);
      } else {
        await this.app.vault.create(logPath, logHeader + row);
      }
    } catch {}

    new Notice(`VerseFlow: finalized ${sorted.length} verse(s)`);
  }

  async updateProgressFrontmatter(path: string, lastOrder: number, versesRead: number) {
    const f = this.app.vault.getAbstractFileByPath(np(path)) as TFile | null; if (!f) return;
    await this.app.fileManager.processFrontMatter(f, (fm) => {
      (fm as any).last_order = lastOrder;
      (fm as any).verses_read = versesRead;
    });
  }

  async clearBibleCheckboxes() {
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const content = editor.getValue();
    const cleared = content.replace(/\[\s*[xX]\s*\](?=[^\n]*\(idx:\d+\))/g, "[ ]");
    if (cleared !== content) editor.setValue(cleared);
    new Notice("VerseFlow: cleared checks");
  }

  async seedMapFromProgress() {
    const { mapPath, progressPath, planPath } = this.settings;
    const prog = await this.readProgress();
    const plan = (await readJson<Array<unknown>>(this.app, planPath)) || [];
    const upTo = Math.min(prog.verses_read ?? 0, plan.length);
    const mapObj: Record<string, string[]> = {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    for (let i = 0; i < upTo; i++) mapObj[i] = [localISO];
    await writeJson(this.app, mapPath, mapObj);

    const c = computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    new Notice(`VerseFlow: seeded ${upTo} indices from progress`);
  }

  async recomputeProgressFromMapCommand() {
    const { mapPath, planPath, progressPath } = this.settings;
    const mapObj = (await readJson<Record<string, string[]>>(this.app, mapPath)) || {};
    const plan = (await readJson<Array<unknown>>(this.app, planPath)) || [];
    const c = computeFromMap(mapObj, (plan as any[]).length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    new Notice(`VerseFlow: recomputed progress (read=${c.uniqueRead})`);
  }

  async rebuildMapFromEventsCommand() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const text = (await readText(this.app, eventsPath)) || "";
    const lines = text.split("\n").filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l));
    const data = lines.slice(1);
    const mapObj: Record<string, string[]> = {};
    for (const line of data) {
      const cols = line.split("|").map((s) => s.trim());
      if (cols.length >= 5) {
        const ts = cols[1]; const idx = Number(cols[2]);
        if (Number.isFinite(idx) && ts) {
          if (!Array.isArray(mapObj[idx])) mapObj[idx] = [];
          const arr = mapObj[idx]; if (arr[arr.length - 1] !== ts) arr.push(ts);
        }
      }
    }
    await writeJson(this.app, mapPath, mapObj);
    const plan = (await readJson<Array<unknown>>(this.app, planPath)) || [];
    const c = computeFromMap(mapObj, (plan as any[]).length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    new Notice(`VerseFlow: rebuilt map from events (${Object.keys(mapObj).length} entries)`);
  }

  async openBibleDashboard() {
    const path = "Bible-Dashboard.md";
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) { new Notice("VerseFlow: dashboard not found"); return; }
    const leaf = this.app.workspace.getLeaf(true) as any;
    await leaf.openFile(f);
  }

  private getDashboardContent(): string {
    return `# Bible Reading Dashboard\n\n- **Overview**: Live progress and history powered by VerseFlow + Dataview.\n- Ensure the Dataview plugin is enabled and DataviewJS is allowed.\n\n## Progress (DataviewJS)\n\n\`\`\`dataviewjs\n{\n  const p = dv.page(\"Bible-Progress\");\n  if (!p) { dv.paragraph(\"Bible-Progress.md not found\"); } else {\n    const total = p.total_verses ?? 31102;\n    const pct = total ? ((p.verses_read ?? 0) / total * 100).toFixed(1) + \"%\" : \"0.0%\";\n    dv.table([\n      \"last_order\",\"verses_read\",\"total_verses\",\"progress\",\"start_date\",\"target_days\"\n    ], [[\n      p.last_order ?? 0,\n      p.verses_read ?? 0,\n      total,\n      pct,\n      p.start_date ?? dv.luxon.DateTime.now().toISODate(),\n      p.target_days ?? 365\n    ]]);\n  }\n}\n\`\`\`\n\n## Recommended pace today (DataviewJS)\n\n\`\`\`dataviewjs\n{\n  const p = dv.page(\"Bible-Progress\");\n  if (!p) { dv.el(\"div\", \"Bible-Progress.md not found\"); } else {\n    const total = p.total_verses ?? 31102;\n    const start = new Date((p.start_date ?? dv.current().file.ctime.toISODate()) + \"T00:00:00\");\n    const today = new Date(dv.current().file.cday.toISODate() + \"T00:00:00\");\n    const daysElapsed = Math.max(1, Math.floor((today - start) / 86400000) + 1);\n    const targetDays = p.target_days ?? 365;\n    const expected = Math.ceil((total * daysElapsed) / targetDays);\n    const remaining = Math.max(0, total - (p.verses_read ?? 0));\n    const daysRemaining = Math.max(1, targetDays - daysElapsed);\n    const pace = Math.max(1, Math.ceil(remaining / daysRemaining));\n    const catchup = Math.max(0, expected - (p.verses_read ?? 0));\n    dv.paragraph(\`Recommended today: \${catchup || pace} verses (pace \${pace}, catch-up \${catchup}).\`);\n  }\n}\n\`\`\`\n`;
  }

  async regenerateBibleDashboard() {
    const path = "Bible-Dashboard.md";
    const f = this.app.vault.getAbstractFileByPath(path) as TFile | null;
    const content = this.getDashboardContent();
    if (f) await this.app.vault.modify(f, content); else await this.app.vault.create(path, content);
    new Notice("VerseFlow: Bible-Dashboard regenerated");
  }

  async insertProgressSummary() {
    const editor = this.getActiveEditor();
    const { planPath } = this.settings;
    const plan = (await readJson<Array<unknown>>(this.app, planPath)) || [];
    const prog = await this.readProgress();
    const total = prog.total_verses ?? (plan as any[]).length;
    const start = parseDateISO(prog.start_date ?? todayISO());
    const today = parseDateISO(todayISO());
    let daysElapsed = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1; if (!Number.isFinite(daysElapsed) || daysElapsed < 1) daysElapsed = 1;
    const targetDays = prog.target_days ?? 365;
    const remaining = Math.max(0, total - (prog.verses_read ?? 0));
    const daysRemaining = Math.max(1, targetDays - daysElapsed);
    let pace = Math.ceil(remaining / daysRemaining); if (!Number.isFinite(pace) || pace < 1) pace = 1;
    const pct = total ? (((prog.verses_read ?? 0) / total) * 100).toFixed(1) : "0.0";
    let line = `> Progress: ${prog.verses_read}/${total} (${pct}%). Target ${targetDays} days from ${prog.start_date}. Today's pace: ${pace}.`;
    if (this.settings.includeDashboardLink) {
      line += ` See [[Bible-Dashboard|Bible Dashboard]] for overall progress.`;
    }

    if (editor) {
      editor.replaceSelection(line + "\n");
    } else {
      const summaryPath = "VerseFlow-Summary.md";
      const prev = (await readText(this.app, summaryPath)) || "";
      const next = (prev.endsWith("\n") || prev.length === 0) ? prev + line + "\n" : prev + "\n" + line + "\n";
      await upsertText(this.app, summaryPath, next);
      new Notice(`VerseFlow: summary appended to ${summaryPath}`);
    }
  }
  
  async appendNotesForChecked() {
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const text = editor.getValue();
    // Match checked list items we generate inside the callout (leading '> - [x] ... (idx:N)')
    const lineRE = /^>\s*-\s*\[(?:x|X)\]\s*(.*?)(\(idx:(\d+)\))?\s*$/gm;
    const linkRE = /\[\[([^\]|]+)\|([^\]]+)\]\]/;
    type Target = { destDir: string; destPath: string; anchor: string; ref: string; chapterBase: string };
    const targets: Record<string, Target[]> = {};

    let m: RegExpExecArray | null;
    while ((m = lineRE.exec(text)) !== null) {
      const line = m[0];
      const link = line.match(linkRE);
      if (!link) continue;
      const path = link[1]; const ref = link[2];
      const idxCap = m[3];
      const src = (path || '').split('#')[0]; const parts = src.split('/');
      const fileName = parts.pop() || ''; const bookName = parts.pop() || 'Bible';
      const chapterBase = fileName.replace(/\.md$/i, '');
      const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const chapterSlug = slug(chapterBase);
      const destDir = `${this.settings.notesBasePath}/${bookName}`;
      const destPath = `${destDir}/${chapterSlug}${this.settings.notesSuffix}`;
      const verseNum = Number(((ref || '').match(/:(\d+)/) || [])[1]);
      const anchor = Number.isFinite(verseNum) ? `v-${verseNum}` : (idxCap ? `i-${idxCap}` : `v-1`);
      if (!targets[destPath]) targets[destPath] = [];
      targets[destPath].push({ destDir, destPath, anchor, ref, chapterBase });
    }

    let filesTouched = 0; let anchorsAdded = 0;
    const plan = (await readJson<Array<{ ref: string; path: string }>>(this.app, this.settings.planPath)) || [];
    
    // Optimizing async operations with Promise.all for independent files
    const tasks = Object.entries(targets).map(async ([destPath, arr]) => {
      const { destDir } = arr[0];
      try { 
        if (!this.app.vault.getAbstractFileByPath(destDir)) {
          await this.app.vault.createFolder(destDir);
        }
      } catch {}
      
      let f = this.app.vault.getAbstractFileByPath(destPath) as TFile | null;
      if (!f) {
        const verses = collectChapterVerses(plan, destDir.split('/').pop() || 'Bible', arr[0].chapterBase);
        const content = buildChapterNoteContent(destDir.split('/').pop() || 'Bible', arr[0].chapterBase, verses);
        await this.app.vault.create(destPath, content);
        f = this.app.vault.getAbstractFileByPath(destPath) as TFile; 
        filesTouched++;
      }
      
      // We must read fresh content here
      let content = await this.app.vault.read(f);
      let localAdded = 0;
      for (const t of arr) {
        if (!new RegExp(`^#{1,6}\\s+${t.anchor}\\b`, 'm').test(content)) {
          const heading = `\n### ${t.anchor} — ${t.ref}\n\n- `;
          content += heading; 
          localAdded++;
        }
      }
      if (localAdded > 0) {
        await this.app.vault.modify(f, content);
        anchorsAdded += localAdded;
      }
    });

    await Promise.all(tasks);
    new Notice(`VerseFlow: updated ${Object.keys(targets).length} note(s), added ${anchorsAdded} anchor(s)`);
  }
}
