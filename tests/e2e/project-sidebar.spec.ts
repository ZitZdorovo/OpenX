import { closeElectronApp, expect, test } from './fixtures/electron';

test('project sidebar replaces workspace groups and exposes pinned/search/project controls', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('openx-sidebar-header')).toContainText('OpenX');
    await expect(page.getByPlaceholder('Search chats')).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder('Search chats')).toBeVisible();
    await expect(page.getByText('Suggested', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Pinned', { exact: true })).toBeVisible();
    await expect(page.getByText('Session list', { exact: true })).toBeVisible();
    const pinnedToggle = page.getByRole('button', { name: 'Pinned' });
    const pinnedArrow = pinnedToggle.locator('svg');
    await expect(pinnedToggle).toHaveCSS('font-size', '15px');
    await expect(pinnedArrow).toHaveCSS('opacity', '0');
    await pinnedToggle.hover();
    await expect(pinnedArrow).toHaveCSS('opacity', '1');
    await expect(page.getByTitle('New project')).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-session-group-"]')).toHaveCount(0);
    await page.getByTitle('New project').click();
    await expect(page.getByText('Create project', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('chat-page')).toHaveClass(/bg-surface-chat/);
    await expect(page.getByTestId('main-content')).toHaveClass(/bg-surface-sidebar/);
    await page.getByTitle('Settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-page')).toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});
