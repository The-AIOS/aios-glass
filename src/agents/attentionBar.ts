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
 */
import * as vscode from 'vscode';
import {
  attentionTick, markNotified, mayBanner, normalizeNotifyLevel, sessionKey,
  EMPTY_ATTENTION, type AttentionState,
} from '../core/attention';
import { listOperatorSessions, type RunningAgent } from './running';
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

  const level = (): ReturnType<typeof normalizeNotifyLevel> =>
    normalizeNotifyLevel(vscode.workspace.getConfiguration('aiosGlass').get<string>('attention'));

  const tick = async (): Promise<void> => {
    const running = await listOperatorSessions();   // AI-165: never a daemon spare
    const lvl = level();
    const r = attentionTick(
      state,
      running.map((a) => ({ id: sessionKey(a), name: a.name, status: a.status, waitingFor: a.waitingFor })),
    );
    state = r.state;

    /* Oldest first — the one that has been blocked longest is the one to answer next, and the
       terminal list cannot tell you that because it never reorders (nor should it). */
    lastBlocked = running
      .filter((a) => r.blocks.some((b) => b.id === sessionKey(a)))
      .sort((x, y) => (x.statusUpdatedAt ?? x.updatedAt ?? 0) - (y.statusUpdatedAt ?? y.updatedAt ?? 0));

    if (lvl === 'off' || r.badge === 0) {
      item.hide();
    } else {
      /* ONE meaning, so the number is readable without a legend: sessions blocked on you. The
         design also counted "finished while you were away" and the operator could not read the
         result — a 4 beside two waiting sessions, with no way to clear the other half. */
      item.text = `$(bell-dot) ${r.badge}`;
      item.tooltip = `${r.badge} ${t('waiting on you')}`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
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
        delivered.push(s.id);
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
