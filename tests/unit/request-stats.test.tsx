// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { RequestStats } from '@/pages/Chat/RequestStats';
import { useProviderUsageStore } from '@/stores/provider-usage';

describe('RequestStats', () => {
  beforeEach(() => {
    useProviderUsageStore.setState({
      providers: [],
      loading: false,
      updatedAt: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('uses a compact progress ring and reveals context limits on click', () => {
    render(
      <RequestStats
        usage={{ used: 23_900, size: 200_000, inputTokens: 23_900, outputTokens: 92 }}
        model={{
          modelRef: 'custom-custom4/agy/claude-opus-4-6-thinking',
          label: 'Claude Opus 4.6',
          runtimeProviderKey: 'custom-custom4',
          accountId: 'custom4',
          contextWindow: 200_000,
        }}
      />,
    );

    const button = screen.getByTestId('chat-request-stats-button');
    expect(button).toHaveTextContent('12%');
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('12%'));

    fireEvent.click(button);

    expect(screen.getByTestId('chat-request-stats-panel')).toBeVisible();
    expect(screen.getByText('Context window')).toBeVisible();
    expect(screen.getByText('Tokens in last request')).toBeVisible();
    expect(screen.getByText('custom-custom4')).toBeVisible();
  });

  it('reads provider token aliases from nested usage payloads', () => {
    render(
      <RequestStats
        usage={{ context: { usedTokens: 50_000 }, usage: { input_tokens: 40_000, output_tokens: 10_000 }, cost: { total: 0.42 } }}
        model={{
          modelRef: 'remote/model',
          label: 'Remote Model',
          runtimeProviderKey: 'remote',
          accountId: 'remote',
          contextWindow: 100_000,
        }}
      />,
    );

    expect(screen.getByTestId('chat-request-stats-button')).toHaveTextContent('50%');
    fireEvent.click(screen.getByTestId('chat-request-stats-button'));
    expect(screen.getByText('Input').parentElement).toHaveTextContent(/40/);
    expect(screen.getByText('Output').parentElement).toHaveTextContent(/10/);
    expect(screen.getByText('$0.4200')).toBeVisible();
  });

  it('shows OmniRoute 5-hour and weekly windows with account labels', () => {
    useProviderUsageStore.setState({
      providers: [{
        provider: 'custom-omniroute',
        displayName: 'OmniRoute',
        activeAccountId: 'one',
        activeAccountName: 'Primary',
        windows: [
          { label: 'session', usedPercent: 20, accountId: 'one', accountName: 'Primary', accountProvider: 'codex' },
          { label: 'weekly', usedPercent: 55, accountId: 'one', accountName: 'Primary', accountProvider: 'codex' },
        ],
      }],
    });

    render(
      <RequestStats
        usage={{ used: 10_000 }}
        model={{
          modelRef: 'omniroute/gpt-5.6',
          label: 'GPT 5.6',
          runtimeProviderKey: 'custom-omniroute',
          accountId: 'omniroute',
          contextWindow: 200_000,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-request-stats-button'));
    expect(screen.getByText('ChatGPT account limits')).toBeVisible();
    expect(screen.getByText('5-hour limit')).toBeVisible();
    expect(screen.getByText('Weekly limit')).toBeVisible();
    expect(screen.getAllByText('Account: Primary')).toHaveLength(1);
    expect(screen.getByText(/80% remaining/)).toBeVisible();
    expect(screen.getByText(/45% remaining/)).toBeVisible();
  });

  it('shows one shared Gemini pool per named account and hides orphaned ids', () => {
    useProviderUsageStore.setState({
      providers: [{
        provider: 'custom-omniroute',
        displayName: 'OmniRoute',
        activeAccountId: 'one',
        activeAccountName: 'user@example.com',
        windows: [
          { label: 'gemini-3.6-flash-low', usedPercent: 10, period: 'five_hour', accountId: 'one', accountName: 'user@example.com', accountProvider: 'agy' },
          { label: 'gemini-pro-agent', usedPercent: 40, period: 'five_hour', accountId: 'one', accountName: 'user@example.com', accountProvider: 'agy' },
          { label: 'Gemini Models', usedPercent: 30, period: 'weekly', accountId: 'one', accountName: 'user@example.com', accountProvider: 'agy' },
          { label: 'gemini-3.6-flash-low', usedPercent: 90, period: 'five_hour', accountId: 'two', accountName: 'idle@example.com', accountProvider: 'agy' },
        ],
      }],
    });

    render(
      <RequestStats
        usage={{ used: 10_000 }}
        model={{
          modelRef: 'custom-omniroute/agy/gemini-3.6-flash-low',
          label: 'Gemini 3.6 Flash',
          runtimeProviderKey: 'custom-omniroute',
          accountId: 'omniroute',
          contextWindow: 200_000,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-request-stats-button'));
    expect(screen.getByText('Gemini account limits')).toBeVisible();
    expect(screen.getByText('5-hour limit')).toBeVisible();
    expect(screen.getByText('Weekly limit')).toBeVisible();
    expect(screen.getAllByText('Account: user@example.com')).toHaveLength(1);
    expect(screen.getByText(/60% remaining/)).toBeVisible();
    expect(screen.queryByText('Account: idle@example.com')).not.toBeInTheDocument();
  });

  it('keeps the available 5-hour limit visible when OmniRoute omits the weekly window', () => {
    useProviderUsageStore.setState({
      providers: [{
        provider: 'custom-omniroute',
        displayName: 'OmniRoute',
        activeAccountId: 'active',
        windows: [{
          label: 'gemini-3.6-flash-high',
          period: 'five_hour',
          usedPercent: 89.99,
          accountId: 'active',
          accountName: 'Primary',
          accountProvider: 'antigravity',
        }],
      }],
    });

    render(
      <RequestStats
        usage={{ used: 23_900 }}
        model={{
          modelRef: 'custom-omniroute/agy/gemini-3.6-flash-high',
          label: 'Gemini 3.6 Flash',
          runtimeProviderKey: 'custom-omniroute',
          accountId: 'omniroute',
          contextWindow: 1_000_000,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-request-stats-button'));
    expect(screen.getByText('5-hour limit')).toBeVisible();
    expect(screen.getByText(/10% remaining/)).toBeVisible();
    expect(screen.getByText('Weekly limit')).toBeVisible();
    expect(screen.getByText('Not returned by OmniRoute')).toBeVisible();
  });
});
