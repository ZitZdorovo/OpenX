import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import {
  EMPTY_CHAT_ORGANIZATION,
  type ChatFolder,
  type ChatOrganizationSnapshot,
  type ChatPlacement,
} from '@shared/types/chat-organization';
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';

type OrganizationApi = CompleteHostServiceRegistry['chatOrganization'];

let storePromise: Promise<{
  get: (key: string, fallback?: unknown) => unknown;
  set: (key: string, value: unknown) => void;
}> | null = null;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

function sanitizeDirectorySegment(value: string): string {
  return Array.from(value.replace(/[<>:"/\\|?*]/g, '-'))
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('');
}

function resolveWorkspacePath(value: string): string {
  const expanded = value === '~'
    ? homedir()
    : value.startsWith('~/') || value.startsWith('~\\')
      ? join(homedir(), value.slice(2))
      : value;
  return resolve(expanded);
}

async function getStore() {
  if (!storePromise) {
    storePromise = import('electron-store').then(({ default: Store }) => {
      const store = new Store({ name: 'openx-chat-organization' });
      if (store.get('organization') === undefined) {
        const legacyStore = new Store({ name: 'openx-chat-organization' });
        const legacyOrganization = legacyStore.get('organization');
        if (legacyOrganization !== undefined) store.set('organization', legacyOrganization);
      }
      return store;
    });
  }
  return storePromise;
}

function normalizedSnapshot(value: unknown): ChatOrganizationSnapshot {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_CHAT_ORGANIZATION);
  const record = value as Partial<ChatOrganizationSnapshot>;
  const projects = Array.isArray(record.projects) ? record.projects : [];
  const rawFolders = Array.isArray(record.folders) ? record.folders : [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const rawFolderById = new Map(rawFolders.map((folder) => [folder.id, folder]));
  const resolveLegacyFolderPath = (folder: ChatFolder, seen = new Set<string>()): string => {
    if (typeof folder.path === 'string' && isAbsolute(folder.path)) return resolve(folder.path);
    if (seen.has(folder.id)) return projectById.get(folder.projectId)?.path ?? '';
    seen.add(folder.id);
    const parent = folder.parentId ? rawFolderById.get(folder.parentId) : null;
    const root = parent
      ? resolveLegacyFolderPath(parent, seen)
      : projectById.get(folder.projectId)?.path ?? '';
    const segment = sanitizeDirectorySegment(folder.name).trim() || folder.id;
    return root ? join(root, segment) : '';
  };
  const folders = rawFolders.map((folder) => ({ ...folder, path: resolveLegacyFolderPath(folder) }));
  return {
    version: 1,
    projects,
    folders,
    placements: Array.isArray(record.placements) ? record.placements : [],
    workspacePaths: record.workspacePaths && typeof record.workspacePaths === 'object'
      ? record.workspacePaths as Record<string, string>
      : {},
    pinnedChatKeys: Array.isArray(record.pinnedChatKeys) ? record.pinnedChatKeys : [],
    pinnedProjectIds: Array.isArray(record.pinnedProjectIds) ? record.pinnedProjectIds : [],
    pinnedFolderIds: Array.isArray(record.pinnedFolderIds) ? record.pinnedFolderIds : [],
    collapsedProjectIds: Array.isArray(record.collapsedProjectIds) ? record.collapsedProjectIds : [],
    collapsedFolderIds: Array.isArray(record.collapsedFolderIds) ? record.collapsedFolderIds : [],
    pinnedCollapsed: record.pinnedCollapsed === true,
  };
}

async function readSnapshot(): Promise<ChatOrganizationSnapshot> {
  const store = await getStore();
  return normalizedSnapshot(store.get('organization', EMPTY_CHAT_ORGANIZATION));
}

async function writeSnapshot(snapshot: ChatOrganizationSnapshot): Promise<ChatOrganizationSnapshot> {
  const store = await getStore();
  store.set('organization', snapshot);
  return structuredClone(snapshot);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function requireDirectoryName(value: unknown): string {
  const name = requireText(value, 'name');
  if (name === '.' || name === '..' || /[<>:"/\\|?*]/.test(name) || containsControlCharacter(name)) {
    throw new Error('Folder name contains characters that cannot be used in a directory');
  }
  return name;
}

function organizationCategory(
  snapshot: ChatOrganizationSnapshot,
  projectId: string,
  folderId: string | null,
): string {
  const project = snapshot.projects.find((entry) => entry.id === projectId);
  if (!project) return '';
  const names: string[] = [];
  let current = folderId ? snapshot.folders.find((entry) => entry.id === folderId) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId
      ? snapshot.folders.find((entry) => entry.id === current?.parentId)
      : undefined;
  }
  return [project.name, ...names].join(' / ');
}

export function descendantFolderIds(folders: ChatFolder[], folderId: string): Set<string> {
  const result = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        changed = true;
      }
    }
  }
  return result;
}

export function normalizePlacementOrder(placements: ChatPlacement[]): ChatPlacement[] {
  const groups = new Map<string, ChatPlacement[]>();
  for (const placement of placements) {
    const key = `${placement.projectId}:${placement.folderId ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(placement);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => (
    group.sort((a, b) => a.order - b.order).map((placement, order) => ({ ...placement, order }))
  ));
}

export function createChatOrganizationApi(gatewayManager?: GatewayManager): OrganizationApi {
  const api: OrganizationApi = {
    snapshot: () => readSnapshot(),
    createProject: async (payload) => {
      const projectPath = resolve(requireText(payload?.path, 'path'));
      const pathStat = await stat(projectPath);
      if (!pathStat.isDirectory()) throw new Error('Project path must be a directory');
      const snapshot = await readSnapshot();
      if (snapshot.projects.some((project) => project.path.toLowerCase() === projectPath.toLowerCase())) {
        throw new Error('A project already uses this directory');
      }
      snapshot.projects.push({
        id: randomUUID(),
        name: typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : basename(projectPath),
        path: projectPath,
        order: snapshot.projects.length,
      });
      return writeSnapshot(snapshot);
    },
    createFolder: async (payload) => {
      const snapshot = await readSnapshot();
      const projectId = requireText(payload?.projectId, 'projectId');
      const project = snapshot.projects.find((entry) => entry.id === projectId);
      if (!project) throw new Error('Project not found');
      const parentId = payload?.parentId ?? null;
      let parent: ChatFolder | undefined;
      if (parentId) {
        parent = snapshot.folders.find((folder) => folder.id === parentId);
        if (!parent || parent.projectId !== projectId) throw new Error('Parent folder not found in project');
      }
      const siblings = snapshot.folders.filter((folder) => folder.projectId === projectId && folder.parentId === parentId);
      const name = requireDirectoryName(payload?.name);
      const folderPath = resolve(parent?.path || project.path, name);
      await mkdir(folderPath, { recursive: true });
      snapshot.folders.push({
        id: randomUUID(),
        projectId,
        parentId,
        name,
        path: folderPath,
        order: siblings.length,
      });
      return writeSnapshot(snapshot);
    },
    rename: async (payload) => {
      const snapshot = await readSnapshot();
      const id = requireText(payload?.id, 'id');
      const name = requireText(payload?.name, 'name');
      if (payload?.kind === 'project') {
        const project = snapshot.projects.find((entry) => entry.id === id);
        if (!project) throw new Error('Project not found');
        project.name = name;
      } else if (payload?.kind === 'folder') {
        const folder = snapshot.folders.find((entry) => entry.id === id);
        if (!folder) throw new Error('Folder not found');
        folder.name = name;
      } else {
        throw new Error('Invalid organization node kind');
      }
      return writeSnapshot(snapshot);
    },
    deleteProject: async (payload) => {
      const snapshot = await readSnapshot();
      const id = requireText(payload?.id, 'id');
      if (!snapshot.projects.some((project) => project.id === id)) throw new Error('Project not found');
      const affectedChatKeys = snapshot.placements
        .filter((placement) => placement.projectId === id)
        .map((placement) => placement.chatKey);
      const hasContent = snapshot.folders.some((folder) => folder.projectId === id)
        || snapshot.placements.some((placement) => placement.projectId === id);
      if (hasContent && payload?.confirmed !== true) throw new Error('CONFIRM_NON_EMPTY_PROJECT');
      snapshot.projects = snapshot.projects.filter((project) => project.id !== id)
        .map((project, order) => ({ ...project, order }));
      snapshot.folders = snapshot.folders.filter((folder) => folder.projectId !== id);
      snapshot.placements = snapshot.placements.filter((placement) => placement.projectId !== id);
      snapshot.collapsedProjectIds = snapshot.collapsedProjectIds.filter((entry) => entry !== id);
      snapshot.pinnedProjectIds = snapshot.pinnedProjectIds.filter((entry) => entry !== id);
      snapshot.pinnedFolderIds = snapshot.pinnedFolderIds.filter((entry) => (
        snapshot.folders.some((folder) => folder.id === entry)
      ));
      for (const chatKey of affectedChatKeys) {
        snapshot.workspacePaths[chatKey] = resolveWorkspacePath(DEFAULT_WORKSPACE_CWD);
      }
      if (gatewayManager) {
        await Promise.all(affectedChatKeys.map((chatKey) => gatewayManager.rpc('sessions.patch', {
          key: chatKey,
          category: null,
        })));
      }
      return writeSnapshot(snapshot);
    },
    deleteFolder: async (payload) => {
      const snapshot = await readSnapshot();
      const id = requireText(payload?.id, 'id');
      if (!snapshot.folders.some((folder) => folder.id === id)) throw new Error('Folder not found');
      const folderIds = descendantFolderIds(snapshot.folders, id);
      const affectedChatKeys = snapshot.placements
        .filter((placement) => placement.folderId ? folderIds.has(placement.folderId) : false)
        .map((placement) => placement.chatKey);
      const hasContent = folderIds.size > 1 || snapshot.placements.some((placement) => (
        placement.folderId ? folderIds.has(placement.folderId) : false
      ));
      if (hasContent && payload?.confirmed !== true) throw new Error('CONFIRM_NON_EMPTY_FOLDER');
      snapshot.folders = snapshot.folders.filter((folder) => !folderIds.has(folder.id));
      snapshot.placements = snapshot.placements.filter((placement) => (
        placement.folderId ? !folderIds.has(placement.folderId) : true
      ));
      snapshot.collapsedFolderIds = snapshot.collapsedFolderIds.filter((entry) => !folderIds.has(entry));
      snapshot.pinnedFolderIds = snapshot.pinnedFolderIds.filter((entry) => !folderIds.has(entry));
      for (const chatKey of affectedChatKeys) {
        snapshot.workspacePaths[chatKey] = resolveWorkspacePath(DEFAULT_WORKSPACE_CWD);
      }
      if (gatewayManager) {
        await Promise.all(affectedChatKeys.map((chatKey) => gatewayManager.rpc('sessions.patch', {
          key: chatKey,
          category: null,
        })));
      }
      return writeSnapshot(snapshot);
    },
    moveChat: async (payload) => {
      const snapshot = await readSnapshot();
      const chatKey = requireText(payload?.chatKey, 'chatKey');
      const projectId = requireText(payload?.projectId, 'projectId');
      if (!snapshot.projects.some((project) => project.id === projectId)) throw new Error('Project not found');
      const folderId = payload?.folderId ?? null;
      if (folderId) {
        const folder = snapshot.folders.find((entry) => entry.id === folderId);
        if (!folder || folder.projectId !== projectId) throw new Error('Folder not found in project');
      }
      const remaining = snapshot.placements.filter((placement) => placement.chatKey !== chatKey);
      const siblings = remaining
        .filter((placement) => placement.projectId === projectId && placement.folderId === folderId)
        .sort((a, b) => a.order - b.order);
      const beforeIndex = payload?.beforeChatKey
        ? siblings.findIndex((placement) => placement.chatKey === payload.beforeChatKey)
        : -1;
      const insertAt = beforeIndex >= 0 ? beforeIndex : siblings.length;
      siblings.splice(insertAt, 0, { chatKey, projectId, folderId, order: insertAt });
      snapshot.placements = normalizePlacementOrder([
        ...remaining.filter((placement) => !(placement.projectId === projectId && placement.folderId === folderId)),
        ...siblings,
      ]);
      snapshot.pinnedChatKeys = snapshot.pinnedChatKeys.filter((key) => key !== chatKey);
      const project = snapshot.projects.find((entry) => entry.id === projectId);
      const folder = folderId ? snapshot.folders.find((entry) => entry.id === folderId) : undefined;
      if (project) snapshot.workspacePaths[chatKey] = folder?.path || project.path;
      if (gatewayManager) {
        await gatewayManager.rpc('sessions.patch', {
          key: chatKey,
          category: organizationCategory(snapshot, projectId, folderId),
          pinned: false,
        });
      }
      return writeSnapshot(snapshot);
    },
    moveFolder: async (payload) => {
      const snapshot = await readSnapshot();
      const folderId = requireText(payload?.folderId, 'folderId');
      const projectId = requireText(payload?.projectId, 'projectId');
      const folder = snapshot.folders.find((entry) => entry.id === folderId);
      if (!folder) throw new Error('Folder not found');
      if (!snapshot.projects.some((project) => project.id === projectId)) throw new Error('Project not found');
      const parentId = payload?.parentId ?? null;
      const descendants = descendantFolderIds(snapshot.folders, folderId);
      if (parentId && descendants.has(parentId)) throw new Error('Cannot move a folder into itself');
      if (parentId) {
        const parent = snapshot.folders.find((entry) => entry.id === parentId);
        if (!parent || parent.projectId !== projectId) throw new Error('Parent folder not found in project');
      }
      const siblings = snapshot.folders.filter((entry) => (
        entry.projectId === projectId && entry.parentId === parentId && entry.id !== folderId
      ));
      for (const entry of snapshot.folders) {
        if (descendants.has(entry.id)) entry.projectId = projectId;
      }
      folder.parentId = parentId;
      folder.order = siblings.length;
      for (const placement of snapshot.placements) {
        if (placement.folderId && descendants.has(placement.folderId)) placement.projectId = projectId;
      }
      if (gatewayManager) {
        const affectedChats = snapshot.placements.filter((placement) => (
          placement.folderId ? descendants.has(placement.folderId) : false
        ));
        await Promise.all(affectedChats.map((placement) => gatewayManager.rpc('sessions.patch', {
          key: placement.chatKey,
          category: organizationCategory(snapshot, placement.projectId, placement.folderId),
        })));
      }
      return writeSnapshot(snapshot);
    },
    unplaceChat: async (payload) => {
      const snapshot = await readSnapshot();
      const chatKey = requireText(payload?.chatKey, 'chatKey');
      const workspacePath = resolveWorkspacePath(requireText(payload?.workspacePath, 'workspacePath'));
      snapshot.placements = normalizePlacementOrder(
        snapshot.placements.filter((placement) => placement.chatKey !== chatKey),
      );
      snapshot.workspacePaths[chatKey] = workspacePath;
      if (gatewayManager) await gatewayManager.rpc('sessions.patch', { key: chatKey, category: null });
      return writeSnapshot(snapshot);
    },
    pinChat: async (payload) => {
      const snapshot = await readSnapshot();
      const chatKey = requireText(payload?.chatKey, 'chatKey');
      const pinned = payload?.pinned === true;
      const beforeChatKey = payload?.beforeChatKey == null
        ? null
        : requireText(payload.beforeChatKey, 'beforeChatKey');
      const wasPinned = snapshot.pinnedChatKeys.includes(chatKey);
      const remainingPinnedKeys = snapshot.pinnedChatKeys.filter((key) => key !== chatKey);
      if (pinned) {
        const beforeIndex = beforeChatKey
          ? remainingPinnedKeys.indexOf(beforeChatKey)
          : -1;
        remainingPinnedKeys.splice(beforeIndex >= 0 ? beforeIndex : remainingPinnedKeys.length, 0, chatKey);
        snapshot.placements = normalizePlacementOrder(snapshot.placements.filter((placement) => placement.chatKey !== chatKey));
      } else if (wasPinned && !snapshot.placements.some((placement) => placement.chatKey === chatKey)) {
        snapshot.workspacePaths[chatKey] = resolveWorkspacePath(DEFAULT_WORKSPACE_CWD);
      }
      snapshot.pinnedChatKeys = remainingPinnedKeys;
      if (gatewayManager) {
        await gatewayManager.rpc('sessions.patch', {
          key: chatKey,
          pinned,
          ...(pinned || (wasPinned && !snapshot.placements.some((placement) => placement.chatKey === chatKey))
            ? { category: null }
            : {}),
        });
      }
      return writeSnapshot(snapshot);
    },
    pinNode: async (payload) => {
      const snapshot = await readSnapshot();
      const id = requireText(payload?.id, 'id');
      const update = (entries: string[]) => {
        const remaining = entries.filter((entry) => entry !== id);
        return payload?.pinned === true ? [...remaining, id] : remaining;
      };
      if (payload?.kind === 'project') {
        if (!snapshot.projects.some((project) => project.id === id)) throw new Error('Project not found');
        snapshot.pinnedProjectIds = update(snapshot.pinnedProjectIds);
      } else if (payload?.kind === 'folder') {
        if (!snapshot.folders.some((folder) => folder.id === id)) throw new Error('Folder not found');
        snapshot.pinnedFolderIds = update(snapshot.pinnedFolderIds);
      } else {
        throw new Error('Invalid pin target');
      }
      return writeSnapshot(snapshot);
    },
    setCollapsed: async (payload) => {
      const snapshot = await readSnapshot();
      const update = (entries: string[], id: string, collapsed: boolean) => (
        collapsed ? [...new Set([...entries, id])] : entries.filter((entry) => entry !== id)
      );
      if (payload?.kind === 'pinned') {
        snapshot.pinnedCollapsed = payload.collapsed === true;
      } else if (payload?.kind === 'project') {
        const id = requireText(payload.id, 'id');
        snapshot.collapsedProjectIds = update(snapshot.collapsedProjectIds, id, payload.collapsed === true);
      } else if (payload?.kind === 'folder') {
        const id = requireText(payload.id, 'id');
        snapshot.collapsedFolderIds = update(snapshot.collapsedFolderIds, id, payload.collapsed === true);
      } else {
        throw new Error('Invalid collapse target');
      }
      return writeSnapshot(snapshot);
    },
  };

  if (gatewayManager) {
    gatewayManager.registerClientRpcHandler('openx.chats.pin', (params) => api.pinChat(params as never));
    gatewayManager.registerClientRpcHandler('openx.organization.pin', (params) => api.pinNode(params as never));
    gatewayManager.registerClientRpcHandler('openx.chats.move', (params) => api.moveChat(params as never));
    gatewayManager.registerClientRpcHandler('openx.folders.move', (params) => api.moveFolder(params as never));
    gatewayManager.registerClientRpcHandler('openx.chats.unplace', (params) => api.unplaceChat(params as never));
    gatewayManager.registerClientRpcHandler('openx.chats.rename', async (params) => {
      const body = params && typeof params === 'object' ? params as Record<string, unknown> : {};
      const chatKey = requireText(body.chatKey, 'chatKey');
      const title = requireText(body.title, 'title');
      await gatewayManager.rpc('sessions.patch', { key: chatKey, label: title });
      return { success: true };
    });
    gatewayManager.registerClientRpcHandler('openx.organization.rename', (params) => api.rename(params as never));
    gatewayManager.registerClientRpcHandler('openx.projects.create', (params) => api.createProject(params as never));
    gatewayManager.registerClientRpcHandler('openx.folders.create', (params) => api.createFolder(params as never));
    gatewayManager.registerClientRpcHandler('openx.projects.delete', (params) => api.deleteProject(params as never));
    gatewayManager.registerClientRpcHandler('openx.folders.delete', (params) => api.deleteFolder(params as never));
    gatewayManager.registerClientRpcHandler('openx.organization.collapse', (params) => api.setCollapsed(params as never));
  }
  return api;
}
