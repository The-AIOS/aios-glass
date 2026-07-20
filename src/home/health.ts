import * as vscode from 'vscode';
import { resolveCommandsDir } from '../aios/commands';
import { vaultRoot } from './vault';
import { currentAnthropicAccount } from './config';

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
  id: 'framework' | 'vault' | 'account' | 'foam';
  /** Short label shown on the row. */
  label: string;
  ok: boolean;
  /** One-line current-state detail (path found, account email, …). */
  detail: string;
  /** The fix action id when NOT ok — mapped to a command in home.js. */
  fix?: 'setPath' | 'login' | 'installFoam';
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

  // 4. Foam — optional (renders [[wikilinks]] + the graph). Amber, not red.
  const foam = !!vscode.extensions.getExtension('foam.foam-vscode');
  checks.push(foam
    ? { id: 'foam', label: 'Foam', ok: true, detail: 'installed' }
    : { id: 'foam', label: 'Foam', ok: false, detail: 'optional — renders wikilinks & the graph', fix: 'installFoam' });

  return checks;
}
