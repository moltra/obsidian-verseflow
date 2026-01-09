import { App, TFile, normalizePath } from "obsidian";

export function todayISO(): string { return new Date().toISOString().slice(0, 10); }
export function parseDateISO(d: string): Date { return new Date(`${d}T00:00:00`); }

export function np(p: string): string { return normalizePath(p); }

export async function readJson<T = any>(app: App, path: string): Promise<T | null> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  try { return JSON.parse(await app.vault.read(f as TFile)); } catch { return null; }
}

export async function writeJson(app: App, path: string, obj: unknown): Promise<void> {
  const f = app.vault.getAbstractFileByPath(path);
  const json = JSON.stringify(obj, null, 2);
  if (f instanceof TFile) await app.vault.modify(f, json);
  else await app.vault.create(path, json);
}

export async function readText(app: App, path: string): Promise<string | null> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  try { return await app.vault.read(f as TFile); } catch { return null; }
}

export async function upsertText(app: App, path: string, content: string): Promise<void> {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) await app.vault.modify(f, content);
  else await app.vault.create(path, content);
}

export function computeFromMap(mapObj: Record<string, unknown> | null, total: number): { uniqueRead: number; firstUnread: number } {
  let uniqueRead = 0; let firstUnread = 0; let seenUnread = false;
  for (let i = 0; i < total; i++) {
    const v: any = mapObj?.[i as any];
    const has = Array.isArray(v) ? v.length > 0 : !!v;
    if (has) uniqueRead++; else if (!seenUnread) { firstUnread = i; seenUnread = true; }
  }
  if (!seenUnread) firstUnread = total; // fully read
  return { uniqueRead, firstUnread };
}

// Build per-chapter verse list from the plan
export function collectChapterVerses(plan: Array<{ ref?: string; path?: string }>, bookName: string, chapterBase: string): Array<{ num: number; ref: string }> {
  const out: Array<{ num: number; ref: string }> = [];
  const add = (num: number, ref: string) => { if (Number.isFinite(num)) out.push({ num, ref }); };

  const matchOne = (v: { ref?: string; path?: string }, requireBook: boolean): boolean => {
    const p = v.path || ""; if (!p) return false;
    const [src, hash = ""] = p.split("#");
    const segs = src.split("/"); const fn = segs.pop() || ""; const book = segs.pop() || "";
    const base = fn.replace(/\.md$/i, "");
    if ((requireBook ? (book === bookName) : true) && base === chapterBase) {
      const ref = v.ref || "";
      let num = Number(((ref.match(/:(\d+)/i) || [])[1]));
      if (!Number.isFinite(num)) {
        const m = (hash.match(/^\^?v(\d+)/i) || p.match(/#\^?v(\d+)/i));
        num = Number((m || [])[1]);
      }
      add(num, ref || `${chapterBase}:${Number.isFinite(num) ? num : ''}`.trim());
      return true;
    }
    return false;
  };

  // Pass 1: strict book+chapter match
  for (const v of plan) matchOne(v, true);
  if (out.length === 0) {
    // Pass 2: chapter base only
    for (const v of plan) matchOne(v, false);
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

// Build initial chapter note content including all verse stubs
export function buildChapterNoteContent(bookName: string, chapterBase: string, verses: Array<{ num: number; ref: string }>): string {
  const header = `---\ntitle: ${chapterBase} Notes\nbook: ${bookName}\ncreated: ${todayISO()}\n---\n\n# ${chapterBase} – Notes\n\n- Notes that may span multiple verses.\n\n## Per-verse\n\n`;
  const sections = verses.map(v => `### v-${v.num} — ${v.ref}\n\n- \n\n`).join("");
  return header + sections;
}
