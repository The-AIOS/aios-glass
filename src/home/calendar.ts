import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { vaultRoot } from './vault';

export interface DayCell {
  /** ISO date YYYY-MM-DD, or null for padding cells */
  date: string | null;
  day: number | null;
  hasNote: boolean;
  isToday: boolean;
}

export interface MonthData {
  year: number;
  month: number; // 1-12
  label: string; // e.g. "May 2026"
  /** Monday-first weekday headers */
  weekdays: string[];
  /** rows of 7 cells, Monday-first */
  weeks: DayCell[][];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Directory holding a given month's notes: `<vault>/01 - calendar/YYYY-MM`. */
export function monthDir(year: number, month: number): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  return path.join(v, '01 - calendar', `${year}-${pad2(month)}`);
}

/** Absolute path to a daily note for an ISO date. */
export function dailyNotePath(iso: string): string | undefined {
  const [y, m] = iso.split('-').map(Number);
  const dir = monthDir(y, m);
  return dir ? path.join(dir, `${iso}.md`) : undefined;
}

/** Set of YYYY-MM-DD that have a daily note (excludes weekly -plan/-summary). */
function daysWithNotes(year: number, month: number): Set<string> {
  const dir = monthDir(year, month);
  const out = new Set<string>();
  if (!dir) return out;
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (m) out.add(m[1]);
    }
  } catch {
    // month dir may not exist yet
  }
  return out;
}

/** Today's ISO date in local time (the editor host's clock). */
function todayIso(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Build a Monday-first month grid with note/today flags. */
export function getMonthData(year: number, month: number): MonthData {
  const notes = daysWithNotes(year, month);
  const today = todayIso();
  const daysInMonth = new Date(year, month, 0).getDate();

  // JS getDay(): 0=Sun..6=Sat. Convert to Monday-first index 0=Mon..6=Sun.
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lead = (firstDow + 6) % 7;

  const cells: DayCell[] = [];
  for (let i = 0; i < lead; i++) cells.push({ date: null, day: null, hasNote: false, isToday: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = isoDate(year, month, d);
    cells.push({ date: iso, day: d, hasNote: notes.has(iso), isToday: iso === today });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null, hasNote: false, isToday: false });

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weeks
  };
}

/**
 * Open the daily note for an ISO date, creating a minimal stub if missing.
 * Existing notes honor the `aiosGlass.openNotesIn` setting (default: rendered
 * preview — Foam renders [[wikilinks]] there). `forceEditor` (⌘/Ctrl-click)
 * always opens the source. Freshly-created stubs always open in the editor
 * so you can start writing.
 */
export async function openDailyNote(iso: string, opts: { forceEditor?: boolean; forcePreview?: boolean } = {}): Promise<void> {
  const target = dailyNotePath(iso);
  if (!target) {
    void vscode.window.showWarningMessage('AIOS Glass: could not resolve the vault calendar path.');
    return;
  }
  let created = false;
  if (!fs.existsSync(target)) {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true });
    const heading = new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    fs.writeFileSync(target, `# ${heading}\n\n`, 'utf8');
    created = true;
  }

  const uri = vscode.Uri.file(target);
  const mode = opts.forcePreview
    ? 'preview'
    : created || opts.forceEditor
    ? 'editor'
    : vscode.workspace.getConfiguration('aiosGlass').get<string>('openNotesIn', 'preview');

  if (mode === 'editor') {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } else if (mode === 'previewToSide') {
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
  } else {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  }
}
