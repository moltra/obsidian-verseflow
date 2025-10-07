import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

/**
 * VerseFlow – Bible reading workflow for Obsidian.
 *
 * Commands:
 * - Insert Today’s Target
 * - Finalize Bible Read
 * - Clear Bible Checkboxes
 * - Seed Map From Progress
 * - Recompute Progress From Map
 * - Rebuild Map From Events
 * - Open Bible Dashboard
 * - Insert Progress Summary (read-only)
 */

export interface VerseFlowSettings {
  planPath: string;
  progressPath: string;
  mapPath: string;
  eventsPath: string;
  useMap: boolean;
  maxToday: number;
  previewCount: number;
}

const DEFAULT_SETTINGS: VerseFlowSettings = {
  planPath: "chronological_plan.vault.json",
  progressPath: "Bible-Progress.md",
  mapPath: "bible-read-map.json",
  eventsPath: "Bible-Read-Events.md",
  useMap: true,
  maxToday: 40,
  previewCount: 20,
};

export default class VerseFlowPlugin extends Plugin {
  settings: VerseFlowSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new VerseFlowSettingsTab(this.app, this));

    // Core commands
    this.addCommand({ id: "vf-insert-today-target", name: "Insert Today’s Target", callback: () => this.insertTodayTarget() });
    this.addCommand({ id: "vf-finalize", name: "Finalize Bible Read", callback: () => this.finalizeBibleRead() });
    this.addCommand({ id: "vf-clear-checkboxes", name: "Clear Bible Checkboxes", callback: () => this.clearBibleCheckboxes() });

    // Maintenance
    this.addCommand({ id: "vf-seed-map-from-progress", name: "Seed Map From Progress", callback: () => this.seedMapFromProgress() });
    this.addCommand({ id: "vf-recompute-progress-from-map", name: "Recompute Progress From Map", callback: () => this.recomputeProgressFromMapCommand() });
    this.addCommand({ id: "vf-rebuild-map-from-events", name: "Rebuild Map From Events", callback: () => this.rebuildMapFromEventsCommand() });

    // Convenience
    this.addCommand({ id: "vf-open-dashboard", name: "Open Bible Dashboard", callback: () => this.openBibleDashboard() });
    this.addCommand({ id: "vf-insert-progress-summary", name: "Insert Progress Summary (read-only)", callback: () => this.insertProgressSummary() });

    // Ribbon (best-effort, no-op on mobile)
    try { this.addRibbonIcon("checkmark", "VerseFlow: Finalize Bible Read", () => this.finalizeBibleRead()); } catch {}
    try { this.addRibbonIcon("document", "VerseFlow: Insert Today’s Target", () => this.insertTodayTarget()); } catch {}
    try { this.addRibbonIcon("trash", "VerseFlow: Clear Bible Checkboxes", () => this.clearBibleCheckboxes()); } catch {}
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  // ---------- Utils ----------
  todayISO(): string { return new Date().toISOString().slice(0, 10); }
  parseDateISO(d: string): Date { return new Date(`${d}T00:00:00`); }

  async readJson<T = any>(path: string): Promise<T | null> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return null;
    try { return JSON.parse(await this.app.vault.read(f as TFile)); } catch { return null; }
  }
  async writeJson(path: string, obj: unknown): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    const json = JSON.stringify(obj, null, 2);
    if (f instanceof TFile) await this.app.vault.modify(f, json);
    else await this.app.vault.create(path, json);
  }
  async readText(path: string): Promise<string | null> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return null;
    try { return await this.app.vault.read(f as TFile); } catch { return null; }
  }
  async upsertText(path: string, content: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.modify(f, content);
    else await this.app.vault.create(path, content);
  }

  getActiveEditor(): Editor | null {
    const leaf = this.app.workspace.activeLeaf as any;
    return leaf?.view?.editor ?? null;
  }

  /** Read progress frontmatter snapshot. */
  async readProgress(): Promise<{ last_order: number; verses_read: number; total_verses: number; start_date: string; target_days: number; }> {
    const { progressPath } = this.settings;
    const f = this.app.vault.getAbstractFileByPath(progressPath) as TFile | null;
    if (!f) return { last_order: 0, verses_read: 0, total_verses: 31102, start_date: this.todayISO(), target_days: 365 };
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {} as any;
    return {
      last_order: Number.parseInt(fm.last_order ?? 0) || 0,
      verses_read: Number.parseInt(fm.verses_read ?? 0) || 0,
      total_verses: Number.parseInt(fm.total_verses ?? 31102) || 31102,
      start_date: typeof fm.start_date === "string" ? fm.start_date : this.todayISO(),
      target_days: Number.parseInt(fm.target_days ?? 365) || 365,
    };
  }

  /** Compute counts from map (unique read count and first unread index). */
  computeFromMap(mapObj: Record<string, unknown> | null, total: number): { uniqueRead: number; firstUnread: number } {
    let uniqueRead = 0; let firstUnread = 0; let seenUnread = false;
    for (let i = 0; i < total; i++) {
      const v: any = mapObj?.[i as any];
      const has = Array.isArray(v) ? v.length > 0 : !!v;
      if (has) uniqueRead++; else if (!seenUnread) { firstUnread = i; seenUnread = true; }
    }
    if (!seenUnread) firstUnread = total; // fully read
    return { uniqueRead, firstUnread };
  }

  // ---------- Commands ----------
  async insertTodayTarget() {
    const { planPath, useMap, maxToday, previewCount } = this.settings;
    const plan: Array<{ ref: string; path: string }> | null = await this.readJson(planPath);
    if (!Array.isArray(plan) || plan.length === 0) { new Notice("VerseFlow: plan not found"); return; }

    const prog = await this.readProgress();
    let versesRead = prog.verses_read;
    let lastOrder = prog.last_order;

    const mapObj = await this.readJson<Record<string, unknown>>(this.settings.mapPath);
    if (useMap && mapObj) {
      const c = this.computeFromMap(mapObj, plan.length);
      versesRead = c.uniqueRead; lastOrder = c.firstUnread;
    }

    const total = prog.total_verses ?? plan.length;
    const start = this.parseDateISO(prog.start_date ?? this.todayISO());
    const today = this.parseDateISO(this.todayISO());
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
    out.push(`> [!abstract]+ Today's target to stay on schedule (${todayCount})`);
    let lastLbl = "";
    for (let i = 0; i < todayCount; i++) {
      const v = plan[lastOrder + i]; if (!v) break;
      const lbl = fileName(v.path); const chap = chapterLink(v.path);
      if (lbl !== lastLbl) { out.push(`> **[[${chap}|${lbl}]]**`); lastLbl = lbl; }
      const idx = lastOrder + i;
      out.push(`> - [ ] [[${v.path}|${v.ref}]] (idx:${idx})`);
    }

    const nextStart = lastOrder + todayCount;
    const nextArr = plan.slice(nextStart, Math.min(nextStart + previewCount, plan.length));
    out.push(`\n> [!abstract]- Next ${nextArr.length} verses after today's target (boundaries shown)`);
    lastLbl = "";
    for (let i = 0; i < nextArr.length; i++) {
      const v = nextArr[i]; const lbl = fileName(v.path); const chap = chapterLink(v.path);
      if (lbl !== lastLbl) { out.push(`> **[[${chap}|${lbl}]]**`); lastLbl = lbl; }
      const idx = nextStart + i; out.push(`> - [ ] [[${v.path}|${v.ref}]] (idx:${idx})`);
    }

    editor.replaceSelection(out.join("\n") + "\n");
  }

  async finalizeBibleRead() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const content = editor.getValue();
    const re = /\[[xX]\][^\n]*\(idx:(\d+)\)/g;
    let m: RegExpExecArray | null; const indices = new Set<number>();
    while ((m = re.exec(content)) !== null) { const n = Number.parseInt(m[1]); if (!Number.isNaN(n)) indices.add(n); }
    if (indices.size === 0) { new Notice("VerseFlow: no checked items found"); return; }

    let mapObj: Record<string, string[]> = (await this.readJson(mapPath)) || {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    const sorted = [...indices].sort((a, b) => a - b);
    for (const idx of sorted) {
      if (!Array.isArray(mapObj[idx])) mapObj[idx] = [] as any;
      const arr = mapObj[idx]; if (arr[arr.length - 1] !== localISO) arr.push(localISO);
    }
    await this.writeJson(mapPath, mapObj);

    const plan = (await this.readJson<Array<{ ref: string; path: string }>>(planPath)) || [];
    const c = this.computeFromMap(mapObj, plan.length);
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
    const f = this.app.vault.getAbstractFileByPath(path) as TFile | null; if (!f) return;
    let text = await this.app.vault.read(f);
    if (!/^---/.test(text)) text = `---\n---\n` + text;
    if (/last_order:\s*\d+/i.test(text)) text = text.replace(/last_order:\s*\d+/i, `last_order: ${lastOrder}`);
    else text = text.replace(/^---\n/, `---\nlast_order: ${lastOrder}\n`);
    if (/verses_read:\s*\d+/i.test(text)) text = text.replace(/verses_read:\s*\d+/i, `verses_read: ${versesRead}`);
    else text = text.replace(/^---\n/, `---\nverses_read: ${versesRead}\n`);
    await this.app.vault.modify(f, text);
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
    const plan = (await this.readJson<Array<unknown>>(planPath)) || [];
    const upTo = Math.min(prog.verses_read ?? 0, plan.length);
    const mapObj: Record<string, string[]> = {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    for (let i = 0; i < upTo; i++) mapObj[i] = [localISO];
    await this.writeJson(mapPath, mapObj);

    const c = this.computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    new Notice(`VerseFlow: seeded ${upTo} indices from progress`);
  }

  async recomputeProgressFromMapCommand() {
    const { mapPath, planPath, progressPath } = this.settings;
    const mapObj = (await this.readJson<Record<string, string[]>>(mapPath)) || {};
    const plan = (await this.readJson<Array<unknown>>(planPath)) || [];
    const c = this.computeFromMap(mapObj, (plan as any[]).length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    new Notice(`VerseFlow: recomputed progress (read=${c.uniqueRead})`);
  }

  async rebuildMapFromEventsCommand() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const text = (await this.readText(eventsPath)) || "";
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
    await this.writeJson(mapPath, mapObj);
    const plan = (await this.readJson<Array<unknown>>(planPath)) || [];
    const c = this.computeFromMap(mapObj, (plan as any[]).length);
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

  async insertProgressSummary() {
    const editor = this.getActiveEditor(); if (!editor) { new Notice("VerseFlow: no active editor"); return; }
    const { planPath } = this.settings;
    const plan = (await this.readJson<Array<unknown>>(planPath)) || [];
    const prog = await this.readProgress();
    const total = prog.total_verses ?? (plan as any[]).length;
    const start = this.parseDateISO(prog.start_date ?? this.todayISO());
    const today = this.parseDateISO(this.todayISO());
    let daysElapsed = Math.floor((today.getTime() - start.getTime()) / 86400000) + 1; if (!Number.isFinite(daysElapsed) || daysElapsed < 1) daysElapsed = 1;
    const targetDays = prog.target_days ?? 365;
    const remaining = Math.max(0, total - (prog.verses_read ?? 0));
    const daysRemaining = Math.max(1, targetDays - daysElapsed);
    let pace = Math.ceil(remaining / daysRemaining); if (!Number.isFinite(pace) || pace < 1) pace = 1;
    const pct = total ? (((prog.verses_read ?? 0) / total) * 100).toFixed(1) : "0.0";
    const line = `> Progress: ${prog.verses_read}/${total} (${pct}%). Target ${targetDays} days from ${prog.start_date}. Today's pace: ${pace}.`;
    editor.replaceSelection(line + "\n");
  }
}

class VerseFlowSettingsTab extends PluginSettingTab {
  plugin: VerseFlowPlugin;
  constructor(app: App, plugin: VerseFlowPlugin) { super(app, plugin); this.plugin = plugin; }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VerseFlow Settings" });

    const addText = (name: string, desc: string, key: keyof VerseFlowSettings) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => t.setValue(String(this.plugin.settings[key] ?? "")).onChange(async (v) => { (this.plugin.settings as any)[key] = v; await this.plugin.saveSettings(); }));
    };
    const addToggle = (name: string, desc: string, key: keyof VerseFlowSettings) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) => t.setValue(!!(this.plugin.settings as any)[key]).onChange(async (v) => { (this.plugin.settings as any)[key] = v; await this.plugin.saveSettings(); }));
    };
    const addNumber = (name: string, desc: string, key: keyof VerseFlowSettings) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => t.setValue(String(this.plugin.settings[key] ?? "")).onChange(async (v) => { const n = Number.parseInt(v); (this.plugin.settings as any)[key] = Number.isFinite(n) ? n : (DEFAULT_SETTINGS as any)[key]; await this.plugin.saveSettings(); }));
    };

    addText("Plan Path", "Vault-relative path to chronological plan JSON.", "planPath");
    addText("Progress Path", "Vault-relative path to Bible-Progress.md.", "progressPath");
    addText("Map Path", "Vault-relative path to bible-read-map.json.", "mapPath");
    addText("Events Path", "Vault-relative path to Bible-Read-Events.md.", "eventsPath");
    addToggle("Use Map", "Prefer progress derived from map over frontmatter.", "useMap");
    addNumber("Max Today", "Upper bound for today's target length.", "maxToday");
    addNumber("Preview Count", "How many verses to preview after today's list.", "previewCount");
  }
}
