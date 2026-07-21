import * as fs from 'fs';
import * as path from 'path';
import { stateGet, stateSet } from '../state';
import { vaultRoot } from '../home/vault';
import { swallow } from '../log';
import { SessionNote, parseStoredNotes } from './sessionNotesParse';

export { SessionNote, parseStoredNotes } from './sessionNotesParse';

/**
 * AI-18 / AI-39 — session post-its ("running session reminders").
 *
 * A fourth hover button on a live session lets the HUMAN jot quick notes
 * attached to that session — "what did I want to do here next" — replacing the
 * physical desk full of post-its. Notes are session-scoped and **die at kill**
 * (Chuy's default). The buddai-suggested safety, confirmed here: rather than
 * silently losing surviving notes when a session is killed, the kill-guard
 * HARVESTS them — into the session's Mode W close-session report if one exists,
 * else into today's daily note — so a reminder is never dropped on the floor.
 *
 * Stored in `.glass/state.json` (via state.ts) under `sessionNotes`, keyed by
 * session NAME (unique among live sessions). Roams with the vault like the rest
 * of glass state; the App's session viewer reads the same key (AI-53 topology).
 */

const NOTES_KEY = 'sessionNotes';

/** A stored entry: the timestamped object shape, or a LEGACY bare string (pre-AI-39
 *  notes, and whatever the App may still write). Readers coerce both (sessionNotesParse). */
type StoredNote = string | { t: string; ts: number };
type NotesMap = Record<string, StoredNote[]>;

function readMap(): NotesMap {
  const raw = stateGet<NotesMap>(NOTES_KEY);
  return raw && typeof raw === 'object' ? raw : {};
}

/** The notes attached to a session (most-recent last), normalized. Tolerates the
 *  legacy bare-string shape so notes jotted before timestamps still read. */
export function getSessionNotes(name: string): SessionNote[] {
  return parseStoredNotes(readMap()[name]);
}

/** Per-session note counts — fed to the webview so a row can show its badge. */
export function sessionNoteCounts(): Record<string, number> {
  const map = readMap();
  const out: Record<string, number> = {};
  for (const name of Object.keys(map)) { const n = getSessionNotes(name).length; if (n) out[name] = n; }
  return out;
}

/** Append a note to a session (trimmed; empties are ignored). Stored with a timestamp. */
export async function addSessionNote(name: string, note: string): Promise<void> {
  const text = (note || '').trim();
  if (!name || !text) return;
  const map = readMap();
  const arr = Array.isArray(map[name]) ? map[name].slice() : [];
  arr.push({ t: text, ts: Date.now() });
  map[name] = arr;
  await stateSet(NOTES_KEY, map);
}

/** Delete one note by its index in the NORMALIZED (getSessionNotes) list. Rewrites the
 *  array in the timestamped shape so raw/normalized indices stay aligned afterwards. */
export async function deleteSessionNote(name: string, index: number): Promise<void> {
  const notes = getSessionNotes(name);
  if (index < 0 || index >= notes.length) return;
  notes.splice(index, 1);
  const map = readMap();
  if (notes.length) map[name] = notes.map((n) => ({ t: n.text, ts: n.ts }));
  else delete map[name];
  await stateSet(NOTES_KEY, map);
}

/** Drop all notes for a session (die-at-kill, and after a harvest). */
export async function clearSessionNotes(name: string): Promise<void> {
  const map = readMap();
  if (!(name in map)) return;
  delete map[name];
  await stateSet(NOTES_KEY, map);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Find the session's Mode W close-session report for today, if one exists:
 * `<vault>/00 - notes/logs/session-reports/<YYYY-MM>/session-report-<date>-<name>.md`.
 * Only returned when it already exists — we append to a report the session wrote,
 * we never fabricate the provenance-stamped file ourselves.
 */
function modeWReportPath(name: string): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const iso = todayIso();
  const p = path.join(v, '00 - notes', 'logs', 'session-reports', iso.slice(0, 7), `session-report-${iso}-${name}.md`);
  try { return fs.statSync(p).isFile() ? p : undefined; } catch { return undefined; }
}

/** Today's daily note path (may not exist — the caller creates the section lazily). */
function dailyNotePath(): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const iso = todayIso();
  return path.join(v, '01 - calendar', iso.slice(0, 7), `${iso}.md`);
}

/**
 * Harvest a session's surviving post-its so they aren't lost at kill. Appends
 * them to the session's Mode W report when present (the faithful destination);
 * otherwise to today's daily note under a `## Session notes (harvested)` region,
 * creating the note/section if needed. Clears the notes after. Returns how many
 * were harvested (0 = nothing to do). Best-effort — never throws into the caller.
 */
export async function harvestSessionNotes(name: string): Promise<number> {
  const notes = getSessionNotes(name);
  if (!notes.length) return 0;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const block = notes.map((n) => `- ${n.text}`).join('\n');

  const report = modeWReportPath(name);
  try {
    if (report) {
      fs.appendFileSync(report, `\n\n## Session post-its (harvested ${stamp})\n\n${block}\n`);
    } else {
      const daily = dailyNotePath();
      if (daily) {
        let md = '';
        try { md = fs.readFileSync(daily, 'utf8'); } catch { /* note may not exist yet */ }
        const heading = '## Session notes (harvested)';
        if (md.includes(heading)) {
          md = md.replace(/\s*$/, '\n') + `\n**${name}** _(${stamp})_\n\n${block}\n`;
        } else {
          const prefix = md ? md.replace(/\s*$/, '\n') + '\n' : '';
          md = `${prefix}${heading}\n\n> Reminders harvested from a killed session — move or clear them.\n\n**${name}** _(${stamp})_\n\n${block}\n`;
        }
        fs.mkdirSync(path.dirname(daily), { recursive: true });
        fs.writeFileSync(daily, md);
      }
    }
  } catch (e) {
    swallow('harvestSessionNotes ' + name, e);
    return 0; // couldn't persist → report nothing harvested (notes stay until cleared)
  }
  await clearSessionNotes(name);
  return notes.length;
}
