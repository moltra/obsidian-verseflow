/*
  Bible Reading Workflow Obsidian Plugin
  Commands:
  - Insert Today’s Target
  - Finalize Bible Read
  - Clear Bible Checkboxes
  Settings:
  - planPath, progressPath, mapPath, eventsPath, useMap, maxToday, previewCount
*/

/** @typedef {{
 * planPath:string, progressPath:string, mapPath:string, eventsPath:string,
 * useMap:boolean, maxToday:number, previewCount:number
 * }} BRWSettings
 */

const obsidian = require('obsidian');

const DEFAULT_SETTINGS = /** @type {BRWSettings} */ ({
  planPath: "chronological_plan.vault.json",
  progressPath: "Bible-Progress.md",
  mapPath: "bible-read-map.json",
  eventsPath: "Bible-Read-Events.md",
  useMap: true,
  maxToday: 40,
  previewCount: 20,
});

class BibleReadingWorkflowPlugin extends obsidian.Plugin {
  /** @type {BRWSettings} */ settings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new BRWSettingsTab(this.app, this));

    this.addCommand({
      id: "brw-insert-today-target",
      name: "Insert Today’s Target",
      callback: () => this.insertTodayTarget(),
    });

    this.addCommand({
      id: "brw-finalize-bible-read",
      name: "Finalize Bible Read",
      callback: () => this.finalizeBibleRead(),
    });

    this.addCommand({
      id: "brw-clear-bible-checkboxes",
      name: "Clear Bible Checkboxes",
      callback: () => this.clearBibleCheckboxes(),
    });

    // Maintenance commands
    this.addCommand({
      id: "brw-seed-map-from-progress",
      name: "Seed Map From Progress",
      callback: () => this.seedMapFromProgress(),
    });
    this.addCommand({
      id: "brw-recompute-progress-from-map",
      name: "Recompute Progress From Map",
      callback: () => this.recomputeProgressFromMapCommand(),
    });
    this.addCommand({
      id: "brw-rebuild-map-from-events",
      name: "Rebuild Map From Events",
      callback: () => this.rebuildMapFromEventsCommand(),
    });

    // Convenience commands
    this.addCommand({
      id: "brw-open-dashboard",
      name: "Open Bible Dashboard",
      callback: () => this.openBibleDashboard(),
    });
    this.addCommand({
      id: "brw-insert-progress-summary",
      name: "Insert Progress Summary (read-only)",
      callback: () => this.insertProgressSummary(),
    });

    // Ribbon icons (best-effort)
    try { this.addRibbonIcon('checkmark', 'BRW: Finalize Bible Read', () => this.finalizeBibleRead()); } catch {}
    try { this.addRibbonIcon('document', 'BRW: Insert Today’s Target', () => this.insertTodayTarget()); } catch {}
    try { this.addRibbonIcon('trash', 'BRW: Clear Bible Checkboxes', () => this.clearBibleCheckboxes()); } catch {}
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ---------- Logging ----------
  /** @param {string} evt @param {any} data */
  async log(evt, data) {
    try {
      const folder = "logs";
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const path = `${folder}/bible-plugin-log.md`;
      const now = new Date();
      const stamp = now.toISOString();
      const line = `- ${stamp} ${evt} ${JSON.stringify(data ?? {})}`;
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f) {
        const prev = await this.app.vault.read(f);
        await this.app.vault.modify(f, prev + "\n" + line);
      } else {
        await this.app.vault.create(path, `# Bible Plugin Log\n${line}`);
      }
    } catch {}
  }

  // ---------- Utilities ----------
  /** @param {string} path */
  async readJson(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return null;
    try { return JSON.parse(await this.app.vault.read(f)); } catch { return null; }
  }

  /** @param {string} path @param {any} obj */
  async writeJson(path, obj) {
    const f = this.app.vault.getAbstractFileByPath(path);
    const json = JSON.stringify(obj, null, 2);
    if (f) { await this.app.vault.modify(f, json); }
    else { await this.app.vault.create(path, json); }
  }

  /** @param {string} path */
  async readText(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return null;
    try { return await this.app.vault.read(f); } catch { return null; }
  }

  /** @param {string} path @param {string} content */
  async upsertText(path, content) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f) { await this.app.vault.modify(f, content); }
    else { await this.app.vault.create(path, content); }
  }

  /** @returns {{last_order:number, verses_read:number, total_verses:number, start_date:string, target_days:number}} */
  async readProgress() {
    const { progressPath } = this.settings;
    const f = this.app.vault.getAbstractFileByPath(progressPath);
    if (!f) return { last_order: 0, verses_read: 0, total_verses: 31102, start_date: this.todayISO(), target_days: 365 };
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    return {
      last_order: parseInt(fm.last_order ?? 0) || 0,
      verses_read: parseInt(fm.verses_read ?? 0) || 0,
      total_verses: parseInt(fm.total_verses ?? 31102) || 31102,
      start_date: typeof fm.start_date === "string" ? fm.start_date : this.todayISO(),
      target_days: parseInt(fm.target_days ?? 365) || 365,
    };
  }

  todayISO() { return new Date().toISOString().slice(0,10); }
  parseDateISO(d) { return new Date(`${d}T00:00:00`); }

  /** Compute progress from map */
  computeFromMap(mapObj, total) {
    let uniqueRead = 0; let firstUnread = 0;
    for (let i = 0; i < total; i++) {
      const v = mapObj?.[i];
      const has = Array.isArray(v) ? v.length > 0 : !!v;
      if (has) uniqueRead++; else if (firstUnread === 0) firstUnread = i;
    }
    return { uniqueRead, firstUnread };
  }

  // ---------- Command: Insert Today’s Target ----------
  async insertTodayTarget() {
    const { planPath, progressPath, mapPath, useMap, maxToday, previewCount } = this.settings;
    const plan = await this.readJson(planPath);
    if (!Array.isArray(plan)) { await this.log("insert.error", { reason: "plan missing" }); return; }

    const prog = await this.readProgress();
    let versesRead = prog.verses_read;
    let lastOrder = prog.last_order;

    const mapObj = await this.readJson(mapPath);
    if (useMap && mapObj) {
      const c = this.computeFromMap(mapObj, plan.length);
      versesRead = c.uniqueRead; lastOrder = c.firstUnread;
      await this.log("progress.map", { used: true, uniqueRead: versesRead, firstUnread: lastOrder });
    } else {
      await this.log("progress.map", { used: false });
    }

    const totalVerses = prog.total_verses ?? plan.length;
    const start = this.parseDateISO(prog.start_date ?? this.todayISO());
    const today = this.parseDateISO(this.todayISO());
    let daysElapsed = Math.floor((today - start) / 86400000) + 1;
    if (!Number.isFinite(daysElapsed) || daysElapsed < 1) daysElapsed = 1;
    const targetDays = prog.target_days ?? 365;
    let expected = Math.ceil((totalVerses * daysElapsed) / targetDays);
    if (!Number.isFinite(expected) || expected < 0) expected = 0;
    const remaining = Math.max(0, totalVerses - versesRead);
    const daysRemaining = Math.max(1, targetDays - daysElapsed);
    let pace = Math.ceil(remaining / daysRemaining); if (!Number.isFinite(pace) || pace < 1) pace = 1;
    const defaultToday = Math.max(1, expected - versesRead || pace);

    const todayCount = Math.min(defaultToday, maxToday, Math.max(0, plan.length - lastOrder));

    // Build markdown
    const fileName = (p) => p.split("#")[0].split("/").pop();
    const chapterLink = (p) => p.split("#")[0].replace(/\.md$/, "");

    let out = [];
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
      const v = nextArr[i];
      const lbl = fileName(v.path); const chap = chapterLink(v.path);
      if (lbl !== lastLbl) { out.push(`> **[[${chap}|${lbl}]]**`); lastLbl = lbl; }
      const idx = nextStart + i;
      out.push(`> - [ ] [[${v.path}|${v.ref}]] (idx:${idx})`);
    }

    const editor = this.getActiveEditor();
    if (!editor) { await this.log("insert.error", { reason: "no editor" }); return; }
    editor.replaceSelection(out.join("\n") + "\n");

    await this.log("insert.result", { lastOrder, versesRead, totalVerses, defaultToday, todayCount });
  }

  getActiveEditor() {
    const leaf = this.app.workspace.activeLeaf;
    // @ts-ignore
    return leaf?.view?.editor ?? null;
  }

  // ---------- Command: Finalize ----------
  async finalizeBibleRead() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const editor = this.getActiveEditor(); if (!editor) return;
    const content = editor.getValue();
    const re = /\[[xX]\][^\n]*\(idx:(\d+)\)/g;
    let m; const indices = new Set();
    while ((m = re.exec(content)) !== null) { const n = parseInt(m[1]); if (!Number.isNaN(n)) indices.add(n); }
    if (indices.size === 0) { await this.log("finalize.none", {}); return; }

    let mapObj = (await this.readJson(mapPath)) || {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset()*60000).toISOString().slice(0,19);
    for (const idx of [...indices].sort((a,b)=>a-b)) {
      if (!Array.isArray(mapObj[idx])) mapObj[idx] = [];
      const arr = mapObj[idx]; if (arr[arr.length-1] !== localISO) arr.push(localISO);
    }
    await this.writeJson(mapPath, mapObj);

    const plan = await this.readJson(planPath) || [];
    // recompute progress from map
    const c = this.computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);

    // append events rows
    const header = `| timestamp | idx | ref | path |\n|---|---:|---|---|\n`;
    let rows = "";
    for (const idx of indices) { const v = plan[idx]; if (!v) continue; rows += `| ${localISO} | ${idx} | ${v.ref} | ${v.path} |\n`; }
    const f = this.app.vault.getAbstractFileByPath(eventsPath);
    if (f) {
      const existing = await this.app.vault.read(f);
      if (/\n\|\s*timestamp\s*\|/.test(existing)) await this.app.vault.modify(f, existing + rows);
      else await this.app.vault.modify(f, existing + "\n" + header + rows);
    } else {
      await this.app.vault.create(eventsPath, header + rows);
    }

    // append session to Bible-Read-Log.md (derived summary)
    try {
      const logPath = 'Bible-Read-Log.md';
      const logHeader = `| date | start_ref | end_ref | count | last_order |\n|---|---|---|---:|---:|\n`;
      const sorted = [...indices].sort((a,b)=>a-b);
      const first = sorted[0];
      const last = sorted[sorted.length-1];
      const startRef = plan[first]?.ref ?? '';
      const endRef = plan[last]?.ref ?? '';
      const row = `| ${localISO.slice(0,10)} | ${startRef} | ${endRef} | ${sorted.length} | ${c.firstUnread} |\n`;
      const lf = this.app.vault.getAbstractFileByPath(logPath);
      if (lf) {
        const prev = await this.app.vault.read(lf);
        if (/\n\|\s*date\s*\|/.test(prev)) await this.app.vault.modify(lf, prev + row);
        else await this.app.vault.modify(lf, prev + "\n" + logHeader + row);
      } else {
        await this.app.vault.create(logPath, logHeader + row);
      }
    } catch {}

    await this.log("finalize.result", { added: indices.size });
  }

  async updateProgressFrontmatter(path, lastOrder, versesRead) {
    const f = this.app.vault.getAbstractFileByPath(path); if (!f) return;
    let text = await this.app.vault.read(f);
    if (!/^---/.test(text)) text = `---\n---\n` + text;
    if (/last_order:\s*\d+/i.test(text)) text = text.replace(/last_order:\s*\d+/i, `last_order: ${lastOrder}`);
    else text = text.replace(/^---\n/, `---\nlast_order: ${lastOrder}\n`);
    if (/verses_read:\s*\d+/i.test(text)) text = text.replace(/verses_read:\s*\d+/i, `verses_read: ${versesRead}`);
    else text = text.replace(/^---\n/, `---\nverses_read: ${versesRead}\n`);
    await this.app.vault.modify(f, text);
  }

  // ---------- Command: Clear ----------
  async clearBibleCheckboxes() {
    const editor = this.getActiveEditor(); if (!editor) return;
    const content = editor.getValue();
    const cleared = content.replace(/\[\s*[xX]\s*\](?=[^\n]*\(idx:\d+\))/g, "[ ]");
    if (cleared !== content) editor.setValue(cleared);
    await this.log("clear.result", {});
  }

  // ---------- Command: Open Dashboard ----------
  async openBibleDashboard() {
    const path = 'Bible-Dashboard.md';
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) { await this.log('open.dashboard.missing', { path }); return; }
    const leaf = this.app.workspace.getLeaf(true);
    // @ts-ignore
    await leaf.openFile(f);
    await this.log('open.dashboard', { path });
  }

  // ---------- Command: Insert Progress Summary ----------
  async insertProgressSummary() {
    const editor = this.getActiveEditor(); if (!editor) return;
    const { planPath } = this.settings;
    const plan = await this.readJson(planPath) || [];
    const prog = await this.readProgress();
    const total = prog.total_verses ?? plan.length;
    const start = this.parseDateISO(prog.start_date ?? this.todayISO());
    const today = this.parseDateISO(this.todayISO());
    let daysElapsed = Math.floor((today - start) / 86400000) + 1; if (!Number.isFinite(daysElapsed) || daysElapsed < 1) daysElapsed = 1;
    const targetDays = prog.target_days ?? 365;
    const remaining = Math.max(0, total - (prog.verses_read ?? 0));
    const daysRemaining = Math.max(1, targetDays - daysElapsed);
    let pace = Math.ceil(remaining / daysRemaining); if (!Number.isFinite(pace) || pace < 1) pace = 1;
    const pct = total ? ((prog.verses_read ?? 0) / total * 100).toFixed(1) : '0.0';
    const line = `> Progress: ${prog.verses_read}/${total} (${pct}%). Target ${targetDays} days from ${prog.start_date}. Today's pace: ${pace}.`;
    editor.replaceSelection(line + "\n");
    await this.log('insert.progress.summary', { daysElapsed, targetDays, remaining, daysRemaining, pace, pct });
  }

  // ---------- Command: Seed Map From Progress ----------
  async seedMapFromProgress() {
    const { mapPath, progressPath, planPath } = this.settings;
    const prog = await this.readProgress();
    const plan = await this.readJson(planPath) || [];
    const upTo = Math.min(prog.verses_read ?? 0, plan.length);
    const mapObj = {};
    const stamp = new Date();
    const localISO = new Date(stamp.getTime() - stamp.getTimezoneOffset()*60000).toISOString().slice(0,19);
    for (let i = 0; i < upTo; i++) mapObj[i] = [localISO];
    await this.writeJson(mapPath, mapObj);

    // recompute and write progress from seeded map
    const c = this.computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    await this.log('seed.result', { seeded: upTo, firstUnread: c.firstUnread, uniqueRead: c.uniqueRead });
  }

  // ---------- Command: Recompute Progress From Map ----------
  async recomputeProgressFromMapCommand() {
    const { mapPath, planPath, progressPath } = this.settings;
    const mapObj = (await this.readJson(mapPath)) || {};
    const plan = await this.readJson(planPath) || [];
    const c = this.computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    await this.log('recompute.result', { firstUnread: c.firstUnread, uniqueRead: c.uniqueRead });
  }

  // ---------- Command: Rebuild Map From Events ----------
  async rebuildMapFromEventsCommand() {
    const { eventsPath, mapPath, planPath, progressPath } = this.settings;
    const text = await this.readText(eventsPath) || '';
    const lines = text.split('\n').filter(l => l.startsWith('|') && !/^\|\s*-/.test(l));
    const data = lines.slice(1);
    /** @type {Record<string, string[]>} */
    const mapObj = {};
    for (const line of data) {
      const cols = line.split('|').map(s => s.trim());
      if (cols.length >= 5) {
        const ts = cols[1];
        const idx = Number(cols[2]);
        if (Number.isFinite(idx) && ts) {
          if (!Array.isArray(mapObj[idx])) mapObj[idx] = [];
          const arr = mapObj[idx]; if (arr[arr.length-1] !== ts) arr.push(ts);
        }
      }
    }
    await this.writeJson(mapPath, mapObj);
    const plan = await this.readJson(planPath) || [];
    const c = this.computeFromMap(mapObj, plan.length);
    await this.updateProgressFrontmatter(progressPath, c.firstUnread, c.uniqueRead);
    await this.log('rebuild.result', { entries: Object.keys(mapObj).length, firstUnread: c.firstUnread, uniqueRead: c.uniqueRead });
  }
}

class BRWSettingsTab extends obsidian.PluginSettingTab {
  /** @param {obsidian.App} app @param {BibleReadingWorkflowPlugin} plugin */
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Bible Reading Workflow" });

    const addText = (name, desc, key) => {
      new obsidian.Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(t => t.setValue(String(this.plugin.settings[key] ?? "")).onChange(async (v)=>{ this.plugin.settings[key]=v; await this.plugin.saveSettings(); }));
    };
    const addToggle = (name, desc, key) => {
      new obsidian.Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle(t => t.setValue(!!this.plugin.settings[key]).onChange(async (v)=>{ this.plugin.settings[key]=v; await this.plugin.saveSettings(); }));
    };
    const addNumber = (name, desc, key) => {
      new obsidian.Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText(t => t.setValue(String(this.plugin.settings[key] ?? "")).onChange(async (v)=>{ const n=parseInt(v); this.plugin.settings[key]=Number.isFinite(n)?n:DEFAULT_SETTINGS[key]; await this.plugin.saveSettings(); }));
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

module.exports = BibleReadingWorkflowPlugin;
