// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type ElectronBuilderConfig = {
  dmg?: { background?: string };
  mac?: { entitlements?: string; entitlementsInherit?: string };
  nsis?: { include?: string; license?: string };
};

describe('release configuration', () => {
  it('references only files that are present in the repository', () => {
    const root = process.cwd();
    const config = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as ElectronBuilderConfig;
    const referencedFiles = [
      config.dmg?.background,
      config.mac?.entitlements,
      config.mac?.entitlementsInherit,
      config.nsis?.include,
      config.nsis?.license,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const relativePath of referencedFiles) {
      expect(existsSync(join(root, relativePath)), `Missing release resource: ${relativePath}`).toBe(true);
    }
  });

  it('does not expose empty macOS secrets as electron-builder signing variables', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

    expect(workflow).not.toMatch(/^\s+CSC_LINK:\s*\$\{\{\s*secrets\./m);
    expect(workflow).not.toMatch(/^\s+CSC_KEY_PASSWORD:\s*\$\{\{\s*secrets\./m);
    expect(workflow).not.toMatch(/^\s+APPLE_ID:\s*\$\{\{\s*secrets\./m);
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false');
    expect(workflow).toContain('export CSC_LINK="$OPENX_MAC_CERTS"');
  });
});
