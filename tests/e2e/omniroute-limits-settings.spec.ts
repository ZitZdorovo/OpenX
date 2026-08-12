import { expect, test } from './fixtures/electron';

test('OmniRoute quota settings keep the management token masked', async ({ page }) => {
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('e2eSkipSetup', '1');
    url.hash = '/settings';
    window.location.href = url.toString();
  });
  await expect(page.getByTestId('main-layout')).toBeVisible();

  const section = page.getByTestId('settings-omniroute-limits');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('settings-omniroute-url')).toHaveAttribute(
    'placeholder',
    'http://127.0.0.1:20128',
  );
  await expect(page.getByTestId('settings-omniroute-token')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('settings-omniroute-save')).toBeDisabled();
});
