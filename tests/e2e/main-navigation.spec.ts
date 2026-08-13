import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

async function readNativeMenuLabels(app: ElectronApplication) {
  return await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const fileMenu = menu?.items.find((item) => item.label === 'Файл' || item.label === 'File');
    const findMenuItem = (
      items: Electron.MenuItem[],
      predicate: (item: Electron.MenuItem) => boolean,
    ): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (predicate(item)) return item;
        const child = item.submenu ? findMenuItem(item.submenu.items, predicate) : undefined;
        if (child) return child;
      }
      return undefined;
    };
    return {
      topLevel: menu?.items.map((item) => item.label) ?? [],
      file: fileMenu?.label,
      quit: findMenuItem(menu?.items ?? [], (item) => item.role === 'quit')?.label,
      numberedNavigationAccelerators: menu?.items
        .flatMap((item) => item.submenu?.items ?? [])
        .filter((item) => ['navigate-dashboard', 'navigate-chat', 'navigate-channels', 'navigate-skills', 'navigate-cron'].includes(item.id))
        .map((item) => item.accelerator ?? null),
      newChat: fileMenu?.submenu?.items.find((item) => item.id === 'new-chat' || item.label === 'New Chat' || item.label === 'Новый чат')?.label,
    };
  });
}

test.describe('OpenX main navigation without setup flow', () => {
  test('resizes, auto-hides, reveals, and locks the sidebar', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      const sidebar = page.getByTestId('sidebar');
      const sidebarLayoutSlot = page.getByTestId('sidebar-layout-slot');
      const resizeHandle = page.getByTestId('sidebar-resize-handle');
      const initialBox = await sidebar.boundingBox();
      const handleBox = await resizeHandle.boundingBox();
      expect(initialBox).not.toBeNull();
      expect(handleBox).not.toBeNull();
      if (!initialBox || !handleBox) return;

      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 120);
      await page.mouse.down();
      await page.mouse.move(initialBox.x + initialBox.width + 70, handleBox.y + 120, { steps: 5 });
      await page.mouse.up();
      await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(initialBox.width + 40);
      await page.waitForTimeout(220);

      const expandedBox = await sidebar.boundingBox();
      if (!expandedBox) return;
      await page.mouse.move(expandedBox.x + expandedBox.width - 1, expandedBox.y + 120);
      await page.mouse.down();
      await page.mouse.move(expandedBox.x + 240, expandedBox.y + 120, { steps: 5 });
      await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(240);
      await page.mouse.move(expandedBox.x + 1, expandedBox.y + 120, { steps: 5 });
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await expect.poll(async () => Math.round((await sidebarLayoutSlot.boundingBox())?.width ?? -1)).toBe(0);
      await page.mouse.move(expandedBox.x + 260, expandedBox.y + 120, { steps: 5 });
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
      await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBeGreaterThanOrEqual(240);
      await expect.poll(async () => {
        const sidebarBox = await sidebar.boundingBox();
        const slotBox = await sidebarLayoutSlot.boundingBox();
        return Math.abs((sidebarBox?.width ?? 0) - (slotBox?.width ?? 0));
      }).toBeLessThanOrEqual(1);
      await page.mouse.move(expandedBox.x + 1, expandedBox.y + 120, { steps: 5 });
      await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
      await page.mouse.up();
      await expect(page.getByTestId('sidebar-hover-trigger')).toBeVisible();
      await expect(sidebar).toHaveAttribute('data-hover-expanded', 'false');
      await page.mouse.move(80, 180);
      await page.waitForTimeout(250);
      await expect(sidebar).toHaveAttribute('data-hover-expanded', 'false');
      await expect.poll(async () => Math.round(await sidebar.evaluate((element) => element.getBoundingClientRect().right))).toBeLessThanOrEqual(1);

      await page.mouse.move(5, 180);
      await expect(sidebar).toHaveAttribute('data-hover-expanded', 'true');
      await expect.poll(async () => Math.round(await sidebar.evaluate((element) => element.getBoundingClientRect().x))).toBeGreaterThanOrEqual(0);
      await page.getByRole('button', { name: 'Keep sidebar open' }).click();
      await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('navigates between core pages with setup bypassed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('main-content')).toBeVisible();

      const sectionBoxes = await Promise.all([
        page.getByTestId('sidebar-section-pinned').boundingBox(),
        page.getByTestId('sidebar-section-projects').boundingBox(),
        page.getByTestId('sidebar-section-sessions').boundingBox(),
      ]);
      expect(sectionBoxes.every(Boolean)).toBe(true);
      const pinnedToProjects = sectionBoxes[1]!.y - (sectionBoxes[0]!.y + sectionBoxes[0]!.height);
      const projectsToSessions = sectionBoxes[2]!.y - (sectionBoxes[1]!.y + sectionBoxes[1]!.height);
      expect(Math.abs(pinnedToProjects - projectsToSessions)).toBeLessThanOrEqual(1);
      expect(pinnedToProjects).toBe(12);

      const [chatPageBox, composerFooterBox] = await Promise.all([
        page.getByTestId('chat-page').boundingBox(),
        page.getByTestId('chat-composer-footer').boundingBox(),
      ]);
      expect(chatPageBox).not.toBeNull();
      expect(composerFooterBox).not.toBeNull();
      expect(Math.round(chatPageBox!.y + chatPageBox!.height - composerFooterBox!.y - composerFooterBox!.height)).toBe(15);

      const newChatButton = page.getByTestId('sidebar-new-chat');
      const newChatTop = (await newChatButton.boundingBox())?.y;
      await expect(page.getByTestId('sidebar-scroll-area')).toHaveCSS('padding-right', '6px');
      await page.evaluate(() => {
        const scrollPane = document.querySelector<HTMLElement>('[data-testid="sidebar-nav-models"]')?.closest<HTMLElement>('.overflow-y-auto');
        if (scrollPane) scrollPane.scrollTop = scrollPane.scrollHeight;
      });
      await expect(newChatButton).toBeVisible();
      expect((await newChatButton.boundingBox())?.y).toBe(newChatTop);

      const gatewayIndicator = page.getByTestId('gateway-connection-state');
      await expect(gatewayIndicator).toBeVisible();
      const [gatewayIndicatorBox, settingsLinkBox] = await Promise.all([
        gatewayIndicator.boundingBox(),
        page.getByTestId('sidebar-nav-settings').boundingBox(),
      ]);
      expect(gatewayIndicatorBox).not.toBeNull();
      expect(settingsLinkBox).not.toBeNull();
      expect(gatewayIndicatorBox!.width).toBeLessThanOrEqual(32);
      expect(Math.abs((gatewayIndicatorBox!.y + gatewayIndicatorBox!.height / 2) - (settingsLinkBox!.y + settingsLinkBox!.height / 2))).toBeLessThanOrEqual(1);

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();
      const typography = await page.evaluate(() => ({
        body: getComputedStyle(document.body).fontFamily,
        title: getComputedStyle(document.querySelector<HTMLElement>('[data-testid="models-page-title"]')!).fontFamily,
      }));
      expect(typography.title).toBe(typography.body);

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-channels').click();
      await expect(page.getByTestId('channels-page')).toBeVisible();

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(720, 480);
      });
      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page-title')).toBeVisible();

      const layoutMetrics = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar"]');
        const pageTitle = document.querySelector<HTMLElement>('[data-testid="models-page-title"]');
        return {
          sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
          titleRight: pageTitle?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY,
          viewportWidth: window.innerWidth,
          hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(layoutMetrics.sidebarWidth).toBeLessThanOrEqual(241);
      expect(layoutMetrics.titleRight).toBeLessThanOrEqual(layoutMetrics.viewportWidth);
      expect(layoutMetrics.hasHorizontalOverflow).toBe(false);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-navigation')).toBeVisible();
      await expect(page.getByTestId('sidebar')).toHaveCount(0);
      await expect(page.getByRole('switch', { name: 'Launch at system startup' })).toBeVisible();
      await page.getByTestId('settings-nav-gateway').click();
      await expect(page.getByTestId('settings-section-gateway')).toBeVisible();
      await expect(page.getByTestId('settings-section-appearance')).toBeHidden();
      await expect(page.getByRole('switch', { name: 'Developer Mode' })).toBeHidden();

      await page.getByTestId('settings-nav-appearance').click();
      const developerModeSwitch = page.getByRole('switch', { name: 'Developer Mode' });
      await expect(developerModeSwitch).toBeVisible();
      if (!(await developerModeSwitch.isChecked())) {
        await developerModeSwitch.click();
      }

      await page.getByTestId('settings-nav-developer').click();
      await expect(page.getByTestId('settings-developer-section')).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Anonymous Usage Data' })).toBeHidden();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('native New Chat menu opens the same chat route as the sidebar action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible();

      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      await app.evaluate(({ BrowserWindow, Menu }) => {
        const menu = Menu.getApplicationMenu();
        const findMenuItem = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.id === 'new-chat') return item;
            const child = item.submenu ? findMenuItem(item.submenu.items) : undefined;
            if (child) return child;
          }
          return undefined;
        };
        const newChatItem = menu ? findMenuItem(menu.items) : undefined;
        newChatItem?.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined);
      });

      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('gateway shortcut and settings search open the exact setting', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('gateway-connection-state').click();
      await expect(page).toHaveURL(/#\/settings\?section=gateway$/);
      await expect(page.getByTestId('settings-section-gateway')).toBeVisible();
      await expect(page.getByTestId('settings-section-appearance')).toBeHidden();

      const search = page.getByRole('textbox', { name: 'Search settings' });
      await search.fill('Language');
      await page.getByTestId('settings-search-result-settings-language').click();
      await expect(page).toHaveURL(/#\/settings\?section=appearance$/);
      await expect(page.locator('#settings-language')).toBeVisible();

      await expect.poll(() => readNativeMenuLabels(app)).toMatchObject({
        quit: 'Quit OpenX',
        numberedNavigationAccelerators: [null, null, null, null, null],
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('dragging a file anywhere over the chat shows the full-window attachment target', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['test'], 'notes.txt', { type: 'text/plain' }));
        window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }));
      });
      await expect(page.getByTestId('chat-drop-overlay')).toBeVisible();
      await page.evaluate(() => {
        window.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: null }));
      });
      await expect(page.getByTestId('chat-drop-overlay')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('refreshes native menu labels after switching language', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByRole('button', { name: 'English' }).click();
      await page.getByRole('button', { name: 'Русский' }).click();

      await expect(page.getByText('Язык меню обновлён')).toBeVisible();
      await expect.poll(() => readNativeMenuLabels(app)).toMatchObject({
        file: 'Файл',
        newChat: 'Новый чат',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
