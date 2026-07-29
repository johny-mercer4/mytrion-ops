import { createId } from '@paralleldrive/cuid2';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.MYTRION_OPS_TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

describeDatabase('Data Loader trigger journal', () => {
  beforeAll(() => {
    sql = postgres(testDatabaseUrl ?? '', { max: 1 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 2 });
  });

  it('captures the correct before-image on update and delete', async () => {
    const id = `nws_test_${createId()}`;
    const batchId = `trigger-test:${id}`;
    await sql`SELECT set_config('mytrion.batch_id', ${batchId}, false)`;
    try {
      await sql`
        INSERT INTO client_news (
          id, tenant_id, title, body, audience_scope, carrier_ids, roles, severity, pinned, created_by
        )
        VALUES (
          ${id}, 'octane', ${sql.json({ en: 'Before' })}, ${sql.json({ en: 'Body' })},
          'all', ${sql.json([])}, ${sql.json(['owner'])}, 'info', false, 'trigger-test'
        )
      `;
      await sql`
        UPDATE client_news
        SET title = ${sql.json({ en: 'After' })}, updated_at = now()
        WHERE tenant_id = 'octane' AND id = ${id}
      `;
      await sql`DELETE FROM client_news WHERE tenant_id = 'octane' AND id = ${id}`;

      const rows = await sql<
        Array<{ op: string; before: { title?: { en?: string } } | null }>
      >`
        SELECT op, before
        FROM bulk_change_log
        WHERE tenant_id = 'octane' AND batch_id = ${batchId}
        ORDER BY created_at, id
      `;
      expect(rows.map((row) => row.op)).toEqual(['insert', 'update', 'delete']);
      expect(rows[1]?.before?.title?.en).toBe('Before');
      expect(rows[2]?.before?.title?.en).toBe('After');
    } finally {
      await sql`DELETE FROM client_news WHERE tenant_id = 'octane' AND id = ${id}`;
      await sql`DELETE FROM bulk_change_log WHERE tenant_id = 'octane' AND batch_id = ${batchId}`;
    }
  });
});

