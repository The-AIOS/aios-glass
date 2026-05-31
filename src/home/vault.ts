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
