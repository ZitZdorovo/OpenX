import { shell } from 'electron';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

function expandShellPath(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith(`~${sep}`) || input.startsWith('~/') || input.startsWith('~\\')) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

function requirePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('path is required');
  }
  return path;
}

function requireUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('url is required');
  }
  return url;
}

function launchDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveLaunch, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('spawn', () => {
      child.unref();
      resolveLaunch();
    });
    child.once('error', reject);
  });
}

async function openTerminalAt(input: string): Promise<void> {
  const expanded = expandShellPath(input);
  const target = resolve(expanded);
  if (!isAbsolute(target) || !(await stat(target)).isDirectory()) {
    throw new Error('Terminal path must be an existing directory');
  }
  if (process.platform === 'win32') {
    try {
      await launchDetached('wt.exe', ['-d', target], target);
    } catch {
      const escaped = target.replace(/'/g, "''");
      await launchDetached('powershell.exe', ['-NoExit', '-Command', `Set-Location -LiteralPath '${escaped}'`], target);
    }
    return;
  }
  if (process.platform === 'darwin') {
    await launchDetached('open', ['-a', 'Terminal', target], target);
    return;
  }
  try {
    await launchDetached('x-terminal-emulator', ['--working-directory', target], target);
  } catch {
    await launchDetached('gnome-terminal', ['--working-directory', target], target);
  }
}

export function createShellApi(): CompleteHostServiceRegistry['shell'] {
  return {
    openExternal: async (payload) => {
      await shell.openExternal(requireUrl(payload.url));
    },
    showItemInFolder: (payload) => {
      shell.showItemInFolder(expandShellPath(requirePath(payload.path)));
    },
    openPath: (payload) => shell.openPath(expandShellPath(requirePath(payload.path))),
    openTerminal: async (payload) => openTerminalAt(requirePath(payload.path)),
  };
}
