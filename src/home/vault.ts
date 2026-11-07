import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { identityRowsIn, choosePrimaryIdentity } from '../core/primaryIdentity';
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
 * Primary session name from USER.md → ## Identity. A vault on several computers keeps one row per
 * computer's primary; THIS computer's choice is machine-local in ~/.aios/app.json (`primaryIdentity`,
 * set in the AIOS App's Settings), shared with the App so both surfaces launch the same identity.
 * No choice → the first row, as before. Fallback: "aios".
 */
export function primaryName(): string {
  const root = frameworkRoot();
  if (!root) return 'aios';
  let text = '';
  try { text = fs.readFileSync(path.join(root, 'USER.md'), 'utf8'); } catch { return 'aios'; }
  return choosePrimaryIdentity(identityRowsIn(text), storedPrimaryIdentity()).name || 'aios';
}

/** This computer's choice, from the App's machine-local ~/.aios/app.json ('' = none). */
function storedPrimaryIdentity(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.aios', 'app.json'), 'utf8')) as { primaryIdentity?: unknown };
    return typeof raw.primaryIdentity === 'string' ? raw.primaryIdentity.trim() : '';
  } catch { return ''; }
}

export type ContextKind = 'declared' | 'observed' | 'projects';

/** Absolute path to a context/projects folder in the vault. */
export function contextDir(kind: ContextKind): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const sub = kind === 'projects' ? '00 - notes/projects' : `00 - notes/context/${kind}`;
  return path.join(v, sub);
}

/** Count top-level .md notes in a context/projects folder (excludes _index.md). */
export function countNotes(kind: ContextKind): number {
  const dir = contextDir(kind);
  if (!dir) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '_index.md').length;
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
