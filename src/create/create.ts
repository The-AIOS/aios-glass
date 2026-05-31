import * as vscode from 'vscode';
import { launchSpawn } from '../rituals/runner';

export type CreateKind = 'agent' | 'skill' | 'plugin' | 'template' | 'hook' | 'mcp';

interface KindSpec {
  label: string;
  path: string;
  guidance: string;
}

const SPECS: Record<CreateKind, KindSpec> = {
  agent: {
    label: 'Agent',
    path: 'agents/custom/{name}.md',
    guidance: 'Use the agent template and agents/_index.md conventions (frontmatter with name, description, and tags that include "agent"); update agents/custom/_index.md.'
  },
  skill: {
    label: 'Skill',
    path: 'skills/custom/{name}/SKILL.md',
    guidance: 'Use the skill-creator / writing-skills skill and the skills/ conventions; update skills/custom/_index.md if present.'
  },
  plugin: {
    label: 'Plugin',
    path: 'plugins/custom/{name}/',
    guidance: 'Follow CLAUDE.md plugin conventions: .claude-plugin/plugin.json + a starter command; register in .claude-plugin/marketplace.json.'
  },
  template: {
    label: 'Template',
    path: 'templates/custom/{name}',
    guidance: 'Follow the templates/ conventions; add it to templates/_index.md.'
  },
  hook: {
    label: 'Hook',
    path: 'hooks/custom/{name}',
    guidance: 'Follow the hooks/ conventions; place it in hooks/custom/ and wire it via settings.json. (Hooks are not standard custom/ skill-style elements — scaffold per the hook pipeline.)'
  },
  mcp: {
    label: 'MCP server',
    path: 'mcps/custom/{name}-mcp/',
    guidance: 'Follow mcps/_index.md → "Adding a new MCP": vendor under mcps/custom/{name}-mcp/ with its own README + auth instructions, add an install block to mcps/setup.sh, and register via `claude mcp add`. (MCPs are not standard custom/ skill-style elements.)'
  }
};

export const CREATE_KINDS: CreateKind[] = ['agent', 'skill', 'plugin', 'template', 'hook', 'mcp'];

/**
 * Spawn the `aios-builder` agent for a new custom element. The agent owns the
 * whole flow — interview (brainstorming when fuzzy), read the convention for
 * the kind, scaffold under the matching custom/ location, and REGISTER it
 * (e.g. runs skills/setup.sh for new skills) so it actually loads. We just
 * hand it the kind + the operator's seed idea; we don't reimplement the
 * builder prompt here (glass, not engine).
 */
export async function createCustom(kind: CreateKind): Promise<void> {
  const spec = SPECS[kind];
  const seed = await vscode.window.showInputBox({
    title: `New custom ${spec.label.toLowerCase()}`,
    prompt: 'What do you want to build? (optional — the builder will interview you)',
    placeHolder: `e.g. a ${spec.label.toLowerCase()} that …`,
    ignoreFocusOut: true
  });
  if (seed === undefined) return; // cancelled

  const task = `Create a new custom ${kind}${seed.trim() ? `: ${seed.trim()}` : ''}.`;
  await launchSpawn('aios-builder', task);
}
