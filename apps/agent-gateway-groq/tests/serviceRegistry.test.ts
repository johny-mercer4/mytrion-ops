import { describe, expect, it } from 'vitest';
import type { ToolManifest } from '../src/toolRuntime.js';
import {
  filterEnabledTools,
  isToolEnabled,
  parseServiceFlags,
  SERVICE_CATALOG,
  serviceForTool,
  serviceUnavailableText,
} from '../src/serviceRegistry.js';

function manifest(name: string): ToolManifest {
  return {
    name,
    description: name,
    parameters: { type: 'object' },
    riskClass: 'read',
    async execute() {
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}

describe('gateway service registry', () => {
  it('defaults Money Code off while existing safe services stay enabled', () => {
    const availability = parseServiceFlags();
    expect(availability.money_code).toBe(false);
    expect(availability.memory).toBe(false);
    expect(availability.cards).toBe(true);
    expect(isToolEnabled('octane_money_code', availability)).toBe(false);
    expect(isToolEnabled('octane_card_status', availability)).toBe(true);
  });

  it('switches services on and off with deployment configuration', () => {
    const availability = parseServiceFlags('money_code=on,cards=off,memory=on');
    expect(availability.money_code).toBe(true);
    expect(availability.cards).toBe(false);
    expect(availability.memory).toBe(true);
    expect(serviceForTool('octane_money_code_quote')).toBe('money_code');
  });

  it('rejects unknown, malformed, and non-toggleable service overrides', () => {
    expect(() => parseServiceFlags('made_up=on')).toThrow('unknown gateway service');
    expect(() => parseServiceFlags('money_code=maybe')).toThrow('use on/off');
    expect(() => parseServiceFlags('core=off')).toThrow('cannot be disabled');
  });

  it('never exposes disabled or unregistered gateway tools to the model', () => {
    const filtered = filterEnabledTools(
      [
        manifest('octane_money_code_quote'),
        manifest('octane_card_status'),
        manifest('octane_unregistered_future_tool'),
        manifest('unit_test_helper'),
      ],
      parseServiceFlags(),
    );
    expect(filtered.map((tool) => tool.name)).toEqual([
      'octane_card_status',
      'unit_test_helper',
    ]);
  });

  it('assigns every catalog tool to exactly one service', () => {
    const names = Object.values(SERVICE_CATALOG).flatMap((service) => [
      ...service.tools,
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(serviceForTool(name)).not.toBeNull();
  });

  it('returns a deterministic language-matched no-model response', () => {
    expect(serviceUnavailableText('money_code')).toContain(
      'Money Code xizmati hozircha o‘chirilgan',
    );
    expect(
      serviceUnavailableText('money_code', 'en'),
    ).toContain('Money Code is currently unavailable');
    expect(
      serviceUnavailableText('money_code', 'ru'),
    ).toContain('сейчас отключён');
  });
});
