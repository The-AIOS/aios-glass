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
export interface Nudge { kind: 'plan' | 'sessions' | 'close'; icon: string; label: string; command?: string; }

/**
 * The first actionable 💡 ritual the daily note suggests — a backticked
 * `/command` (args included). Skips lines already marked done (`~~strike~~` / ✅)
 * and skips close-day/close-session (the time-based states own those). Namespace-
 * agnostic: takes whatever's in the backticks (`/aios:`, `/vault-commands:`, bare).
 */
function suggestedRitual(md: string): { command: string; short: string } | null {
  for (const line of md.split(/\r?\n/)) {
    if (!/^\s*>?\s*💡/.test(line)) continue;
    if (/~~|✅/.test(line)) continue; // already done / struck through
    const m = line.match(/`(\/[^`]+)`/);
    if (!m) continue;
    const command = m[1].trim();
    if (/close-?day|close-?session/i.test(command)) continue; // time-based states own these
    const short = command.replace(/^\/(?:aios:|vault-commands:)?/, '').split(/\s/)[0];
    return { command, short };
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
export function nudgeState(hour: number, runningCount: number): Nudge | null {
  const note = latestDailyNote();
  const isToday = !!note && path.basename(note, '.md') === todayLocalIso();
  if (!isToday) return { kind: 'plan', icon: '☀️', label: 'Plan your day', command: '/aios:today' };
  let md = '';
  try { md = fs.readFileSync(note as string, 'utf8'); } catch { return null; }
  const isClosed = /close[\s-]?of[\s-]?day|^#{1,4}.*\bclose\b.*\bday\b/im.test(md);
  if (hour >= 17 && !isClosed) {
    return { kind: 'close', icon: '🌙', label: "Close the day — capture what compounded before it's lost", command: '/aios:close-day' };
  }
  if (hour < 12) {
    const r = suggestedRitual(md);
    if (r) return { kind: 'plan', icon: '💡', label: `Suggested: /${r.short}`, command: r.command };
  }
  if (hour < 17 && runningCount > 0) {
    return { kind: 'sessions', icon: '💬', label: 'Wrap your open sessions before you close the day', command: '/aios:close-session' };
  }
  return null;
}
