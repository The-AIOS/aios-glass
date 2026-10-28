/**
 * The `claude` command lines Glass types for a resume and for the Health card's help session —
 * vscode-free so their shape is tested directly. Both may carry a "Read <file> and follow…" prompt
 * pointing into the private run dir; that dir is granted with `--add-dir` (aios#231, core/addDir),
 * placed straight after the binary because the flag is variadic.
 */
import { addDirArgs } from '../core/addDir';

/** POSIX single-quote for a command typed into a shell. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const addDir = (taskFile?: string): string => addDirArgs(taskFile).map((a, i) => ` ${i ? shq(a) : a}`).join('');

/** `claude [--add-dir <run dir>] --resume <id> [extra…] [prompt]`. No --name, no --model: a resume keeps both. */
export function resumeCmd(bin: string, sessionId: string, extraArgs: string[], prompt: string, taskFile?: string): string {
  const extra = extraArgs.map((a) => ` ${shq(a)}`).join('');   // contract 4: --effort / --settings
  return `${bin}${addDir(taskFile)} --resume ${shq(sessionId)}${extra}${prompt ? ` ${shq(prompt)}` : ''}`;
}

/** The Health card's help session: `default` permission mode so it asks before every command. */
export function healthHelpCmd(bin: string, taskFile: string, prompt: string): string {
  return `${bin}${addDir(taskFile)} --permission-mode default --name health-help ${shq(prompt)}`;
}
