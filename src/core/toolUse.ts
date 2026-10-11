/**
 * AI-171 step 1 — "used: deep-research". Which skills and agents a session actually used, read from
 * its transcript, so the session row can show it: the cheapest way to teach an operator that the
 * skills and agents exist is to show them working on their own request. Shared core (both surfaces).
 *
 * Measured record shapes (Claude Code transcripts): an assistant record whose message.content holds
 * {type:"tool_use", name:"Skill", input:{skill:"deep-research", …}} or
 * {type:"tool_use", name:"Agent", input:{subagent_type:"Explore", …}}. Pure: the caller feeds text.
 */
export interface ToolUsage { skills: string[]; agents: string[] }

/** Generic workers say nothing about a capability the operator could learn to ask for. */
const GENERIC_AGENTS = new Set(['general-purpose', 'claude', 'fork']);

export function usageIn(jsonl: string, into: ToolUsage = { skills: [], agents: [] }): ToolUsage {
  for (const line of String(jsonl ?? '').split('\n')) {
    if (!line.includes('"tool_use"') || !(line.includes('"name":"Skill"') || line.includes('"name":"Agent"'))) continue;
    let rec: { message?: { content?: unknown } };
    try { rec = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(rec.message?.content) ? rec.message!.content as Record<string, unknown>[] : [];
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      const input = (c.input ?? {}) as Record<string, unknown>;
      if (c.name === 'Skill' && typeof input.skill === 'string' && input.skill.trim()) push(into.skills, input.skill.trim());
      if (c.name === 'Agent' && typeof input.subagent_type === 'string' && !GENERIC_AGENTS.has(input.subagent_type)) push(into.agents, input.subagent_type);
    }
  }
  return into;
}

/** Most recent last, no repeats — the row shows the newest. */
function push(list: string[], v: string): void {
  const i = list.indexOf(v);
  if (i !== -1) list.splice(i, 1);
  list.push(v);
}

/** The chip's text: the newest one, plus "+N" when there were more. '' when nothing was used. */
export function usageChip(u: ToolUsage): string {
  const all = [...u.skills, ...u.agents];
  if (!all.length) return '';
  const newest = u.skills.length ? u.skills[u.skills.length - 1] : u.agents[u.agents.length - 1];
  return all.length > 1 ? `${newest} +${all.length - 1}` : newest;
}
