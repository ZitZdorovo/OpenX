import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { EMPTY_CHAT_ORGANIZATION, type ChatOrganizationSnapshot } from '@shared/types/chat-organization';

type OrganizationState = ChatOrganizationSnapshot & {
  loading: boolean;
  load: () => Promise<void>;
  createProject: (name: string, path: string) => Promise<void>;
  createFolder: (projectId: string, name: string, parentId?: string | null) => Promise<void>;
  rename: (kind: 'project' | 'folder', id: string, name: string) => Promise<void>;
  deleteProject: (id: string, confirmed?: boolean) => Promise<void>;
  deleteFolder: (id: string, confirmed?: boolean) => Promise<void>;
  moveChat: (chatKey: string, projectId: string, folderId?: string | null, beforeChatKey?: string | null) => Promise<void>;
  moveFolder: (folderId: string, projectId: string, parentId?: string | null) => Promise<void>;
  unplaceChat: (chatKey: string, workspacePath: string) => Promise<void>;
  pinChat: (chatKey: string, pinned: boolean, beforeChatKey?: string | null) => Promise<void>;
  pinNode: (kind: 'project' | 'folder', id: string, pinned: boolean) => Promise<void>;
  setCollapsed: (kind: 'project' | 'folder' | 'pinned', collapsed: boolean, id?: string) => Promise<void>;
};

const snapshotPatch = (snapshot: ChatOrganizationSnapshot) => ({ ...snapshot, loading: false });

export const useChatOrganizationStore = create<OrganizationState>((set) => ({
  ...EMPTY_CHAT_ORGANIZATION,
  loading: false,
  load: async () => {
    set({ loading: true });
    try { set(snapshotPatch(await hostApi.chatOrganization.snapshot())); }
    catch (error) { set({ loading: false }); throw error; }
  },
  createProject: async (name, path) => set(snapshotPatch(await hostApi.chatOrganization.createProject(name, path))),
  createFolder: async (projectId, name, parentId) => set(snapshotPatch(await hostApi.chatOrganization.createFolder(projectId, name, parentId))),
  rename: async (kind, id, name) => set(snapshotPatch(await hostApi.chatOrganization.rename(kind, id, name))),
  deleteProject: async (id, confirmed) => set(snapshotPatch(await hostApi.chatOrganization.deleteProject(id, confirmed))),
  deleteFolder: async (id, confirmed) => set(snapshotPatch(await hostApi.chatOrganization.deleteFolder(id, confirmed))),
  moveChat: async (chatKey, projectId, folderId, beforeChatKey) => set(snapshotPatch(await hostApi.chatOrganization.moveChat(chatKey, projectId, folderId, beforeChatKey))),
  moveFolder: async (folderId, projectId, parentId) => set(snapshotPatch(await hostApi.chatOrganization.moveFolder(folderId, projectId, parentId))),
  unplaceChat: async (chatKey, workspacePath) => set(snapshotPatch(await hostApi.chatOrganization.unplaceChat(chatKey, workspacePath))),
  pinChat: async (chatKey, pinned, beforeChatKey) => {
    let previousPinnedChatKeys: string[] = [];
    set((state) => {
      previousPinnedChatKeys = state.pinnedChatKeys;
      const remaining = state.pinnedChatKeys.filter((key) => key !== chatKey);
      if (!pinned) return { pinnedChatKeys: remaining };
      const beforeIndex = beforeChatKey ? remaining.indexOf(beforeChatKey) : -1;
      remaining.splice(beforeIndex >= 0 ? beforeIndex : remaining.length, 0, chatKey);
      return { pinnedChatKeys: remaining };
    });
    try {
      set(snapshotPatch(await hostApi.chatOrganization.pinChat(chatKey, pinned, beforeChatKey)));
    } catch (error) {
      set({ pinnedChatKeys: previousPinnedChatKeys });
      throw error;
    }
  },
  pinNode: async (kind, id, pinned) => set(snapshotPatch(await hostApi.chatOrganization.pinNode(kind, id, pinned))),
  setCollapsed: async (kind, collapsed, id) => set(snapshotPatch(await hostApi.chatOrganization.setCollapsed(kind, collapsed, id))),
}));
