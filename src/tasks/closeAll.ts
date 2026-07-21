import * as vscode from 'vscode';
import { terminalHasClaude, launchKill } from '../rituals/runner';
import { listRunningAgents } from '../agents/running';
import { t } from '../i18n';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Pick extends vscode.QuickPickItem {
  term?: vscode.Terminal;
  action?: 'closeday' | 'kill';
}

/**
 * "Close all" as a SELECTOR (not a nuke). Opens a grouped multi-select picker of every live
 * Claude session, so you choose which to wrap up + two optional post-actions. It sends
 * `/close-session --auto` (non-interactive) to each picked session — each captures ITSELF
 * race-safe (vault → locked merge-append · project → own per-session report · every commit
 * via aios-commit) and returns to idle.
 *
 * Guards (both fears + your rules):
 *   • Your ACTIVE session defaults UNCHECKED — a click can't close where you're typing.
 *   • WORKING sessions are flagged 🟡; `--auto` completes then idles (never interrupted mid-task).
 *   • KILL is scoped HARD: only sessions you selected, NEVER the active/primary (even if selected —
 *     it gets closed but never killed), NEVER unselected ones. And a session is killed only AFTER
 *     it finishes capturing (busy→idle watch) — never mid-capture.
 *   • /close-day is OPTIONAL (default off) and runs ONCE in your surviving main session — never auto.
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

  const statusByName = new Map<string, string>();
  try { for (const a of await listRunningAgents()) statusByName.set(a.name, a.status); } catch { /* best-effort */ }
  const active = vscode.window.activeTerminal;

  const items: Pick[] = [];
  items.push({ label: t('Sessions to close'), kind: vscode.QuickPickItemKind.Separator });
  for (const term of claudeTerms) {
    const busy = statusByName.get(term.name) === 'busy';
    const isActive = term === active;
    const badges = [
      busy ? '🟡 ' + t('working') : '',
      isActive ? '⟵ ' + t('active — you are here') : '',
    ].filter(Boolean).join('   ');
    items.push({ term, label: term.name, description: badges, picked: !isActive });  // active OFF by default
  }
  items.push({ label: t('After closing (optional)'), kind: vscode.QuickPickItemKind.Separator });
  items.push({ action: 'closeday', label: t('Run /close-day'), description: t('consolidate — stays in your main session'), picked: false });
  items.push({ action: 'kill', label: t('Kill the terminals'), description: t('after each finishes capturing'), picked: false });

  const chosen = (await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t('Close which sessions? Each runs /close-session (auto). Optionally consolidate + kill.'),
    placeHolder: t('Active + 🟡 working are flagged — uncheck to keep. The bottom two are optional.'),
  })) as Pick[] | undefined;
  if (!chosen) return;

  const sessions = chosen.filter((p) => p.term).map((p) => p.term!) as vscode.Terminal[];
  if (sessions.length === 0) { vscode.window.showInformationMessage(t('No sessions selected.')); return; }
  const doCloseDay = chosen.some((p) => p.action === 'closeday');
  const doKill = chosen.some((p) => p.action === 'kill');
  // HARD kill-scope: only selected sessions, and NEVER the active/primary even if selected
  const killNames = doKill
    ? sessions.filter((s) => s !== active).map((s) => s.name)
    : [];

  // 1. broadcast the non-interactive capture to each selected session
  for (const term of sessions) { term.show(false); term.sendText('/close-session --auto', true); }
  vscode.window.showInformationMessage(t('Closing {0} session(s)…').replace('{0}', String(sessions.length)));

  // 2. watch each finish (busy→idle / gone), kill the scoped ones after they're done, then optional close-day
  void (async () => {
    await watchSessionsDone(sessions.map((s) => s.name), killNames);
    if (doCloseDay) {
      if (active && !sessions.includes(active)) {
        active.show(); active.sendText('/close-day', true);
      } else {
        vscode.window.showInformationMessage(t('Sessions closed. Run /close-day in your main session to consolidate.'));
      }
    }
  })();
}

/**
 * Wait for each named session to finish its --auto capture, then spawn-kill the ones in `killNames`.
 * "Done" = it was seen busy (close-session running) and returned to idle, OR it vanished from the
 * registry. A session that never shows the busy→idle cycle within the window is NOT auto-killed
 * (safer to leave it than to risk killing mid-capture). Never kills anything not in killNames.
 */
async function watchSessionsDone(allNames: string[], killNames: string[]): Promise<void> {
  const seenBusy = new Set<string>();
  const pendingKill = new Set(killNames);
  const stillWatching = new Set(allNames);
  const deadline = Date.now() + 180_000; // 2 min ceiling
  await sleep(2000); // grace so close-session can start (the session goes busy)

  while (stillWatching.size > 0 && Date.now() < deadline) {
    let status = new Map<string, string>();
    try { status = new Map((await listRunningAgents()).map((a) => [a.name, a.status])); } catch { /* keep last */ }

    for (const name of [...stillWatching]) {
      const st = status.get(name);
      if (st === 'busy') { seenBusy.add(name); continue; }
      const gone = st === undefined;
      const done = gone || (seenBusy.has(name) && st !== 'busy');
      if (!done) continue;
      stillWatching.delete(name);
      if (pendingKill.has(name) && !gone) { pendingKill.delete(name); await launchKill(name); }
    }
    if (stillWatching.size > 0) await sleep(1500);
  }

  if (pendingKill.size > 0) {
    vscode.window.showWarningMessage(
      t('Kill-after timed out (never saw close-session finish) for: {0}. Kill them manually if you want.')
        .replace('{0}', [...pendingKill].join(', ')),
    );
  }
}
