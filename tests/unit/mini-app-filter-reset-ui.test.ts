import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The Mini App has no DOM test runtime. Keep a small source contract around the reset controls so
// future filter work cannot silently bring back the original dead ends (each field reset by hand).
const APP = readFileSync(join(process.cwd(), 'apps/mini-app/src/App.tsx'), 'utf8');
const SERVICES = readFileSync(join(process.cwd(), 'apps/mini-app/src/screens/ServicesTab.tsx'), 'utf8');
const I18N = readFileSync(join(process.cwd(), 'apps/mini-app/src/lib/i18n.tsx'), 'utf8');
const HTML = readFileSync(join(process.cwd(), 'apps/mini-app/index.html'), 'utf8');

describe('Mini App filter reset UX', () => {
  it('uses one shared, accessible clear-filters control across service sheets', () => {
    expect(APP).toContain('function FilterResetButton');
    expect(APP).toContain("setCardQuery(''); setCardStatusFilter('all');");
    expect(APP).toContain("setRange('month');");
    expect(APP).toContain("setTxnCardSel(null);");
    expect(APP).toContain("setInvRange('last_30'); setInvFrom(''); setInvTo('');");
    expect(APP).toContain("setCoSearch(''); setCoStatus('all');");
  });

  it('lets users clear every service and fleet search directly', () => {
    expect(SERVICES).toContain("onClick={() => setSearch('')}");
    expect(SERVICES).toContain("aria-label={t('common.clearSearch')}");
    expect(APP).toContain("setSearch(''); setFilter('all');");
    expect(APP).toContain("<SearchClearButton onClick={() => setQ('')}");
    expect(APP).toContain("<SearchClearButton onClick={() => setCardQuery('')}");
    expect(APP).toContain("<SearchClearButton onClick={() => setCoSearch('')}");
  });

  it('localizes reset labels and preserves browser zoom', () => {
    expect(I18N.match(/'common\.clearFilters':/g)).toHaveLength(4);
    expect(I18N.match(/'common\.clearSearch':/g)).toHaveLength(4);
    expect(HTML).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  });
});
