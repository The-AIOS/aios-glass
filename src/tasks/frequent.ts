import * as vscode from 'vscode';
import { launchAios, launchSkill, launchInSession, askAios } from '../rituals/runner';
import { discoverAgents, iconForAgent } from '../agents/agents';
import { discoverCommands } from '../aios/commands';
import { discoverSkills } from '../capabilities/capabilities';
import { Routine, listRoutines, runRoutine, removeRoutine, addRoutineFlow } from './routines';

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
  /**
   * Optional fixed task SENT on every run (agent / command / skill). One click
   * shoots — there is no run-time question. Blank → launch bare: the agent
   * self-interviews, the command/skill guides. (kind 'prompt' carries its
   * instruction in `target`, so it ignores this.)
   */
  assignment?: string;
}

export const FREQUENT_TASKS: FreqTask[] = [
  { id: 'email',       label: 'Draft an email',      kind: 'agent',   target: 'email-drafter',       hint: 'Wear the email-drafter agent — it interviews you for who + purpose' },
  { id: 'post',        label: 'Write a post',        kind: 'agent',   target: 'content-writer',      hint: 'Wear the content-writer agent (LinkedIn / X / Substack)' },
  { id: 'deck',        label: 'Create a deck',       kind: 'agent',   target: 'deck-builder',        hint: 'Wear the deck-builder agent' },
  { id: 'research',    label: 'Deep research',       kind: 'agent',   target: 'market-researcher',   hint: 'Wear the market-researcher agent for a deep dive' },
  { id: 'meeting',     label: 'Prep a meeting',      kind: 'agent',   target: 'meeting-prepper',     hint: 'Wear the meeting-prepper agent' },
  { id: 'clarity',     label: 'Get clarity',         kind: 'agent',   target: 'decision-journaler',  hint: 'Think a decision through with the decision-journaler' },
  { id: 'ingest',      label: 'Ingest something',    kind: 'command', target: 'ingest',              hint: 'Turn a URL / file / transcript into structured vault context (/aios:ingest)' },
  { id: 'infographic', label: 'Make an infographic', kind: 'skill',   target: 'infographic-builder', hint: 'Turn a doc or an /ingest reflection into a shareable infographic' },

  // ── "About me" — context-driven self-representation (reads declared / observed) ──
  // These are kind 'prompt': the instruction lives in `target` and self-elicits any
  // per-run specifics ("first ask me …"), so one click fires straight into them.
  {
    id: 'bio-event', label: 'Bio for an event', kind: 'prompt',
    hint: 'Draft an event bio from your AIOS context (you pick declared / observed / both)',
    target: "Write a speaker/attendee bio from my AIOS context. First ask me TWO things: (1) the event + audience, and (2) whether to draw on my DECLARED context, my OBSERVED context, or BOTH — then read the matching files under `vault/00 - notes/context/declared/` and/or `vault/00 - notes/context/observed/`. Tailor tone and length to that audience. Give me a short (~50 words) and a medium (~120 words) version inline, ready to copy."
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
    target: "Describe who I am for a specific audience, drawing on my OBSERVED context (what Claude has actually learned about me — profile.md, patterns.md, growth.md, business.md), not just what I've declared. First ask me which audience (e.g. a new enterprise client, an investor, my team), then read those files. Be specific and honest, framed for what THIS audience cares about. Keep it tight."
  },
  {
    id: 'elevator-pitch', label: 'Elevator pitch about me', kind: 'prompt',
    hint: 'A punchy one-liner + short version for a given context',
    target: "Write a tight elevator pitch about me — one punchy sentence plus an optional 2-3 sentence version. First ask me TWO things: (1) the context (e.g. a cold intro, a panel, a pitch meeting), and (2) whether to use my DECLARED context, OBSERVED context, or BOTH — then read the matching files under `vault/00 - notes/context/`. Specific and confident, not generic."
  },
  {
    id: 'whats-changed', label: "What's changed about me lately", kind: 'prompt',
    hint: 'Your evolution from observed context, over a period',
    target: "Summarize what's genuinely changed or evolved about me over a period, drawing on my OBSERVED context — growth.md, session-insights.md, patterns.md, profile.md. First ask me which period (e.g. this quarter, the last month), then read those files. Surface the real deltas: new patterns, shifts, what got reinforced, what I started avoiding — with the evidence/dates. Honest and growth-minded."
  },
  {
    id: 'podcast-intro', label: 'Intro for a podcast / interview', kind: 'prompt',
    hint: 'A conversational, spoken-style self-intro from your context',
    target: "Draft a conversational, spoken-style intro of me for a show — something a host could read or I could say aloud. First ask me TWO things: (1) the show + angle (e.g. a startups podcast, founder-journey angle), and (2) whether to use my DECLARED, OBSERVED, or BOTH context — then read the matching files. Natural and warm, not a résumé. Give a ~20-second and a ~40-second version."
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

export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
}

/** Wire persistence — call once from activate(). */
export function initFrequentTasks(ctx: vscode.ExtensionContext): void {
  store = ctx.globalState;
}

/**
 * Migrate legacy tasks. The old run-time question lived in `prompt`; the model is
 * now a fixed `assignment` that's SENT. For a USER-authored agent/command/skill
 * task, the text they typed into that "question" field was really the task they
 * wanted to fire — so promote it to `assignment` (this silently fixes tasks made
 * under the old flow). Defaults and prompt-kind tasks just drop the stale question.
 */
function migrateTask(t: FreqTask & { prompt?: string }): FreqTask {
  const { prompt, ...rest } = t;
  if (rest.assignment === undefined && prompt && rest.kind !== 'prompt' && String(rest.id).startsWith('u-')) {
    rest.assignment = prompt;
  }
  return rest;
}

function getTasks(): FreqTask[] {
  // The operator's list (custom + kept defaults), then APPEND any built-in
  // default that's new (not in their list) and that they haven't removed — so
  // pre-bundled tasks we ship later show up without clobbering customizations.
  const saved = store?.get<FreqTask[]>(STORE_KEY);
  const removed = new Set(store?.get<string[]>(STORE_REMOVED) || []);
  const base = saved === undefined ? [] : saved.map(migrateTask);
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

/** The live task list (custom + kept defaults) — consumed by routines + the palette. */
export function listFrequentTasks(): FreqTask[] {
  return getTasks();
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
  // One click shoots — no run-time question. The optional `assignment` (a fixed
  // task) is SENT; blank → launch bare (the agent self-interviews, the
  // command/skill guides). Legacy tasks kept the text in `prompt`; honor it as the
  // assignment so older agent/command/skill tasks fire what was typed.
  const a = (t.assignment ?? (t as { prompt?: string }).prompt)?.trim() || undefined;

  // All kinds run IN-SESSION via runInSession — honoring Terminal Control
  // (ask/active) + live-Claude detection, like "Load a skill". Agents "wear a hat"
  // via /aios:agent (no spawn) — the assignment becomes the hat's first task.
  if (t.kind === 'command') await launchAios(t.target, a);
  else if (t.kind === 'skill') await launchSkill(t.target, a);
  else if (t.kind === 'prompt') await launchInSession(t.target, { name: slug(t.label), icon: 'comment-discussion', color: 'terminal.ansiBlue' });
  else {
    const ag = discoverAgents().find((x) => x.name === t.target);
    await launchAios('agent', t.target + (a ? ` — ${a}` : ''), { name: t.target, icon: iconForAgent(ag ?? { name: t.target }), color: 'terminal.ansiCyan' });
  }
}

type MenuItem = vscode.QuickPickItem & { task?: FreqTask; routine?: Routine; add?: boolean; addRoutine?: boolean; createNew?: string; ask?: string };

/** Open the Quick menu: routines (due-first) + tasks — pick to run, trash to remove, add either. */
export async function openFrequentMenu(): Promise<void> {
  const qp = vscode.window.createQuickPick<MenuItem>();
  qp.title = 'Frequent tasks & routines';
  qp.placeholder = 'Pick to run — trash to remove, or add your own';
  const removeBtn: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Remove' };

  const refresh = () => {
    const items: MenuItem[] = [];
    // Routines first — bundled tasks, one click runs the whole sequence.
    const routines = listRoutines();
    if (routines.length) {
      items.push({ label: 'Routines', kind: vscode.QuickPickItemKind.Separator });
      for (const r of routines) {
        const n = r.taskIds.length;
        items.push({
          label: '$(run-all) ' + r.label,
          description: `${n} task${n === 1 ? '' : 's'} in one click`,
          routine: r,
          buttons: [removeBtn],
        });
      }
      items.push({ label: 'Tasks', kind: vscode.QuickPickItemKind.Separator });
    }
    items.push(...getTasks().map((t) => ({ label: t.label, description: t.hint, task: t, buttons: [removeBtn] })));
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(add) Add a frequent task', add: true });
    items.push({ label: '$(add) Add a routine', addRoutine: true });
    // Type-to-act: whatever's typed becomes one-Enter actions. alwaysShow keeps
    // them visible even when the filter matches nothing — an unmatched search
    // turns into "create it" or "ask AIOS" instead of a dead end.
    const typed = qp.value.trim();
    if (typed) {
      items.push({ label: `$(add) Create task "${typed}"`, alwaysShow: true, createNew: typed });
      items.push({ label: `$(sparkle) Ask AIOS: "${typed}"`, description: 'matches it across your agents, commands, skills & tasks — runs the best one', alwaysShow: true, ask: typed });
    }
    qp.items = items;
  };
  refresh();
  qp.onDidChangeValue(() => refresh());

  qp.onDidTriggerItemButton(async (e) => {
    if (e.item.routine) {
      await removeRoutine(e.item.routine.id);
      refresh();
      return;
    }
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
    if (sel.createNew) { qp.hide(); await addFrequentTask(sel.createNew); return; }
    if (sel.ask) { qp.hide(); askAios(sel.ask); return; }
    if (sel.addRoutine) { qp.hide(); await addRoutineFlow(); await openFrequentMenu(); return; }
    if (sel.routine) { qp.hide(); await runRoutine(sel.routine.id); return; }
    if (sel.task) { qp.hide(); await runTask(sel.task); }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

/** Add a custom frequent task — pick a real agent / command / skill as its target.
 *  `prefill` seeds the label (type-to-create from the Quick menu) — still editable. */
async function addFrequentTask(prefill?: string): Promise<void> {
  const label = await vscode.window.showInputBox({
    title: 'Add a frequent task',
    prompt: 'Button label',
    placeHolder: 'e.g. Summarize a PDF',
    value: prefill,
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

  const assignment = await vscode.window.showInputBox({
    title: label.trim(),
    prompt: 'Optional — a fixed task to send every run (blank = one click launches it bare)',
    placeHolder: "e.g. Review the open PRs and recommend take / adapt / decline",
    ignoreFocusOut: true,
  });
  if (assignment === undefined) return; // cancelled
  const asg = assignment.trim() || undefined;

  const list = getTasks();
  const id = `u-${slug(label)}-${list.length}`;
  const hint = asg ? `${kind}: ${target} · ${asg.slice(0, 44)}${asg.length > 44 ? '…' : ''}` : `${kind}: ${target}`;
  list.push({ id, label: label.trim(), kind, target, hint, assignment: asg });
  await saveTasks(list);

  await openFrequentMenu(); // reopen so the new task is visible
}
