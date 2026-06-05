import * as vscode from 'vscode';
import { launchInSession } from '../rituals/runner';
import { listFrequentTasks, slug, FreqTask } from './frequent';

/**
 * Routines: named, soft-scheduled bundles of frequent tasks — e.g. "Thinkers
 * Symposium — Wednesdays 9am → [symposium + reflection, ingest, infographic]".
 *
 * Scheduling is GLASS-PURE (soft): a routine becomes DUE when its cadence window
 * opens and it hasn't run inside that window; Glass surfaces due routines in the
 * Quick menu while the editor is open. There is no background daemon — nothing
 * fires with the editor closed (a real /schedule cron hookup is future work).
 *
 * Execution is COMBINED: running a routine assembles its tasks' fixed assignments
 * into ONE ordered instruction and fires it into a single fresh session. That's
 * why routine tasks must be self-contained — which the one-click task model
 * already guarantees (baked assignment or self-eliciting prompt, no run-time
 * questions a scheduled run couldn't answer).
 */
export interface Cadence {
  kind: 'daily' | 'weekly' | 'monthly';
  /** 0 (Sun) – 6 (Sat); weekly only. */
  weekday?: number;
  /** Soft "due from" hour, 0–23. Absent = due from the window's start. */
  hour?: number;
}
export interface Routine { id: string; label: string; cadence: Cadence; taskIds: string[]; }

const STORE_KEY = 'aios.routines.v1';
const LASTRUN_KEY = 'aios.routines.lastRun.v1';
let store: vscode.Memento | undefined;

/** Wire persistence — call once from activate(). */
export function initRoutines(ctx: vscode.ExtensionContext): void {
  store = ctx.globalState;
}

export function listRoutines(): Routine[] {
  return store?.get<Routine[]>(STORE_KEY) ?? [];
}

async function saveRoutines(list: Routine[]): Promise<void> {
  await store?.update(STORE_KEY, list);
}

function lastRuns(): Record<string, number> {
  return store?.get<Record<string, number>>(LASTRUN_KEY) ?? {};
}

async function stampRun(id: string): Promise<void> {
  const m = { ...lastRuns(), [id]: Date.now() };
  await store?.update(LASTRUN_KEY, m);
}

export async function removeRoutine(id: string): Promise<void> {
  await saveRoutines(listRoutines().filter((r) => r.id !== id));
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Start of the routine's CURRENT cadence window (epoch ms, local time). */
function windowStart(c: Cadence, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (c.kind === 'daily') return today.getTime();
  if (c.kind === 'weekly') {
    const back = (today.getDay() - (c.weekday ?? 1) + 7) % 7; // days since the most recent cadence weekday
    return today.getTime() - back * 86400000;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime(); // monthly
}

/**
 * Due = the window has opened (past the soft hour) and the routine hasn't run
 * inside it. Soft schedule: once due it STAYS due until run — a missed Wednesday
 * still surfaces on Thursday instead of silently skipping the week.
 */
export function routineDue(r: Routine, now = new Date()): boolean {
  const ws = windowStart(r.cadence, now);
  const dueAt = ws + (r.cadence.hour ?? 0) * 3600000;
  return now.getTime() >= dueAt && (lastRuns()[r.id] ?? 0) < ws;
}

/** Human cadence label — 'daily 9am' / 'Wed 9am' / 'monthly'. */
export function cadenceLabel(c: Cadence): string {
  const hh = c.hour === undefined ? '' : ' ' + ((c.hour % 12) || 12) + (c.hour < 12 ? 'am' : 'pm');
  if (c.kind === 'daily') return 'daily' + hh;
  if (c.kind === 'weekly') return DAY_NAMES[c.weekday ?? 1] + hh;
  return 'monthly' + hh;
}

/** One ordered step of the combined instruction, phrased per task mechanism. */
function stepText(t: FreqTask, n: number): string {
  const a = (t.assignment ?? (t as { prompt?: string }).prompt)?.trim() || '';
  if (t.kind === 'agent') return `${n}. Wear the ${t.target} agent hat (load it via /aios:agent ${t.target}) and ${a || 'complete its core task for today'}.`;
  if (t.kind === 'command') return `${n}. Run /aios:${t.target}${a ? ` with: ${a}` : ''}.`;
  if (t.kind === 'skill') return `${n}. Use the ${t.target} skill${a ? `: ${a}` : ''}.`;
  return `${n}. ${t.target}`; // prompt-kind carries its full instruction in target
}

/** Run a routine: assemble its tasks into one ordered instruction, fire one session. */
export async function runRoutine(id: string): Promise<void> {
  const r = listRoutines().find((x) => x.id === id);
  if (!r) return;
  const all = listFrequentTasks();
  const tasks = r.taskIds.map((tid) => all.find((t) => t.id === tid)).filter(Boolean) as FreqTask[];
  if (!tasks.length) {
    void vscode.window.showWarningMessage(`AIOS Glass: routine "${r.label}" has no surviving tasks — its tasks were removed. Re-create it.`);
    return;
  }
  const steps = tasks.map((t, i) => stepText(t, i + 1)).join('\n');
  const instruction =
    `This is my "${r.label}" routine. Complete these steps IN ORDER, finishing each before starting the next:\n` +
    `${steps}\n` +
    `When all steps are done, give me a one-line summary of each step's outcome.`;
  await launchInSession(instruction, { name: 'routine-' + slug(r.label), icon: 'calendar', color: 'terminal.ansiMagenta' });
  await stampRun(r.id);
}

/** Create-a-routine flow: label → cadence → tasks picked ONE AT A TIME (order matters). */
export async function addRoutineFlow(): Promise<boolean> {
  const label = await vscode.window.showInputBox({
    title: 'Add a routine',
    prompt: 'Routine name',
    placeHolder: 'e.g. Thinkers Symposium',
    ignoreFocusOut: true,
  });
  if (!label?.trim()) return false;

  // `ck` (not `kind`) — QuickPickItem.kind is reserved for separators.
  const kindPick = await vscode.window.showQuickPick(
    [
      { label: '$(calendar) Weekly', ck: 'weekly' as const, description: 'on a specific weekday' },
      { label: '$(sun) Daily', ck: 'daily' as const, description: 'every day' },
      { label: '$(circle-large-outline) Monthly', ck: 'monthly' as const, description: 'once a month' },
    ],
    { title: `${label.trim()} — how often?`, placeHolder: 'Pick a cadence' }
  );
  if (!kindPick) return false;
  const cadence: Cadence = { kind: kindPick.ck };

  if (cadence.kind === 'weekly') {
    const order = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
    const day = await vscode.window.showQuickPick(
      order.map((i) => ({ label: DAY_NAMES[i], i })),
      { title: `${label.trim()} — which day?`, placeHolder: 'Pick a weekday' }
    );
    if (!day) return false;
    cadence.weekday = day.i;
  }

  const hourStr = await vscode.window.showInputBox({
    title: `${label.trim()} — due from what hour? (optional)`,
    prompt: '0–23 · blank = due from the start of the day',
    placeHolder: 'e.g. 9',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() || (/^\d{1,2}$/.test(v.trim()) && Number(v.trim()) <= 23)) ? undefined : 'Enter an hour 0–23, or leave blank',
  });
  if (hourStr === undefined) return false; // cancelled
  if (hourStr.trim()) cadence.hour = Number(hourStr.trim());

  // Tasks, one at a time — preserves the run order (multi-select wouldn't).
  const taskIds: string[] = [];
  for (;;) {
    const remaining = listFrequentTasks().filter((t) => !taskIds.includes(t.id));
    type Item = vscode.QuickPickItem & { taskId?: string; done?: boolean };
    const items: Item[] = [];
    if (taskIds.length) items.push({ label: `$(check) Done — save with ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`, done: true });
    items.push(...remaining.map((t) => ({ label: t.label, description: t.hint, taskId: t.id })));
    const pick = await vscode.window.showQuickPick<Item>(items, {
      title: `${label.trim()} — step ${taskIds.length + 1}`,
      placeHolder: taskIds.length ? 'Add the next task in order, or Done' : 'Pick the first task it runs',
    });
    if (!pick) return false; // Esc anywhere = cancel the whole flow, nothing saved
    if (pick.done) break;
    if (pick.taskId) taskIds.push(pick.taskId);
    if (!remaining.length) break;
  }
  if (!taskIds.length) return false;

  const list = listRoutines();
  list.push({ id: `u-${slug(label)}-${list.length}`, label: label.trim(), cadence, taskIds });
  await saveRoutines(list);
  return true;
}
