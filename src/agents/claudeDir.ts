import * as os from 'os';
import * as path from 'path';

/**
 * Where Claude Code keeps its files. Claude Code honours CLAUDE_CONFIG_DIR, so Glass reads where
 * Claude Code actually writes: the session registry, transcripts, settings, the quota cache, skills.
 * Unset, it is ~/.claude. One resolver for the whole extension, the same rule as the AIOS App's
 * `claudeConfigDir()`: a registry read from one folder and a resume index read from another made
 * Glass list no live session while a `resume` still found the transcript and opened it a second time.
 * Kept vscode-free so tests can load it.
 */
export const claudeConfigDir = (): string => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** ~/.claude.json, or $CLAUDE_CONFIG_DIR/.claude.json when that is set (Claude Code's own rule). */
export const claudeJsonPath = (): string =>
  process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');

/**
 * The marker the statusline reads to show the "swapped account" banner. The framework's writer
 * (`_watch.py`) and its reader (`context-monitor.py`) both use ~/.claude for it whatever
 * CLAUDE_CONFIG_DIR says, so Glass writes it there too: a marker under the variable would be one
 * the statusline never looks at. Follow the variable here only once the framework's reader does.
 */
export const swapMarkerPath = (): string => path.join(os.homedir(), '.claude', 'swap-notification.json');
