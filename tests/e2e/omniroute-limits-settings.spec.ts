import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test('OmniRoute quota settings keep the management token masked', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('settings-nav-gateway').click();

    const section = page.getByTestId('settings-omniroute-limits');
    await expect(section).toBeVisible();
    await expect(page.getByTestId('settings-omniroute-url')).toHaveAttribute(
      'placeholder',
      'http://127.0.0.1:20128',
    );
    await expect(page.getByTestId('settings-omniroute-token')).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('settings-omniroute-save')).toBeDisabled();
  } finally {
    await closeElectronApp(app);
  }
});
