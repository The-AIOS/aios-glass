import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { vaultRoot } from '../home/vault';
import { launchAios } from '../rituals/runner';
import { t } from '../i18n';

// Period values stay English (passed verbatim to the AIOS command); only the
// displayed labels localize.
const PERIODS = (): { label: string; value: string }[] => [
  { label: t('This week'), value: 'This week' },
  { label: t('This month'), value: 'This month' },
  { label: t('This quarter'), value: 'This quarter' },
  { label: t('This year'), value: 'This year' },
  { label: t('All time'), value: 'All time' },
  { label: t('Custom…'), value: 'Custom…' }
];

/**
 * Generate a report: pick the type (role / weekly / status / custom), then a
 * period, then run the right AIOS mechanism. Commands run in-session; the
 * status/custom reports wear the report-drafter hat (via /aios:agent).
 */
export async function runReports(): Promise<void> {
  const type = await vscode.window.showQuickPick(
    [
      { label: '$(person) ' + t('Role report'), detail: t('/aios:role-report — your activity by role'), id: 'role' },
      { label: '$(mortar-board) ' + t('Weekly learnings'), detail: t('/aios:weekly-learnings — consolidate what you learned'), id: 'weekly' },
      { label: '$(output) ' + t('Status report'), detail: t('report-drafter — status / board-style update'), id: 'status' },
      { label: '$(edit) ' + t('Custom report…'), detail: t('describe exactly what you want'), id: 'custom' }
    ],
    { title: t('Generate a report'), placeHolder: t('Pick a report type'), matchOnDetail: true }
  );
  if (!type) return;

  const pick = await vscode.window.showQuickPick(PERIODS(), { title: t('Report period'), placeHolder: t('Over what period?') });
  if (!pick) return;
  let period = pick.value;
  if (period === 'Custom…') {
    const c = await vscode.window.showInputBox({ title: t('Custom period'), prompt: t('e.g. "May 2026", "last 2 weeks", "Q2"'), ignoreFocusOut: true });
    if (c === undefined) return;
    period = c.trim() || 'recent';
  }

  const style = { name: type.id === 'role' ? 'role-report' : type.id === 'weekly' ? 'weekly-learnings' : 'report-drafter', icon: 'output', color: 'terminal.ansiCyan' };

  if (type.id === 'role') return launchAios('role-report', period, style);
  if (type.id === 'weekly') return launchAios('weekly-learnings', period, style);
  if (type.id === 'status') return launchAios('agent', `report-drafter — Status report (period: ${period})`, style);

  // custom
  const desc = await vscode.window.showInputBox({ title: t('Custom report'), prompt: t('What should the report cover?'), placeHolder: t('e.g. "what shipped + what\'s blocked this week"'), ignoreFocusOut: true });
  if (!desc?.trim()) return;
  return launchAios('agent', `report-drafter — ${desc.trim()} (period: ${period})`, style);
}

/** Most-recent files under 03 - export/reports/ — for the Reports card list. */
export interface ReportFile { name: string; path: string; }
export function recentReports(limit = 5): ReportFile[] {
  const v = vaultRoot();
  if (!v) return [];
  const dir = path.join(v, '03 - export', 'reports');
  const out: { name: string; path: string; mtime: number }[] = [];
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '_index.md') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 1) walk(p, depth + 1); continue; }
      let m = 0;
      try { m = fs.statSync(p).mtimeMs; } catch { /* ignore */ }
      out.push({ name: e.name, path: p, mtime: m });
    }
  };
  walk(dir, 0);
  // Two-stage (matches recentOutputs): recency picks WHICH reports, then display
  // that set reverse-ALPHABETICALLY (Z→A — stable, scannable, not mtime order).
  return out
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((o) => ({ name: o.name, path: o.path }));
}
