# Bible Reading Dashboard

- **Overview**: Live progress and history powered by the Bible Reading Workflow plugin + Dataview.
- **Files**: `Bible-Progress.md`, `Bible-Read-Log.md`, `Bible-Read-Events.md`, `bible-read-map.json`, `chronological_plan.vault.json`.

## Progress (DataviewJS)
```dataviewjs
const p = dv.page("Bible-Progress");
if (!p) { dv.paragraph("Bible-Progress.md not found"); } else {
const total = p.total_verses ?? 31102;
const pct = total ? ((p.verses_read ?? 0) / total * 100).toFixed(1) + "%" : "0.0%";
dv.table([
  "last_order",
  "verses_read",
  "total_verses",
  "progress",
  "start_date",
  "target_days"
], [[
  p.last_order ?? 0,
  p.verses_read ?? 0,
  total,
  pct,
  p.start_date ?? dv.luxon.DateTime.now().toISODate(),
  p.target_days ?? 365
]]);
}
```

## Recommended pace today (DataviewJS)
```dataviewjs
const p = dv.page("Bible-Progress");
if (!p) { dv.el("div", "Bible-Progress.md not found"); } else {
const total = p.total_verses ?? 31102;
const start = new Date((p.start_date ?? dv.current().file.ctime.toISODate()) + "T00:00:00");
const today = new Date(dv.current().file.cday.toISODate() + "T00:00:00");
const daysElapsed = Math.max(1, Math.floor((today - start) / 86400000) + 1);
const targetDays = p.target_days ?? 365;
const expected = Math.ceil((total * daysElapsed) / targetDays);
const remaining = Math.max(0, total - (p.verses_read ?? 0));
const daysRemaining = Math.max(1, targetDays - daysElapsed);
const pace = Math.max(1, Math.ceil(remaining / daysRemaining));
const catchup = Math.max(0, expected - (p.verses_read ?? 0));
dv.paragraph(`Recommended today: ${catchup || pace} verses (pace ${pace}, catch-up ${catchup}).`);
}
```

## Reading history (DataviewJS)
```dataviewjs
// Parse Markdown table in Bible-Read-Log.md: | date | start_ref | end_ref | count | last_order |
let text = "";
try { const f = app.vault.getAbstractFileByPath("Bible-Read-Log.md"); if (f) text = await app.vault.read(f); } catch {}
if (!text) { dv.paragraph("Bible-Read-Log.md not found or empty"); } else {
const lines = text.split('\n').filter(l => l.startsWith('|'));
// Remove header separators
const data = lines.filter(l => !/^\|\s*-/.test(l)).slice(1);
const rows = data.map(line => {
  const cols = line.split('|').map(s => s.trim());
  return [cols[1], cols[2], cols[3], Number(cols[4]) || 0, Number(cols[5]) || 0];
});
rows.sort((a,b) => b[0].localeCompare(a[0]));
dv.table(["date","start_ref","end_ref","count","last_order"], rows);
}
```

## Notes
- The session log updates automatically each time the plugin Finalize command runs.
- If you change your plan file location, update Plugin Settings → Plan Path.

---

## Reads by day (DataviewJS)
```dataviewjs
// Parse Markdown table in Bible-Read-Events.md: | timestamp | idx | ref | path |
let content = "";
try {
  const f = app.vault.getAbstractFileByPath("Bible-Read-Events.md");
  if (f) content = await app.vault.read(f);
} catch {}
const rows = [];
if (content) {
  const lines = content.split('\n').filter(l => l.startsWith('|') && !/^\|\s*-/.test(l));
  const dataLines = lines.slice(1); // skip header
  for (const line of dataLines) {
    const cols = line.split('|').map(s => s.trim());
    if (cols.length >= 5) {
      rows.push({
        timestamp: cols[1],
        idx: Number(cols[2]),
        ref: cols[3],
        path: cols[4]
      });
    }
  }
}
// Group by date (YYYY-MM-DD)
const byDay = new Map();
for (const r of rows) {
  const day = (r.timestamp || '').slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(r);
}
const dayTable = [...byDay.entries()]
  .sort((a,b) => b[0].localeCompare(a[0]))
  .map(([day, arr]) => [day, arr.length, arr.map(v => `[[${v.path}|${v.ref}]]`).join(', ')]);
dv.table(["Date", "Reads", "Verses"], dayTable);
```

## Most reread verses (DataviewJS)
```dataviewjs
let content2 = "";
try { const f2 = app.vault.getAbstractFileByPath("Bible-Read-Events.md"); if (f2) content2 = await app.vault.read(f2); } catch {}
const rows2 = [];
if (content2) {
  const lines = content2.split('\n').filter(l => l.startsWith('|') && !/^\|\s*-/.test(l));
  const dataLines = lines.slice(1);
  for (const line of dataLines) {
    const cols = line.split('|').map(s => s.trim());
    if (cols.length >= 5) rows2.push({ ref: cols[3], path: cols[4] });
  }
}
const tally = new Map();
for (const r of rows2) {
  const key = r.ref;
  tally.set(key, (tally.get(key) || 0) + 1);
}
const top = [...tally.entries()]
  .sort((a,b) => b[1]-a[1])
  .slice(0, 25)
  .map(([ref, count]) => [ref, count]);
dv.table(["Verse", "Times Read"], top);
```

## Last read per verse (DataviewJS)
```dataviewjs
// Use bible-read-map.json (idx -> [timestamps]) and plan JSON to show last-read timestamps
const plan = await dv.io.load("chronological_plan.vault.json", "json");
let map = {};
try { map = await dv.io.load("bible-read-map.json", "json"); } catch {}
const rows3 = [];
if (plan && map) {
  for (const [k, v] of Object.entries(map)) {
    const idx = Number(k);
    const verse = plan[idx];
    if (!verse) continue;
    const arr = Array.isArray(v) ? v : (v ? [v] : []);
    const last = arr.length ? arr[arr.length - 1] : null;
    rows3.push([idx, verse.ref, last ?? "—"]);
  }
}
rows3.sort((a,b) => b[2].localeCompare(a[2]));
dv.table(["Idx", "Verse", "Last Read"], rows3.slice(0, 100));
```
