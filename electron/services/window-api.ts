import { Menu, type BrowserWindow } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { syncMacTrafficLightPosition } from '../main/traffic-light-layout';

export function createWindowApi(mainWindow: BrowserWindow): CompleteHostServiceRegistry['window'] {
  return {
    syncTrafficLightPosition: (payload) => {
      syncMacTrafficLightPosition(mainWindow, payload.sidebarCollapsed);
    },
    showMenu: (payload) => {
      const menu = Menu.getApplicationMenu()?.getMenuItemById(payload.menu)?.submenu;
      if (!menu) return;
      menu.popup({
        window: mainWindow,
        x: Math.max(0, Math.round(payload.x)),
        y: Math.max(0, Math.round(payload.y)),
      });
    },
    minimize: () => {
      mainWindow.minimize();
    },
    maximize: () => {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    },
    close: () => {
      mainWindow.close();
    },
    isMaximized: () => mainWindow.isMaximized(),
  };
}
