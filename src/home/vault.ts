import * as fs from 'fs';
import * as path from 'path';
import { resolveCommandsDir, expandHome } from '../aios/commands';
import * as vscode from 'vscode';

/**
 * Resolve the framework root (the folder that contains both `plugins/` and
 * `vault/`). Falls back to the configured framework path, then the open
 * workspace root.
 */
export function frameworkRoot(): string | undefined {
  const dir = resolveCommandsDir();
  if (dir) return path.resolve(dir, '..', '..', '..');
  const configured = vscode.workspace.getConfiguration('aiosGlass').get<string>('frameworkPath', '~/aios');
  if (configured && configured.trim()) return expandHome(configured.trim());
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The vault content root (`<frameworkRoot>/vault`), if it exists. */
export function vaultRoot(): string | undefined {
  const root = frameworkRoot();
  if (!root) return undefined;
  const v = path.join(root, 'vault');
  return dirExists(v) ? v : root; // some vaults may not nest under vault/
}

/** Best-effort operator first/nick name from declared context. */
export function operatorName(): string {
  const setting = vscode.workspace.getConfiguration('aiosGlass').get<string>('operatorName', '');
  if (setting && setting.trim()) return setting.trim();

  const v = vaultRoot();
  if (v) {
    const aboutMe = path.join(v, '00 - notes', 'context', 'declared', 'about_me.md');
    try {
      const text = fs.readFileSync(aboutMe, 'utf8');
      const line = text.split(/\r?\n/).find((l) => /my name is/i.test(l));
      if (line) {
        // Prefer a quoted nickname (straight or curly quotes), else first name.
        const nick = line.match(/["“”']([^"“”']+)["“”']/);
        if (nick) return nick[1].trim();
        const after = line.replace(/.*my name is\s+/i, '').trim();
        const first = after.split(/[\s,.]/)[0];
        if (first) return first;
      }
    } catch {
      // fall through
    }
  }
  return '';
}

/**
 * Primary session name from USER.md → ## Identity (first table row's name),
 * mirroring install-wrappers.sh detect_primary_session. Fallback: "aios".
 */
export function primaryName(): string {
  const root = frameworkRoot();
  if (root) {
    try {
      const lines = fs.readFileSync(path.join(root, 'USER.md'), 'utf8').split(/\r?\n/);
      let inSection = false;
      for (const line of lines) {
        if (/^##\s+Identity/.test(line)) { inSection = true; continue; }
        if (inSection && /^##\s/.test(line)) break;
        if (inSection && line.startsWith('|')) {
          const raw = (line.split('|')[1] ?? '').replace(/`/g, '').trim();
          if (raw && raw !== 'Name' && !/^[ -]+$/.test(raw)) return raw;
        }
      }
    } catch {
      // fall through
    }
  }
  return 'aios';
}

export type ContextKind = 'declared' | 'observed' | 'projects';

/** Absolute path to a context/projects folder in the vault. */
export function contextDir(kind: ContextKind): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const sub = kind === 'projects' ? '00 - notes/projects' : `00 - notes/context/${kind}`;
  return path.join(v, sub);
}

/**
 * Note statuses that are NOT "live" work and should be excluded from counts.
 * Mirrors the AIOS project taxonomy: `active` (counted) vs
 * `paused` / `engagement` / `archived` / `idea` (not counted). Context notes
 * (declared/observed) carry no `status`, so they're always counted.
 */
const NON_ACTIVE_STATUS = new Set(['archived', 'paused', 'engagement', 'idea']);

/** Read the `status:` frontmatter value of a note (lowercased), if present. */
function noteStatus(file: string): string | undefined {
  try {
    const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return undefined;
    // No end anchor: tolerate trailing whitespace or a YAML inline comment
    // (`status: archived  # migrated`). The value is bounded by the frontmatter block.
    const m = fm[1].match(/^status:\s*["']?([A-Za-z-]+)/m);
    return m ? m[1].toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Count top-level .md notes in a context/projects folder (excludes `_index.md`).
 * For `projects`, notes whose frontmatter `status` is non-active
 * (archived/paused/engagement/idea) are excluded, so the count reflects the
 * *active* taxonomy rather than a raw file tally. `declared`/`observed` notes
 * carry no `status`, so their read is skipped entirely (just a file tally).
 * Non-recursive by design — non-active notes filed into subfolders
 * (e.g. `projects/archived/`) are absent from `readdirSync` and so also excluded.
 */
export function countNotes(kind: ContextKind): number {
  const dir = contextDir(kind);
  if (!dir) return 0;
  try {
    const candidates = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '_index.md');
    if (kind !== 'projects') return candidates.length;
    return candidates.filter((f) => !NON_ACTIVE_STATUS.has(noteStatus(path.join(dir, f)) ?? '')).length;
  } catch {
    return 0;
  }
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
