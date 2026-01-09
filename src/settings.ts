import { App, PluginSettingTab, Setting, Plugin } from "obsidian";

export interface VerseFlowSettings {
  planPath: string;
  progressPath: string;
  mapPath: string;
  eventsPath: string;
  useMap: boolean;
  maxToday: number;
  previewCount: number;
  includeDashboardLink: boolean;
  setupOnFirstEnable: boolean;
  initialized?: boolean;
  notesBasePath: string; // base folder for chapter notes
  notesSuffix: string;   // suffix for chapter note files
  notesLinkMode: 'verse' | 'chapter' | 'dual'; // controls links in today's checklist
}

export const DEFAULT_SETTINGS: VerseFlowSettings = {
  planPath: "chronological_plan.vault.json",
  progressPath: "Bible-Progress.md",
  mapPath: "bible-read-map.json",
  eventsPath: "Bible-Read-Events.md",
  useMap: true,
  maxToday: 40,
  previewCount: 20,
  includeDashboardLink: true,
  setupOnFirstEnable: false,
  initialized: false,
  notesBasePath: "VerseNotes",
  notesSuffix: "_notes.md",
  notesLinkMode: 'dual',
};

export class VerseFlowSettingsTab extends PluginSettingTab {
  plugin: Plugin & { settings: VerseFlowSettings; saveSettings: () => Promise<void> };

  constructor(app: App, plugin: Plugin & { settings: VerseFlowSettings; saveSettings: () => Promise<void> }) {
    super(app, plugin);
    this.plugin = plugin;
  }

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
    const addSelect = (name: string, desc: string, key: keyof VerseFlowSettings, opts: Record<string,string>) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) => {
          Object.entries(opts).forEach(([v, lbl]) => d.addOption(v, lbl));
          d.setValue(String(this.plugin.settings[key] ?? (DEFAULT_SETTINGS as any)[key]))
           .onChange(async (v) => { (this.plugin.settings as any)[key] = v as any; await this.plugin.saveSettings(); });
        });
    };

    addText("Plan Path", "Vault-relative path to chronological plan JSON.", "planPath");
    addText("Progress Path", "Vault-relative path to Bible-Progress.md.", "progressPath");
    addText("Map Path", "Vault-relative path to bible-read-map.json.", "mapPath");
    addText("Events Path", "Vault-relative path to Bible-Read-Events.md.", "eventsPath");
    addToggle("Use Map", "Prefer progress derived from map over frontmatter.", "useMap");
    addNumber("Max Today", "Upper bound for today's target length.", "maxToday");
    addNumber("Preview Count", "How many verses to preview after today's list.", "previewCount");
    addToggle("Include Dashboard Link", "Add a link to Bible-Dashboard at the top of inserted targets.", "includeDashboardLink");
    addToggle("Run Setup On Enable", "Run one-time setup automatically the first time the plugin is enabled.", "setupOnFirstEnable");
    addText("Notes Base Path", "Folder to store per-chapter notes (will be created if missing).", "notesBasePath");
    addText("Notes Suffix", "File name suffix for chapter notes (e.g., _notes.md).", "notesSuffix");
    addSelect("Notes Link Mode", "How links appear in Today's Target: verse only, chapter-note only, or both.", "notesLinkMode", {
      verse: "Verse only",
      chapter: "Chapter note only",
      dual: "Verse + notes (default)",
    });
  }
}
