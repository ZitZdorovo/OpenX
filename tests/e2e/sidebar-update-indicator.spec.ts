import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('shows a release indicator beside Settings and opens the Updates section', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('sidebar-update-available')).toHaveCount(0);

    await app.evaluate(async ({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('update:status-changed', {
          status: 'available',
          info: { version: '0.0.2', releaseDate: '2026-08-13T20:00:00.000Z' },
        });
      }
    });

    const indicator = page.getByTestId('sidebar-update-available');
    await expect(indicator).toBeVisible();
    await expect(indicator).toHaveAttribute('title', /0\.0\.2/);
    await indicator.click();

    await expect(page).toHaveURL(/\/settings\?section=updates$/);
    await expect(page.getByTestId('settings-section-updates')).toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});
