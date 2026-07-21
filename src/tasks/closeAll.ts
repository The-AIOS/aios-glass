import * as vscode from 'vscode';
import { findAgentTerminal, launchPrimary } from '../rituals/runner';
import { listRunningAgents } from '../agents/running';
import { primaryName } from '../home/vault';
import { t } from '../i18n';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Pick extends vscode.QuickPickItem {
  term?: vscode.Terminal;
  agentName?: string;
  action?: 'closeday' | 'kill';
}

/**
 * Map a session's registry status → a colored dot + a word, mirroring the running card's
 * statusInfo (home.js). The dot is an EMOJI, not a ThemeIcon+ThemeColor: QuickPick renders
 * item icons monochrome (it ignores the color), so a colored ThemeIcon showed every dot grey.
 * An emoji carries its own color, so it reads true in the picker AND in the multi-select input.
 */
function statusView(raw: string): { dot: string; word: string } {
  const st = (raw || '').toLowerCase();
  if (st === 'busy' || st === 'working' || st === 'running') return { dot: '🟡', word: t('working') };
  if (/wait|input|prompt|\bask\b|attention|approv|permission|block/.test(st)) return { dot: '🔵', word: t('needs input') };
  if (/error|fail|crash/.test(st)) return { dot: '🔴', word: t('error') };
  return { dot: '🟢', word: '' }; // idle / ready — the green dot says it, no word needed
}

/**
 * "Close all" as a SELECTOR. A grouped multi-select picker of every live Claude session in this
 * window; you confirm which to wrap up + two optional post-actions. Each picked session runs
 * `/aios:close-session --auto` (non-interactive) — captures ITSELF race-safe (vault → locked
 * merge-append · project → its own report in ~/aios/.claude/ · every commit via aios-commit)
 * and returns to idle.
 *
 * Design (per operator testing):
 *   • **All sessions selected by default** (including active + primary) — uncheck any to keep it open.
 *   • Each row shows the running-card status **color dot** (🟢 idle · 🟡 working · 🔵 needs-input · 🔴 error).
 *     We iterate the AGENT registry (which carries the real status + pid) and resolve each to its
 *     terminal by pid ancestry — a terminal's DISPLAY name often differs from the session name, so a
 *     name-keyed status lookup showed every dot grey.
 *   • Two OPTIONAL post-actions (default off): run close-day (in your primary session — opens it
 *     if it isn't live) and kill the terminals (disposes every SELECTED terminal EXCEPT your primary).
 *   • KILL = the trash-icon path: term.dispose() (SIGHUP → claude + respawn loop + shell). Only your
 *     primary is spared; and each is disposed only AFTER it finishes capturing (busy→idle watch).
 * Full contract: plugins/aios/commands/close-all.md.
 */
export async function closeAll(): Promise<void> {
  const primary = primaryName();
  const isPrimary = (name: string) => !!primary && name === primary;

  // Agent-first: the session registry carries the CORRECT status + pid. Resolve each agent to its
  // terminal in THIS window via pid-ancestry (findAgentTerminal) — never term.name (unreliable).
  // Keep only sessions whose terminal is here, i.e. ones we can actually drive.
  let agents: Awaited<ReturnType<typeof listRunningAgents>> = [];
  try { agents = await listRunningAgents(); } catch { /* best-effort */ }
  const resolved: { name: string; status: string; term: vscode.Terminal }[] = [];
  for (const a of agents) {
    const term = await findAgentTerminal(a.name, a.pid);
    if (term) resolved.push({ name: a.name, status: a.status, term });
  }
  if (resolved.length === 0) {
    vscode.window.showInformationMessage(t('Close sessions: no live Claude sessions found in this window.'));
    return;
  }

  const items: Pick[] = [];
  items.push({ label: t('Sessions'), kind: vscode.QuickPickItemKind.Separator });
  for (const r of resolved) {
    const sv = statusView(r.status);
    const badges = [isPrimary(r.name) ? t('primary') : '', sv.word].filter(Boolean).join(' · ');
    items.push({ term: r.term, agentName: r.name, label: `${sv.dot} ${r.name}`, description: badges, picked: true }); // ALL selected by default
  }
  items.push({ label: t('After closing (optional)'), kind: vscode.QuickPickItemKind.Separator });
  items.push({ action: 'closeday', label: t('Run /close-day'), description: t('consolidate — runs in your primary session (opens it if needed)'), picked: false });
  items.push({ action: 'kill', label: t('Kill the terminals'), description: t('dispose every selected terminal except your primary session'), picked: false });

  const chosen = (await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t('Close which sessions? Each runs /close-session (auto).'),
    placeHolder: t('All selected by default — uncheck any to keep open. Optional: /close-day (runs in your primary) · kill terminals (every selected except your primary).'),
  })) as Pick[] | undefined;
  if (!chosen) return;

  const picks = chosen.filter((p) => p.term && p.agentName) as Pick[];
  const sessions = picks.map((p) => p.term!);
  if (sessions.length === 0) { vscode.window.showInformationMessage(t('No sessions selected.')); return; }
  const doCloseDay = chosen.some((p) => p.action === 'closeday');
  const doKill = chosen.some((p) => p.action === 'kill');
  // Kill scope: every SELECTED session EXCEPT the primary (never killed, even if selected).
  const killTerms = new Map<string, vscode.Terminal>();
  if (doKill) for (const p of picks) if (!isPrimary(p.agentName!)) killTerms.set(p.agentName!, p.term!);

  // The primary's live terminal (regardless of whether it was selected) — where /close-day runs.
  const primaryTerm = resolved.find((r) => isPrimary(r.name))?.term;

  // 1. broadcast the non-interactive capture to each selected session
  for (const term of sessions) { term.show(false); term.sendText('/aios:close-session --auto', true); }
  vscode.window.showInformationMessage(t('Closing {0} session(s)…').replace('{0}', String(sessions.length)));

  // 2. watch each finish (busy→idle / gone), dispose the scoped ones, then optional close-day in primary
  void (async () => {
    await watchSessionsDone(picks.map((p) => p.agentName!), killTerms);
    if (doCloseDay) {
      if (primaryTerm) { primaryTerm.show(); primaryTerm.sendText('/aios:close-day', true); }
      else { await launchPrimary(primary); vscode.window.showInformationMessage(t('Opened your primary session — run /aios:close-day there to consolidate.')); }
    }
  })();
}

/**
 * Wait for each named session to finish its --auto capture, then dispose the ones in `killTerms`
 * (the trash-icon equivalent: term.dispose() SIGHUPs claude + respawn loop + shell). "Done" = it
 * was seen busy (close-session running) and returned to idle, OR it vanished from the registry.
 * A session that never shows the busy→idle cycle within the window is NOT auto-disposed (safer to
 * leave it than risk killing mid-capture). Never disposes anything not in killTerms.
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
