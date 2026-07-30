import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DbSchemaSnapshot } from '../../api/schema';
import { SchemaBrowser } from './SchemaBrowser';

const snapshot: DbSchemaSnapshot = {
  database: 'mytrion_test',
  fetchedAt: '2026-07-28T12:00:00.000Z',
  schemas: ['public'],
  tableCount: 2,
  columnCount: 4,
  tables: [
    {
      schema: 'public',
      name: 'kpi_workers',
      type: 'BASE TABLE',
      approxRows: 65,
      updateTime: '2026-07-28T11:00:00.000Z',
      createTime: null,
      comment: 'Sales KPI worker directory',
      writeActivity: {
        inserts: 65,
        updates: 15,
        deletes: 0,
        totalWrites: 80,
        statsResetAt: '2026-07-08T12:00:00.000Z',
        writesPerDay: 4,
        frequency: 'Daily',
      },
      columns: [
        {
          name: 'id',
          type: 'text',
          dataType: 'text',
          nullable: false,
          key: 'PRI',
          default: null,
          extra: '',
          comment: '',
        },
        {
          name: 'zoho_user_id',
          type: 'text',
          dataType: 'text',
          nullable: false,
          key: 'UNI',
          default: null,
          extra: '',
          comment: 'Zoho API user id',
        },
      ],
    },
    {
      schema: 'public',
      name: 'kpi_activity_events',
      type: 'BASE TABLE',
      approxRows: 120,
      updateTime: null,
      createTime: null,
      comment: 'Semantic UI activity',
      writeActivity: {
        inserts: 120,
        updates: 0,
        deletes: 0,
        totalWrites: 120,
        statsResetAt: '2026-07-08T12:00:00.000Z',
        writesPerDay: 6,
        frequency: 'Daily',
      },
      columns: [
        {
          name: 'event_name',
          type: 'text',
          dataType: 'text',
          nullable: false,
          key: '',
          default: null,
          extra: '',
          comment: '',
        },
        {
          name: 'metadata',
          type: 'jsonb',
          dataType: 'jsonb',
          nullable: true,
          key: '',
          default: null,
          extra: '',
          comment: 'Allowlisted event metadata',
        },
      ],
    },
  ],
};

describe('SchemaBrowser metadata search', () => {
  it('shows table write frequency and expanded column/API metadata', async () => {
    const user = userEvent.setup();
    render(
      <SchemaBrowser
        title="Mytrion Database"
        subtitle="Read-only metadata"
        load={vi.fn(async () => snapshot)}
      />,
    );

    expect(await screen.findByText('Daily · 4.0/day')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /kpi_workers/i }));
    expect(screen.getByText('Column / API name')).toBeInTheDocument();
    expect(screen.getByText('zoho_user_id')).toBeInTheDocument();
    expect(screen.getByText('Zoho API user id')).toBeInTheDocument();
  });

  it('searches column names, SQL types, and comments and opens the matching table', async () => {
    const user = userEvent.setup();
    render(
      <SchemaBrowser
        title="Mytrion Database"
        subtitle="Read-only metadata"
        load={vi.fn(async () => snapshot)}
      />,
    );
    await screen.findByText('kpi_workers');

    await user.type(screen.getByPlaceholderText('Search tables & columns…'), 'jsonb');

    expect(screen.queryByText('kpi_workers')).not.toBeInTheDocument();
    expect(screen.getByText('kpi_activity_events')).toBeInTheDocument();
    expect(screen.getByText('metadata')).toBeInTheDocument();
    expect(screen.getByText('Allowlisted event metadata')).toBeInTheDocument();
  });
});
