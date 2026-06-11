import * as vscode from 'vscode';

/**
 * One OutputChannel for the whole extension — the antidote to the silent-
 * failure culture (40+ bare `catch {}` sites). Design rule:
 *   · absence is normal (missing file, no registry, no vault) → stay silent
 *   · an ACTION failing (a launch, a dispatch, a message handler) → log it
 * So "it glitched" becomes one paste from `AIOS: Show Logs` instead of a
 * forensic session.
 */
let channel: vscode.OutputChannel | undefined;

export function logChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel('AIOS Glass');
  return channel;
}

export function log(msg: string): void {
  logChannel().appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

/** Record a swallowed exception with its context — never throws. */
export function swallow(ctx: string, e: unknown): void {
  try {
    log(`${ctx} — ${e instanceof Error ? (e.stack || e.message) : String(e)}`);
  } catch { /* logging must never take the extension down */ }
}
