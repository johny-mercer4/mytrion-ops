import { describe, expect, it } from 'vitest';
import { supportBotKnowledgeRepo } from '../../src/repos/supportBotKnowledgeRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function ctx(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'gateway',
    audience: 'customer',
    role: 'fleet_manager',
    scopes: [],
    departments: [],
    allDepartmentAccess: false,
    requestId: `req-${tenantId}`,
  };
}

describe('supportBotKnowledgeRepo isolation', () => {
  it('binds tenant, global-or-exact carrier, published status and enabled services', () => {
    const rendered = supportBotKnowledgeRepo
      .buildVectorQuery(
        ctx('tenant-a'),
        { carrierId: 'carrier-a', enabledServices: ['cards', 'knowledge'] },
        [0.1, 0.2, 0.3],
        3,
      )
      .toSQL();

    expect(rendered.sql).toContain(
      '"support_bot_knowledge_articles"."tenant_id"',
    );
    expect(rendered.sql).toContain(
      '"support_bot_knowledge_articles"."carrier_id"',
    );
    expect(rendered.sql).toContain(
      '"support_bot_knowledge_articles"."service_id"',
    );
    expect(rendered.sql).toContain(
      '"support_bot_knowledge_articles"."status"',
    );
    expect(rendered.params).toEqual(
      expect.arrayContaining([
        'tenant-a',
        'published',
        '*',
        'carrier-a',
        'cards',
        'knowledge',
      ]),
    );
  });

  it('renders distinct scope values for another tenant and carrier', () => {
    const tenantA = supportBotKnowledgeRepo
      .buildFullTextQuery(
        ctx('tenant-a'),
        { carrierId: 'carrier-a', enabledServices: [] },
        'supported stations',
        3,
      )
      .toSQL();
    const tenantB = supportBotKnowledgeRepo
      .buildFullTextQuery(
        ctx('tenant-b'),
        { carrierId: 'carrier-b', enabledServices: [] },
        'supported stations',
        3,
      )
      .toSQL();

    expect(tenantA.params).toContain('tenant-a');
    expect(tenantA.params).toContain('carrier-a');
    expect(tenantA.params).not.toContain('tenant-b');
    expect(tenantB.params).toContain('tenant-b');
    expect(tenantB.params).toContain('carrier-b');
    expect(tenantB.params).not.toContain('tenant-a');
    expect(tenantA.sql).toContain("websearch_to_tsquery('simple'");
  });
});
