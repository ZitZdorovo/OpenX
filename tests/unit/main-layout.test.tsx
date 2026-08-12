import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';

vi.mock('@/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar" />,
}));

vi.mock('@/components/web-browser/WebBrowserHost', () => ({
  WebBrowserHost: () => <div data-testid="web-browser-host" />,
}));

describe('MainLayout platform layout', () => {
  const renderLayout = (route = '/') => render(
    <MemoryRouter initialEntries={[route]}>
      <MainLayout />
    </MemoryRouter>,
  );

  it('uses a left/right shell on macOS with a top drag strip over content', () => {
    window.electron.platform = 'darwin';

    renderLayout();

    expect(screen.getByTestId('main-layout')).toHaveClass('flex-row');
    expect(screen.getByTestId('main-content')).toHaveClass('relative');
    expect(screen.getByTestId('mac-main-drag-region')).toHaveClass('drag-region');
  });

  it('keeps a top titlebar column shell on Windows', () => {
    window.electron.platform = 'win32';

    renderLayout();

    const layout = screen.getByTestId('main-layout');
    expect(layout).toHaveClass('flex-col');
    expect(layout).toHaveClass('bg-surface-sidebar');
    expect(screen.getByTestId('main-content')).not.toHaveClass('border-t');
    expect(screen.queryByTestId('mac-main-drag-region')).not.toBeInTheDocument();
  });

  it('mounts one global web browser host beside routed main content', () => {
    renderLayout();

    const main = screen.getByTestId('main-content');
    const host = screen.getByTestId('web-browser-host');
    expect(screen.getAllByTestId('web-browser-host')).toHaveLength(1);
    expect(main).not.toContainElement(host);
    expect(main.parentElement).toBe(host.parentElement);
  });

  it('uses the sidebar surface behind the rounded chat corner only on the chat route', () => {
    const { unmount } = renderLayout('/');
    expect(screen.getByTestId('main-content')).toHaveClass('bg-surface-sidebar');
    unmount();

    renderLayout('/settings');
    expect(screen.getByTestId('main-content')).toHaveClass('bg-background');
  });
});
