import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  version: vi.fn(),
  status: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  install: vi.fn(),
  setChannel: vi.fn(),
  setAutoDownload: vi.fn(),
  cancelAutoInstall: vi.fn(),
  onStatusChanged: vi.fn(),
  onCountdown: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    updates: {
      version: mocks.version,
      status: mocks.status,
      check: mocks.check,
      download: mocks.download,
      install: mocks.install,
      setChannel: mocks.setChannel,
      setAutoDownload: mocks.setAutoDownload,
      cancelAutoInstall: mocks.cancelAutoInstall,
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onUpdateStatusChanged: mocks.onStatusChanged,
    onUpdateAutoInstallCountdown: mocks.onCountdown,
  },
}));

describe('update store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.version.mockResolvedValue('0.0.1');
    mocks.status.mockResolvedValue({ status: 'idle' });
    mocks.setAutoDownload.mockResolvedValue({ success: true });
  });

  it('initializes prompt-first updates without downloading implicitly', async () => {
    const { useUpdateStore } = await import('@/stores/update');

    await useUpdateStore.getState().init();

    expect(useUpdateStore.getState()).toMatchObject({
      currentVersion: '0.0.1',
      status: 'idle',
      isInitialized: true,
    });
    expect(mocks.setAutoDownload).toHaveBeenCalledWith(false);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('keeps a discovered release available for the sidebar and prompt', async () => {
    mocks.check.mockResolvedValue({
      success: true,
      status: { status: 'available', info: { version: '0.0.2' } },
    });
    const { useUpdateStore } = await import('@/stores/update');

    await useUpdateStore.getState().checkForUpdates({ silent: true });

    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      updateInfo: { version: '0.0.2' },
      error: null,
    });
  });

  it('does not expose background network failures as update actions', async () => {
    mocks.check.mockRejectedValue(new Error('offline'));
    const { useUpdateStore } = await import('@/stores/update');

    await useUpdateStore.getState().checkForUpdates({ silent: true });

    expect(useUpdateStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('does not replace an actionable release with another background check', async () => {
    const { useUpdateStore } = await import('@/stores/update');
    useUpdateStore.setState({ status: 'downloaded', updateInfo: { version: '0.0.2' } });

    await useUpdateStore.getState().checkForUpdates({ silent: true });

    expect(mocks.check).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe('downloaded');
  });
});
