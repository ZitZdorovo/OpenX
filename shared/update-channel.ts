export type OpenXUpdateChannel = 'stable' | 'beta' | 'dev';

export function resolveUpdaterChannel(channel: OpenXUpdateChannel): 'latest' | 'beta' | 'alpha' {
  if (channel === 'stable') return 'latest';
  if (channel === 'dev') return 'alpha';
  return 'beta';
}
