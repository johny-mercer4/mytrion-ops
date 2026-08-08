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

  /**
   * The three numbers that took a night of measurement to find, because nothing displayed them:
   * how many tools the agent was carrying, what fraction of the prompt was a cache hit, and how long
   * the wait before the first token was.
   */
  it('derives tools bound, cache hit rate and TTFT from the step details', () => {
    render(
      <TurnInspector
        inspection={{
          turnId: 'local-2',
          active: false,
          startedAt: '2026-08-08T10:00:00.000Z',
          steps: [
            {
              stage: 'agent',
              status: 'complete',
              label: 'Sales bound 22 tools',
              at: '2026-08-08T10:00:00.050Z',
              details: { toolsBound: 22, writeTools: 0 },
            },
            {
              stage: 'model',
              status: 'complete',
              label: 'gpt-5.4-mini responded',
              at: '2026-08-08T10:00:02.000Z',
              durationMs: 1900,
              details: { inputTokens: 10_000, cachedInputTokens: 9_000, ttftMs: 1_140 },
            },
          ],
        }}
      />,
    );
    // Scoped to the summary tile: "Sales bound 22 tools" also contains "22".
    expect(screen.getByText('22', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('1140ms to first token')).toBeInTheDocument();
    // Per-step duration, distinct from elapsed-since-start.
    expect(screen.getByText('1.9s')).toBeInTheDocument();
  });

  it('shows an em dash rather than 0% when nothing was measured', () => {
    render(
      <TurnInspector
        inspection={{
          turnId: 'local-3',
          active: true,
          startedAt: '2026-08-08T10:00:00.000Z',
          steps: [{ stage: 'route', status: 'running', label: 'Routing', at: '2026-08-08T10:00:00.005Z' }],
        }}
      />,
    );
    // "unknown" must not read as "no cache hits" — they are different states.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('TTFT pending')).toBeInTheDocument();
  });
});
