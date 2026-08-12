import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AcpPlanProgress } from '@/pages/Chat/AcpPlanProgress';
import type { PlanItem } from '@/lib/acp/timeline-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { current?: number; total?: number }) => (
      key === 'acp.stepProgress' ? `Step ${values?.current} / ${values?.total}` : 'Plan'
    ),
  }),
}));

const plan: PlanItem = {
  kind: 'plan',
  id: 'plan:current',
  entries: [
    { content: 'Inspect architecture', status: 'completed' },
    { content: 'Implement progress menu', status: 'in_progress' },
    { content: 'Run tests', status: 'pending' },
  ],
};

describe('AcpPlanProgress', () => {
  it('shows a compact current step and expands the complete plan', () => {
    render(<AcpPlanProgress item={plan} />);

    const trigger = screen.getByTestId('acp-plan-progress-trigger');
    expect(trigger).toHaveTextContent('Step 2 / 3');
    expect(screen.queryByTestId('acp-plan-progress-popover')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByTestId('acp-plan-progress-popover')).toBeInTheDocument();
    expect(screen.getByText('Inspect architecture')).toBeInTheDocument();
    expect(screen.getByText('Implement progress menu')).toBeInTheDocument();
    expect(screen.getByText('Run tests')).toBeInTheDocument();
  });

  it('closes the expanded plan with Escape', () => {
    render(<AcpPlanProgress item={plan} />);
    fireEvent.click(screen.getByTestId('acp-plan-progress-trigger'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('acp-plan-progress-popover')).not.toBeInTheDocument();
  });
});
