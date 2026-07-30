import { describe, expect, it } from 'vitest';
import {
  capabilitySummaryText,
  filterToolsForRole,
  isToolAllowedForRole,
  rolePromptPolicy,
  SKILL_CATALOG,
  skillInstructionsFor,
  skillForTool,
} from '../src/skillRegistry.js';
import {
  parseServiceFlags,
  SERVICE_CATALOG,
} from '../src/serviceRegistry.js';
import type { ToolManifest } from '../src/toolRuntime.js';

const serviceTools = Object.values(SERVICE_CATALOG).flatMap((service) => [
  ...service.tools,
]);

const manifests: ToolManifest[] = serviceTools.map((name) => ({
  name,
  description: name,
  parameters: { type: 'object' },
  riskClass: 'read',
  async execute() {
    return { content: [{ type: 'text', text: 'ok' }] };
  },
}));

describe('runtime skill registry', () => {
  it('summarizes only role-allowed enabled services', () => {
    const availability = parseServiceFlags('money_code=off,billing=on');
    const owner = capabilitySummaryText(
      'owner',
      'uz',
      availability,
    );
    expect(owner).toContain('invoice');
    expect(owner).not.toContain('Money Code');

    const driver = capabilitySummaryText(
      'driver',
      'en',
      availability,
    );
    expect(driver).toContain('transactions and reports');
    expect(driver).not.toContain('billing');
  });

  it('maps every gateway tool to exactly one Markdown-backed skill', () => {
    expect(Object.keys(SKILL_CATALOG).length).toBeGreaterThan(10);
    for (const toolName of serviceTools) {
      expect(skillForTool(toolName)?.tools).toContain(toolName);
    }
  });

  it('gives a driver self-service tools but hides owner financial and write tools', () => {
    const names = filterToolsForRole(manifests, 'driver').map(
      (manifest) => manifest.name,
    );
    expect(names).toContain('octane_card_status');
    expect(names).toContain('octane_txn_report');
    expect(names).toContain('octane_override');
    expect(names).not.toContain('octane_invoice');
    expect(names).not.toContain('octane_balance_dm');
    expect(names).not.toContain('octane_card_action');
    expect(names).not.toContain('octane_money_code');
  });

  it('gives an owner company tools but hides the driver-only override', () => {
    expect(isToolAllowedForRole('octane_invoice', 'owner')).toBe(true);
    expect(isToolAllowedForRole('octane_card_action', 'owner')).toBe(true);
    expect(isToolAllowedForRole('octane_override', 'owner')).toBe(false);
  });

  it('limits an unverified guest to core, identity, and public knowledge', () => {
    const names = filterToolsForRole(manifests, 'guest').map(
      (manifest) => manifest.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'telegram_progress',
        'telegram_buttons',
        'telegram_react',
        'octane_whoami',
        'octane_kb_search',
      ]),
    );
    expect(names.some((name) => name === 'octane_card_status')).toBe(false);
    expect(names.some((name) => name === 'telegram_read_image')).toBe(false);
  });

  it('loads only selected role-allowed skill instructions into the prompt', () => {
    const prompt = skillInstructionsFor('driver', [
      'octane_card_status',
      'octane_invoice',
    ]);
    expect(prompt).toContain('SKILL: Card diagnostics');
    expect(prompt).toContain('Read live status');
    expect(prompt).not.toContain('Billing and invoices');
    expect(rolePromptPolicy('driver')).toContain(
      'backend verified the sender as driver',
    );
  });
});
