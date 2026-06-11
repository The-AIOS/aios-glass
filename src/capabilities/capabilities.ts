import * as fs from 'fs';
import { ttlMemo } from '../core/memo';
import * as path from 'path';
import * as vscode from 'vscode';
import { frameworkRoot } from '../home/vault';
import { parseFrontmatter } from '../aios/commands';
import { launchSkill, pickWithAsk } from '../rituals/runner';

export type CapabilityKind = 'skill' | 'mcp' | 'plugin';

/**
 * A discovered capability — a skill, bundled MCP, or plugin. Read at runtime
 * from the framework's own folders (glass, not engine): whatever `/aios:update`
 * or a company sync adds shows up automatically.
 */
export interface Capability {
  name: string;
  description: string;
  kind: CapabilityKind;
  /** bundle / namespace folder */
  group: string;
  /** file to open when clicked (SKILL.md, plugin.json, or MCP README) */
  openPath?: string;
}

function sub(root: string, ...p: string[]): string {
  return path.join(root, ...p);
}
function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}
function titleCase(seg: string): string {
  return seg.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Skills: skills/<bundle>/<name>/SKILL.md */
function discoverSkillsUncached(): Capability[] {
  const root = frameworkRoot();
  if (!root) return [];
  const skillsDir = sub(root, 'skills');
  if (!isDir(skillsDir)) return [];

  const out: Capability[] = [];
  let rels: string[] = [];
  try {
    rels = fs.readdirSync(skillsDir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  for (const rel of rels) {
    if (path.basename(rel) !== 'SKILL.md') continue;
    const filePath = path.join(skillsDir, rel);
    if (!isFile(filePath)) continue;
    const parts = rel.split(path.sep);
    const group = titleCase(parts[0] || 'skills');
    let name = parts.length >= 2 ? parts[parts.length - 2] : path.basename(path.dirname(filePath));
    let description = '';
    try {
      const fm = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      if (fm.name) name = fm.name;
      if (fm.description) description = fm.description;
    } catch { /* keep folder name */ }
    out.push({ name, description, kind: 'skill', group, openPath: filePath });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** MCPs: bundled folders under mcps/ (top-level `*-mcp` + custom/ + company namespaces). */
export function discoverMcps(): Capability[] {
  const root = frameworkRoot();
  if (!root) return [];
  const mcpsDir = sub(root, 'mcps');
  if (!isDir(mcpsDir)) return [];

  const out: Capability[] = [];
  const pushMcp = (dirPath: string, group: string) => {
    const base = path.basename(dirPath);
    const name = base.replace(/-mcp$/, '');
    const readme = ['README.md', 'readme.md'].map((r) => path.join(dirPath, r)).find(isFile);
    out.push({ name, description: '', kind: 'mcp', group, openPath: readme });
  };

  for (const entry of fs.readdirSync(mcpsDir)) {
    const full = path.join(mcpsDir, entry);
    if (!isDir(full)) continue;
    if (entry.endsWith('-mcp')) {
      pushMcp(full, 'Bundled');
    } else {
      // any other directory = a namespace folder (custom/ or a company namespace)
      for (const child of fs.readdirSync(full)) {
        const cf = path.join(full, child);
        if (isDir(cf)) pushMcp(cf, titleCase(entry));
      }
    }
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** Plugins: a `.claude-plugin/plugin.json` anywhere under plugins/. */
export function discoverPlugins(): Capability[] {
  const root = frameworkRoot();
  if (!root) return [];
  const pluginsDir = sub(root, 'plugins');
  if (!isDir(pluginsDir)) return [];

  const out: Capability[] = [];
  let rels: string[] = [];
  try {
    rels = fs.readdirSync(pluginsDir, { recursive: true }) as string[];
  } catch {
    return [];
  }
  for (const rel of rels) {
    if (path.basename(rel) !== 'plugin.json') continue;
    if (path.basename(path.dirname(rel)) !== '.claude-plugin') continue;
    const filePath = path.join(pluginsDir, rel);
    if (!isFile(filePath)) continue;
    const group = titleCase(rel.split(path.sep)[0] || 'plugins');
    let name = path.basename(path.dirname(path.dirname(rel)));
    let description = '';
    try {
      const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof json.name === 'string') name = json.name;
      if (typeof json.description === 'string') description = json.description;
    } catch { /* keep folder name */ }
    out.push({ name, description, kind: 'plugin', group, openPath: filePath });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export interface CapabilitySets {
  skills: Capability[];
  mcps: Capability[];
  plugins: Capability[];
}

export function discoverCapabilities(): CapabilitySets {
  return { skills: discoverSkills(), mcps: discoverMcps(), plugins: discoverPlugins() };
}

/** Quick-pick across skills, then invoke the chosen one in native Claude. */
export async function skillsPicker(): Promise<void> {
  const skills = discoverSkills();
  if (skills.length === 0) {
    void vscode.window.showWarningMessage('AIOS Glass: no skills found under skills/.');
    return;
  }
  const pick = await pickWithAsk(
    skills.map((s) => ({ label: s.name, description: s.group, detail: s.description, cap: s })),
    { title: 'Run a skill', placeHolder: 'Pick a skill to invoke — or type what you need', matchOnDescription: true, matchOnDetail: true }
  );
  if (pick) await launchSkill(pick.cap.name);
}

// 5s TTL: rapid picker/palette/refresh re-opens reuse one scan; a new file
// still shows within seconds. See core/memo.ts.
export const discoverSkills = ttlMemo(discoverSkillsUncached, 5000);
