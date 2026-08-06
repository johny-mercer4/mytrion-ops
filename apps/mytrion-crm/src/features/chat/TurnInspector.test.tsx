import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnInspector } from './TurnInspector';

describe('TurnInspector', () => {
  it('shows a safe empty state before a request starts', () => {
    render(<TurnInspector inspection={null} />);
    expect(screen.getByRole('complementary', { name: 'Turn Inspector' })).toBeInTheDocument();
    expect(screen.getByText('Send a Horizon request')).toBeInTheDocument();
  });

  it('renders agent, model, RAG state, and ordered runtime steps', () => {
    render(
      <TurnInspector
        inspection={{
          turnId: 'local-1',
          runId: 'run-1',
          active: false,
          startedAt: '2026-08-06T10:00:00.000Z',
          agent: 'sales',
          model: 'gpt-5.4-mini',
          modelRole: 'answer',
          provider: 'openai',
          route: 'knowledge',
          ragUsed: true,
          ragGrade: 'sufficient',
          passages: 4,
          confidence: 0.96,
          steps: [
            { stage: 'route', status: 'complete', label: 'Routed to sales', at: '2026-08-06T10:00:00.010Z' },
            { stage: 'rag', status: 'complete', label: 'Evidence sufficient', at: '2026-08-06T10:00:00.120Z' },
          ],
        }}
      />,
    );
    expect(screen.getByText('gpt-5.4-mini')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText('Routed to sales')).toBeInTheDocument();
    expect(screen.getByText('Evidence sufficient')).toBeInTheDocument();
  });
});
