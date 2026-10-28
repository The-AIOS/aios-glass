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
  if (platform === 'win32') {
    const docs = [path.join(home, 'Documents')];
    if (env.OneDrive) docs.push(path.join(env.OneDrive, 'Documents'));   // a redirected Documents folder
    return docs.flatMap((d) => [
      path.join(d, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(d, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ]);
  }
  // Same rule as install-wrappers.sh: bash → .bashrc, anything else → .zshrc.
  return [path.join(home, path.basename(env.SHELL || '') === 'bash' ? '.bashrc' : '.zshrc')];
}

/**
 * The flag to add to a typed `spawn` so its worker may read `dir`, or '' when the installed wrapper
 * cannot take it. On Windows every profile that carries the wrapper must support it, because Glass
 * cannot know which edition's terminal will run the command.
 */
export function addDirFlag(dir: string, platform: NodeJS.Platform, home: string,
  env: Record<string, string | undefined>, read: (f: string) => string | undefined): string {
  if (!dir || dir.includes("'")) return '';
  const blocks = wrapperStartupFiles(platform, home, env).map((f) => wrapperBlock(read(f))).filter((b): b is string => !!b);
  if (!blocks.length) return '';
  const shell = platform === 'win32' ? 'powershell' : 'posix';
  if (!blocks.every((b) => blockAcceptsAddDir(b, shell))) return '';
  return shell === 'powershell' ? `-AddDir '${dir}' ` : `--add-dir '${dir}' `;
}
