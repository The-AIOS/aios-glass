import * as vscode from 'vscode';
import { terminalHasClaude } from '../rituals/runner';
import { listRunningAgents } from '../agents/running';
import { primaryName } from '../home/vault';
import { t } from '../i18n';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Pick extends vscode.QuickPickItem {
  term?: vscode.Terminal;
  action?: 'closeday' | 'kill';
}

/** Map a session's registry status → a colored dot + a word, mirroring the running
 * card's statusInfo (home.js): busy→amber, wait/input/approve→blue, else→green idle.
 * The dot carries the status (so it reads at a glance); the word only appears when
 * there's something to say (idle needs no word — the green dot says "ready"). */
function statusView(raw: string): { icon: vscode.ThemeIcon; word: string } {
  const st = (raw || '').toLowerCase();
  if (st === 'busy' || st === 'working' || st === 'running')
    return { icon: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow')), word: t('working') };
  if (/wait|input|prompt|\bask\b|attention|approv|permission|block/.test(st))
    return { icon: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue')), word: t('needs input') };
  if (/error|fail|crash/.test(st))
    return { icon: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red')), word: t('error') };
  return { icon: new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green')), word: '' };
}

/**
 * "Close all" as a SELECTOR (not a nuke). Opens a grouped multi-select picker of every live
 * Claude session, so you choose which to wrap up + two optional post-actions. It sends
 * `/aios:close-session --auto` (non-interactive) to each picked session — each captures ITSELF
 * race-safe (vault → locked merge-append · project → own per-session report · every commit
 * via aios-commit) and returns to idle.
 *
 * Guards (both fears + your rules):
 *   • Your PRIMARY session (buddai — the same one the "launch primary" button detects) defaults
 *     UNCHECKED and is NEVER killed, even if you select it. It's the guaranteed survivor and the
 *     one that runs /close-day. The currently-active terminal is protected the same way.
 *   • Each session shows the running-card's status dot (green idle · amber working · blue needs-input)
 *     so you can see what you're closing before you confirm.
 *   • KILL means what the trash icon means: dispose the integrated terminal (SIGHUP → claude +
 *     respawn loop + shell all stop) — NOT `spawn-kill` in a stray terminal (that only killed the
 *     claude process and left the terminal open). It's scoped HARD: only selected, non-protected
 *     sessions, and only AFTER each finishes capturing (busy→idle watch) — never mid-capture.
 *   • /close-day is OPTIONAL (default off) and runs ONCE in your primary session — never auto.
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
  const primary = primaryName();
  const activeTerm = vscode.window.activeTerminal;
  // Protected = never killed, default-unchecked. Your primary session (buddai) by NAME — the
  // reliable identity, not "whatever's focused" — plus the active terminal (never close where
  // you're typing). Selecting a protected session still closes it (appends its block); it just
  // can't be killed.
  const isPrimary = (term: vscode.Terminal) => !!primary && term.name === primary;
  const isProtected = (term: vscode.Terminal) => isPrimary(term) || term === activeTerm;

  const items: Pick[] = [];
  items.push({ label: t('Sessions'), kind: vscode.QuickPickItemKind.Separator });
  for (const term of claudeTerms) {
    const sv = statusView(statusByName.get(term.name) ?? '');
    // Word-only role/state badges (no emoji — the dot carries color/status).
    const badges = [
      isPrimary(term) ? t('primary') : (term === activeTerm ? t('active') : ''),
      sv.word,
    ].filter(Boolean).join(' · ');
    items.push({ term, label: term.name, description: badges, iconPath: sv.icon, picked: !isProtected(term) });
  }
  items.push({ label: t('After closing'), kind: vscode.QuickPickItemKind.Separator });
  items.push({ action: 'closeday', label: t('Run /close-day'), description: t('consolidate — runs once in your primary session'), picked: false });
  items.push({ action: 'kill', label: t('Kill the terminals'), description: t('dispose each terminal after it finishes capturing'), picked: false });

  const chosen = (await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t('Close which sessions? Each runs /close-session (auto). Optionally consolidate + kill.'),
    placeHolder: t('Primary + active are unchecked to keep — check to close them (never killed). The bottom two are optional.'),
  })) as Pick[] | undefined;
  if (!chosen) return;

  const sessions = chosen.filter((p) => p.term).map((p) => p.term!) as vscode.Terminal[];
  if (sessions.length === 0) { vscode.window.showInformationMessage(t('No sessions selected.')); return; }
  const doCloseDay = chosen.some((p) => p.action === 'closeday');
  const doKill = chosen.some((p) => p.action === 'kill');
  // HARD kill-scope: only selected, NON-protected sessions (never primary/active, even if selected).
  const killTerms = new Map<string, vscode.Terminal>();
  if (doKill) for (const s of sessions) if (!isProtected(s)) killTerms.set(s.name, s);

  // 1. broadcast the non-interactive capture to each selected session
  for (const term of sessions) { term.show(false); term.sendText('/aios:close-session --auto', true); }
  vscode.window.showInformationMessage(t('Closing {0} session(s)…').replace('{0}', String(sessions.length)));

  // 2. watch each finish (busy→idle / gone), dispose the scoped ones after they're done, then
  //    optional close-day in the PRIMARY session (never auto, never killed).
  const primaryTerm = claudeTerms.find(isPrimary) ?? (activeTerm && claudeTerms.includes(activeTerm) ? activeTerm : undefined);
  void (async () => {
    await watchSessionsDone(sessions.map((s) => s.name), killTerms);
    if (doCloseDay) {
      if (primaryTerm) { primaryTerm.show(); primaryTerm.sendText('/aios:close-day', true); }
      else vscode.window.showInformationMessage(t('Sessions closed. Run /close-day in your primary session to consolidate.'));
    }
  })();
}

/**
 * Wait for each named session to finish its --auto capture, then dispose the ones in `killTerms`
 * (the trash-icon equivalent: term.dispose() SIGHUPs claude + respawn loop + shell). "Done" = it
 * was seen busy (close-session running) and returned to idle, OR it vanished from the registry.
 * A session that never shows the busy→idle cycle within the window is NOT auto-disposed (safer to
 * leave it than to risk killing mid-capture). Never disposes anything not in killTerms.
 */
async function watchSessionsDone(allNames: string[], killTerms: Map<string, vscode.Terminal>): Promise<void> {
  const seenBusy = new Set<string>();
  const pendingKill = new Set(killTerms.keys());
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
      // dispose only after it's done capturing, and only if the terminal is still around
      if (pendingKill.has(name) && !gone) { pendingKill.delete(name); killTerms.get(name)?.dispose(); }
    }
    if (stillWatching.size > 0) await sleep(1500);
  }

  if (pendingKill.size > 0) {
    vscode.window.showWarningMessage(
      t('Kill-after timed out (never saw close-session finish) for: {0}. Close them manually if you want.')
        .replace('{0}', [...pendingKill].join(', ')),
    );
  }
}
