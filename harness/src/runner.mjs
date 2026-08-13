import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './specs.mjs';

export async function runStep(step) {
  const started = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: ROOT,
      stdio: 'inherit',
      // Windows needs a shell for command shims such as pnpm.cmd, but routing
      // an absolute executable through cmd.exe breaks paths containing spaces.
      shell: process.platform === 'win32' && !path.isAbsolute(step.command),
    });

    child.on('close', (exitCode) => {
      resolve({
        ...step,
        status: exitCode === 0 ? 'pass' : 'fail',
        exitCode,
        durationMs: Date.now() - started,
      });
    });
  });
}
