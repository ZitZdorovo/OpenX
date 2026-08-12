import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('page scrollbar placement', () => {
  test('keeps the scrollbar visible and attached to the window edge', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-models').click();
      await expect(page.getByTestId('models-page')).toBeVisible();

      const scrollContainer = page.locator('[data-testid="models-page"] .overflow-y-auto').first();
      await expect(scrollContainer).toBeVisible();
      await page.mouse.move(5, 5);

      const beforeHover = await scrollContainer.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const thumbStyle = window.getComputedStyle(element, '::-webkit-scrollbar-thumb');
        return {
          scrollbarWidth: style.scrollbarWidth,
          thumbBackground: thumbStyle.backgroundColor,
        };
      });

      await expect(scrollContainer).toHaveCSS('scrollbar-width', 'thin');
      expect(beforeHover.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');
      await expect.poll(async () => {
        const box = await scrollContainer.boundingBox();
        const viewportWidth = await page.evaluate(() => window.innerWidth);
        return Math.abs(viewportWidth - ((box?.x ?? 0) + (box?.width ?? 0)));
      }).toBeLessThanOrEqual(1);

      await scrollContainer.hover();

      const afterHover = await scrollContainer.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const thumbStyle = window.getComputedStyle(element, '::-webkit-scrollbar-thumb');
        return {
          scrollbarWidth: style.scrollbarWidth,
          thumbBackground: thumbStyle.backgroundColor,
        };
      });

      expect(afterHover.scrollbarWidth).toBe('thin');
      expect(afterHover.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');
    } finally {
      await closeElectronApp(app);
    }
  });
});
