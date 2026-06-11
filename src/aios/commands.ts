import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseFrontmatter } from '../core/frontmatter';

/**
 * An AIOS slash command, discovered at runtime from the framework's
 * `plugins/aios/commands/*.md` directory. We never hardcode the list —
 * glass, not engine: the source of truth is the framework itself, so a
 * `/aios:update` that adds a command surfaces here automatically.
 */
export interface AiosCommand {
  /** bare name, e.g. "today" (the slash command is /aios:today) */
  name: string;
  /** frontmatter `description` */
  description: string;
  /** frontmatter `argument-hint`, if present */
  argumentHint?: string;
  /** cadence group derived from frontmatter tags */
  cadence: Cadence;
  /** absolute path to the source .md (for "open definition") */
  filePath: string;
}

export type Cadence = 'Daily' | 'Weekly' | 'Bi-weekly' | 'Monthly' | 'As needed';

const CADENCE_BY_TAG: Record<string, Cadence> = {
  daily: 'Daily',
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly'
};

/**
 * Expand a leading `~` to the user's home directory, then resolve symlinks to
 * the canonical path. The realpath step matters: operators often land their
 * AIOS vault at one location with `~/aios` symlinked to it, so the configured
 * `frameworkPath` is frequently a symlink. VS Code's macOS file watcher doesn't
 * fire for external writes (a markdown editor, an MCP, or git) that arrive
 * through a symlinked path — the editor/preview then goes stale until a manual
 * window reload. Resolving to the canonical path here (a no-op when there's no
 * symlink) makes the watcher track the SAME path those external writes land on,
 * so live refresh works. Guarded: falls back to the plain expansion if the path
 * doesn't exist yet.
 */
export function expandHome(p: string): string {
  let out = p;
  if (p === '~') out = os.homedir();
  else if (p.startsWith('~/')) out = path.join(os.homedir(), p.slice(2));
  try {
    return fs.realpathSync(out);
  } catch {
    return out;
  }
}

/**
 * Resolve the directory that holds the AIOS command definitions.
 * Priority: configured `aiosGlass.frameworkPath` → open workspace root.
 * Returns null if no candidate contains `plugins/aios/commands`.
 */
export function resolveCommandsDir(): string | null {
  const configured = vscode.workspace
    .getConfiguration('aiosGlass')
    .get<string>('frameworkPath', '~/aios');

  const candidates: string[] = [];
  if (configured && configured.trim()) {
    candidates.push(expandHome(configured.trim()));
  }
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) candidates.push(wsRoot);

  for (const base of candidates) {
    const dir = path.join(base, 'plugins', 'aios', 'commands');
    if (dirExists(dir)) return dir;
  }
  return null;
}

/** Discover and parse all AIOS commands. Sorted by cadence, then name. */
export function discoverCommands(): AiosCommand[] {
  const dir = resolveCommandsDir();
  if (!dir) return [];

  const commands: AiosCommand[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.md') || entry === '_index.md') continue;
    const filePath = path.join(dir, entry);
    const name = entry.replace(/\.md$/, '');
    try {
      const fm = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      commands.push({
        name,
        description: fm.description ?? '',
        argumentHint: fm.argumentHint,
        cadence: cadenceFromTags(fm.tags),
        filePath
      });
    } catch {
      // A malformed command file shouldn't break the whole tree.
      commands.push({ name, description: '', cadence: 'As needed', filePath });
    }
  }
  return commands.sort(byCadenceThenName);
}

const CADENCE_ORDER: Cadence[] = ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'As needed'];

function byCadenceThenName(a: AiosCommand, b: AiosCommand): number {
  const c = CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence);
  return c !== 0 ? c : a.name.localeCompare(b.name);
}

function cadenceFromTags(tags: string[]): Cadence {
  for (const t of tags) {
    const hit = CADENCE_BY_TAG[t.toLowerCase()];
    if (hit) return hit;
  }
  return 'As needed';
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}



// Moved to the pure core (unit-testable); re-exported for existing consumers.
export { parseFrontmatter } from '../core/frontmatter';
export type { Frontmatter } from '../core/frontmatter';
