import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Russian language localization', () => {
  test('switches between Russian and English in Settings and persists the selection', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-page')).toBeVisible();

      await page.getByRole('button', { name: 'Русский', exact: true }).click();
      await expect(page.getByTestId('settings-page').getByRole('heading', { level: 1 })).toHaveText('Настройки');

      await closeElectronApp(app);

      const relaunchedApp = await launchElectronApp({ skipSetup: true });
      try {
        const relaunchedPage = await getStableWindow(relaunchedApp);
        await expect(relaunchedPage.getByTestId('sidebar-nav-settings')).toContainText('Настройки');
        await relaunchedPage.getByTestId('sidebar-nav-settings').click();
        await relaunchedPage.getByRole('button', { name: 'English', exact: true }).click();
        await expect(relaunchedPage.getByTestId('settings-page').getByRole('heading', { level: 1 })).toHaveText('Settings');
      } finally {
        await closeElectronApp(relaunchedApp);
      }
    } finally {
      try {
        await closeElectronApp(app);
      } catch {
        // The first app is intentionally closed before the persistence check.
      }
    }
  });
});
