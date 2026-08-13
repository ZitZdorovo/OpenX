import type { Locator } from '@playwright/test';
import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function expectSubtleDialogAnimation(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveAttribute('data-state', 'open');

  const animation = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      name: style.animationName,
      duration: style.animationDuration,
    };
  });

  expect(animation.name).toContain('openx-dialog-content-in');
  expect(animation.duration).toContain('0.1s');

  const firstFrameOffset = await locator.evaluate(async (element) => {
    const animation = element.getAnimations()[0];
    if (!animation) {
      return null;
    }

    animation.pause();
    animation.currentTime = 0;
    await new Promise(requestAnimationFrame);

    const rect = element.getBoundingClientRect();
    const offset = {
      x: rect.left + rect.width / 2 - window.innerWidth / 2,
      y: rect.top + rect.height / 2 - window.innerHeight / 2,
    };

    animation.finish();
    return offset;
  });

  expect(firstFrameOffset).not.toBeNull();
  expect(Math.abs(firstFrameOffset!.x)).toBeLessThan(8);
  expect(Math.abs(firstFrameOffset!.y)).toBeLessThan(12);
}

test.describe('dialog transitions', () => {
  test('uses the shared subtle transition for core modal dialogs', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {},
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          },
        },
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: [],
          },
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, channels: [] },
          },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: {
              agents: [{
                id: 'main',
                name: 'Main Agent',
                isDefault: true,
                modelDisplay: 'Default Model',
                modelRef: 'openai/gpt-5.5',
                overrideModelRef: null,
                inheritedModel: true,
                workspace: '/tmp/openx-main-agent',
                agentDir: '/tmp/openx-main-agent/agent',
                mainSessionKey: 'main/default',
                channelTypes: [],
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'openai/gpt-5.5',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            },
          },
        },
      },
    });

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-models').click();
    await page.getByTestId('providers-add-button').click();
    const providerDialog = page.getByTestId('add-provider-dialog');
    await expectSubtleDialogAnimation(providerDialog);

    await page.getByTestId('add-provider-close-button').click();
    await expect(providerDialog).toHaveAttribute('data-state', 'closed');
    await expect(providerDialog).toHaveCount(0);

    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('agents-add-button').click();
    const agentDialog = page.getByTestId('add-agent-dialog');
    await expectSubtleDialogAnimation(agentDialog);
    await page.keyboard.press('Escape');
    await expect(agentDialog).toHaveCount(0);

    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-new-task-button').click();
    await expectSubtleDialogAnimation(page.getByTestId('cron-task-dialog'));
  });

});
