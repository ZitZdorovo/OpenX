import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Bot, ChevronDown, ChevronRight, Clock, Cpu, Folder, FolderOpen,
  FolderPlus, MoreHorizontal, Network, Pencil, Pin, Plus, Puzzle, Search,
  CircleArrowUp, Settings, SquareTerminal, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { useChatOrganizationStore } from '@/stores/chat-organization';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useSessionAttentionStore } from '@/stores/session-attention';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import { getSessionDisplayTitle } from '@shared/chat/session-title';
import { projectSessionRunState } from '@/stores/chat/session-status';
import { groupSessionsByWorkspace } from '@/components/layout/session-buckets';
import { useTranslation } from 'react-i18next';
import type { ChatFolder, ChatProject } from '@shared/types/chat-organization';
import type { ChatSession } from '@shared/chat/types';
import { toast } from 'sonner';
import { DEFAULT_WORKSPACE_CWD } from '@/lib/workspace-context';

type DropTarget = { projectId: string; folderId: string | null; beforeChatKey?: string };
type NodeContextMenu = { kind: 'project' | 'folder'; id: string; x: number; y: number };
type DeleteTarget =
  | { kind: 'chat'; id: string; name: string }
  | { kind: 'project' | 'folder'; id: string; name: string };

function OverflowMarqueeText({ children, fadeTail = false }: { children: string; fadeTail?: boolean }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);

  useLayoutEffect(() => {
    const measure = () => setOverflow(Math.max(0, (textRef.current?.scrollWidth ?? 0) - (viewportRef.current?.clientWidth ?? 0)));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    if (textRef.current) observer?.observe(textRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children]);

  const motionStyle = {
    transform: hovered && overflow > 0 ? `translateX(-${overflow}px)` : 'translateX(0)',
    transitionDuration: `${Math.max(500, overflow * 28)}ms`,
    transitionDelay: hovered ? '260ms' : '0ms',
  } satisfies CSSProperties;

  return (
    <span
      ref={viewportRef}
      draggable={false}
      className="relative min-w-0 flex-1 select-none overflow-hidden whitespace-nowrap"
      style={fadeTail ? {
        WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)',
        maskImage: 'linear-gradient(to right, black calc(100% - 28px), transparent)',
      } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span ref={textRef} draggable={false} className="inline-block select-none will-change-transform transition-transform ease-linear" style={motionStyle}>{children}</span>
    </span>
  );
}

const NAV_ITEMS = [
  { to: '/models', label: 'nav.models', icon: Cpu, testId: 'sidebar-nav-models' },
  { to: '/agents', label: 'nav.agents', icon: Bot, testId: 'sidebar-nav-agents' },
  { to: '/channels', label: 'nav.channels', icon: Network, testId: 'sidebar-nav-channels' },
  { to: '/skills', label: 'nav.skills', icon: Puzzle, testId: 'sidebar-nav-skills' },
  { to: '/cron', label: 'nav.cron', icon: Clock, testId: 'sidebar-nav-cron' },
];

function matchesQuery(session: ChatSession, labels: Record<string, string>, query: string): boolean {
  return !query || getSessionDisplayTitle(session, labels).toLocaleLowerCase().includes(query);
}

function getSessionAgentId(sessionKey: string): string {
  return sessionKey.split(':')[1] || 'main';
}

function formatRelativeTime(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const isRussian = locale.toLocaleLowerCase().startsWith('ru');
  if (elapsedSeconds < 60) return isRussian ? '<1м' : '<1m';
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}${isRussian ? 'м' : 'm'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${isRussian ? 'ч' : 'h'}`;
  const days = Math.floor(hours / 24);
  return `${days}${isRussian ? 'д' : 'd'}`;
}

function SectionHeader({ title, collapsed, onToggle, action }: { title: string; collapsed: boolean; onToggle: () => void; action?: ReactNode }) {
  return (
    <div className="group/section flex h-8 items-center gap-1 px-3 text-[15px] font-semibold text-muted-foreground">
      <button type="button" className="group flex min-w-0 flex-1 self-stretch items-center gap-1.5 text-left hover:text-foreground" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="truncate">{title}</span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-within:opacity-100', !collapsed && 'rotate-90')} />
      </button>
      {action && <div className="ml-auto opacity-0 transition-opacity duration-200 group-hover/section:opacity-100 group-focus-within/section:opacity-100">{action}</div>}
    </div>
  );
}

function AnimatedSectionContent({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100')}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function DropInsertionIndicator({ testId, edge = 'bottom' }: { testId?: string; edge?: 'top' | 'bottom' }) {
  return (
    <span
      data-testid={testId}
      data-edge={edge}
      className={cn(
        'pointer-events-none absolute left-5 right-2 z-20 h-px bg-sky-500',
        edge === 'top' ? 'top-0' : 'bottom-0',
      )}
    >
      <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full border-2 border-sky-500 bg-surface-sidebar" />
    </span>
  );
}

export function Sidebar() {
  const { t, i18n } = useTranslation('organization');
  const navigate = useNavigate();
  const collapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const width = useSettingsStore((state) => state.sidebarWidth);
  const setCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth);
  const setWorkspace = useSettingsStore((state) => state.setChatWorkspacePath);
  const agentBadgeMode = useSettingsStore((state) => state.agentBadgeMode);
  const agentBadgeAliases = useSettingsStore((state) => state.agentBadgeAliases);
  const agents = useAgentsStore((state) => state.agents);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const gateway = useGatewayStore((state) => state.status);
  const updateStatus = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const sessions = useChatStore((state) => state.sessions);
  const currentKey = useChatStore((state) => state.currentSessionKey);
  const labels = useChatStore((state) => state.sessionLabels);
  const switchSession = useChatStore((state) => state.switchSession);
  const setSessionWorkspace = useChatStore((state) => state.setSessionWorkspace);
  const newSession = useChatStore((state) => state.newSession);
  const loadSessions = useChatStore((state) => state.loadSessions);
  const renameSession = useChatStore((state) => state.renameSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const sessionLastActivity = useChatStore((state) => state.sessionLastActivity);
  const attention = useSessionAttentionStore((state) => state.bySessionKey);
  const markRead = useSessionAttentionStore((state) => state.markRead);
  const organization = useChatOrganizationStore();
  const loadOrganization = organization.load;
  const workspaceLabels = useSettingsStore((state) => state.workspaceLabels);
  const chatWorkspacePath = useSettingsStore((state) => state.chatWorkspacePath);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [sessionListCollapsed, setSessionListCollapsed] = useState(false);
  const [collapsedWorkspacePaths, setCollapsedWorkspacePaths] = useState<string[]>([]);
  const [draggedChat, setDraggedChat] = useState<string | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [chatDropEdge, setChatDropEdge] = useState<'top' | 'bottom'>('bottom');
  const [chatContextMenu, setChatContextMenu] = useState<{ chatKey: string; x: number; y: number } | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenu | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [editingChatKey, setEditingChatKey] = useState<string | null>(null);
  const [editingChatValue, setEditingChatValue] = useState('');
  const [renamingChatKey, setRenamingChatKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [triggerArmed, setTriggerArmed] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameCancelledRef = useRef(false);
  const draggedChatRef = useRef<string | null>(null);
  const resizingWidthRef = useRef<number | null>(null);
  const revealArmedRef = useRef(true);
  const resizingGestureRef = useRef(false);

  useEffect(() => {
    if (!collapsed) {
      revealArmedRef.current = true;
      setTriggerArmed(true);
      return;
    }
    setHoverExpanded(false);
    setTriggerArmed(false);
    revealArmedRef.current = false;
    let transitionComplete = false;
    let lastPointerX = 0;
    const armAfterLeavingEdge = (event: globalThis.PointerEvent) => {
      lastPointerX = event.clientX;
      if (!transitionComplete || event.clientX <= 12) return;
      revealArmedRef.current = true;
      setTriggerArmed(true);
      window.removeEventListener('pointermove', armAfterLeavingEdge);
    };
    const transitionTimer = window.setTimeout(() => {
      transitionComplete = true;
      if (lastPointerX <= 12) return;
      revealArmedRef.current = true;
      setTriggerArmed(true);
      window.removeEventListener('pointermove', armAfterLeavingEdge);
    }, 220);
    window.addEventListener('pointermove', armAfterLeavingEdge);
    return () => {
      window.clearTimeout(transitionTimer);
      window.removeEventListener('pointermove', armAfterLeavingEdge);
    };
  }, [collapsed]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    resizingGestureRef.current = true;
    resizeHandle.setPointerCapture(pointerId);
    const sidebarLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let hiddenDuringResize = false;

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const pointerWidth = Math.round(pointerEvent.clientX - sidebarLeft);
      if (pointerWidth <= 24) {
        hiddenDuringResize = true;
        revealArmedRef.current = false;
        setTriggerArmed(false);
        setCollapsed(true);
        return;
      }
      if (hiddenDuringResize) {
        hiddenDuringResize = false;
        revealArmedRef.current = true;
        setTriggerArmed(true);
        setCollapsed(false);
      }
      const nextWidth = Math.min(520, Math.max(240, pointerWidth));
      resizingWidthRef.current = nextWidth;
      setResizingWidth(nextWidth);
    };
    const finishResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      resizingGestureRef.current = false;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      const nextWidth = resizingWidthRef.current ?? width;
      resizingWidthRef.current = null;
      setResizingWidth(null);
      setSidebarWidth(nextWidth);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize, { once: true });
    window.addEventListener('pointercancel', finishResize, { once: true });
  };

  const connectionLabel = gateway.errorCode === 'unauthorized'
    ? t('connection.unauthorized')
    : gateway.errorCode === 'pairing-required'
      ? t('connection.pairingRequired')
    : gateway.errorCode === 'origin-not-allowed'
      ? t('connection.originNotAllowed')
    : gateway.state === 'reconnecting'
      ? t('connection.reconnecting', { count: gateway.reconnectAttempts ?? 1 })
      : gateway.errorCode === 'unreachable'
        ? t('connection.unreachable')
        : gateway.state === 'running'
          ? t('common:status.connected')
          : t('connection.disconnected');
  const isGatewayConnected = gateway.state === 'running' && gateway.gatewayReady !== false;
  const hasGatewayError = gateway.state === 'error' || Boolean(gateway.errorCode);
  const gatewayStatusColor = isGatewayConnected
    ? 'bg-green-500'
    : hasGatewayError
      ? 'bg-red-500'
      : 'bg-yellow-500';
  const gatewayIconColor = isGatewayConnected
    ? 'text-green-600 dark:text-green-400'
    : hasGatewayError
      ? 'text-red-600 dark:text-red-400'
      : 'text-yellow-700 dark:text-yellow-400';
  const showUpdateIndicator = updateStatus === 'available'
    || updateStatus === 'downloading'
    || updateStatus === 'downloaded';
  const updateLabel = updateStatus === 'downloaded'
    ? t('update.ready', { version: updateInfo?.version ?? '' })
    : updateStatus === 'downloading'
      ? t('update.downloading', { version: updateInfo?.version ?? '' })
      : t('update.available', { version: updateInfo?.version ?? '' });

  useEffect(() => { void loadOrganization().catch(() => {}); }, [loadOrganization]);
  useEffect(() => {
    if (gateway.state === 'running' && gateway.gatewayReady !== false) void loadSessions();
  }, [gateway.connectedAt, gateway.gatewayReady, gateway.state, loadSessions]);
  useEffect(() => {
    if (gateway.state === 'running' && gateway.gatewayReady !== false) void fetchAgents();
  }, [fetchAgents, gateway.connectedAt, gateway.gatewayReady, gateway.state]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);
  useEffect(() => {
    if (!chatContextMenu && !nodeContextMenu) return;
    const close = () => {
      setChatContextMenu(null);
      setNodeContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('blur', close);
    };
  }, [chatContextMenu, nodeContextMenu]);

  const sessionByKey = useMemo(() => new Map(sessions.map((session) => [session.key, session])), [sessions]);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const getAgentDisplayName = (sessionKey: string): string | null => {
    if (agentBadgeMode === 'hidden') return null;
    const agentId = getSessionAgentId(sessionKey);
    const fullName = agentById.get(agentId)?.name?.trim()
      || agentId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    if (agentBadgeMode === 'initial') return Array.from(fullName)[0]?.toLocaleUpperCase() || null;
    if (agentBadgeMode === 'custom') return agentBadgeAliases[agentId]?.trim() || fullName;
    return fullName;
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const pinnedSessions = organization.pinnedChatKeys
    .map((key) => sessionByKey.get(key))
    .filter((session): session is ChatSession => Boolean(session));
  const pinnedProjects = organization.pinnedProjectIds
    .map((id) => organization.projects.find((project) => project.id === id))
    .filter((project): project is ChatProject => Boolean(project));
  const pinnedFolders = organization.pinnedFolderIds
    .map((id) => organization.folders.find((folder) => folder.id === id))
    .filter((folder): folder is ChatFolder => Boolean(folder))
    .filter((folder) => !organization.pinnedProjectIds.includes(folder.projectId));
  const searchResults = sessions
    .filter((session) => matchesQuery(session, labels, normalizedQuery))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const placementByKey = useMemo(() => new Map(organization.placements.map((item) => [item.chatKey, item])), [organization.placements]);
  const workspaceGroups = useMemo(() => groupSessionsByWorkspace(
    sessions.filter((session) => !placementByKey.has(session.key) && !organization.pinnedChatKeys.includes(session.key)),
    sessionLastActivity,
    t('defaultWorkspace'),
    chatWorkspacePath,
    workspaceLabels,
    organization.projects.map((project) => project.path),
  ), [chatWorkspacePath, organization.pinnedChatKeys, organization.projects, placementByKey, sessionLastActivity, sessions, t, workspaceLabels]);
  const sessionsForNode = (project: ChatProject, folderId: string | null) => sessions
    .filter((session) => {
      const placement = placementByKey.get(session.key);
      return placement?.projectId === project.id && placement.folderId === folderId;
    })
    .sort((left, right) => {
      const leftOrder = placementByKey.get(left.key)?.order;
      const rightOrder = placementByKey.get(right.key)?.order;
      if (leftOrder !== undefined || rightOrder !== undefined) return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });

  const workspaceForNode = (project: ChatProject, folderId?: string | null): string => (
    (folderId ? organization.folders.find((folder) => folder.id === folderId)?.path : null) || project.path
  );

  const selectChat = (session: ChatSession, project?: ChatProject, folderId?: string | null) => {
    if (project) {
      const workspacePath = workspaceForNode(project, folderId);
      setSessionWorkspace(session.key, workspacePath);
      setWorkspace(workspacePath);
    }
    switchSession(session.key);
    markRead(session.key);
    navigate('/');
  };

  const dropChat = async (event: DragEvent, target: DropTarget) => {
    event.preventDefault();
    const folderKey = draggedFolder || event.dataTransfer.getData('text/openx-folder');
    if (folderKey) {
      await organization.moveFolder(folderKey, target.projectId, target.folderId);
      setDraggedFolder(null);
      setDropTargetId(null);
      return;
    }
    const key = draggedChatRef.current || draggedChat || event.dataTransfer.getData('text/openx-chat');
    if (!key) return;
    await organization.moveChat(key, target.projectId, target.folderId, target.beforeChatKey);
    const project = organization.projects.find((entry) => entry.id === target.projectId);
    if (project) {
      const workspacePath = workspaceForNode(project, target.folderId);
      setSessionWorkspace(key, workspacePath);
      if (key === currentKey) setWorkspace(workspacePath);
    }
    if (organization.pinnedChatKeys.includes(key)) await organization.pinChat(key, false);
    draggedChatRef.current = null;
    setDraggedChat(null);
    setDropTargetId(null);
  };

  const moveChatTo = async (chatKey: string, project: ChatProject, folderId: string | null) => {
    await organization.moveChat(chatKey, project.id, folderId);
    const workspacePath = workspaceForNode(project, folderId);
    setSessionWorkspace(chatKey, workspacePath);
    if (chatKey === currentKey) setWorkspace(workspacePath);
    if (organization.pinnedChatKeys.includes(chatKey)) await organization.pinChat(chatKey, false);
    setChatContextMenu(null);
  };

  const removeChatFromProject = async (chatKey: string) => {
    await organization.unplaceChat(chatKey, DEFAULT_WORKSPACE_CWD);
    setSessionWorkspace(chatKey, DEFAULT_WORKSPACE_CWD);
    if (chatKey === currentKey) setWorkspace(DEFAULT_WORKSPACE_CWD);
    setChatContextMenu(null);
  };

  const toggleChatPinned = async (chatKey: string, pinned: boolean, beforeChatKey?: string | null) => {
    if (pinned) {
      const placement = placementByKey.get(chatKey);
      if (placement) {
        const project = organization.projects.find((entry) => entry.id === placement.projectId);
        if (project) await organization.unplaceChat(chatKey, workspaceForNode(project, placement.folderId));
      }
      await organization.pinChat(chatKey, true, beforeChatKey);
    } else {
      await organization.pinChat(chatKey, false);
      if (!placementByKey.has(chatKey)) {
        await organization.unplaceChat(chatKey, DEFAULT_WORKSPACE_CWD);
        setSessionWorkspace(chatKey, DEFAULT_WORKSPACE_CWD);
        if (chatKey === currentKey) setWorkspace(DEFAULT_WORKSPACE_CWD);
      }
    }
  };

  const restoreChatToDefault = async (chatKey: string) => {
    if (organization.pinnedChatKeys.includes(chatKey)) await organization.pinChat(chatKey, false);
    await removeChatFromProject(chatKey);
    draggedChatRef.current = null;
    setDraggedChat(null);
    setDropTargetId(null);
  };

  const deleteChat = async (chatKey: string) => {
    if (organization.pinnedChatKeys.includes(chatKey)) await organization.pinChat(chatKey, false);
    if (placementByKey.has(chatKey)) await organization.unplaceChat(chatKey, DEFAULT_WORKSPACE_CWD);
    await deleteSession(chatKey);
    setChatContextMenu(null);
  };

  const chooseProjectPath = async () => {
    const result = await hostApi.dialog.open({ title: t('chooseFolder'), properties: ['openDirectory', 'createDirectory'] });
    const path = result.filePaths?.[0];
    if (!result.canceled && path) {
      setProjectPath(path);
      if (!projectName.trim()) setProjectName(path.split(/[\\/]/).filter(Boolean).at(-1) || 'Project');
    }
  };

  const createProject = async () => {
    if (!projectPath.trim()) return;
    setSavingProject(true);
    try {
      await organization.createProject(projectName, projectPath);
      setProjectDialogOpen(false);
      setProjectName('');
      setProjectPath('');
    } finally { setSavingProject(false); }
  };

  const createFolder = async (projectId: string, parentId?: string | null) => {
    const name = window.prompt(t('folderName'));
    if (name?.trim()) await organization.createFolder(projectId, name.trim(), parentId);
  };

  const renameNode = async (kind: 'project' | 'folder', id: string, current: string) => {
    const name = window.prompt(t('renameNode', { kind }), current);
    if (name?.trim() && name.trim() !== current) await organization.rename(kind, id, name.trim());
  };

  const deleteOrganizationNode = async (kind: 'project' | 'folder', id: string) => {
    const folderIds = kind === 'folder'
      ? new Set(organization.folders
        .filter((folder) => folder.id === id || isFolderInside(folder.id, id))
        .map((folder) => folder.id))
      : null;
    const affectedChatKeys = organization.placements
      .filter((placement) => kind === 'project'
        ? placement.projectId === id
        : placement.folderId !== null && folderIds?.has(placement.folderId))
      .map((placement) => placement.chatKey);

    if (kind === 'project') await organization.deleteProject(id, true);
    else await organization.deleteFolder(id, true);

    for (const chatKey of affectedChatKeys) setSessionWorkspace(chatKey, DEFAULT_WORKSPACE_CWD);
    if (currentKey && affectedChatKeys.includes(currentKey)) setWorkspace(DEFAULT_WORKSPACE_CWD);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'chat') await deleteChat(deleteTarget.id);
    else await deleteOrganizationNode(deleteTarget.kind, deleteTarget.id);
    setDeleteTarget(null);
  };

  const openNodeMenu = (kind: 'project' | 'folder', id: string, x: number, y: number) => {
    setChatContextMenu(null);
    setNodeContextMenu({ kind, id, x, y });
  };

  const isFolderInside = (candidateId: string, ancestorId: string): boolean => {
    let current = organization.folders.find((folder) => folder.id === candidateId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = organization.folders.find((folder) => folder.id === current?.parentId);
    }
    return false;
  };

  const beginChatRename = (session: ChatSession) => {
    renameCancelledRef.current = false;
    setEditingChatKey(session.key);
    setEditingChatValue(getSessionDisplayTitle(session, labels));
  };

  const commitChatRename = async (session: ChatSession) => {
    if (editingChatKey !== session.key) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      setEditingChatKey(null);
      return;
    }
    const nextTitle = editingChatValue.trim();
    setEditingChatKey(null);
    if (!nextTitle || nextTitle === getSessionDisplayTitle(session, labels)) return;
    setRenamingChatKey(session.key);
    try {
      await renameSession(session.key, nextTitle);
    } catch (error) {
      toast.error(t('renameFailed', { error: String(error) }));
    } finally {
      setRenamingChatKey(null);
    }
  };

  const ChatRow = ({ session, project, folderId, sessionList = false }: { session: ChatSession; project?: ChatProject; folderId?: string | null; sessionList?: boolean }) => {
    const busy = projectSessionRunState(session) === 'busy';
    const unread = attention[session.key]?.unread;
    const pinned = organization.pinnedChatKeys.includes(session.key);
    return (
      <div
        role="button"
        tabIndex={0}
        aria-current={currentKey === session.key ? 'page' : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/openx-chat', session.key);
          draggedChatRef.current = session.key;
        }}
        onDragEnd={() => {
          draggedChatRef.current = null;
          setDraggedChat(null);
          setDropTargetId(null);
        }}
        onDragOver={(event) => {
          const sourceKey = draggedChatRef.current || draggedChat;
          if (sourceKey === session.key) {
            if (pinned) {
              event.preventDefault();
              event.stopPropagation();
            }
            return;
          }
          if (!project && !pinned) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          const rowRect = event.currentTarget.getBoundingClientRect();
          setChatDropEdge(event.clientY < rowRect.top + rowRect.height / 2 ? 'top' : 'bottom');
          setDraggedChat(sourceKey);
          setDropTargetId(`chat:${session.key}`);
        }}
        onDrop={(event) => {
          if (pinned) {
            event.preventDefault();
            event.stopPropagation();
            const sourceKey = draggedChatRef.current || draggedChat || event.dataTransfer.getData('text/openx-chat');
            if (!sourceKey || sourceKey === session.key) return;
            const siblings = organization.pinnedChatKeys.filter((key) => key !== sourceKey);
            const targetIndex = siblings.indexOf(session.key);
            const beforeChatKey = chatDropEdge === 'top'
              ? session.key
              : siblings[targetIndex + 1];
            void toggleChatPinned(sourceKey, true, beforeChatKey);
            draggedChatRef.current = null;
            setDraggedChat(null);
            setDropTargetId(null);
            return;
          }
          if (project) {
            event.stopPropagation();
            const sourceKey = draggedChatRef.current || draggedChat;
            const siblings = sessionsForNode(project, folderId ?? null).filter((entry) => entry.key !== sourceKey);
            const targetIndex = siblings.findIndex((entry) => entry.key === session.key);
            const beforeChatKey = chatDropEdge === 'top'
              ? session.key
              : siblings[targetIndex + 1]?.key;
            void dropChat(event, { projectId: project.id, folderId: folderId ?? null, beforeChatKey });
          }
        }}
        onClick={() => selectChat(session, project, folderId)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          selectChat(session, project, folderId);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setNodeContextMenu(null);
          setChatContextMenu({ chatKey: session.key, x: event.clientX, y: event.clientY });
        }}
        className={cn(
          'group relative mx-1 my-0.5 flex min-h-8 select-none items-center gap-1 rounded-lg px-2.5 py-1 text-meta transition-[background-color,box-shadow,opacity] cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          draggedChat === session.key && 'opacity-55',
          currentKey === session.key
            ? 'bg-black/[0.07] font-medium text-foreground dark:bg-white/[0.09]'
            : 'text-foreground/75 hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.08]',
        )}
        data-testid={`sidebar-session-${session.key}`}
      >
        {dropTargetId === `chat:${session.key}` && draggedChat !== session.key && (
          <DropInsertionIndicator testId="sidebar-chat-drop-indicator" edge={chatDropEdge} />
        )}
        {sessionList && getAgentDisplayName(session.key) && <span draggable={false} className="mr-1 max-w-24 shrink-0 select-none truncate rounded bg-black/[0.06] px-1.5 py-0.5 text-2xs font-semibold text-foreground/70 dark:bg-white/[0.08]" title={agentById.get(getSessionAgentId(session.key))?.name}>{getAgentDisplayName(session.key)}</span>}
        <OverflowMarqueeText fadeTail>{getSessionDisplayTitle(session, labels)}</OverflowMarqueeText>
        {busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse bg-amber-400" title={t('typing')} />}
        {!busy && unread && <span className="h-1.5 w-1.5 shrink-0 bg-sky-400" title={t('newMessage')} />}
        {sessionList && !busy && !unread && (
          <span
            draggable={false}
            className="shrink-0 select-none tabular-nums text-2xs text-muted-foreground/75 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
            title={session.updatedAt ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(session.updatedAt) : undefined}
          >
            {formatRelativeTime(session.updatedAt, i18n.language)}
          </span>
        )}
        <button
          className={cn(
            'no-drag absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity hover:bg-black/5 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10',
            pinned && 'opacity-70 text-primary',
          )}
          title={pinned ? t('unpin') : t('pin')}
          onClick={(event) => { event.stopPropagation(); void toggleChatPinned(session.key, !pinned); }}
        >
          <Pin className="h-3 w-3" />
        </button>
      </div>
    );
  };

  const FolderNode = ({ folder, project, depth }: { folder: ChatFolder; project: ChatProject; depth: number }) => {
    const isCollapsed = organization.collapsedFolderIds.includes(folder.id);
    const isPinned = organization.pinnedFolderIds.includes(folder.id);
    const children = organization.folders
      .filter((candidate) => candidate.parentId === folder.id && !organization.pinnedFolderIds.includes(candidate.id))
      .sort((a, b) => a.order - b.order);
    const rows = sessionsForNode(project, folder.id);
    return (
      <div style={{ marginLeft: depth * 10 }}>
        <div
          data-testid={`sidebar-folder-${folder.id}`}
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          draggable
          className={cn(
            'group relative mx-1 my-0.5 flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-meta text-foreground/75 transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5',
            draggedFolder === folder.id && 'opacity-55',
            dropTargetId === `folder:${folder.id}` && 'text-foreground',
          )}
          onClick={() => void organization.setCollapsed('folder', !isCollapsed, folder.id)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            void organization.setCollapsed('folder', !isCollapsed, folder.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openNodeMenu('folder', folder.id, event.clientX, event.clientY);
          }}
          onDragStart={(event) => {
            event.stopPropagation();
            setDraggedFolder(folder.id);
            event.dataTransfer.setData('text/openx-folder', folder.id);
          }}
          onDragEnd={() => { setDraggedFolder(null); setDropTargetId(null); }}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDropTargetId(`folder:${folder.id}`); }}
          onDrop={(event) => { event.stopPropagation(); void dropChat(event, { projectId: project.id, folderId: folder.id }); }}
        >
          {dropTargetId === `folder:${folder.id}` && <DropInsertionIndicator testId="sidebar-folder-drop-indicator" />}
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {isCollapsed ? <Folder className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />}
          <OverflowMarqueeText>{folder.name}</OverflowMarqueeText>
          <button
            type="button"
            draggable={false}
            className={cn('no-drag rounded p-0.5 opacity-0 hover:bg-black/5 hover:text-foreground group-hover:opacity-80 group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10', isPinned && 'text-primary')}
            title={t('actions')}
            aria-label={t('actions')}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openNodeMenu('folder', folder.id, rect.right, rect.bottom);
            }}
          ><MoreHorizontal className="h-3.5 w-3.5" /></button>
        </div>
        <AnimatedSectionContent collapsed={isCollapsed}>
          <div>
            {children.map((child) => <FolderNode key={child.id} folder={child} project={project} depth={depth + 1} />)}
            <div className="pl-5">{rows.map((session) => <ChatRow key={session.key} session={session} project={project} folderId={folder.id} />)}</div>
          </div>
        </AnimatedSectionContent>
      </div>
    );
  };

  const ProjectNode = ({ project }: { project: ChatProject }) => {
    const isCollapsed = organization.collapsedProjectIds.includes(project.id);
    const isPinned = organization.pinnedProjectIds.includes(project.id);
    const folders = organization.folders
      .filter((folder) => folder.projectId === project.id
        && folder.parentId === null
        && !organization.pinnedFolderIds.includes(folder.id))
      .sort((a, b) => a.order - b.order);
    const rows = sessionsForNode(project, null);
    return (
      <section
        data-testid={`sidebar-project-${project.id}`}
        className="relative mb-2 rounded-lg last:mb-0"
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDraggedChat(draggedChatRef.current); setDropTargetId(`project:${project.id}`); }}
        onDrop={(event) => void dropChat(event, { projectId: project.id, folderId: null })}
      >
        {dropTargetId === `project:${project.id}` && <DropInsertionIndicator testId="sidebar-project-drop-indicator" />}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          className="group mx-1 flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-meta font-semibold text-foreground/75 transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5"
          onClick={() => void organization.setCollapsed('project', !isCollapsed, project.id)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            void organization.setCollapsed('project', !isCollapsed, project.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openNodeMenu('project', project.id, event.clientX, event.clientY);
          }}
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
          <OverflowMarqueeText>{project.name}</OverflowMarqueeText>
          <button
            type="button"
            className={cn('rounded p-0.5 opacity-0 hover:bg-black/5 hover:text-foreground group-hover:opacity-80 group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10', isPinned && 'text-primary')}
            title={t('actions')}
            aria-label={t('actions')}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openNodeMenu('project', project.id, rect.right, rect.bottom);
            }}
          ><MoreHorizontal className="h-3.5 w-3.5" /></button>
        </div>
        <AnimatedSectionContent collapsed={isCollapsed}>
          <div>
            {folders.map((folder) => <FolderNode key={folder.id} folder={folder} project={project} depth={0} />)}
            <div className="pl-5">{rows.map((session) => <ChatRow key={session.key} session={session} project={project} folderId={null} />)}</div>
          </div>
        </AnimatedSectionContent>
      </section>
    );
  };

  return (
    <>
      {collapsed && (
        <div
          aria-hidden="true"
          data-testid="sidebar-hover-trigger"
          className={cn(
            'absolute inset-y-0 left-0 z-40 w-2 bg-transparent transition-colors duration-150 hover:bg-primary/20',
            triggerArmed ? 'pointer-events-auto' : 'pointer-events-none',
          )}
          onPointerMove={(event) => {
            if (event.clientX <= 8 && !resizingGestureRef.current && revealArmedRef.current) setHoverExpanded(true);
          }}
        />
      )}
      <div
        className={cn(
          'relative min-h-0 self-stretch shrink-0 transition-[width,min-width,max-width] duration-180 ease-out',
          collapsed
            ? 'w-0 min-w-0 max-w-0'
            : 'w-[min(var(--sidebar-width),38vw)] min-w-[240px] max-w-[520px] max-[900px]:!w-[240px] max-[900px]:!min-w-[240px] max-[900px]:!max-w-[240px]',
        )}
        style={{
          '--sidebar-width': `${resizingWidth ?? width}px`,
          ...(!collapsed && resizingWidth !== null ? {
            width: `${resizingWidth}px`,
            minWidth: `${resizingWidth}px`,
            maxWidth: `${resizingWidth}px`,
          } : {}),
        } as CSSProperties}
        data-testid="sidebar-layout-slot"
      >
        <aside
          className={cn(
            'absolute inset-y-0 left-0 flex w-[min(var(--sidebar-width),38vw)] min-w-[240px] max-w-[520px] flex-col overflow-hidden bg-surface-sidebar transition-[transform,box-shadow] duration-200 ease-out max-[900px]:!w-[240px] max-[900px]:!min-w-[240px] max-[900px]:!max-w-[240px]',
            collapsed ? 'z-50 shadow-2xl' : 'z-10',
            collapsed && !hoverExpanded && 'pointer-events-none',
          )}
          style={{
            '--sidebar-width': `${resizingWidth ?? width}px`,
            ...(resizingWidth !== null ? {
              width: `${resizingWidth}px`,
              minWidth: `${resizingWidth}px`,
              maxWidth: `${resizingWidth}px`,
            } : {}),
            transform: collapsed && !hoverExpanded ? 'translateX(-100vw)' : 'translateX(0)',
          } as CSSProperties}
          data-testid="sidebar"
          data-collapsed={collapsed ? 'true' : 'false'}
          data-hover-expanded={hoverExpanded ? 'true' : 'false'}
          onMouseLeave={() => {
            if (collapsed) setHoverExpanded(false);
          }}
        >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeSidebar')}
        data-testid="sidebar-resize-handle"
        onPointerDown={handleResizePointerDown}
        className="group absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize bg-transparent"
      >
        <span
          className="pointer-events-none absolute bottom-2 right-0 top-2 w-px rounded-full bg-black/[0.10] transition-colors group-hover:bg-black/[0.16] dark:bg-white/[0.10] dark:group-hover:bg-white/[0.18]"
          style={{
            WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)',
            maskImage: 'linear-gradient(to bottom, transparent, black 10px, black calc(100% - 10px), transparent)',
          }}
        />
      </div>
      <div className="flex h-11 items-center gap-1 px-3 pt-1" data-testid="openx-sidebar-header">
        <span className="min-w-0 flex-1 truncate px-1 text-base font-bold tracking-tight text-foreground" title="OpenX">OpenX</span>
        {collapsed && hoverExpanded && (
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            title={t('lockSidebar')}
            aria-label={t('lockSidebar')}
            onClick={() => {
              setCollapsed(false);
              setHoverExpanded(false);
            }}
          >
            <Pin className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          title={t('focusSearch')}
          aria-label={t('focusSearch')}
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      <div className="px-2">
        <button data-testid="sidebar-new-chat" className="sidebar-nav-text flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5" onClick={() => { newSession(); navigate('/'); }}><Plus className="h-3.5 w-3.5" />{t('newChat')}</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-1 pr-1.5" data-testid="sidebar-scroll-area">
        <nav className="flex flex-col gap-0 px-2">{NAV_ITEMS.map(({ to, label, icon: Icon, testId }) => <NavLink key={to} to={to} title={t(label)} data-testid={testId} className={({ isActive }) => cn('sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1 text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5', isActive && 'bg-black/5 text-foreground dark:bg-white/10')}><Icon className="h-3.5 w-3.5" /><span>{t(label)}</span></NavLink>)}</nav>

        <div className="mt-2 flex flex-col gap-3">
        <section
          className="relative rounded-lg"
          data-testid="sidebar-section-pinned"
          onDragOver={(event) => { event.preventDefault(); setDropTargetId('pinned'); }}
          onDrop={(event) => {
            event.preventDefault();
            const folderId = draggedFolder || event.dataTransfer.getData('text/openx-folder');
            const chatKey = draggedChatRef.current || draggedChat || event.dataTransfer.getData('text/openx-chat');
            if (folderId) void organization.pinNode('folder', folderId, true);
            if (chatKey) void toggleChatPinned(chatKey, true);
            draggedChatRef.current = null;
            setDraggedFolder(null);
            setDraggedChat(null);
            setDropTargetId(null);
          }}
        >
          {dropTargetId === 'pinned' && <DropInsertionIndicator testId="sidebar-pinned-drop-indicator" />}
          <SectionHeader title={t('pinned')} collapsed={organization.pinnedCollapsed} onToggle={() => void organization.setCollapsed('pinned', !organization.pinnedCollapsed)} />
          <AnimatedSectionContent collapsed={organization.pinnedCollapsed}>
            <div>
              {pinnedProjects.map((project) => <ProjectNode key={project.id} project={project} />)}
              {pinnedFolders.map((folder) => {
                const project = organization.projects.find((candidate) => candidate.id === folder.projectId);
                return project ? <FolderNode key={folder.id} folder={folder} project={project} depth={0} /> : null;
              })}
              {pinnedSessions.map((session) => <ChatRow key={session.key} session={session} />)}
            </div>
          </AnimatedSectionContent>
        </section>

        <section className="rounded-lg" data-testid="sidebar-section-projects">
          <SectionHeader
            title={t('projects')}
            collapsed={projectsCollapsed}
            onToggle={() => setProjectsCollapsed((value) => !value)}
            action={<button type="button" title={t('newProject')} aria-label={t('newProject')} className="rounded p-1 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10" onClick={() => setProjectDialogOpen(true)}><FolderPlus className="h-3.5 w-3.5" /></button>}
          />
          <AnimatedSectionContent collapsed={projectsCollapsed}>
            <div>{[...organization.projects]
              .filter((project) => !organization.pinnedProjectIds.includes(project.id))
              .sort((a, b) => a.order - b.order)
              .map((project) => <ProjectNode key={project.id} project={project} />)}</div>
          </AnimatedSectionContent>
        </section>

        <section
          className={cn(
            'relative rounded-lg transition-colors',
            dropTargetId === 'session-list' && 'bg-black/[0.045] dark:bg-white/[0.055]',
          )}
          data-testid="sidebar-section-sessions"
          onDragOver={(event) => {
            if (!draggedChatRef.current && !draggedChat && !event.dataTransfer.types.includes('text/openx-chat')) return;
            event.preventDefault();
            setDraggedChat(draggedChatRef.current);
            setDropTargetId('session-list');
          }}
          onDrop={(event) => {
            event.preventDefault();
            const chatKey = draggedChatRef.current || draggedChat || event.dataTransfer.getData('text/openx-chat');
            if (chatKey) void restoreChatToDefault(chatKey);
          }}
        >
          <SectionHeader title={t('sessionList')} collapsed={sessionListCollapsed} onToggle={() => setSessionListCollapsed((value) => !value)} />
          <AnimatedSectionContent collapsed={sessionListCollapsed}>
            {workspaceGroups.map((group) => {
              const workspaceCollapsed = collapsedWorkspacePaths.includes(group.workspacePath);
              return (
                <div key={group.workspacePath} data-testid="openx-workspace-session-group">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 px-3 py-1.5 text-meta font-semibold text-foreground/80 hover:text-foreground"
                    title={group.workspacePath}
                    onClick={() => setCollapsedWorkspacePaths((paths) => workspaceCollapsed ? paths.filter((path) => path !== group.workspacePath) : [...paths, group.workspacePath])}
                  >
                    {workspaceCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                    <span className="text-2xs font-normal text-muted-foreground">{group.sessions.length}</span>
                  </button>
                  {!workspaceCollapsed && group.sessions.map(({ session }) => <ChatRow key={session.key} session={session} sessionList />)}
                </div>
              );
            })}
          </AnimatedSectionContent>
        </section>

        {!organization.loading && organization.projects.length === 0 && sessions.length === 0 && <button className="mx-2 mt-3 rounded-lg border border-dashed border-border p-3 text-left text-xs text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5" onClick={() => setProjectDialogOpen(true)}>{t('empty')}</button>}
        </div>
      </div>

      <div className="mt-auto p-2">
        <div className="flex items-center gap-1">
          <NavLink to="/settings" title={t('nav.settings')} data-testid="sidebar-nav-settings" className={({ isActive }) => cn('sidebar-nav-text flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5', isActive && 'bg-black/5 text-foreground dark:bg-white/10')}><Settings className="h-4 w-4" /><span>{t('nav.settings')}</span></NavLink>
          {showUpdateIndicator && (
            <button
              type="button"
              data-testid="sidebar-update-available"
              className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-blue-600 transition-colors hover:bg-blue-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
              title={updateLabel}
              aria-label={updateLabel}
              onClick={() => navigate('/settings?section=updates')}
            >
              <CircleArrowUp className={cn('h-4 w-4', updateStatus === 'downloading' && 'animate-pulse')} />
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-surface-sidebar" />
            </button>
          )}
          <button
            type="button"
            data-testid="gateway-connection-state"
            className={cn(
              'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5',
              gatewayIconColor,
            )}
            title={gateway.error || connectionLabel}
            aria-label={connectionLabel}
            onClick={() => navigate('/settings?section=gateway')}
          >
            <Network className="h-4 w-4" />
            <span className={cn('absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-surface-sidebar', gatewayStatusColor, gateway.state === 'reconnecting' && 'animate-pulse')} />
          </button>
        </div>
      </div>

      {chatContextMenu && (() => {
        const session = sessionByKey.get(chatContextMenu.chatKey);
        const placement = placementByKey.get(chatContextMenu.chatKey);
        const pinned = organization.pinnedChatKeys.includes(chatContextMenu.chatKey);
        if (!session) return null;
        const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-foreground/85 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10';
        return createPortal(
          <div
            data-testid="chat-context-menu"
            className="fixed z-[100] max-h-[min(30rem,calc(100vh-1rem))] w-64 overflow-y-auto rounded-xl border border-black/10 bg-surface-modal p-1.5 shadow-2xl shadow-black/25 dark:border-white/10 dark:shadow-black/50"
            style={{ left: Math.max(8, Math.min(chatContextMenu.x, window.innerWidth - 272)), top: Math.max(8, Math.min(chatContextMenu.y, window.innerHeight - 360)) }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="truncate px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground" title={getSessionDisplayTitle(session, labels)}>
              {getSessionDisplayTitle(session, labels)}
            </div>
            <button type="button" className={menuItemClass} onClick={() => { void toggleChatPinned(session.key, !pinned); setChatContextMenu(null); }}>
              <Pin className="h-3.5 w-3.5" />{pinned ? t('unpin') : t('moveToPinned')}
            </button>
            <button type="button" className={menuItemClass} onClick={() => { beginChatRename(session); setChatContextMenu(null); }}>
              <Pencil className="h-3.5 w-3.5" />{t('rename')}
            </button>
            {placement && (
              <button type="button" className={menuItemClass} onClick={() => void removeChatFromProject(session.key)}>
                <FolderOpen className="h-3.5 w-3.5" />{t('removeFromProject')}
              </button>
            )}
            <div className="my-1 border-t border-border/70" />
            <div className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('moveTo')}</div>
            {[...organization.projects].sort((a, b) => a.order - b.order).map((project) => (
              <div key={project.id}>
                <button type="button" className={menuItemClass} onClick={() => void moveChatTo(session.key, project, null)}>
                  <Folder className="h-3.5 w-3.5" /><span className="truncate">{project.name}</span>
                </button>
                {organization.folders
                  .filter((folder) => folder.projectId === project.id)
                  .sort((a, b) => a.order - b.order)
                  .map((folder) => (
                    <button key={folder.id} type="button" className={cn(menuItemClass, 'pl-7')} onClick={() => void moveChatTo(session.key, project, folder.id)}>
                      <FolderOpen className="h-3.5 w-3.5" /><span className="truncate">{folder.name}</span>
                    </button>
                  ))}
              </div>
            ))}
            <div className="my-1 border-t border-border/70" />
            <button type="button" className={cn(menuItemClass, 'text-destructive hover:text-destructive')} onClick={() => { setDeleteTarget({ kind: 'chat', id: session.key, name: getSessionDisplayTitle(session, labels) }); setChatContextMenu(null); }}>
              <Trash2 className="h-3.5 w-3.5" />{t('deleteChat')}
            </button>
          </div>,
          document.body,
        );
      })()}

      {nodeContextMenu && (() => {
        const folder = nodeContextMenu.kind === 'folder'
          ? organization.folders.find((entry) => entry.id === nodeContextMenu.id)
          : undefined;
        const project = nodeContextMenu.kind === 'project'
          ? organization.projects.find((entry) => entry.id === nodeContextMenu.id)
          : organization.projects.find((entry) => entry.id === folder?.projectId);
        const node = nodeContextMenu.kind === 'project' ? project : folder;
        if (!node || !project) return null;
        const pinned = nodeContextMenu.kind === 'project'
          ? organization.pinnedProjectIds.includes(node.id)
          : organization.pinnedFolderIds.includes(node.id);
        const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-foreground/85 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10';
        const closeMenu = () => setNodeContextMenu(null);
        return createPortal(
          <div
            data-testid="node-context-menu"
            className="fixed z-[100] max-h-[min(32rem,calc(100vh-1rem))] w-64 overflow-y-auto rounded-xl border border-black/10 bg-surface-modal p-1.5 shadow-2xl shadow-black/25 dark:border-white/10 dark:shadow-black/50"
            style={{ left: Math.max(8, Math.min(nodeContextMenu.x, window.innerWidth - 272)), top: Math.max(8, Math.min(nodeContextMenu.y, window.innerHeight - 400)) }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="truncate px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground" title={node.path}>{node.name}</div>
            <button type="button" className={menuItemClass} onClick={() => { void organization.pinNode(nodeContextMenu.kind, node.id, !pinned); closeMenu(); }}>
              <Pin className="h-3.5 w-3.5" />{nodeContextMenu.kind === 'project'
                ? (pinned ? t('unpinProject') : t('pinProject'))
                : (pinned ? t('unpinFolder') : t('pinFolder'))}
            </button>
            <button type="button" className={menuItemClass} onClick={() => { void hostApi.shell.openPath(node.path); closeMenu(); }}>
              <FolderOpen className="h-3.5 w-3.5" />{t('openInExplorer')}
            </button>
            <button type="button" className={menuItemClass} onClick={() => { void hostApi.shell.openTerminal(node.path); closeMenu(); }}>
              <SquareTerminal className="h-3.5 w-3.5" />{t('openTerminalHere')}
            </button>
            <button type="button" className={menuItemClass} onClick={() => { void createFolder(project.id, folder?.id ?? null); closeMenu(); }}>
              <FolderPlus className="h-3.5 w-3.5" />{folder ? t('newSubfolder') : t('newFolder')}
            </button>
            <button type="button" className={menuItemClass} onClick={() => { void renameNode(nodeContextMenu.kind, node.id, node.name); closeMenu(); }}>
              <Pencil className="h-3.5 w-3.5" />{t('rename')}
            </button>
            {folder && (
              <>
                <div className="my-1 border-t border-border/70" />
                <div className="px-2.5 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('moveTo')}</div>
                {[...organization.projects].sort((a, b) => a.order - b.order).map((targetProject) => (
                  <div key={targetProject.id}>
                    <button type="button" className={menuItemClass} disabled={folder.projectId === targetProject.id && folder.parentId === null} onClick={() => { void organization.moveFolder(folder.id, targetProject.id, null); closeMenu(); }}>
                      <Folder className="h-3.5 w-3.5" /><span className="truncate">{targetProject.name}</span>
                    </button>
                    {organization.folders
                      .filter((candidate) => candidate.projectId === targetProject.id && candidate.id !== folder.id && !isFolderInside(candidate.id, folder.id))
                      .sort((a, b) => a.order - b.order)
                      .map((candidate) => (
                        <button key={candidate.id} type="button" className={cn(menuItemClass, 'pl-7')} disabled={folder.parentId === candidate.id} onClick={() => { void organization.moveFolder(folder.id, targetProject.id, candidate.id); closeMenu(); }}>
                          <FolderOpen className="h-3.5 w-3.5" /><span className="truncate">{candidate.name}</span>
                        </button>
                      ))}
                  </div>
                ))}
              </>
            )}
            <div className="my-1 border-t border-border/70" />
            <button type="button" className={cn(menuItemClass, 'text-destructive hover:text-destructive')} onClick={() => { setDeleteTarget({ kind: nodeContextMenu.kind, id: node.id, name: node.name }); closeMenu(); }}>
              <Trash2 className="h-3.5 w-3.5" />{t('delete')}
            </button>
          </div>,
          document.body,
        );
      })()}

      <Dialog open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setQuery(''); }}>
        <DialogContent className="max-w-[540px] overflow-hidden rounded-2xl border border-border bg-surface-modal p-0 shadow-2xl">
          <DialogTitle className="sr-only">{t('search')}</DialogTitle>
          <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
          <div className="flex h-12 items-center gap-2 border-b border-border/70 px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  const resultIndex = Number(event.key) - 1;
                  if (resultIndex >= 0 && resultIndex < 3 && searchResults[resultIndex]) {
                    event.preventDefault();
                    selectChat(searchResults[resultIndex]);
                    setSearchOpen(false);
                    return;
                  }
                  if (event.key.toLocaleLowerCase() === 'o') {
                    event.preventDefault();
                    setSearchOpen(false);
                    setProjectDialogOpen(true);
                    void chooseProjectPath();
                    return;
                  }
                }
                if (event.key === 'Enter' && searchResults[0]) {
                  selectChat(searchResults[0]);
                  setSearchOpen(false);
                }
              }}
              placeholder={t('search')}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded bg-black/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground dark:bg-white/[0.08]">Ctrl+K</kbd>
          </div>
          <div className="max-h-[480px] overflow-y-auto p-2">
            <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">{t('chats')}</div>
            {searchResults.slice(0, 8).map((session, index) => (
              <button
                key={session.key}
                type="button"
                className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                onClick={() => { selectChat(session); setSearchOpen(false); }}
              >
                <span className="min-w-0 flex-1 truncate">{getSessionDisplayTitle(session, labels)}</span>
                {getAgentDisplayName(session.key) && <span className="truncate text-xs text-muted-foreground">{getAgentDisplayName(session.key)}</span>}
                {index < 3 && <kbd className="rounded bg-black/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground dark:bg-white/[0.08]">Ctrl+{index + 1}</kbd>}
              </button>
            ))}
            {searchResults.length === 0 && <div className="px-2.5 py-3 text-xs text-muted-foreground">{t('noChatsFound')}</div>}

            {!query.trim() && (
              <>
                <div className="mt-2 px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{t('suggested')}</div>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { newSession(); navigate('/'); setSearchOpen(false); }}>
                  <Pencil className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{t('newChat')}</span><kbd className="rounded bg-black/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground dark:bg-white/[0.08]">Ctrl+N</kbd>
                </button>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { setSearchOpen(false); setProjectDialogOpen(true); void chooseProjectPath(); }}>
                  <FolderOpen className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{t('openFolder')}</span><kbd className="rounded bg-black/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground dark:bg-white/[0.08]">Ctrl+O</kbd>
                </button>

                <div className="mt-2 px-2 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{t('settingsSection')}</div>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { navigate('/settings'); setSearchOpen(false); }}><Settings className="h-4 w-4 text-muted-foreground" />{t('general')}</button>
                <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground/80 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { navigate('/models'); setSearchOpen(false); }}><Cpu className="h-4 w-4 text-muted-foreground" />{t('nav.models')}</button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border border-border bg-surface-modal p-6 shadow-2xl">
          <DialogTitle className="font-serif text-2xl font-normal tracking-tight">{t('createTitle')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('createDescription')}</DialogDescription>
          <div className="mt-4 space-y-3">
            <label className="block text-xs">{t('name')}<Input value={projectName} onChange={(event) => setProjectName(event.target.value)} className="mt-1 h-9 rounded-lg" /></label>
            <label className="block text-xs">{t('workingFolder')}<div className="mt-1 flex gap-2"><Input readOnly value={projectPath} placeholder={t('choosePlaceholder')} className="h-9 rounded-lg font-mono text-xs" /><Button variant="outline" size="sm" className="h-9 rounded-lg" onClick={() => void chooseProjectPath()}>{t('browse')}</Button></div></label>
          </div>
          <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setProjectDialogOpen(false)}>{t('cancel')}</Button><Button size="sm" onClick={() => void createProject()} disabled={!projectPath || savingProject}>{savingProject ? t('creating') : t('create')}</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingChatKey !== null}
        onOpenChange={(open) => {
          if (!open) setEditingChatKey(null);
        }}
      >
        <DialogContent className="max-w-[420px] rounded-2xl border border-border bg-surface-modal p-5 shadow-2xl">
          <DialogTitle className="text-xl font-semibold tracking-tight">{t('renameChatTitle')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('renameChatDescription')}</DialogDescription>
          <Input
            autoFocus
            data-testid="sidebar-chat-rename-input"
            value={editingChatValue}
            disabled={renamingChatKey !== null}
            className="mt-4 h-10 rounded-xl border-border bg-surface-input px-3 shadow-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setEditingChatValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditingChatKey(null);
              if (event.key === 'Enter') {
                const session = editingChatKey ? sessionByKey.get(editingChatKey) : null;
                if (session) void commitChatRename(session);
              }
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingChatKey(null)}>{t('cancel')}</Button>
            <Button
              disabled={!editingChatValue.trim() || renamingChatKey !== null}
              onClick={() => {
                const session = editingChatKey ? sessionByKey.get(editingChatKey) : null;
                if (session) void commitChatRename(session);
              }}
            >
              {t('save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.kind === 'chat'
          ? t('deleteChatTitle')
          : deleteTarget?.kind === 'project'
            ? t('deleteProjectTitle')
            : t('deleteFolderTitle')}
        message={deleteTarget?.kind === 'chat'
          ? t('deleteChatConfirm', { name: deleteTarget.name })
          : deleteTarget?.kind === 'project'
            ? t('deleteProjectConfirm', { name: deleteTarget.name })
            : t('deleteFolderConfirm', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        onError={(error) => toast.error(t('deleteFailed', { error: String(error) }))}
      />
        </aside>
      </div>
    </>
  );
}
