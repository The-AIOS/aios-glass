import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { resolveCommandsDir } from '../aios/commands';
import { vaultRoot } from './vault';
import { currentAnthropicAccount } from './config';
import { routineRows, routineNeedsAttention, type RoutineRow } from '../core/routineHealth';

/**
 * AI-18 — health / setup card.
 *
 * A quiet "is my AIOS wired?" readout for the Home panel: the handful of things
 * that, when unset, silently break Glass for a non-dev (Iris's app-only
 * topology especially). Each check is green (ok) or amber (needs attention) and
 * carries a one-click `fix` — the command Glass already ships to resolve it — so
 * the card is a fix-it surface, not just a status light.
 *
 * Pure read (config files + extension registry); the fix actions are wired in
 * the webview to existing commands.
 */
export interface HealthCheck {
  id: 'framework' | 'vault' | 'account' | 'skills';
  /** Short label shown on the row. */
  label: string;
  ok: boolean;
  /** One-line current-state detail (path found, account email, …). */
  detail: string;
  /** The fix action id when NOT ok — mapped to a command in home.js. */
  fix?: 'setPath' | 'login';
}

/** Compute the setup-health checks (order = display order). */
export function computeHealth(): HealthCheck[] {
  const checks: HealthCheck[] = [];

  // 1. Framework — the commands dir must resolve or nothing launches.
  const cmds = resolveCommandsDir();
  checks.push(cmds
    ? { id: 'framework', label: 'Framework', ok: true, detail: 'connected' }
    : { id: 'framework', label: 'Framework', ok: false, detail: 'not found — set the path', fix: 'setPath' });

  // 2. Vault — the notes root Glass reads for context / calendar / projects.
  const v = vaultRoot();
  checks.push(v
    ? { id: 'vault', label: 'Vault', ok: true, detail: 'connected' }
    : { id: 'vault', label: 'Vault', ok: false, detail: 'no vault under the framework root', fix: 'setPath' });

  // 3. Account — a signed-in Anthropic account is required to run anything.
  const acct = currentAnthropicAccount();
  checks.push(acct
    ? { id: 'account', label: 'Claude account', ok: true, detail: acct }
    : { id: 'account', label: 'Claude account', ok: false, detail: 'not signed in', fix: 'login' });

  // 4. Skills & commands — the /aios:* commands + skills must be registered
  //    (marketplace plugin + `skills/setup.sh` symlinks into ~/.claude/skills)
  //    or they silently don't load. Amber if the skills dir is empty/missing.
  let skillCount = 0;
  try {
    const skillsDir = path.join(os.homedir(), '.claude', 'skills');
    skillCount = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).length : 0;
  } catch { skillCount = 0; }
  checks.push(skillCount > 0
    ? { id: 'skills', label: 'Skills & commands', ok: true, detail: `${skillCount} registered` }
    : { id: 'skills', label: 'Skills & commands', ok: false, detail: 'not registered — run `bash skills/setup.sh`' });

  return checks;
}

/** #27 — scheduled jobs from canonical's status files ($AIOS_HEALTH_DIR or ~/.aios/health), the
 *  App's reader and rules (shared core). No directory → no rows. */
export function routineJobs(now = Date.now()): RoutineRow[] {
  const dir = process.env.AIOS_HEALTH_DIR || path.join(os.homedir(), '.aios', 'health');
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return routineRows(names.filter((f) => f.endsWith('.json') && !f.startsWith('.')).map((file) => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, file), 'utf8'); } catch { text = '\u0000unreadable'; }
    return { file, text };
  }), now);
}

/** The brief for "Let Claude help": exactly what is not green, and the rules the helper works by. */
export function healthHelpBrief(checks = computeHealth(), jobs = routineJobs()): string {
  const iso = (ms?: number) => (ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : '?');
  const jobLine = (j: RoutineRow) => j.status === 'overdue'
    ? (j.state === 'pending' ? `installed, no completed run yet (expected by ${iso(j.validUntil)})` : `no result since ${iso(j.writtenAt)}${j.detail ? ` — last detail: ${j.detail}` : ''}`)
    : j.status === 'unreadable' ? `unreadable status file (${j.why})` : `${j.status}${j.detail ? `: ${j.detail}` : ''} (${iso(j.writtenAt)})`;
  const lines = [
    ...checks.filter((c) => !c.ok).map((c) => `- ${c.label}: ${c.detail}`),
    ...jobs.filter(routineNeedsAttention).map((j) => `- scheduled job "${j.name}": ${jobLine(j)} (status file: ~/.aios/health/${j.name}.json)`),
  ];
  return 'Help me fix my AIOS health. These items in the AIOS Glass Health card are not green:\n' + lines.join('\n') + '\n\n'
    + 'For each one: find the cause, explain it in plain words, and propose the fix. Ask me before you run any command or change anything. '
    + 'Scheduled jobs write their status with hooks/aios-health.py at the end of each run; a job is fixed when its NEXT run writes a fresh "ok", so tell me how to trigger it or when it is due — never edit or delete a status file to make it look green. '
    + 'When you are done, tell me to re-check the Health card.';
}
