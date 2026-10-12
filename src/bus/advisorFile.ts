/**
 * Contract 4: the advisor goes to Claude as `--settings <FILE>`, never inline JSON — the Windows
 * `.cmd` shim mangles quotes inside an argument. Each launch gets its own uniquely named file
 * (mkdtemp; never a fixed path in a shared temp folder). The pure decision still produces the
 * JSON (core/contract4, which the conformance fixture reads); this only moves it into a file.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function settingsToFile(args: string[]): string[] {
  const i = args.indexOf('--settings');
  if (i === -1 || i + 1 >= args.length) return args;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-advisor-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, args[i + 1] + '\n', { mode: 0o600 });
  const out = args.slice();
  out[i + 1] = file;
  return out;
}
