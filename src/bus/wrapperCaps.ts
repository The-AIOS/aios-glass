/**
 * Does the INSTALLED `spawn` wrapper accept a folder grant? (aios#231, the Glass spawn half.)
 *
 * Glass hands a long spawn task over as a file in its own handoff folder and types
 * `spawn <name> 'Read <file> and follow the instructions inside.'`. Canonical's wrapper writes that
 * line into ITS task file, in a folder it grants with --add-dir, so under
 * blockReadsOutsideWorkingDirectories the worker reads the wrapper's file and is then refused
 * Glass's. Canonical v0.8.13 lets a caller grant one more folder: `spawn --add-dir <dir>` (zsh/bash)
 * and `spawn -AddDir <dir>` (PowerShell). An OLDER wrapper does not know the flag and takes it as the
 * worker's NAME, so the flag may only be typed when the wrapper the shell will actually run has it.
 *
 * The answer is read from the wrapper block canonical's installer writes into the shell's startup
 * file, the same file the shell will source: no shell is started and no rc file is executed. Any
 * doubt (no file, no block, a profile without support) answers false, which keeps today's command.
 */
import * as path from 'path';
import { quoteFor, spawnOption, typedShellFor } from '../core/spawnShell';

/* A banner counts only at the START of a line, which is how the installer writes it. The installer's
   own source also names the banners inside comments and match patterns (indented, or mid-line); a
   plain indexOf took those first and cut the block to nothing, so a v0.8.13 wrapper read as
   unsupported. Measured against canonical's real install-wrappers.sh/.ps1. */
const BEGIN = /^# ==== claude-spawn-wrappers\b.*$/m;
const END = /^# ==== END claude-spawn-wrappers\b.*$/m;

/** The installer's managed block in a startup file, or undefined when there is none. */
export function wrapperBlock(rc: string | undefined): string | undefined {
  if (!rc) return undefined;
  const a = BEGIN.exec(rc);
  if (!a) return undefined;
  const rest = rc.slice(a.index);
  const b = END.exec(rest);
  return b ? rest.slice(0, b.index) : undefined;
}

/** Does this block's `spawn` take a folder grant? */
export function blockAcceptsAddDir(block: string | undefined, shell: 'posix' | 'powershell'): boolean {
  if (!block) return false;
  return shell === 'posix' ? /^\s*--add-dir\)/m.test(block) : /\[string\[\]\]\s*\$AddDir\b/.test(block);
}

/** The startup files the installer writes to: the one it picks for $SHELL, or both PowerShell profiles. */
export function wrapperStartupFiles(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): string[] {
  /* The given platform's separators, whatever host computes the answer. */
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const docs = [p.join(home, 'Documents')];
    if (env.OneDrive) docs.push(p.join(env.OneDrive, 'Documents'));   // a redirected Documents folder
    return docs.flatMap((d) => [
      p.join(d, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      p.join(d, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ]);
  }
  // Same rule as install-wrappers.sh: bash → .bashrc, anything else → .zshrc.
  return [p.join(home, p.basename(env.SHELL || '') === 'bash' ? '.bashrc' : '.zshrc')];
}

/**
 * The flag to add to a typed `spawn` so its worker may read `dir`, or '' when the installed wrapper
 * cannot take it. On Windows every profile that carries the wrapper must support it, because Glass
 * cannot know which edition's terminal will run the command.
 */
export function addDirFlag(dir: string, platform: NodeJS.Platform, home: string,
  env: Record<string, string | undefined>, read: (f: string) => string | undefined): string {
  /* A folder holding any quote is not granted (doubt answers no). PowerShell also ends a
     single-quoted string at a typographic quote, so those count too (C:\Users\D’Arcy). */
  if (!dir || /['\u2018\u2019\u201a\u201b]/.test(dir)) return '';
  const blocks = wrapperStartupFiles(platform, home, env).map((f) => wrapperBlock(read(f))).filter((b): b is string => !!b);
  if (!blocks.length) return '';
  const shell = typedShellFor(platform);
  if (!blocks.every((b) => blockAcceptsAddDir(b, shell))) return '';
  return `${spawnOption('add-dir', shell)} ${quoteFor(dir, shell)} `;
}

/**
 * Does this block's `spawn` start a session with NO model flag when asked? (aios-app#230.)
 * Canonical's wrapper always passes `--model` (its pin) unless told `spawn --inherit-model`
 * (zsh/bash) or `spawn -InheritModel` (PowerShell). Same rule as the folder grant: an older
 * wrapper takes the unknown flag as the worker's name, so it is typed only when the wrapper the
 * shell will run has it.
 */
export function blockAcceptsInheritModel(block: string | undefined, shell: 'posix' | 'powershell'): boolean {
  if (!block) return false;
  return shell === 'posix' ? /^\s*--inherit-model\)/m.test(block) : /\[switch\]\s*\$InheritModel\b/.test(block);
}

/**
 * The flag that makes a typed `spawn` start on the operator's saved model, or '' when the installed
 * wrapper cannot take it (then the worker starts on the wrapper's pin, as before). On Windows every
 * profile that carries the wrapper must support it, as for the folder grant.
 */
export function inheritModelFlag(platform: NodeJS.Platform, home: string,
  env: Record<string, string | undefined>, read: (f: string) => string | undefined): string {
  const blocks = wrapperStartupFiles(platform, home, env).map((f) => wrapperBlock(read(f))).filter((b): b is string => !!b);
  if (!blocks.length) return '';
  const shell = typedShellFor(platform);
  if (!blocks.every((b) => blockAcceptsInheritModel(b, shell))) return '';
  return `${spawnOption('inherit-model', shell)} `;
}
