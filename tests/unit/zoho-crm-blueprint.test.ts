import { describe, expect, it } from 'vitest';
import {
  ZohoCrmRecordsWrapper,
  type BlueprintDetails,
} from '../../src/integrations/zohoCrmRecords.js';
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Zoho CRM record Blueprint contract', () => {
  it('parses process info, live transitions, required fields, and picklist values', async () => {
    const wrapper = new StubZohoCrmRecords([jsonResponse({
      blueprint: {
        process_info: {
          id: '6227679000162301360', name: 'Lead flow', api_name: 'Status',
          field_label: 'Lead Status', field_value: 'Third Call',
        },
        transitions: [{
          id: '6227679000162301999', name: 'Unqualified', next_field_value: 'Unqualified',
          type: 'manual', criteria_matched: true, data: { Unqualified_Reason: null },
          fields: [{
            api_name: 'Unqualified_Reason', display_label: 'Reason', data_type: 'picklist',
            mandatory: true, read_only: false,
            pick_list_values: [{ display_value: 'No response', actual_value: 'No response' }],
          }],
        }],
      },
    })]);

    const result = await wrapper.getBlueprintDetails('Leads', '555');
    expect(result).toEqual<BlueprintDetails>({
      process: {
        id: '6227679000162301360', name: 'Lead flow', fieldApiName: 'Status',
        fieldLabel: 'Lead Status', currentValue: 'Third Call',
      },
      transitions: [{
        id: '6227679000162301999', name: 'Unqualified', nextValue: 'Unqualified', type: 'manual',
        criteriaMatched: true, criteriaMessage: '',
        fields: [{
          apiName: 'Unqualified_Reason', label: 'Reason', dataType: 'picklist', mandatory: true,
          readOnly: false, value: null, options: [{ label: 'No response', value: 'No response' }],
        }],
      }],
    });
  });

  it('falls back to display_value when Zoho omits picklist actual_value', async () => {
    const wrapper = new StubZohoCrmRecords([jsonResponse({
      blueprint: {
        process_info: {
          id: '1', name: 'Lead flow', api_name: 'Status', field_label: 'Status', field_value: 'Third Call',
        },
        transitions: [{
          id: '2', name: 'Not Interested', next_field_value: 'Not Interested',
          type: 'manual', criteria_matched: true, data: {},
          fields: [{
            api_name: 'Not_Interested_Reason', display_label: 'Not Interested Reason', data_type: 'picklist',
            mandatory: true, read_only: false,
            pick_list_values: [{ display_value: 'Wrong language' }],
          }],
        }],
      },
    })]);

    const result = await wrapper.getBlueprintDetails('Leads', '555');
    expect(result?.transitions[0]?.fields[0]?.options).toEqual([
      { label: 'Wrong language', value: 'Wrong language' },
    ]);
  });

  it('returns null only for Zoho RECORD_NOT_IN_PROCESS and propagates permission failures', async () => {
    const outside = new StubZohoCrmRecords([
      jsonResponse({ code: 'RECORD_NOT_IN_PROCESS', message: 'Record not in process' }, 400),
    ]);
    await expect(outside.getBlueprintDetails('Leads', '555')).resolves.toBeNull();

    const forbidden = new StubZohoCrmRecords([
      jsonResponse({ code: 'NO_PERMISSION', message: 'Permission denied' }, 403),
    ]);
    await expect(forbidden.getBlueprintDetails('Leads', '555')).rejects.toMatchObject({ status: 403 });
  });

  it('sends the official PUT envelope and checks a top-level Zoho result code', async () => {
    const success = new StubZohoCrmRecords([jsonResponse({
      code: 'SUCCESS', status: 'success', message: 'transition updated successfully', details: {},
    })]);
    await success.executeBlueprintTransition('Leads', '555', '6227679000162301999', {
      Unqualified_Reason: 'No response',
    });
    expect(success.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/Leads/555/actions/blueprint',
      options: {
        body: {
          blueprint: [{
            transition_id: '6227679000162301999',
            data: { Unqualified_Reason: 'No response' },
          }],
        },
      },
    });

    const failure = new StubZohoCrmRecords([jsonResponse({
      code: 'MANDATORY_NOT_FOUND', status: 'error', message: 'mandatory param missing', details: {},
    })]);
    await expect(failure.executeBlueprintTransition('Leads', '555', '1')).rejects.toThrow('MANDATORY_NOT_FOUND');
  });
});
