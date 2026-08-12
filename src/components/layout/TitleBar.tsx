/**
 * TitleBar Component
 * macOS: empty drag region (native traffic lights handled by hiddenInset).
 * Windows: drag region with custom minimize/maximize/close controls; uses
 * `bg-surface-sidebar` so the frameless strip matches the sidebar rail.
 * Linux: use native window chrome (no custom title bar).
 */
import { useState, useEffect, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Minus, PanelLeft, Square, X, Copy } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { WindowMenuId } from '@shared/host-api/contract';

export function TitleBar() {
  const platform = window.electron?.platform;

  if (platform === 'darwin') {
    // macOS traffic lights live inside the sidebar area; keep the shell left/right.
    return null;
  }

  // Linux keeps the native frame/title bar for better IME compatibility.
  if (platform !== 'win32') {
    return null;
  }

  return <WindowsTitleBar />;
}

function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const { t } = useTranslation('menu');
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);

  useEffect(() => {
    // Check initial state
    hostApi.window.isMaximized().then((val) => {
      setMaximized(val);
    });
  }, []);

  const handleMinimize = () => {
    void hostApi.window.minimize();
  };

  const handleMaximize = () => {
    hostApi.window.maximize().then(() => {
      hostApi.window.isMaximized().then((val) => {
        setMaximized(val);
      });
    });
  };

  const handleClose = () => {
    void hostApi.window.close();
  };

  const showMenu = (event: MouseEvent<HTMLButtonElement>, menu: WindowMenuId) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void hostApi.window.showMenu(menu, rect.left, rect.bottom);
  };

  const menus: Array<{ id: WindowMenuId; label: string }> = [
    { id: 'file', label: t('file.label') },
    { id: 'edit', label: t('edit.label') },
    { id: 'view', label: t('view.label') },
    { id: 'help', label: t('help.label') },
  ];

  return (
    <div
      data-testid="windows-titlebar"
      className="drag-region flex h-10 shrink-0 items-center bg-surface-sidebar"
    >
      <div className="no-drag flex h-full items-center pl-1">
        <button
          type="button"
          className="flex h-7 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          title={sidebarCollapsed ? t('titleBar.showSidebar') : t('titleBar.hideSidebar')}
          aria-label={sidebarCollapsed ? t('titleBar.showSidebar') : t('titleBar.hideSidebar')}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-7 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          title={t('titleBar.back')}
          aria-label={t('titleBar.back')}
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-7 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          title={t('titleBar.forward')}
          aria-label={t('titleBar.forward')}
          onClick={() => window.history.forward()}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <div className="ml-2 flex h-full items-center gap-0.5">
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              className="h-7 rounded px-2.5 text-xs text-foreground/75 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              onClick={(event) => showMenu(event, menu.id)}
            >
              {menu.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-8 flex-1" />

      {/* Right: Window Controls */}
      <div className="no-drag flex h-full">
        <button
          onClick={handleMinimize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 transition-colors"
          title={t('titleBar.minimize')}
          aria-label={t('titleBar.minimize')}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 transition-colors"
          title={maximized ? t('titleBar.restore') : t('titleBar.maximize')}
          aria-label={maximized ? t('titleBar.restore') : t('titleBar.maximize')}
        >
          {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={handleClose}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-red-500 hover:text-white transition-colors"
          title={t('titleBar.close')}
          aria-label={t('titleBar.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
