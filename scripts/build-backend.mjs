import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const binary = resolve('.dbx-dev/bin', process.platform === 'win32' ? 'dbx-waitwork.exe' : 'dbx-waitwork');
mkdirSync(resolve('.dbx-dev/bin'), { recursive: true });
const result = spawnSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', binary, '.'], { cwd: resolve('backend'), stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
