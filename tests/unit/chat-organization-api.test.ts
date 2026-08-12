// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({ organization: undefined as unknown }));

vi.mock('electron-store', () => ({
  default: class MemoryStore {
    constructor(options: { defaults?: { organization?: unknown } }) {
      if (memory.organization === undefined) memory.organization = structuredClone(options.defaults?.organization);
    }
    get(key: string, fallback?: unknown) { return key === 'organization' ? memory.organization ?? fallback : fallback; }
    set(key: string, value: unknown) { if (key === 'organization') memory.organization = structuredClone(value); }
  },
}));

describe('chat organization host service', () => {
  beforeEach(() => { memory.organization = undefined; });

  it('persists nested folders, DnD order, pins, collapse state, and confirmation guards', async () => {
    const handlers = new Map<string, (params: unknown) => unknown>();
    const gateway = {
      registerClientRpcHandler: vi.fn((method: string, handler: (params: unknown) => unknown) => {
        handlers.set(method, handler);
        return () => handlers.delete(method);
      }),
      rpc: vi.fn().mockResolvedValue({}),
    };
    const { createChatOrganizationApi } = await import('@electron/services/chat-organization-api');
    const api = createChatOrganizationApi(gateway as never);
    let snapshot = await api.createProject({ name: 'OpenX', path: process.cwd() });
    const projectId = snapshot.projects[0]!.id;
    const folderSnapshot = await api.createFolder({ projectId, name: 'Feature', parentId: null });
    const folderId = folderSnapshot.folders[0]!.id;
    const childSnapshot = await api.createFolder({ projectId, name: 'Review', parentId: folderId });
    const childId = childSnapshot.folders[1]!.id;
    await api.moveChat({ chatKey: 'chat-b', projectId, folderId: childId });
    await api.moveChat({ chatKey: 'chat-a', projectId, folderId: childId, beforeChatKey: 'chat-b' });
    await api.pinChat({ chatKey: 'chat-a', pinned: true });
    await api.pinChat({ chatKey: 'chat-c', pinned: true });
    snapshot = await api.pinChat({ chatKey: 'chat-c', pinned: true, beforeChatKey: 'chat-a' });
    expect(snapshot.pinnedChatKeys).toEqual(['chat-c', 'chat-a']);
    await api.pinChat({ chatKey: 'chat-c', pinned: false });
    await api.pinNode({ kind: 'project', id: projectId, pinned: true });
    await api.pinNode({ kind: 'folder', id: folderId, pinned: true });
    snapshot = await api.setCollapsed({ kind: 'folder', id: folderId, collapsed: true });
    expect(snapshot.placements.map((row) => [row.chatKey, row.order])).toEqual([['chat-b', 0]]);
    expect(snapshot.pinnedChatKeys).toEqual(['chat-a']);
    expect(snapshot.pinnedProjectIds).toEqual([projectId]);
    expect(snapshot.pinnedFolderIds).toEqual([folderId]);
    expect(snapshot.collapsedFolderIds).toEqual([folderId]);

    snapshot = await api.moveChat({ chatKey: 'chat-a', projectId, folderId: null });
    expect(snapshot.pinnedChatKeys).not.toContain('chat-a');
    expect(snapshot.workspacePaths['chat-a']).toBe(process.cwd());
    snapshot = await api.pinChat({ chatKey: 'chat-a', pinned: true });
    expect(snapshot.placements.some((placement) => placement.chatKey === 'chat-a')).toBe(false);
    snapshot = await api.pinChat({ chatKey: 'chat-a', pinned: false });
    expect(snapshot.workspacePaths['chat-a']).not.toContain('~');
    expect(snapshot.workspacePaths['chat-a']).toMatch(/[\\/]\.openclaw[\\/]workspace$/);

    await expect(api.deleteFolder({ id: folderId, confirmed: false })).rejects.toThrow('CONFIRM_NON_EMPTY_FOLDER');
    snapshot = await api.deleteFolder({ id: folderId, confirmed: true });
    expect(snapshot.folders).toEqual([]);
    expect(snapshot.placements).toEqual([]);
    expect(snapshot.workspacePaths['chat-b']).toMatch(/[\\/]\.openclaw[\\/]workspace$/);
    expect(gateway.rpc).toHaveBeenCalledWith('sessions.patch', {
      key: 'chat-b',
      category: null,
    });
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.chats.pin', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.chats.move', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.chats.unplace', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.chats.rename', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.projects.create', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.folders.create', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.folders.move', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.projects.delete', expect.any(Function));
    expect(gateway.registerClientRpcHandler).toHaveBeenCalledWith('openx.folders.delete', expect.any(Function));
  });
});
