import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

test('remote setup exposes URL and token/password modes without a local-provider wizard', async ({ page }) => {
  await expect(page.getByTestId('setup-page')).toBeVisible();
  await expect(page.getByTestId('remote-gateway-url')).toBeVisible();
  await expect(page.getByTestId('remote-gateway-auth-token')).toBeVisible();
  await expect(page.getByTestId('remote-gateway-auth-password')).toBeVisible();
  await expect(page.getByTestId('remote-gateway-credential')).toHaveAttribute('type', 'password');
  await expect(page.getByTestId('setup-skip-button')).toHaveCount(0);
});

test('pairing approval is shown as a warning instead of a connection failure', async ({ launchElectronApp }) => {
  const app = await launchElectronApp();
  try {
    const page = await getStableWindow(app);
    const payload = { url: 'wss://gateway.example.com/', authMode: 'token', credential: 'secret-token' };
    await installIpcMocks(app, {
      hostApi: {
        [stableStringify(['gateway', 'configure', payload])]: {
          success: false,
          status: { state: 'error', errorCode: 'pairing-required' },
        },
      },
    });

    await page.getByTestId('remote-gateway-url').fill(payload.url);
    await page.getByTestId('remote-gateway-credential').fill(payload.credential);
    await page.getByTestId('remote-gateway-connect').click();

    await expect(page.getByTestId('remote-gateway-warning')).toBeVisible();
    await expect(page.getByTestId('remote-gateway-warning')).toHaveClass(/text-amber/);
    await expect(page.getByTestId('remote-gateway-error')).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});
