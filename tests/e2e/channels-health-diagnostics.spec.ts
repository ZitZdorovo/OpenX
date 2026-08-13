import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Channels health diagnostics', () => {
  test('does not show a local Gateway lifecycle banner for a connected remote Gateway', async ({ electronApp, page }) => {
    await completeSetup(page);

    await electronApp.evaluate(({ ipcMain }) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, {
            success: true,
            gatewayHealth: {
              state: 'degraded',
              reasons: ['gateway_not_running'],
              consecutiveHeartbeatMisses: 0,
            },
            channels: [{
              channelType: 'feishu',
              defaultAccountId: 'default',
              status: 'connected',
              accounts: [{
                accountId: 'default',
                name: 'Primary Account',
                configured: true,
                status: 'connected',
                isDefault: true,
              }],
            }],
          });
        }
        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [] });
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await page.evaluate(() => { window.location.hash = '/channels'; });
    await expect(page.getByTestId('channels-page')).toBeVisible();
    await expect(page.getByText('Feishu / Lark')).toBeVisible();
    await expect(page.getByTestId('channels-health-banner')).toHaveCount(0);
    await expect(page.getByText(/Gateway degraded|Gateway is not running/)).toHaveCount(0);
  });
});
