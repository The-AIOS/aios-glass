import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { vaultRoot } from '../home/vault';
import { launchSpawn } from '../rituals/runner';

interface Suggestion { task: string; agents: string[]; raw: string; }

/** Newest `YYYY-MM-DD.md` under `<vault>/01 - calendar/YYYY-MM/`. */
function latestDailyNote(): string | undefined {
  const v = vaultRoot();
  if (!v) return undefined;
  const cal = path.join(v, '01 - calendar');
  let months: string[];
  try {
    months = fs.readdirSync(cal).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
  } catch {
    return undefined;
  }
  for (const m of months.reverse()) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(cal, m)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
    } catch {
      continue;
    }
    if (files.length) return path.join(cal, m, files[files.length - 1]);
  }
  return undefined;
}

/** Extract the "Agents can handle" section's suggestions: each line that names
 *  one or more `[[agent]]` links, with the bolded task as its label. */
function parseAgentSection(md: string): Suggestion[] {
  const lines = md.split(/\r?\n/);
  const out: Suggestion[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+.*Agents can handle/i.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection) continue;
    if (/^\s*[-*]\s*\[[xX]\]/.test(line)) continue; // skip done/checked suggestions
    const agents = [...line.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
    if (!agents.length) continue;
    const bold = line.match(/\*\*(.+?)\*\*/);
    const task = (bold ? bold[1] : line.replace(/[-*🤖_]/g, '')).trim();
    out.push({ task, agents, raw: line.trim() });
  }
  return out;
}

/** How many agent suggestions the latest daily note lists (for the Home badge). */
export function countAgentSuggestions(): number {
  const note = latestDailyNote();
  if (!note) return 0;
  try {
    return parseAgentSection(fs.readFileSync(note, 'utf8')).length;
  } catch {
    return 0;
  }
}

/** Read the latest daily note's agent suggestions and spawn the chosen ones. */
export async function goWithAgents(): Promise<void> {
  const note = latestDailyNote();
  if (!note) { void vscode.window.showInformationMessage('AIOS Glass: no daily note found.'); return; }

  let md: string;
  try {
    md = fs.readFileSync(note, 'utf8');
  } catch {
    void vscode.window.showWarningMessage('AIOS Glass: could not read the daily note.');
    return;
  }

  const suggestions = parseAgentSection(md);
  if (!suggestions.length) {
    void vscode.window.showInformationMessage(`AIOS Glass: no agent suggestions in ${path.basename(note)}.`);
    return;
  }

  // Multi-select (all pre-checked): each selected task spawns its agent in its
  // OWN new terminal. Unlike "Launch an agent" (wear one hat in-session), this
  // dispatches many parallel workers — you can't wear multiple hats at once —
  // so it always opens a terminal per task.
  const picks = await vscode.window.showQuickPick(
    suggestions.map((s) => ({ label: s.task || s.agents[0], description: s.agents.join(' / '), detail: s.raw, picked: true, s })),
    {
      title: `Go with agents — ${path.basename(note, '.md')}`,
      placeHolder: 'Each spawns its agent in its own terminal — uncheck any to skip',
      canPickMany: true,
      matchOnDetail: true,
    }
  );
  if (!picks || picks.length === 0) return;

  for (const p of picks) {
    await launchSpawn(p.s.agents[0], p.s.task); // first-listed agent; one terminal each
  }
}
