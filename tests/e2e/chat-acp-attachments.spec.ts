import type { ElectronApplication, Page } from '@playwright/test';
import {
  closeElectronApp,
  expect,
  getRecordedLegacyIpcInvocations,
  getStableWindow,
  installAttachmentHostFixture,
  test,
} from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('ACP media attachments', () => {
  test('previews an existing filesystem path for a personal client session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const localPath = await fixture.createWorkspaceFile('personal-notes.txt', 'Personal attachment preview.');
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [{
        sessionUpdate: 'agent_message',
        messageId: 'personal-local-path',
        content: [{
          type: 'resource_link',
          uri: localPath,
          name: 'personal-notes.txt',
          mimeType: 'text/plain',
        }],
      }]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const attachment = page.getByRole('button', { name: 'Preview personal-notes.txt', exact: true });
      await expect(attachment).toBeEnabled({ timeout: 30_000 });
      await attachment.click();
      await expect(page.getByTestId('artifact-panel').getByText('Personal attachment preview.')).toBeVisible();
      expect(await fixture.getShellInvocations()).toEqual([]);
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('previews explicitly staged user files through the typed host boundary', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      const notesPath = await fixture.createWorkspaceFile('uploads/notes.txt', 'Staged attachment preview.');
      await fixture.registerStagedAttachment('stage-notes', notesPath, 'C:\\Users\\Tester\\Documents\\notes.txt');
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [{
        sessionUpdate: 'user_message',
        messageId: 'staged-user-file',
        content: [
          { type: 'text', text: 'Review the staged notes.' },
          {
            type: 'resource_link',
            uri: notesPath,
            name: 'notes.txt',
            mimeType: 'text/plain',
            _meta: { openx: { stagingId: 'stage-notes' } },
          },
        ],
      }]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const notes = page.getByRole('button', { name: 'Preview notes.txt', exact: true });
      await expect(notes).toBeEnabled({ timeout: 30_000 });
      await expect(notes).toContainText('C:\\Users\\Tester\\Documents\\notes.txt');
      await notes.click();
      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByText('Staged attachment preview.')).toBeVisible({ timeout: 30_000 });
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('opens HTTPS attachments through the validated Main operation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const remoteUrl = 'https://example.test/files/remote-archive.zip';

    try {
      const fixture = await installAttachmentHostFixture(app, {
        sessions: [{ key: MAIN_SESSION_KEY, title: 'Main session' }],
      });
      await fixture.setSessionReplay(MAIN_SESSION_KEY, [{
        sessionUpdate: 'agent_message',
        messageId: 'remote-url',
        content: [{
          type: 'resource_link',
          uri: remoteUrl,
          name: 'remote-archive.zip',
          mimeType: 'application/zip',
        }],
      }]);
      await fixture.setTranscriptResponses(MAIN_SESSION_KEY, [[]]);

      const page = await openChat(app);
      const remoteCard = page.getByRole('button').filter({ hasText: 'remote-archive.zip' });
      await expect(remoteCard).toBeEnabled({ timeout: 30_000 });
      await remoteCard.click();
      await expect.poll(async () => (await fixture.getShellInvocations()).some((call) => (
        call.action === 'openExternal' && call.payload?.url === remoteUrl
      ))).toBe(true);
      const hostCalls = await fixture.getHostInvocations();
      expect(hostCalls.some((call) => call.module === 'files' && call.action === 'openAttachment')).toBe(true);
      expect(await getRecordedLegacyIpcInvocations(app)).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
