import * as vscode from 'vscode';
import { terminalHasClaude } from '../rituals/runner';
import { listRunningAgents } from '../agents/running';
import { t } from '../i18n';

/**
 * "Close all" as a SELECTOR, not a nuke. Opens a multi-select picker (like "go with agents")
 * of every live Claude session, so you choose which to wrap up. It sends `/close-session` to
 * each picked session — NOT a consolidator, never writes the daily note: each session captures
 * itself race-safe (vault → locked merge-append · project → own per-session report · every
 * commit via aios-commit). Afterward run `/close-day` (once) to consolidate.
 *
 * Two fears, two guards:
 *   • Your ACTIVE session defaults to UNCHECKED (flagged "active — you're here") so a click can
 *     never close the session you're typing in. Check it only if you mean to.
 *   • WORKING sessions (busy, the amber dot) are flagged. `sendText` queues `/close-session`, so
 *     a busy session finishes its task then closes — it is not interrupted. Uncheck it to keep it.
 *
 * (sendText writes straight to each terminal's stdin — no clipboard, so the loop is safe.)
 * Full contract: plugins/aios/commands/close-all.md.
 */
export async function closeAll(): Promise<void> {
  const claudeTerms: vscode.Terminal[] = [];
  for (const term of vscode.window.terminals) {
    if (await terminalHasClaude(term)) claudeTerms.push(term);
  }
  if (claudeTerms.length === 0) {
    vscode.window.showInformationMessage(t('Close sessions: no live Claude sessions found.'));
    return;
  }

  // busy/idle status from the session registry (~/.claude/sessions/<pid>.json), matched by name
  const statusByName = new Map<string, string>();
  try { for (const a of await listRunningAgents()) statusByName.set(a.name, a.status); } catch { /* best-effort */ }
  const active = vscode.window.activeTerminal;

  interface Item extends vscode.QuickPickItem { term: vscode.Terminal }
  const items: Item[] = claudeTerms.map((term) => {
    const busy = statusByName.get(term.name) === 'busy';
    const isActive = term === active;
    const badges = [
      busy ? '🟡 ' + t('working') : '',
      isActive ? '⟵ ' + t('active — you are here') : '',
    ].filter(Boolean).join('   ');
    return { term, label: term.name, description: badges, picked: !isActive };  // active OFF by default
  });

  const picked = (await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t('Close which sessions? Each runs /close-session, then run /close-day to consolidate.'),
    placeHolder: t('Checked = will close. Your active session and 🟡 working ones are flagged — uncheck to keep.'),
  })) as Item[] | undefined;
  if (!picked || picked.length === 0) return;

  for (const it of picked) { it.term.show(false); it.term.sendText('/close-session', true); }
  vscode.window.showInformationMessage(
    t('Sent /close-session to {0} session(s). Run /close-day to consolidate.').replace('{0}', String(picked.length)),
  );
}
