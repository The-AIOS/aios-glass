/**
 * The `claude` command lines Glass types for a resume and for the Health card's help session —
 * vscode-free so their shape is tested directly. Both may carry a "Read <file> and follow…" prompt
 * pointing into the private run dir; that dir is granted with `--add-dir` (aios#231, core/addDir),
 * placed straight after the binary because the flag is variadic.
 *
 * `shell` is the dialect of the terminal the line is typed into (core/spawnShell): the flags are the
 * claude binary's and the same everywhere, but PowerShell quotes differently from zsh and bash.
 */
import { addDirArgs } from '../core/addDir';
import { quoteFor, type TypedShell } from '../core/spawnShell';

const addDir = (taskFile: string | undefined, shell: TypedShell): string =>
  addDirArgs(taskFile).map((a, i) => ` ${i ? quoteFor(a, shell) : a}`).join('');

/** `claude [--add-dir <run dir>] --resume <id> [extra…] [prompt]`. No --name, no --model: a resume keeps both. */
export function resumeCmd(bin: string, sessionId: string, extraArgs: string[], prompt: string, taskFile: string | undefined, shell: TypedShell): string {
  const q = (s: string) => quoteFor(s, shell);
  const extra = extraArgs.map((a) => ` ${q(a)}`).join('');   // contract 4: --effort / --settings
  return `${bin}${addDir(taskFile, shell)} --resume ${q(sessionId)}${extra}${prompt ? ` ${q(prompt)}` : ''}`;
}

/** The Health card's help session: `default` permission mode so it asks before every command. */
export function healthHelpCmd(bin: string, taskFile: string, prompt: string, shell: TypedShell): string {
  return `${bin}${addDir(taskFile, shell)} --permission-mode default --name health-help ${quoteFor(prompt, shell)}`;
}
