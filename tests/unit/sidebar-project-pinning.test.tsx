import React from 'react';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useChatOrganizationStore } from '@/stores/chat-organization';
import { useGatewayStore } from '@/stores/gateway';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useSettingsStore } from '@/stores/settings';

const initialAgentsState = useAgentsStore.getState();
const initialChatState = useChatStore.getState();
const initialOrganizationState = useChatOrganizationStore.getState();
const initialGatewayState = useGatewayStore.getState();
const initialAttentionState = useSessionAttentionStore.getState();
const initialSettingsState = useSettingsStore.getState();
const initialPlatform = window.electron.platform;

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.electron.platform = 'linux';
  useSettingsStore.setState({
    sidebarCollapsed: false,
    sidebarWidth: 320,
    chatWorkspacePath: '/default',
    workspaceLabels: {},
  });
  useGatewayStore.setState({ status: { state: 'running', port: 18789, gatewayReady: true } });
  useAgentsStore.setState({ agents: [], fetchAgents: vi.fn().mockResolvedValue(undefined) });
  useSessionAttentionStore.setState({ bySessionKey: {}, visibleSessionKey: null });
  useChatStore.setState({
    sessions: [],
    currentSessionKey: null,
    sessionLabels: {},
    sessionLastActivity: {},
    loadSessions: vi.fn().mockResolvedValue(undefined),
  });
  useChatOrganizationStore.setState({
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
    loading: false,
    load: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  cleanup();
  window.electron.platform = initialPlatform;
  useAgentsStore.setState(initialAgentsState, true);
  useChatStore.setState(initialChatState, true);
  useChatOrganizationStore.setState(initialOrganizationState, true);
  useGatewayStore.setState(initialGatewayState, true);
  useSessionAttentionStore.setState(initialAttentionState, true);
  useSettingsStore.setState(initialSettingsState, true);
});

describe('project sidebar pin and delete behavior', () => {
  it('reorders pinned chats on the first drag gesture', async () => {
    const pinChat = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      sessions: [
        { key: 'agent:main:pinned-first', displayName: 'Pinned first', updatedAt: Date.now() },
        { key: 'agent:main:pinned-second', displayName: 'Pinned second', updatedAt: Date.now() - 1 },
      ],
      currentSessionKey: 'agent:main:pinned-first',
      sessionLastActivity: {},
    });
    useChatOrganizationStore.setState({
      pinnedChatKeys: ['agent:main:pinned-first', 'agent:main:pinned-second'],
      pinChat,
    });
    renderSidebar();

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(''),
      types: ['text/openx-chat'],
    };
    const secondChat = screen.getByTestId('sidebar-session-agent:main:pinned-second');
    const firstChat = screen.getByTestId('sidebar-session-agent:main:pinned-first');
    firstChat.getBoundingClientRect = () => ({
      x: 0, y: 100, top: 100, right: 200, bottom: 132, left: 0, width: 200, height: 32,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(secondChat, { dataTransfer });
    const upperHalfDragOver = createEvent.dragOver(firstChat, { dataTransfer });
    Object.defineProperty(upperHalfDragOver, 'clientY', { value: 104 });
    fireEvent(firstChat, upperHalfDragOver);
    expect(screen.getByTestId('sidebar-chat-drop-indicator')).toHaveAttribute('data-edge', 'top');
    fireEvent.drop(screen.getByTestId('sidebar-session-agent:main:pinned-first'), { dataTransfer });

    await waitFor(() => expect(pinChat).toHaveBeenCalledWith(
      'agent:main:pinned-second',
      true,
      'agent:main:pinned-first',
    ));
  });

  it('starts moving a chat on the first gesture and inserts above from the upper half', async () => {
    const moveChat = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      sessions: [
        { key: 'agent:main:first', displayName: 'First chat', updatedAt: Date.now() },
        { key: 'agent:main:second', displayName: 'Second chat', updatedAt: Date.now() - 1 },
      ],
      currentSessionKey: 'agent:main:first',
      sessionLastActivity: {},
    });
    useChatOrganizationStore.setState({
      projects: [{ id: 'drag-project', name: 'Drag project', path: '/drag', order: 0 }],
      placements: [
        { chatKey: 'agent:main:first', projectId: 'drag-project', folderId: null, order: 0 },
        { chatKey: 'agent:main:second', projectId: 'drag-project', folderId: null, order: 1 },
      ],
      moveChat,
    });

    renderSidebar();

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue(''),
      types: ['text/openx-chat'],
    };
    const firstChat = screen.getByTestId('sidebar-session-agent:main:first');

    fireEvent.dragStart(firstChat, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledTimes(1);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/openx-chat', 'agent:main:first');
    expect(dataTransfer.effectAllowed).toBe('move');
    const secondChat = screen.getByTestId('sidebar-session-agent:main:second');
    secondChat.getBoundingClientRect = () => ({
      x: 0, y: 100, top: 100, right: 200, bottom: 132, left: 0, width: 200, height: 32,
      toJSON: () => ({}),
    });
    const upperHalfDragOver = createEvent.dragOver(secondChat, { dataTransfer });
    Object.defineProperty(upperHalfDragOver, 'clientY', { value: 104 });
    fireEvent(secondChat, upperHalfDragOver);
    expect(screen.getByTestId('sidebar-chat-drop-indicator')).toHaveAttribute('data-edge', 'top');
    expect(dataTransfer.dropEffect).toBe('move');
    fireEvent.drop(screen.getByTestId('sidebar-session-agent:main:second'), { dataTransfer });
    await waitFor(() => expect(moveChat).toHaveBeenCalledWith(
      'agent:main:first',
      'drag-project',
      null,
      'agent:main:second',
    ));
  });

  it('uses a subdued neutral target when returning a project chat to the main session list', () => {
    useChatStore.setState({
      sessions: [
        { key: 'agent:main:project-chat', displayName: 'Project chat', updatedAt: Date.now() },
        { key: 'agent:main:main-chat', displayName: 'Main chat', updatedAt: Date.now() - 1 },
      ],
      currentSessionKey: 'agent:main:project-chat',
      sessionLastActivity: {},
    });
    useChatOrganizationStore.setState({
      projects: [{ id: 'project', name: 'Project', path: '/project', order: 0 }],
      placements: [{ chatKey: 'agent:main:project-chat', projectId: 'project', folderId: null, order: 0 }],
    });
    renderSidebar();

    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('agent:main:project-chat'),
      types: ['text/openx-chat'],
    };
    fireEvent.dragStart(screen.getByTestId('sidebar-session-agent:main:project-chat'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('sidebar-section-sessions'), { dataTransfer });

    expect(screen.getByTestId('sidebar-section-sessions')).toHaveClass('bg-black/[0.045]', 'dark:bg-white/[0.055]');
    expect(screen.queryByTestId('sidebar-session-list-drop-indicator')).not.toBeInTheDocument();
  });

  it('renames the already active chat with one click', () => {
    useChatStore.setState({
      sessions: [{ key: 'agent:main:active', displayName: 'Active chat', updatedAt: Date.now() }],
      currentSessionKey: 'agent:main:active',
      sessionLastActivity: {},
      renameSession: vi.fn().mockResolvedValue(undefined),
    });

    renderSidebar();

    const activeChat = screen.getByTestId('sidebar-session-agent:main:active');
    expect(screen.getByText('Active chat').parentElement).toHaveStyle({
      maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)',
    });
    fireEvent.click(activeChat);

    expect(screen.getByTestId('sidebar-chat-rename-input')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-chat-rename-input')).toHaveValue('Active chat');
  });

  it('renders pinned projects and folders only in the pinned section', () => {
    useChatOrganizationStore.setState({
      projects: [
        { id: 'regular-project', name: 'Regular project', path: '/regular', order: 0 },
        { id: 'pinned-project', name: 'Pinned project', path: '/pinned', order: 1 },
      ],
      folders: [
        { id: 'pinned-folder', projectId: 'regular-project', parentId: null, name: 'Pinned folder', path: '/regular/pinned-folder', order: 0 },
      ],
      pinnedProjectIds: ['pinned-project'],
      pinnedFolderIds: ['pinned-folder'],
    });

    renderSidebar();

    expect(screen.getAllByTestId('sidebar-project-pinned-project')).toHaveLength(1);
    expect(screen.getAllByTestId('sidebar-folder-pinned-folder')).toHaveLength(1);
    expect(screen.getAllByText('Pinned project')).toHaveLength(1);
    expect(screen.getAllByText('Pinned folder')).toHaveLength(1);
  });

  it('uses the shared OpenX confirmation dialog when deleting a chat', async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({
      sessions: [{ key: 'agent:main:delete-me', displayName: 'Delete me', updatedAt: Date.now() }],
      currentSessionKey: 'agent:main:delete-me',
      sessionLastActivity: { 'agent:main:delete-me': Date.now() },
      deleteSession,
    });

    renderSidebar();
    fireEvent.contextMenu(screen.getByTestId('sidebar-session-agent:main:delete-me'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete chat?')).toBeInTheDocument();
    expect(screen.getByText('Delete “Delete me” and its OpenClaw transcript?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('agent:main:delete-me'));
  });
});
