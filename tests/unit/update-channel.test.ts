import { describe, expect, it } from 'vitest';
import { resolveUpdaterChannel } from '@shared/update-channel';

describe('OpenX update channels', () => {
  it.each([
    ['stable', 'latest'],
    ['beta', 'beta'],
    ['dev', 'alpha'],
  ] as const)('maps %s releases to the electron-updater %s feed', (channel, expected) => {
    expect(resolveUpdaterChannel(channel)).toBe(expected);
  });
});
