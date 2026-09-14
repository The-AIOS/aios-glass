/**
 * Glass's half of the attention contract (#22/#23) — the IDE's answer to the App's Dock badge.
 *
 * The DEFINITIONS are shared byte-identical in `core/attention.ts` (pinned by ATTENTION_SHA in
 * both repos): when a block is entered, when a result counts as unread, what "seen" means. Only
 * the SURFACE differs, and it has to — an extension does not own the Dock icon, so the badge
 * becomes a status-bar item, which is where VS Code puts exactly this kind of standing count.
 *
 * WHY SHARED DEFINITIONS MATTER HERE MORE THAN THE UI DOES. Both surfaces watch the SAME session
 * registry on ONE machine. If they disagreed about when a block begins, the operator would get
 * two different answers from two windows onto the same sessions — and each would look right on
 * its own, which is the kind of disagreement nobody debugs because nobody sees both at once.
 *
 * "Visible" is the honest difference between the surfaces. The App can say a pane is on screen;
 * an extension cannot see which terminal the operator is looking at with any reliability, so
 * Glass reports visibility only when a terminal is BOTH the active terminal AND the window has
 * focus. When the window is unfocused, nothing is visible — the same rule the App applies.
 */
import * as vscode from 'vscode';
import {
  attentionTick, markNotified, mayBanner, normalizeNotifyLevel,
  EMPTY_ATTENTION, type AttentionState,
} from '../core/attention';
import { listRunningAgents, type RunningAgent } from './running';
import { t } from '../i18n';

const POLL_MS = 2000;

export interface AttentionBar extends vscode.Disposable {
  /** The blocked sessions, oldest first — what the jump command walks. */
  blocked(): RunningAgent[];
}

export function createAttentionBar(context: vscode.ExtensionContext): AttentionBar {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'aios.nextWaiting';
  context.subscriptions.push(item);

  let state: AttentionState = EMPTY_ATTENTION;
  let lastBlocked: RunningAgent[] = [];

  /** Every session pane the operator can actually see. */
  const visible = (): string[] => {
    if (!vscode.window.state.focused) return [];       // IDE in the background → nothing is seen
    const active = vscode.window.activeTerminal;
    return active ? [active.name] : [];
  };

  const level = (): ReturnType<typeof normalizeNotifyLevel> =>
    normalizeNotifyLevel(vscode.workspace.getConfiguration('aiosGlass').get<string>('attention'));

  const tick = async (): Promise<void> => {
    const running = await listRunningAgents();
    const lvl = level();
    const r = attentionTick(
      state,
      running.map((a) => ({ name: a.name, status: a.status, waitingFor: a.waitingFor })),
      visible(),
    );
    state = r.state;

    /* Oldest first — the one that has been blocked longest is the one to answer next, and the
       terminal list cannot tell you that because it never reorders (nor should it). */
    lastBlocked = running
      .filter((a) => r.blocks.some((b) => b.name === a.name))
      .sort((x, y) => (x.statusUpdatedAt ?? x.updatedAt ?? 0) - (y.statusUpdatedAt ?? y.updatedAt ?? 0));

    if (lvl === 'off' || r.badge === 0) {
      item.hide();
    } else {
      const blocks = r.blocks.length;
      item.text = blocks > 0 ? `$(bell-dot) ${blocks}` : `$(inbox) ${r.unread.length}`;
      item.tooltip = blocks > 0
        ? `${blocks} ${t('waiting on you')} · ${r.unread.length} ${t('finished unseen')}`
        : `${r.unread.length} ${t('finished unseen')}`;
      /* Warning colour only for a real block. An unread RESULT is not a problem to be alarmed
         about — it is something to read when you get to it, and colouring it would train the
         operator to ignore the colour that does mean "answer me". */
      item.backgroundColor = blocks > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
      item.show();
    }

    if (!mayBanner(lvl) || !r.pending.length) return;
    const delivered: string[] = [];
    for (const s of r.pending) {
      try {
        void vscode.window.showWarningMessage(
          `${s.name} ${t('needs you')} — ${s.waitingFor || t('waiting on your answer')}`,
          t('Show me'),
        ).then((pick) => {
          if (pick) void vscode.commands.executeCommand('aios.revealAgent', s.name);
        });
        delivered.push(s.name);
      } catch { /* not shown → stays pending, and the next tick tries again */ }
    }
    // ONLY what actually went out: a notification that threw must not be remembered as shown.
    state = markNotified(state, delivered);
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, POLL_MS);

  return {
    blocked: () => lastBlocked,
    dispose: () => { clearInterval(timer); item.dispose(); },
  };
}
