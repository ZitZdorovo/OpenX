import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
  popup: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getLocale: () => 'en', isPackaged: false },
  BrowserWindow: {
    fromWebContents: () => undefined,
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  Menu: {
    buildFromTemplate: (...args: unknown[]) => electronMocks.buildFromTemplate(...args),
  },
  shell: { openExternal: vi.fn() },
}));

describe('native editing context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMocks.buildFromTemplate.mockReturnValue({ popup: electronMocks.popup });
  });

  it('offers spelling and editing actions in renderer text fields', async () => {
    let contextMenuHandler: ((event: unknown, params: Record<string, unknown>) => void) | undefined;
    const replaceMisspelling = vi.fn();
    const addWordToSpellCheckerDictionary = vi.fn();
    const webContents = {
      on: vi.fn((event: string, handler: typeof contextMenuHandler) => {
        if (event === 'context-menu') contextMenuHandler = handler;
      }),
      isDestroyed: () => false,
      replaceMisspelling,
      session: { addWordToSpellCheckerDictionary },
    };
    const { installEditingContextMenu } = await import('../../electron/main/menu');
    installEditingContextMenu(webContents as never);

    contextMenuHandler?.({}, {
      isEditable: true,
      selectionText: 'teh',
      misspelledWord: 'teh',
      dictionarySuggestions: ['the'],
    });
    await vi.waitFor(() => expect(electronMocks.buildFromTemplate).toHaveBeenCalled());

    const template = electronMocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string;
      role?: string;
      click?: () => void;
    }>;
    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'the' }),
      expect.objectContaining({ role: 'copy' }),
      expect.objectContaining({ role: 'paste' }),
      expect.objectContaining({ role: 'selectAll' }),
    ]));
    template.find((item) => item.label === 'the')?.click?.();
    expect(replaceMisspelling).toHaveBeenCalledWith('the');
    expect(electronMocks.popup).toHaveBeenCalled();
  });
});
