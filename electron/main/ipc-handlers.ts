import type { BrowserWindow, Session } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createAppApi } from '../services/app-api';
import { createOpenClawApi } from '../services/openclaw-api';
import { createShellApi } from '../services/shell-api';
import { createDialogApi } from '../services/dialog-api';
import { createWindowApi } from '../services/window-api';
import { createUpdatesApi } from '../services/updates-api';
import { createUvApi } from '../services/uv-api';
import { createGatewayApi } from '../services/gateway-api';
import { createLogsApi } from '../services/logs-api';
import { createSettingsApi } from '../services/settings-api';
import { createChannelsApi } from '../services/channels-api';
import { createAgentsApi } from '../services/agents-api';
import { createChatApi } from '../services/chat-api';
import { AcpSessionAccessRegistry } from '../services/acp-session-access-registry';
import { createAttachmentAccess, StagedAttachmentRegistry } from '../services/attachment-access';
import { createAttachmentOpenWithService } from '../services/attachment-open-with';
import { createCronApi } from '../services/cron-api';
import { createFilesApi } from '../services/files-api';
import { createMediaApi } from '../services/media-api';
import { createProvidersApi } from '../services/providers-api';
import { createSessionsApi } from '../services/sessions-api';
import { createSkillsApi } from '../services/skills-api';
import { createUsageApi } from '../services/usage-api';
import { createWebBrowserApi } from '../services/web-browser-api';
import { createChatOrganizationApi } from '../services/chat-organization-api';
import { appUpdater } from './updater';
import type { WebBrowserGuestRegistry } from './web-browser-policy';

const OPENX_AGENT_NAVIGATION_ROUTES = new Set([
  '/',
  '/agents',
  '/channels',
  '/cron',
  '/models',
  '/settings',
  '/skills',
]);

function focusOpenXWindow(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerOpenXNodeClientHandlers(gatewayManager: GatewayManager, mainWindow: BrowserWindow): void {
  gatewayManager.registerClientRpcHandler('openx.app.focus', () => {
    focusOpenXWindow(mainWindow);
    return { success: true };
  });
  gatewayManager.registerClientRpcHandler('openx.app.navigate', (params) => {
    const body = params && typeof params === 'object' && !Array.isArray(params)
      ? params as Record<string, unknown>
      : {};
    const route = typeof body.route === 'string' ? body.route.trim() : '';
    if (!OPENX_AGENT_NAVIGATION_ROUTES.has(route)) throw new Error(`Unsupported OpenX route: ${route}`);
    focusOpenXWindow(mainWindow);
    mainWindow.webContents.send('navigate', route);
    return { success: true, route };
  });
  gatewayManager.registerClientRpcHandler('openx.app.newChat', () => {
    focusOpenXWindow(mainWindow);
    mainWindow.webContents.send('new-chat');
    return { success: true };
  });
  gatewayManager.registerClientRpcHandler('openx.app.status', () => ({
    visible: mainWindow.isVisible(),
    focused: mainWindow.isFocused(),
    minimized: mainWindow.isMinimized(),
  }));
}

/**
 * Registers the single typed host-api boundary used by the renderer.
 * Legacy ad-hoc IPC channels were intentionally removed: remote Gateway
 * capabilities now flow through the same audited contract as the UI.
 */
export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  mainWindow: BrowserWindow,
  hostApiRegistry: HostApiRegistry,
  browserSession: Session,
  registry: WebBrowserGuestRegistry,
): void {
  registerOpenXNodeClientHandlers(gatewayManager, mainWindow);
  const acpSessionAccessRegistry = new AcpSessionAccessRegistry();
  const stagedAttachments = new StagedAttachmentRegistry();
  const attachmentOpenWith = createAttachmentOpenWithService();
  const attachmentAccess = createAttachmentAccess({
    sessionAccessRegistry: acpSessionAccessRegistry,
    stagedAttachments,
    openWith: attachmentOpenWith,
  });

  hostApiRegistry.registerCoreServices({
    app: createAppApi(),
    openclaw: createOpenClawApi(),
    shell: createShellApi(),
    webBrowser: createWebBrowserApi({ browserSession, registry }),
    dialog: createDialogApi(),
    window: createWindowApi(mainWindow),
    updates: createUpdatesApi(appUpdater),
    uv: createUvApi(),
    settings: createSettingsApi(gatewayManager),
    gateway: createGatewayApi(gatewayManager),
    logs: createLogsApi(),
    channels: createChannelsApi({ gatewayManager }),
    agents: createAgentsApi({ gatewayManager }),
    providers: createProvidersApi({ gatewayManager, mainWindow }),
    files: createFilesApi({ attachmentAccess, openWith: attachmentOpenWith, stagedAttachments }),
    media: createMediaApi({ attachmentAccess }),
    sessions: createSessionsApi(gatewayManager),
    chatOrganization: createChatOrganizationApi(gatewayManager),
    chat: createChatApi({ gatewayManager, mainWindow, acpSessionAccessRegistry }),
    cron: createCronApi({ gatewayManager }),
    skills: createSkillsApi({ gatewayManager }),
    usage: createUsageApi(gatewayManager),
  });

  registerHostInvokeHandler(hostApiRegistry);
}
