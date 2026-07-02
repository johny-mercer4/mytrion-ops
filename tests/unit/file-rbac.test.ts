/**
 * File RBAC (rule 9): visibility SQL is tenant + department/ownership scoped; the write-risk
 * ingest tool stays admin-sentinel; department policy for file tools derives from the manifests.
 */
import { describe, expect, it } from 'vitest';
import { fileRepo } from '../../src/repos/fileRepo.js';
import {
  ADMIN_ONLY_DEPARTMENTS,
  departmentsForTool,
} from '../../src/modules/agents/departmentAgents.js';
import { KNOWN_DEPARTMENTS } from '../../src/lib/department.js';
import { makeContext } from '../fixtures/seed.js';

describe('file visibility SQL', () => {
  it('non-admin: tenant + (dept-or-NULL or ownership) — foreign departments never widen it', () => {
    const ctx = makeContext({
      tenantId: 'octane',
      userId: 'zoho:42',
      scopes: ['*'],
      departments: ['sales'],
      allDepartmentAccess: false,
    });
    const { sql, params } = fileRepo.buildFindQuery(ctx, 'file-1').toSQL();
    const strings = params.filter((p): p is string => typeof p === 'string');
    expect(strings).toContain('octane');
    expect(strings).toContain('sales');
    expect(strings).toContain('zoho:42'); // ownership escape hatch
    for (const dept of KNOWN_DEPARTMENTS.filter((d) => d !== 'sales')) {
      expect(strings).not.toContain(dept);
    }
    expect(sql).toContain('is null'); // tenant-global files stay visible
  });

  it('admin: tenant filter only (no department/ownership restriction)', () => {
    const admin = makeContext({ tenantId: 'octane', allDepartmentAccess: true });
    const { params } = fileRepo.buildFindQuery(admin, 'file-1').toSQL();
    const strings = params.filter((p): p is string => typeof p === 'string');
    expect(strings).toContain('octane');
    expect(strings.filter((s) => (KNOWN_DEPARTMENTS as readonly string[]).includes(s))).toEqual([]);
  });
});

describe('file tool department policy (derived from manifests)', () => {
  it('generate/analyze tools are available to every real department', () => {
    const depts = departmentsForTool('file.generate_csv').sort();
    expect(depts).toEqual(
      ['billing', 'c-level', 'collection', 'customer-service', 'finance', 'management', 'marketing', 'retention', 'sales', 'verification'],
    );
    expect(departmentsForTool('file.analyze').sort()).toEqual(depts);
  });

  it('ingest_to_knowledge (write) is admin-sentinel — no manifest lists it', () => {
    expect(departmentsForTool('file.ingest_to_knowledge')).toEqual([...ADMIN_ONLY_DEPARTMENTS]);
  });
});
