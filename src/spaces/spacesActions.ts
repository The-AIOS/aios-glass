import * as vscode from 'vscode';
import { launchAios } from '../rituals/runner';
import { readCompanies } from './spaces';

/**
 * Args-as-forms: turn `/aios:company` and `/aios:collaborate` subcommands into
 * guided pickers/inputs, then launch the real command via native Claude.
 * Glass triggers the engine; the command does the work.
 */

async function pickCompanyName(): Promise<string | undefined> {
  const companies = readCompanies();
  if (companies.length === 0) {
    void vscode.window.showWarningMessage('AIOS Glass: no mounted companies found in USER.md.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    companies.map((c) => ({ label: c.name, description: `${c.substrate} · synced ${c.lastSync}` })),
    { title: 'Pick a company', placeHolder: 'Mounted companies' }
  );
  return pick?.label;
}

/** Company actions. If `preselected`, jump straight to per-company actions. */
export async function companyAction(preselected?: string): Promise<void> {
  if (preselected) {
    const sub = await vscode.window.showQuickPick(['Sync', 'Status', 'Invite'], {
      title: `Company: ${preselected}`, placeHolder: 'Action'
    });
    if (!sub) return;
    if (sub === 'Sync') return launchAios('company', `--sync ${preselected}`);
    if (sub === 'Status') return launchAios('company', '--status');
    if (sub === 'Invite') return launchAios('company', `--invite ${preselected}`);
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: 'Sync all companies', id: 'sync-all' },
      { label: 'Sync a company…', id: 'sync' },
      { label: 'Mount a company…', id: 'mount' },
      { label: 'Status', id: 'status' },
      { label: 'Invite to a company…', id: 'invite' },
      { label: 'Create a company…', id: 'create' }
    ],
    { title: 'Companies', placeHolder: 'Pick an action' }
  );
  if (!action) return;

  switch (action.id) {
    case 'sync-all': return launchAios('company', '--sync-all');
    case 'status': return launchAios('company', '--status');
    case 'create': return launchAios('company', '--create');
    case 'mount': {
      const url = await vscode.window.showInputBox({
        title: 'Mount a company', prompt: 'Git remote URL (or substrate source)',
        placeHolder: 'git@github.com:org/company-context.git', ignoreFocusOut: true
      });
      if (url && url.trim()) return launchAios('company', `--mount ${url.trim()}`);
      return;
    }
    case 'sync': {
      const name = await pickCompanyName();
      if (name) return launchAios('company', `--sync ${name}`);
      return;
    }
    case 'invite': {
      const name = await pickCompanyName();
      if (name) return launchAios('company', `--invite ${name}`);
      return;
    }
  }
}

/** Collaborate actions. */
export async function collaborateAction(): Promise<void> {
  const action = await vscode.window.showQuickPick(
    [
      { label: 'Add a project to a space…', id: 'add-project' },
      { label: 'Status', id: 'status' },
      { label: 'New space…', id: 'new' },
      { label: 'Dry run', id: 'dry-run' }
    ],
    { title: 'Collaboration spaces', placeHolder: 'Pick an action' }
  );
  if (!action) return;

  switch (action.id) {
    case 'add-project': return launchAios('collaborate', '--add-project');
    case 'status': return launchAios('collaborate', '--status');
    case 'dry-run': return launchAios('collaborate', '--dry-run');
    case 'new': {
      const name = await vscode.window.showInputBox({
        title: 'New collaboration space', prompt: 'Space name (optional — leave blank for the suggester)',
        placeHolder: 'e.g. acme-partnership', ignoreFocusOut: true
      });
      if (name === undefined) return;
      return launchAios('collaborate', name.trim() || undefined);
    }
  }
}
