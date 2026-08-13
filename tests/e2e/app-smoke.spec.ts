import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('OpenX Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('remote-gateway-url')).toBeVisible();
    await expect(page.getByTestId('remote-gateway-credential')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
  });

  test('navigates to the models page with normally persisted setup state', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      expect(new URL(page.url()).search).toBe('');
      await expect(page.getByTestId('chat-toolbar-actions').getByRole('button', { name: 'Refresh chat' })).toHaveCount(0);
      await page.getByTestId('sidebar-nav-models').click();

      await expect(page.getByTestId('models-page')).toBeVisible();
      await expect(page.getByTestId('models-page-title')).toBeVisible();
      await expect(page.getByTestId('providers-settings')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('persists completed setup across relaunch for the same isolated profile', async ({ launchElectronApp }) => {
    const firstApp = await launchElectronApp({ skipSetup: true });
    const firstWindow = await getStableWindow(firstApp);
    await expect(firstWindow.getByTestId('main-layout')).toBeVisible();
    await closeElectronApp(firstApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await getStableWindow(relaunchedApp);

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
      expect(new URL(relaunchedWindow.url()).search).toBe('');
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
