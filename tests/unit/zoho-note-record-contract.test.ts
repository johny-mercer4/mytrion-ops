import { describe, expect, it } from 'vitest';
import { ZohoCrmRecordsWrapper } from '../../src/integrations/zohoCrmRecords.js';
import type { HttpMethod, HttpRequestOptions } from '../../src/integrations/core/base.js';

class StubZohoCrmRecords extends ZohoCrmRecordsWrapper {
  readonly calls: Array<{ method: HttpMethod; path: string; options: HttpRequestOptions }> = [];

  constructor(private readonly responses: Response[]) {
    super();
  }

  protected override requestRaw(
    method: HttpMethod,
    path: string,
    options: HttpRequestOptions = {},
  ): Promise<Response> {
    this.calls.push({ method, path, options });
    const response = this.responses.shift();
    if (!response) throw new Error('No stub response queued');
    return Promise.resolve(response);
  }
}

function successResponse(): Response {
  return new Response(JSON.stringify({
    data: [{ code: 'SUCCESS', status: 'success', details: { id: '7001' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Zoho CRM single-note mutation contract', () => {
  it('PATCHes the exact Notes record endpoint with only the editable fields', async () => {
    const wrapper = new StubZohoCrmRecords([successResponse()]);

    await wrapper.patchRecord('Notes', '7001', {
      Note_Title: 'Updated',
      Note_Content: 'Body',
    });

    expect(wrapper.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/Notes/7001',
      options: {
        body: { data: [{ Note_Title: 'Updated', Note_Content: 'Body' }] },
      },
    });
  });

  it('DELETEs the exact Notes record endpoint and checks the row result', async () => {
    const wrapper = new StubZohoCrmRecords([successResponse()]);

    await wrapper.deleteRecordById('Notes', '7001');

    expect(wrapper.calls[0]).toMatchObject({
      method: 'DELETE',
      path: '/Notes/7001',
    });
  });
});
