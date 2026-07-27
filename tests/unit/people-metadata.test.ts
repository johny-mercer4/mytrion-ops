import { describe, expect, it } from 'vitest';
import {
  filterForms,
  flattenGetRecordsResult,
  formApiName,
  mapComponent,
} from '../../metadataScripts/lib/peopleForms.js';

describe('mapComponent', () => {
  it('reads lowercase People API keys (labelname / comptype)', () => {
    expect(
      mapComponent({
        labelname: 'EmailID',
        displayname: 'Email address',
        comptype: 'Email',
        ismandatory: true,
      }),
    ).toEqual({
      apiName: 'EmailID',
      label: 'Email address',
      dataType: 'Email',
      mandatory: true,
    });
  });
});

describe('filterForms', () => {
  const forms = [
    { formLinkName: 'employee', displayName: 'Employee' },
    { formLinkName: 'department', displayName: 'Department' },
  ];

  it('matches formLinkName or displayName case-insensitively', () => {
    expect(filterForms(forms, ['Employee']).map(formApiName)).toEqual(['employee']);
    expect(filterForms(forms, ['DEPARTMENT']).map(formApiName)).toEqual(['department']);
  });

  it('throws on unknown modules with a hint list', () => {
    expect(() => filterForms(forms, ['nope'])).toThrow(/unknown module/);
  });
});

describe('flattenGetRecordsResult', () => {
  it('flattens nested getRecords rows', () => {
    const rows = flattenGetRecordsResult([
      { '111': [{ FirstName: 'Ada', EmailID: 'ada@example.com' }] },
      { '222': [{ FirstName: 'Grace' }] },
    ]);
    expect(rows).toEqual([
      { recordId: '111', fields: { FirstName: 'Ada', EmailID: 'ada@example.com' } },
      { recordId: '222', fields: { FirstName: 'Grace' } },
    ]);
  });
});
