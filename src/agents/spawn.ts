import * as vscode from 'vscode';
import { Agent, discoverAgents, iconForAgent } from './agents';
import { launchSpawn, launchAios, revealAgentTerminal } from '../rituals/runner';
import { listRunningAgents } from './running';

/**
 * "Launch an agent": pick an agent (unless preselected) → optional task → wear
 * its hat IN-SESSION via /aios:agent, honoring Terminal Control like "Load a
 * skill" (active+Claude → sent in; active-no-Claude / new → launch claude).
 * No spawn — that's what "Spawn a session" is for.
 */
export async function spawnAgentFlow(preselected?: Agent): Promise<void> {
  let agent = preselected;

  if (!agent) {
    const agents = discoverAgents();
    if (agents.length === 0) {
      void vscode.window.showWarningMessage('AIOS Glass: no agents found under agents/.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      agents.map((a) => ({
        label: a.name,
        description: a.group,
        detail: a.description,
        agent: a
      })),
      { title: 'Launch an agent (wear its hat)', placeHolder: 'Pick an agent', matchOnDescription: true, matchOnDetail: true }
    );
    if (!pick) return;
    agent = pick.agent;
  }

  const task = await vscode.window.showInputBox({
    title: `Wear the ${agent.name} hat`,
    prompt: 'Task (optional — becomes the hat\'s first assignment)',
    placeHolder: agent.description || 'e.g. Review the Q1 financials',
    ignoreFocusOut: true
  });
  if (task === undefined) return; // cancelled

  await launchAios('agent', agent.name + (task.trim() ? ` — ${task.trim()}` : ''), { name: agent.name, icon: iconForAgent(agent), color: 'terminal.ansiCyan' });
}

const ADJ = ['amber', 'brisk', 'calm', 'dapper', 'eager', 'fleet', 'golden', 'hidden', 'jolly', 'keen', 'lucid', 'mellow', 'noble', 'quiet', 'rapid', 'sly', 'swift', 'vivid', 'witty', 'zesty'];
const ANIMAL = ['otter', 'falcon', 'lynx', 'heron', 'ibex', 'marlin', 'quokka', 'raven', 'tapir', 'vervet', 'wombat', 'yak', 'badger', 'crane', 'dingo', 'egret', 'gecko', 'jackal', 'koala', 'puma'];

/**
 * Spawn a session: an optional user-chosen name (blank → a random adj-animal
 * handle) + an optional task. A general, non-agent session you can find /
 * resume / kill by a meaningful name (e.g. `feat-glass-menu`). If the name
 * matches an agent, the wrapper loads that agent — intentional and rare.
 */
export async function spawnWorker(): Promise<void> {
  const raw = await vscode.window.showInputBox({
    title: 'Spawn a session',
    prompt: 'Name (optional, kebab-case). An agent name (e.g. lawyer) loads that agent; anything else (e.g. feat-checkout) starts a fresh named session. Blank → random handle.',
    placeHolder: 'feat-checkout  ·  or an agent: lawyer, deck-builder…',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return undefined; // blank → random handle
      return /^[a-z0-9][a-z0-9-]*$/.test(t)
        ? undefined
        : 'Lowercase letters, numbers and hyphens only (e.g. feat-glass-menu).';
    }
  });
  if (raw === undefined) return; // cancelled

  let name = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!name) name = `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${ANIMAL[Math.floor(Math.random() * ANIMAL.length)]}`;

  // Collision guard: a live session with this name shares the same respawn /
  // session files (keyed by name), so don't blindly spawn a duplicate.
  const live = (await listRunningAgents()).find((a) => a.name === name);
  if (live) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(eye) Reveal it', id: 'reveal' },
        { label: '$(add) Spawn anyway', id: 'spawn' }
      ],
      { title: `"${name}" is already running (pid ${live.pid})`, placeHolder: 'It would share the same session files — what do you want?' }
    );
    if (!choice) return;
    if (choice.id === 'reveal') { await revealAgentTerminal(name, live.pid); return; }
  }

  const task = await vscode.window.showInputBox({
    title: `spawn ${name}`,
    prompt: 'Task for this session (optional — leave blank to start it idle)',
    placeHolder: 'e.g. Draft the Q3 board update',
    ignoreFocusOut: true
  });
  if (task === undefined) return;

  await launchSpawn(name, task);
}
