import * as vscode from 'vscode';
import { launchAios, launchSkill, launchInSession } from '../rituals/runner';
import { discoverAgents, iconForAgent } from '../agents/agents';
import { discoverCommands } from '../aios/commands';
import { discoverSkills } from '../capabilities/capabilities';

/**
 * Frequent tasks: intent-first launchers. The operator picks *what they want
 * done* (a verb) and Glass routes to the right AIOS mechanism (agent / command
 * / skill) without exposing which.
 *
 * The list is user-editable and persisted in the extension's globalState
 * (per-machine). The built-ins below seed it; the operator can add their own
 * (picking a real agent/command/skill) and remove any — including defaults.
 */
export interface FreqTask {
  id: string;
  label: string;
  kind: 'agent' | 'command' | 'skill' | 'prompt';
  /** agent/command/skill name, or (kind 'prompt') the free-form instruction itself */
  target: string;
  /** tooltip — says plainly what happens */
  hint: string;
  /** optional one-line seed prompt; omit to launch straight into the interview */
  prompt?: string;
}

export const FREQUENT_TASKS: FreqTask[] = [
  { id: 'email',       label: 'Draft an email',      kind: 'agent',   target: 'email-drafter',       hint: 'Spawn the email-drafter agent',                              prompt: "What's the email about? (who + purpose)" },
  { id: 'post',        label: 'Write a post',        kind: 'agent',   target: 'content-writer',      hint: 'Spawn the content-writer agent (LinkedIn / X / Substack)',   prompt: "What's the post about? (topic + platform)" },
  { id: 'deck',        label: 'Create a deck',       kind: 'agent',   target: 'deck-builder',        hint: 'Spawn the deck-builder agent',                               prompt: "What's the deck about?" },
  { id: 'research',    label: 'Deep research',       kind: 'agent',   target: 'market-researcher',   hint: 'Spawn the market-researcher agent for a deep dive',          prompt: 'What should I research?' },
  { id: 'meeting',     label: 'Prep a meeting',      kind: 'agent',   target: 'meeting-prepper',     hint: 'Spawn the meeting-prepper agent',                            prompt: 'Which meeting? (who + when + purpose)' },
  { id: 'clarity',     label: 'Get clarity',         kind: 'agent',   target: 'decision-journaler',  hint: 'Think a decision through with the decision-journaler',        prompt: 'What are you trying to decide or get clear on?' },
  { id: 'ingest',      label: 'Ingest something',    kind: 'command', target: 'ingest',              hint: 'Turn a URL / file / transcript into structured vault context (/aios:ingest)', prompt: 'What to ingest? (URL, file path, or topic — blank to be guided)' },
  { id: 'infographic', label: 'Make an infographic', kind: 'skill',   target: 'infographic-builder', hint: 'Turn a doc or an /ingest reflection into a shareable infographic',           prompt: 'From what? (a doc, an /ingest reflection, or a topic — blank to be guided)' },

  // ── "About me" — context-driven self-representation (reads declared / observed) ──
  {
    id: 'bio-event', label: 'Bio for an event', kind: 'prompt',
    hint: 'Draft an event bio from your AIOS context (you pick declared / observed / both)',
    prompt: "Which event + audience? (e.g. 'a conference keynote — founder audience')",
    target: "Write a speaker/attendee bio for the event + audience I name below. First ask me whether to draw on my DECLARED context, my OBSERVED context, or BOTH, then read the matching files under `vault/00 - notes/context/declared/` and/or `vault/00 - notes/context/observed/`. Tailor tone and length to that audience. Give me a short (~50 words) and a medium (~120 words) version inline, ready to copy. — Event + audience:"
  },
  {
    id: 'infographic-me', label: 'Infographic about me', kind: 'prompt',
    hint: 'A one-page visual of who you are, from your context (declared / observed / both)',
    target: "Build an infographic about me. First ask whether to use my DECLARED context, my OBSERVED context, or BOTH; read the matching files under `vault/00 - notes/context/declared/` and/or `observed/`. Then use the infographic-builder skill to produce a clean one-page visual — who I am, what I do, how I work, what I value. Save it to `vault/03 - export/infographics/`."
  },
  {
    id: 'infographic-become', label: 'Who I have become', kind: 'prompt',
    hint: 'Contrast declared vs observed — your growth story, visualized',
    target: "Build an infographic contrasting who I SAY I am (declared context) with who I've SHOWN I am (observed context) — the gap and the growth. Read both `vault/00 - notes/context/declared/` and `vault/00 - notes/context/observed/` (especially growth.md, patterns.md, profile.md). Surface the meaningful deltas — what's reinforced, what's shifted, what's emerging — and use the infographic-builder skill to render a 'declared → observed' before/after one-pager. Honest, not flattering. Save to `vault/03 - export/infographics/`."
  },
  {
    id: 'who-for-audience', label: 'Who I am, for an audience', kind: 'prompt',
    hint: 'Summarize your identity (observed context) tailored to a specific audience',
    prompt: "Which audience? (e.g. 'a new enterprise client', 'an investor', 'my team')",
    target: "Describe who I am for the audience I name below, drawing on my OBSERVED context (what Claude has actually learned about me — profile.md, patterns.md, growth.md, business.md), not just what I've declared. Read those files first. Be specific and honest, and frame it for what THIS audience cares about. Keep it tight. — Audience:"
  },
  {
    id: 'elevator-pitch', label: 'Elevator pitch about me', kind: 'prompt',
    hint: 'A punchy one-liner + short version for a given context',
    prompt: "For what context? (e.g. 'a cold intro', 'a panel', 'a pitch meeting')",
    target: "Write a tight elevator pitch about me for the context below — one punchy sentence plus an optional 2-3 sentence version. First ask whether to use my DECLARED context, OBSERVED context, or BOTH; read the matching files under `vault/00 - notes/context/`. Specific and confident, not generic. — Context:"
  },
  {
    id: 'whats-changed', label: "What's changed about me lately", kind: 'prompt',
    hint: 'Your evolution from observed context, over a period',
    prompt: "Over what period? (e.g. 'this quarter', 'the last month')",
    target: "Summarize what's genuinely changed or evolved about me over the period below, drawing on my OBSERVED context — growth.md, session-insights.md, patterns.md, profile.md (read those first). Surface the real deltas: new patterns, shifts, what got reinforced, what I started avoiding — with the evidence/dates. Honest and growth-minded. — Period:"
  },
  {
    id: 'podcast-intro', label: 'Intro for a podcast / interview', kind: 'prompt',
    hint: 'A conversational, spoken-style self-intro from your context',
    prompt: "Which show + angle? (e.g. 'a startups podcast, founder-journey angle')",
    target: "Draft a conversational, spoken-style intro of me for the show/angle below — something a host could read or I could say aloud. First ask whether to use my DECLARED, OBSERVED, or BOTH context; read the matching files. Natural and warm, not a résumé. Give a ~20-second and a ~40-second version. — Show + angle:"
  },
  {
    id: 'values', label: 'My values & non-negotiables', kind: 'prompt',
    hint: 'A reference card distilled from your context',
    target: "Distill my core values and non-negotiables into a tight reference card. Read BOTH my declared context (about_me, working_style, role-expectations) and observed context (profile, patterns, growth) under `vault/00 - notes/context/`. Separate clearly: values (what I care about) vs non-negotiables (lines I won't cross), and cite where each comes from. Keep it scannable."
  },
];

const STORE_KEY = 'aios.frequentTasks.v1';
const STORE_REMOVED = 'aios.frequentTasks.removed.v1';
let store: vscode.Memento | undefined;

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
}

/** Wire persistence — call once from activate(). */
export function initFrequentTasks(ctx: vscode.ExtensionContext): void {
  store = ctx.globalState;
}

function getTasks(): FreqTask[] {
  // The operator's list (custom + kept defaults), then APPEND any built-in
  // default that's new (not in their list) and that they haven't removed — so
  // pre-bundled tasks we ship later show up without clobbering customizations.
  const saved = store?.get<FreqTask[]>(STORE_KEY);
  const removed = new Set(store?.get<string[]>(STORE_REMOVED) || []);
  const base = saved === undefined ? [] : [...saved];
  const have = new Set(base.map((t) => t.id));
  for (const def of FREQUENT_TASKS) {
    if (!have.has(def.id) && !removed.has(def.id)) base.push(def);
  }
  return base;
}

/** How many frequent tasks are configured (kept defaults + customizations) — for the Home badge. */
export function frequentTaskCount(): number {
  return getTasks().length;
}

async function saveTasks(list: FreqTask[]): Promise<void> {
  await store?.update(STORE_KEY, list);
}

/** Record a removed default so the merge in getTasks() won't re-add it. */
async function markRemoved(id: string): Promise<void> {
  if (!FREQUENT_TASKS.some((d) => d.id === id)) return; // only defaults need this
  const removed = new Set(store?.get<string[]>(STORE_REMOVED) || []);
  removed.add(id);
  await store?.update(STORE_REMOVED, Array.from(removed));
}

/** Launch a task by id (looked up in the live, possibly-customized list). */
export async function runFrequentTask(id: string): Promise<void> {
  const t = getTasks().find((x) => x.id === id);
  if (t) return runTask(t);
}

async function runTask(t: FreqTask): Promise<void> {
  let seed: string | undefined;
  if (t.prompt) {
    seed = await vscode.window.showInputBox({
      title: t.label,
      prompt: t.prompt,
      placeHolder: 'Optional — leave blank and the agent will interview you',
      ignoreFocusOut: true,
    });
    if (seed === undefined) return; // cancelled
  }
  const s = seed?.trim() || undefined;

  // All three kinds run IN-SESSION via runInSession — honoring Terminal Control
  // (ask/active) + live-Claude detection, exactly like "Load a skill" (3
  // scenarios: active+Claude → sent in; active-no-Claude / new → launch claude).
  // Agents "wear a hat" via /aios:agent (no spawn) — the seed becomes the hat's
  // first assignment. Only "Spawn a session" always opens a new terminal.
  if (t.kind === 'command') await launchAios(t.target, s);
  else if (t.kind === 'skill') await launchSkill(t.target, s);
  else if (t.kind === 'prompt') await launchInSession(t.target + (s ? ` ${s}` : ''), { name: slug(t.label), icon: 'comment-discussion', color: 'terminal.ansiBlue' });
  else {
    const a = discoverAgents().find((x) => x.name === t.target);
    await launchAios('agent', t.target + (s ? ` — ${s}` : ''), { name: t.target, icon: iconForAgent(a ?? { name: t.target }), color: 'terminal.ansiCyan' });
  }
}

type MenuItem = vscode.QuickPickItem & { task?: FreqTask; add?: boolean };

/** Open the frequent-tasks menu: pick to run, trash-button to remove, "add" to create. */
export async function openFrequentMenu(): Promise<void> {
  const qp = vscode.window.createQuickPick<MenuItem>();
  qp.title = 'Frequent tasks';
  qp.placeholder = 'Pick a task to run — trash to remove, or add your own';
  const removeBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Remove this task' };

  const refresh = () => {
    const tasks = getTasks();
    const items: MenuItem[] = tasks.map((t) => ({ label: t.label, description: t.hint, task: t, buttons: [removeBtn] }));
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(add) Add a frequent task', add: true });
    qp.items = items;
  };
  refresh();

  qp.onDidTriggerItemButton(async (e) => {
    const t = e.item.task;
    if (!t) return;
    await saveTasks(getTasks().filter((x) => x.id !== t.id));
    await markRemoved(t.id); // a removed default stays removed (won't re-merge)
    refresh();
  });

  qp.onDidAccept(async () => {
    const sel = qp.selectedItems[0];
    if (!sel) return;
    if (sel.add) { qp.hide(); await addFrequentTask(); return; }
    if (sel.task) { qp.hide(); await runTask(sel.task); }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

/** Add a custom frequent task — pick a real agent / command / skill as its target. */
async function addFrequentTask(): Promise<void> {
  const label = await vscode.window.showInputBox({
    title: 'Add a frequent task',
    prompt: 'Button label',
    placeHolder: 'e.g. Summarize a PDF',
    ignoreFocusOut: true,
  });
  if (!label?.trim()) return;

  const kindPick = await vscode.window.showQuickPick(
    [
      { label: '$(person) Agent', mech: 'agent' as const, detail: 'Wear an AIOS agent\'s hat' },
      { label: '$(terminal) Command', mech: 'command' as const, detail: 'Run an /aios: command' },
      { label: '$(sparkle) Skill', mech: 'skill' as const, detail: 'Load a skill' },
      { label: '$(comment) None — just a prompt', mech: 'prompt' as const, detail: 'A free-form instruction sent to Claude' },
    ],
    { title: 'Add a frequent task — what runs it?', placeHolder: 'Pick a mechanism' }
  );
  if (!kindPick) return;
  const kind = kindPick.mech;

  // "None" → skip the target picker; write the instruction directly.
  if (kind === 'prompt') {
    const instr = await vscode.window.showInputBox({
      title: label.trim(),
      prompt: 'What should Claude do when you click this?',
      placeHolder: "e.g. Summarize today's Slack and list my action items",
      ignoreFocusOut: true,
    });
    if (!instr?.trim()) return;
    const list = getTasks();
    list.push({ id: `u-${slug(label)}-${list.length}`, label: label.trim(), kind: 'prompt', target: instr.trim(), hint: instr.trim().slice(0, 70) });
    await saveTasks(list);
    await openFrequentMenu();
    return;
  }

  let target: string | undefined;
  if (kind === 'agent') {
    target = (await vscode.window.showQuickPick(
      discoverAgents().map((a) => ({ label: a.name, description: a.group, detail: a.description })),
      { title: 'Which agent?', placeHolder: 'Pick an agent', matchOnDetail: true }
    ))?.label;
  } else if (kind === 'command') {
    target = (await vscode.window.showQuickPick(
      discoverCommands().map((c) => ({ label: c.name, description: c.description })),
      { title: 'Which command?', placeHolder: 'Pick a command', matchOnDescription: true }
    ))?.label;
  } else {
    target = (await vscode.window.showQuickPick(
      discoverSkills().map((s) => ({ label: s.name, description: s.description })),
      { title: 'Which skill?', placeHolder: 'Pick a skill', matchOnDescription: true }
    ))?.label;
  }
  if (!target) return;

  const prompt = await vscode.window.showInputBox({
    title: 'Add a frequent task',
    prompt: 'Optional question to ask each time it runs (blank = none)',
    placeHolder: "e.g. What's it about?",
    ignoreFocusOut: true,
  });
  if (prompt === undefined) return; // cancelled

  const list = getTasks();
  const id = `u-${slug(label)}-${list.length}`;
  list.push({ id, label: label.trim(), kind, target, hint: `${kind}: ${target}`, prompt: prompt.trim() || undefined });
  await saveTasks(list);

  await openFrequentMenu(); // reopen so the new task is visible
}
