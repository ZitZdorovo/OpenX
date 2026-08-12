import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Windows frameless chrome', () => {
  test.skip(process.platform !== 'win32', 'Windows custom title bar only');

  test('renders the OpenX menu chrome above the main panel', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('main-layout')).toHaveAttribute('data-platform', 'win32');

      const shell = page.getByTestId('main-layout');
      await expect(shell).toHaveClass(/bg-surface-sidebar/);

      const titleBar = page.getByTestId('windows-titlebar');
      await expect(titleBar).toBeVisible();
      await expect(titleBar).toHaveClass(/bg-surface-sidebar/);
      await expect(titleBar).not.toHaveClass(/border-b/);
      await expect(titleBar).toHaveCSS('-webkit-app-region', 'drag');
      await expect(titleBar.getByAltText('OpenX')).toHaveCount(0);
      await expect(titleBar.getByTitle('Hide sidebar')).toBeVisible();
      await expect(titleBar.getByTitle('Back')).toBeVisible();
      await expect(titleBar.getByTitle('Forward')).toBeVisible();
      await expect(titleBar.getByRole('button', { name: /File|Файл/ })).toBeVisible();

      const main = page.getByTestId('main-content');
      await expect(main).not.toHaveClass(/border-t/);
    } finally {
      await closeElectronApp(app);
    }
  });
});
