export type ChatProject = {
  id: string;
  name: string;
  path: string;
  order: number;
};

export type ChatFolder = {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  /** Absolute local directory used as the ACP workspace for chats placed here. */
  path: string;
  order: number;
};

export type ChatPlacement = {
  chatKey: string;
  projectId: string;
  folderId: string | null;
  order: number;
};

export type ChatOrganizationSnapshot = {
  version: 1;
  projects: ChatProject[];
  folders: ChatFolder[];
  placements: ChatPlacement[];
  /** Persistent ACP workspace selected for each organized or restored chat. */
  workspacePaths: Record<string, string>;
  pinnedChatKeys: string[];
  pinnedProjectIds: string[];
  pinnedFolderIds: string[];
  collapsedProjectIds: string[];
  collapsedFolderIds: string[];
  pinnedCollapsed: boolean;
};

export const EMPTY_CHAT_ORGANIZATION: ChatOrganizationSnapshot = {
  version: 1,
  projects: [],
  folders: [],
  placements: [],
  workspacePaths: {},
  pinnedChatKeys: [],
  pinnedProjectIds: [],
  pinnedFolderIds: [],
  collapsedProjectIds: [],
  collapsedFolderIds: [],
  pinnedCollapsed: false,
};
