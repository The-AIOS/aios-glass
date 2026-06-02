import * as fs from 'fs';
import * as path from 'path';
import { vaultRoot } from '../home/vault';

/** A recent thing Claude noticed/learned — for the "What Claude's learned" card. */
export interface Learning { title: string; date: string; source: string; file: string; line: number; }

const SOURCES: { file: string; label: string }[] = [
  { file: 'session-insights.md', label: 'noticed' },
  { file: 'growth.md', label: 'growth' },
  { file: 'antifragile.md', label: 'rule' },
];

function observedDir(): string | undefined {
  const v = vaultRoot();
  return v ? path.join(v, '00 - notes', 'context', 'observed') : undefined;
}

export function observedDirPath(): string | undefined {
  return observedDir();
}

function cleanTitle(s: string): string {
  return s
    .replace(/^\d+\.\s*/, '')                                  // leading "16. "
    .replace(/\s*\((?:new[^)]*|[^)]*20\d\d[^)]*)\)\s*$/i, '')  // trailing "(new — date)" / "(… date)"
    .replace(/[#*_`]/g, '')
    .trim();
}

/** The most recent dated `### ` entries across the observed files (recency view). */
export function recentLearnings(limit = 4): Learning[] {
  const dir = observedDir();
  if (!dir) return [];
  const out: Learning[] = [];
  for (const s of SOURCES) {
    let md: string;
    const fpath = path.join(dir, s.file);
    try { md = fs.readFileSync(fpath, 'utf8'); } catch { continue; }
    md.split(/\r?\n/).forEach((line, idx) => {
      const m = line.match(/^###\s+(.+)$/);
      if (!m) return;
      const dates = m[1].match(/20\d\d-\d\d-\d\d/g);
      if (!dates) return;
      const date = dates.slice().sort()[dates.length - 1]; // latest date referenced in the header
      const title = cleanTitle(m[1]);
      if (title) out.push({ title: title.slice(0, 96), date, source: s.label, file: fpath, line: idx });
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
}

/** A produced deliverable under <vault>/03 - export/. */
export interface OutputFile { name: string; group: string; path: string; mtime: number; }

/** Most-recently-modified deliverables across the export folders — "where did my output land". */
export function recentOutputs(limit = 6): OutputFile[] {
  const v = vaultRoot();
  if (!v) return [];
  const root = path.join(v, '03 - export');
  const out: OutputFile[] = [];
  const walk = (dir: string, group: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '_index.md') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(p, group || e.name, depth + 1); continue; }
      let m = 0;
      try { m = fs.statSync(p).mtimeMs; } catch { /* ignore */ }
      if (m > 0) out.push({ name: e.name, group: group || 'export', path: p, mtime: m });
    }
  };
  walk(root, '', 0);
  // Two-stage: recency picks WHICH files (the actually-recent outputs), then we
  // display that set reverse-ALPHABETICALLY (Z→A — stable, scannable, not mtime order).
  return out
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .sort((a, b) => b.name.localeCompare(a.name));
}

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Latest daily note path under <vault>/01 - calendar/. */
function latestDailyNote(): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const cal = path.join(v, '01 - calendar');
  try {
    const months = fs.readdirSync(cal).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
    for (const mo of months.reverse()) {
      const files = fs.readdirSync(path.join(cal, mo)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
      if (files.length) return path.join(cal, mo, files[files.length - 1]);
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * "Close the loop" guard: true when TODAY's daily note exists but has no
 * Close-of-Day section yet — the moment a non-dev silently breaks the
 * compounding (run /today, work, never close → nothing gets captured).
 */
export interface Nudge { kind: 'plan' | 'sessions' | 'close' | 'week'; icon: string; label: string; command?: string; cmdLabel?: string; }

/** ISO-8601 week (Mon-based) for a date — matches the AIOS `{YYYY}-W{WW}` weekly-note convention. (helper from PR #7) */
function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7)); // shift to this week's Thursday
  const week1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week };
}

/** True if THIS week's weekly-plan note (`{YYYY}-W{WW}-plan.md`) already exists under 01 - calendar/. (helper from PR #7) */
function weeklyPlanExists(): boolean {
  const v = vaultRoot();
  if (!v) return false;
  const { year, week } = isoWeek(new Date());
  const name = `${year}-W${String(week).padStart(2, '0')}-plan.md`;
  const cal = path.join(v, '01 - calendar');
  try {
    for (const mo of fs.readdirSync(cal).filter((d) => /^\d{4}-\d{2}$/.test(d))) {
      if (fs.existsSync(path.join(cal, mo, name))) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * The first actionable 💡 ritual the daily note suggests — a backticked
 * `/command` (args included). Skips lines already marked done (`~~strike~~` / ✅)
 * and skips close-day/close-session (the time-based states own those). Namespace-
 * agnostic: takes whatever's in the backticks (`/aios:`, `/vault-commands:`, bare).
 */
function suggestedRitual(md: string): { command: string; short: string; desc: string } | null {
  for (const line of md.split(/\r?\n/)) {
    if (!/^\s*>?\s*💡/.test(line)) continue;
    if (/~~|✅/.test(line)) continue; // already done / struck through
    const m = line.match(/`(\/[^`]+)`/);
    if (!m) continue;
    const command = m[1].trim();
    if (/close-?day|close-?session/i.test(command)) continue; // time-based states own these
    const short = command.replace(/^\/(?:aios:|vault-commands:)?/, '').split(/\s/)[0];
    // The note's own warm one-liner — the first italic span after the command
    // (e.g. _maps the week across all four pillars…_). Skip the trailing _(suggested)_.
    let desc = '';
    for (const im of line.matchAll(/_([^_]+)_/g)) {
      const cand = im[1].trim();
      if (/^\(?\s*suggested\s*\)?$/i.test(cand)) continue;
      desc = cand;
      break;
    }
    return { command, short, desc };
  }
  return null;
}

/**
 * Contextual ritual nudge for the Home banner, by time of day + state:
 *   no today-note     → plan the day (/today)
 *   evening (≥17h)    → close the day
 *   morning (<12h)    → the note's 💡 suggested ritual (planning-type only)
 *   daytime + live sessions → wrap open sessions before close-day
 * Pure given the inputs — caller passes the local hour + live-session count.
 */
export function nudgeState(hour: number, weekday: number, runningCount: number): Nudge | null {
  const note = latestDailyNote();
  const isToday = !!note && path.basename(note, '.md') === todayLocalIso();
  if (!isToday) return { kind: 'plan', icon: '☀️', label: 'Plan your day', command: '/aios:today' };
  let md = '';
  try { md = fs.readFileSync(note as string, 'utf8'); } catch { return null; }
  const isClosed = /close[\s-]?of[\s-]?day|^#{1,4}.*\bclose\b.*\bday\b/im.test(md);
  if (hour >= 17 && !isClosed) {
    return { kind: 'close', icon: '🌙', label: "Close the day — capture what compounded before it's lost", command: '/aios:close-day' };
  }
  // Early-week (Mon/Tue, 6–17h): if this week isn't planned yet, nudge /7plan — a
  // file-existence signal, so it's reliable regardless of what the note's 💡 says.
  // Ranks above the morning 💡 (week kickoff is the Mon/Tue priority); when the note's
  // 💡 happens to be /7plan, reuse its warm description so this stays in our voice.
  if ((weekday === 1 || weekday === 2) && hour >= 6 && hour < 17 && !weeklyPlanExists()) {
    const r = suggestedRitual(md);
    const desc = r && r.short === '7plan' && r.desc ? r.desc : `plan the week — it's ${weekday === 1 ? 'Monday' : 'Tuesday'}`;
    return { kind: 'week', icon: '🗓️', cmdLabel: 'Run /7plan', label: desc.charAt(0).toUpperCase() + desc.slice(1), command: '/aios:7plan' };
  }
  if (hour < 12) {
    const r = suggestedRitual(md);
    if (r) {
      // Use the note's own warm one-liner (capitalized, trimmed) — matches the
      // voice of the other nudges. Fall back to the command if the note had none.
      // bold "Run /cmd" + the note's own one-liner (the webview clamps it to 2 rows).
      const label = r.desc ? r.desc.charAt(0).toUpperCase() + r.desc.slice(1) : '';
      return { kind: 'plan', icon: '💡', cmdLabel: `Run /${r.short}`, label, command: r.command };
    }
  }
  if (hour < 17 && runningCount > 0) {
    return { kind: 'sessions', icon: '💬', label: 'Wrap your open sessions before you close the day', command: '/aios:close-session' };
  }
  return null;
}
