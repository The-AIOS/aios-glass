import * as fs from 'fs';
import { ttlMemo } from '../core/memo';
import * as path from 'path';
import { frameworkRoot } from '../home/vault';
import { parseFrontmatter } from '../aios/commands';

/**
 * An AIOS agent, discovered at runtime from `agents/**` — glass, not engine:
 * the registry is the framework's own files, so agents added via `/aios:update`
 * or hand-authored in `agents/custom/` appear automatically.
 */
export interface Agent {
  name: string;
  description: string;
  /** display group derived from the containing folder (bundle / company / custom) */
  group: string;
  /** codicon id declared in the agent's frontmatter `icon:` (if any) */
  icon?: string;
  /** search synonyms from frontmatter `keywords:` — e.g. content-writer can
   *  declare "social media, posts, linkedin" so intent words find it in pickers */
  keywords?: string;
  filePath: string;
}

/**
 * Resolve a codicon id for an agent — most-specific wins:
 *   1. the agent's declared `icon:` frontmatter (the agent owns its identity),
 *   2. inferred from its name / group / description (keyword scan of context),
 *   3. fallback 'robot'.
 * Returns a plain codicon id; callers wrap it in vscode.ThemeIcon.
 */
const ICON_RULES: ReadonlyArray<[RegExp, string]> = [
  [/legal|lawyer|\blaw\b|contract|complian|\bnda\b/i, 'law'],
  [/account|financ|invoic|\btax\b|bookkee|cash|billing/i, 'graph'],
  [/secur|threat|vuln|stride/i, 'shield'],
  [/aios-builder|scaffold|\bmeta\b/i, 'tools'],
  [/\bbug\b|triage/i, 'bug'],
  [/review|code|document|engineer|cofounder|\bship\b|product/i, 'code'],
  [/research|market|analyst|company|deep.?dive/i, 'search'],
  [/consult|strateg|advis|framework/i, 'briefcase'],
  [/email|mail|outreach|reply/i, 'mail'],
  [/content|writ|post|blog|article|substack/i, 'edit'],
  [/deck|present|slide|design|brand/i, 'symbol-color'],
  [/meeting|brief|prep|agenda/i, 'calendar'],
  [/report|status|board.?update/i, 'output'],
  [/lead|prospect|sales|\bcrm\b|monitor/i, 'megaphone'],
  [/study|learn|chapter|\bbook\b/i, 'mortar-board'],
  [/journal|reflect|prompt/i, 'note'],
  [/growth|companion|vent/i, 'heart'],
  [/crisis|emergency|urgent/i, 'flame'],
  [/decision|dilemma|weigh/i, 'list-tree'],
  [/onboard|orient|getting.?started|guide/i, 'compass'],
];

export function iconForAgent(a: { name?: string; group?: string; description?: string; icon?: string }): string {
  if (a.icon && a.icon.trim()) return a.icon.trim();
  const hay = `${a.name ?? ''} ${a.group ?? ''} ${a.description ?? ''}`;
  for (const [re, icon] of ICON_RULES) if (re.test(hay)) return icon;
  return 'robot';
}

export function agentsRoot(): string | undefined {
  const root = frameworkRoot();
  if (!root) return undefined;
  const a = path.join(root, 'agents');
  try {
    return fs.statSync(a).isDirectory() ? a : undefined;
  } catch {
    return undefined;
  }
}

/** Pretty-case a folder segment: "finance-legal" → "Finance Legal". */
function groupLabel(seg: string): string {
  return seg.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Discover all agents, sorted by group then name. */
function discoverAgentsUncached(): Agent[] {
  const root = agentsRoot();
  if (!root) return [];

  let rels: string[] = [];
  try {
    rels = fs.readdirSync(root, { recursive: true }) as string[];
  } catch {
    return [];
  }

  const agents: Agent[] = [];
  for (const rel of rels) {
    const base = path.basename(rel);
    if (!base.endsWith('.md') || base === '_index.md' || base.startsWith('_')) continue;

    const filePath = path.join(root, rel);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }

    // Only real agents — they carry `tags: [agent, …]`. This excludes the
    // reference/eval docs that live under some agent folders (no frontmatter).
    let fm;
    try {
      fm = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }
    if (!fm.tags.map((t) => t.toLowerCase()).includes('agent')) continue;

    const dirName = path.basename(path.dirname(rel)) || 'agents';
    const group = groupLabel(dirName === 'agents' ? 'general' : dirName);
    const name = fm.name || base.replace(/\.md$/, '');
    agents.push({ name, description: fm.description ?? '', group, icon: fm.icon, keywords: fm.keywords, filePath });
  }

  return agents.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

/** Group → agents map, preserving sorted (group, name) order. */
export function groupAgents(agents: Agent[]): Map<string, Agent[]> {
  const map = new Map<string, Agent[]>();
  for (const a of agents) {
    const list = map.get(a.group) ?? [];
    list.push(a);
    map.set(a.group, list);
  }
  return map;
}

// 5s TTL: rapid picker/palette/refresh re-opens reuse one scan; a new file
// still shows within seconds. See core/memo.ts.
export const discoverAgents = ttlMemo(discoverAgentsUncached, 5000);
