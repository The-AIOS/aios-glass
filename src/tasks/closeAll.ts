import * as vscode from 'vscode';
import { terminalHasClaude } from '../rituals/runner';
import { t } from '../i18n';

/**
 * /close-all as a Glass button — the "wrap up now" BROADCAST. Iterates every live Claude
 * terminal and sends `/close-session` to each. It is NOT a consolidator and never writes
 * the daily note: each session captures ITSELF, race-safe —
 *   • a vault session merge-appends its block into today's note under a per-file lock, so
 *     N landing at once are ordered, never clobbered;
 *   • a project/worker session writes its own `.claude/session-report-{date}-{session}.md`;
 *   • every commit underneath goes through `aios-commit` (mutex + scoped-staging plumbing).
 * Afterward the operator runs `/close-day` (once) to consolidate the per-session reports.
 * (sendText writes straight to each terminal's stdin — no clipboard, so the loop is safe;
 * the clipboard-race caveat is only for the spawn/remote-control path.)
 * Full contract: plugins/aios/commands/close-all.md.
 */
export async function closeAll(): Promise<void> {
  const claudeTerms: vscode.Terminal[] = [];
  for (const term of vscode.window.terminals) {
    if (await terminalHasClaude(term)) claudeTerms.push(term);
  }
  if (claudeTerms.length === 0) {
    vscode.window.showInformationMessage(t('Close all: no live Claude sessions found.'));
    return;
  }

  const label = t('Close all');
  const n = String(claudeTerms.length);
  const confirm = await vscode.window.showWarningMessage(
    t('Close all {0} live session(s)? Each runs /close-session — it captures itself (race-safe). Then run /close-day to consolidate.').replace('{0}', n),
    { modal: true },
    label,
  );
  if (confirm !== label) return;

  for (const term of claudeTerms) {
    term.show(false);
    term.sendText('/close-session', true);
  }

  vscode.window.showInformationMessage(
    t('Sent /close-session to {0} session(s). Run /close-day to consolidate.').replace('{0}', n),
  );
}
