/**
 * aios#231 — under permissions.blockReadsOutsideWorkingDirectories a worker could not read the task
 * file Glass wrote to ~/.aios/run. Every Glass launch whose prompt points at such a file now grants
 * its directory with --add-dir, placed where the variadic flag cannot swallow the prompt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import { addDirArgs, dirOfFile } from '../core/addDir';
import { resumeCmd, healthHelpCmd } from '../bus/launchCmd';

const RUN = '/Users/heron/.aios/run';
const FILE = `${RUN}/aios-resume-task-heron.md`;
const PROMPT = `Read ${FILE} and follow the instructions inside.`;

/** The token right after --add-dir's value — must be a flag, or the prompt is read as a directory. */
const afterAddDir = (cmd: string): string => {
  const m = /--add-dir '[^']*' (\S+)/.exec(cmd);
  assert.ok(m, `no --add-dir in: ${cmd}`);
  return m![1];
};

test('dirOfFile is separator-agnostic', () => {
  assert.equal(dirOfFile(FILE), RUN);
  assert.equal(dirOfFile('C:\\Users\\heron\\AppData\\Local\\Temp\\t.md'), 'C:\\Users\\heron\\AppData\\Local\\Temp');
  assert.equal(dirOfFile('C:\\t.md'), 'C:\\');
  assert.equal(dirOfFile('/t.md'), '/');
  assert.equal(dirOfFile('t.md'), '');
  assert.deepEqual(addDirArgs(FILE), ['--add-dir', RUN]);
  assert.deepEqual(addDirArgs(undefined), []);
});

test('a file-prompt resume carries --add-dir with the run dir, followed by a flag', () => {
  const cmd = resumeCmd('claude', 'abc-123', ['--effort', 'high'], PROMPT, FILE);
  assert.ok(cmd.startsWith(`claude --add-dir '${RUN}' --resume 'abc-123'`), cmd);
  assert.ok(afterAddDir(cmd).startsWith('--'));
  assert.ok(cmd.endsWith(` '${PROMPT}'`));
});

test('the health-help launch carries --add-dir with the run dir, followed by a flag', () => {
  const f = `${RUN}/aios-task-health-help.md`;
  const cmd = healthHelpCmd('claude', f, `Read ${f} and follow the instructions inside.`);
  assert.ok(cmd.startsWith(`claude --add-dir '${RUN}' --permission-mode default --name health-help `), cmd);
  assert.ok(afterAddDir(cmd).startsWith('--'));
});

test('an inline-prompt resume carries no --add-dir', () => {
  assert.doesNotMatch(resumeCmd('claude', 'abc-123', [], 'carry on', undefined), /--add-dir/);
  assert.doesNotMatch(resumeCmd('claude', 'abc-123', [], '', undefined), /--add-dir/);
});

test('a resume never gets --name or --model as a side effect', () => {
  for (const cmd of [resumeCmd('claude', 'abc-123', [], PROMPT, FILE), resumeCmd('claude', 'abc-123', [], 'hi')]) {
    assert.doesNotMatch(cmd, /--name|--model/, cmd);
  }
});

test('the runner passes the task file to both builders, and never adds --add-dir to the spawn wrapper', () => {
  const src = fs.readFileSync('src/rituals/runner.ts', 'utf8');
  assert.match(src, /runNew\(resumeCmd\(claudeBin\(\), sessionId, extraArgs, inline, taskFile\)/);
  assert.match(src, /runNew\(healthHelpCmd\(claudeBin\(\), file, prompt\)/);
  assert.match(src, /taskFile = f;\s*inline = `Read \$\{f\}/, 'the resume remembers the file it pointed the prompt at');
  const spawnLine = src.slice(src.indexOf('runNew(`spawn '), src.indexOf('\n', src.indexOf('runNew(`spawn ')));
  assert.doesNotMatch(spawnLine, /add-dir/, 'the wrapper reads an unknown flag as the worker name');
});
