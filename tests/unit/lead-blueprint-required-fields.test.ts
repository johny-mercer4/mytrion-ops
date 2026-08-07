import { describe, expect, it } from 'vitest';
import { enrichLeadBlueprintFields } from '../../src/modules/sales/leadBlueprintRequiredFields.js';
import type { BlueprintTransitionField } from '../../src/integrations/zohoCrmRecords.js';

function field(partial: Partial<BlueprintTransitionField> & Pick<BlueprintTransitionField, 'apiName'>): BlueprintTransitionField {
  return {
    label: partial.label ?? partial.apiName,
    dataType: partial.dataType ?? 'text',
    mandatory: partial.mandatory ?? false,
    readOnly: partial.readOnly ?? false,
    value: partial.value ?? null,
    options: partial.options ?? [],
    ...partial,
  };
}

describe('enrichLeadBlueprintFields', () => {
  it('injects Application_ID when Application Filled has no Zoho fields', () => {
    const result = enrichLeadBlueprintFields('Application Filled', []);
    expect(result).toEqual([
      expect.objectContaining({
        apiName: 'Application_ID',
        label: 'Application ID',
        mandatory: true,
        dataType: 'text',
      }),
    ]);
  });

  it('injects Not Interested / Unqualified reason picklists with known options', () => {
    const ni = enrichLeadBlueprintFields('Not Interested', []);
    expect(ni[0]).toMatchObject({
      apiName: 'Not_Interested_Reason',
      mandatory: true,
      dataType: 'picklist',
    });
    expect(ni[0]?.options.some((o) => o.value === 'Already has another fuel card')).toBe(true);

    const uq = enrichLeadBlueprintFields('Unqualified', []);
    expect(uq[0]).toMatchObject({
      apiName: 'Unqualified_Reason',
      mandatory: true,
      dataType: 'picklist',
    });
    expect(uq[0]?.options.some((o) => o.value === 'No response')).toBe(true);
  });

  it('forces mandatory and backfills empty Zoho picklist options', () => {
    const result = enrichLeadBlueprintFields('Unqualified', [
      field({ apiName: 'Unqualified_Reason', label: 'Reason', dataType: 'picklist', mandatory: false, options: [] }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.mandatory).toBe(true);
    expect(result[0]?.options.length).toBeGreaterThan(0);
  });

  it('leaves unrelated statuses unchanged', () => {
    const fields = [field({ apiName: 'Phone', mandatory: false })];
    expect(enrichLeadBlueprintFields('Interested', fields)).toEqual(fields);
  });
});
