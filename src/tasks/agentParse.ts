/**
 * Pure parsing for the daily note's "Agents can handle" section — no vscode/fs,
 * so it's unit-testable in plain node. goWithAgents.ts wraps these with the
 * filesystem + spawn side-effects.
 */

export interface Suggestion { task: string; agents: string[]; command?: string; arg?: string; raw: string; }

/**
 * Reduce a task line to its core identity for cross-section matching — the same
 * "ignore emojis / time-slots / tags / markdown" rule the ledger uses to mark
 * tasks done. Lets us recognise a suggestion as done even when the done-mark
 * landed on its canonical copy elsewhere in the note, not on the suggestion line.
 */
export function taskIdentity(s: string): string {
  return s
    .replace(/^\s*[-*]\s*/, '')                                   // list marker
    .replace(/\[[ xX]\]/g, '')                                    // checkbox
    .replace(/~~/g, '')                                           // strike markers
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a) // wikilink → its text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                      // md link → its text
    .replace(/[`*_#>]/g, '')                                      // emphasis / tag / quote / code
    .replace(/\b\d{1,2}:\d{2}\b/g, '')                            // 09:00 time-slots
    .replace(/\b\d{1,2}\s?(?:am|pm)\b/gi, '')                     // 9am / 9 pm
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '') // emoji/symbol/arrows
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Identities of every task the note marks DONE *anywhere* — `[x]` checkboxes or
 * ~~struck~~ titles. A suggestion whose canonical task is finished in another
 * section then drops out of the count even if its own mirror line was never
 * struck (the common over-count cause).
 */
export function doneIdentities(md: string): string[] {
  const out: string[] = [];
  for (const line of md.split(/\r?\n/)) {
    if (!(/^\s*[-*]\s*\[[xX]\]/.test(line) || /~~[^~]+~~/.test(line))) continue;
    const id = taskIdentity(line);
    if (id.length >= 4) out.push(id);
  }
  return out;
}

/**
 * Extract the "Agents can handle" section's suggestions. A line is a suggestion
 * when it routes a task to EITHER one or more `[[agent]]` links (→ spawn that
 * agent) OR a backticked `/command` (e.g. `` `/aios:ingest` `` — the most common
 * case). The bolded span is the task label; for command-routed lines we also
 * grab a best-effort argument (the first URL — markdown-link target or bare
 * https), so `/aios:ingest https://youtu.be/…` dispatches with its source
 * already filled in.
 *
 * Why both shapes: `/today` is LLM-generated and legitimately writes either form
 * (`→ agent: [[name]]` vs `→ \`/aios:command\``), so the deterministic reader
 * must tolerate both — otherwise command-routed tasks (ingests) are silently
 * invisible to the Home badge and to "Go with agents".
 *
 * A suggestion drops out when it's done — either marked inline (checkbox /
 * ~~strike~~ / 🚀 in-flight) OR its canonical task is checked/struck elsewhere in
 * the note (identity-matched), since the done-mark rarely lands on the mirror.
 */
export function parseAgentSection(md: string): Suggestion[] {
  const lines = md.split(/\r?\n/);
  const done = doneIdentities(md); // cross-section done-set (built once)
  const out: Suggestion[] = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+.*Agents can handle/i.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection) continue;
    // A routed task is ALWAYS a list item. This is the load-bearing guard: it
    // excludes the section's prose — the count header (`**1 task an agent…**`)
    // and the footer (`Say "go with agents"… or `/ghost`…`) — which would
    // otherwise be mis-read as a command-routed task purely because they mention
    // a backticked `/command` in passing (the over-count bug).
    if (!/^\s*[-*]\s/.test(line)) continue;
    if (/^\s*[-*]\s*\[[xX]\]/.test(line)) continue; // done: checkbox form
    if (/^\s*[-*]\s*(?:\u{1F916}\s*)*~~/u.test(line)) continue; // done: the ledger's strike-the-title form
    if (line.includes('\u{1F680}')) continue; // already spawned from Glass (in flight)
    const agents = [...line.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim());
    const cmd = line.match(/`(\/[a-z][\w:-]*)`/i); // backticked `/aios:ingest` etc.
    if (!agents.length && !cmd) continue; // not a routed task (e.g. the section's count header)
    const bold = line.match(/\*\*(.+?)\*\*/);
    const task = (bold ? bold[1] : line.replace(/[-*🤖_]/g, '')).trim();
    // Done elsewhere? If the canonical task is checked/struck in another section,
    // skip this suggestion — the done-mark rarely lands on the mirror line itself.
    const sId = taskIdentity(task);
    if (sId.length >= 6 && done.some((d) => d === sId || d.includes(sId))) continue;
    const sug: Suggestion = { task, agents, raw: line.trim() };
    if (!agents.length && cmd) {
      sug.command = cmd[1];
      const mdLink = line.match(/\]\((https?:\/\/[^)]+)\)/); // [label](url) — already delimited
      sug.arg = mdLink ? mdLink[1] : line.match(/https?:\/\/\S+/)?.[0]?.replace(/[)*_.,]+$/, '');
    }
    out.push(sug);
  }
  return out;
}
