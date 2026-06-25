import * as vscode from 'vscode';
import { launchInSession } from '../rituals/runner';
import { listFrequentTasks, slug, FreqTask } from './frequent';
import { stateGet, stateSet } from '../state';
import { stepText } from '../core/taskModel';
import { t } from '../i18n';

/**
 * Routines: named, ORDERED bundles of frequent tasks — "Thinkers Symposium →
 * [symposium + reflection, ingest, infographic]". A routine is bundled tasks in
 * ONE click, nothing more: no cadence, no triggers, no due-state. (True
 * scheduling — "fire this Wednesdays 9am" — is future work via the /schedule
 * engine; a glass layer shouldn't fake it with soft reminders.)
 *
 * Execution is COMBINED: running a routine assembles its tasks' fixed
 * assignments into ONE ordered instruction and fires it into a single fresh
 * session. That's why routine tasks must be self-contained — which the
 * one-click task model already guarantees (baked assignment or self-eliciting
 * prompt, no run-time questions).
 */
export interface Routine { id: string; label: string; taskIds: string[]; }

const STORE_KEY = 'aios.routines.v1';

export function listRoutines(): Routine[] {
  // Saved objects may carry legacy fields (cadence/hour from the brief
  // soft-schedule era) — extra keys are simply ignored.
  return stateGet<Routine[]>(STORE_KEY) ?? [];
}

async function saveRoutines(list: Routine[]): Promise<void> {
  await stateSet(STORE_KEY, list);
}

export async function removeRoutine(id: string): Promise<void> {
  await saveRoutines(listRoutines().filter((r) => r.id !== id));
}


/** Run a routine: assemble its tasks into one ordered instruction, fire one session. */
export async function runRoutine(id: string): Promise<void> {
  const r = listRoutines().find((x) => x.id === id);
  if (!r) return;
  const all = listFrequentTasks();
  const tasks = r.taskIds.map((tid) => all.find((t) => t.id === tid)).filter(Boolean) as FreqTask[];
  if (!tasks.length) {
    void vscode.window.showWarningMessage(`AIOS Glass: ${t('routine')} "${r.label}" ${t('has no surviving tasks — its tasks were removed. Re-create it.')}`);
    return;
  }
  const steps = tasks.map((t, i) => stepText(t, i + 1)).join('\n');
  const instruction =
    `This is my "${r.label}" routine. Complete these steps IN ORDER, finishing each before starting the next:\n` +
    `${steps}\n` +
    `When all steps are done, give me a one-line summary of each step's outcome.`;
  await launchInSession(instruction, { name: 'routine-' + slug(r.label), icon: 'calendar', color: 'terminal.ansiMagenta' });
}

/** Create-a-routine flow: label → tasks picked ONE AT A TIME (order matters). */
export async function addRoutineFlow(): Promise<boolean> {
  const label = await vscode.window.showInputBox({
    title: t('Add a routine'),
    prompt: t('Routine name — a bundle of tasks that runs in one click'),
    placeHolder: t('e.g. Monday Kickoff — plan the day, prep the meetings, draft the posts'),
    ignoreFocusOut: true,
  });
  if (!label?.trim()) return false;

  // Tasks, one at a time — preserves the run order (multi-select wouldn't).
  const taskIds: string[] = [];
  for (;;) {
    const remaining = listFrequentTasks().filter((t) => !taskIds.includes(t.id));
    type Item = vscode.QuickPickItem & { taskId?: string; done?: boolean };
    const items: Item[] = [];
    if (taskIds.length) items.push({ label: `$(check) ${t('Done — save with')} ${taskIds.length} ${taskIds.length > 1 ? t('tasks') : t('task')}`, done: true });
    items.push(...remaining.map((ft) => ({ label: ft.label, description: ft.hint, taskId: ft.id })));
    const pick = await vscode.window.showQuickPick<Item>(items, {
      title: `${label.trim()} — ${t('step')} ${taskIds.length + 1}`,
      placeHolder: taskIds.length ? t('Add the next task in order, or Done') : t('Pick the first task it runs'),
    });
    if (!pick) return false; // Esc anywhere = cancel the whole flow, nothing saved
    if (pick.done) break;
    if (pick.taskId) taskIds.push(pick.taskId);
    if (!remaining.length) break;
  }
  if (!taskIds.length) return false;

  const list = listRoutines();
  list.push({ id: `u-${slug(label)}-${list.length}`, label: label.trim(), taskIds });
  await saveRoutines(list);
  return true;
}
