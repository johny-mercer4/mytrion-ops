import { describe, expect, it } from 'vitest';
import { BudgetExceededError, BudgetMeter } from '../../src/modules/agents/budget.js';

const budget = { maxToolCalls: 3, maxCostUsd: 0.1, maxWallMs: 1000 };

describe('BudgetMeter', () => {
  it('allows work within limits', () => {
    const meter = new BudgetMeter(budget, () => 0);
    meter.countToolCall();
    meter.charge(0.05);
    expect(meter.snapshot()).toEqual({ toolCalls: 1, costUsd: 0.05, elapsedMs: 0 });
  });

  it('trips on too many tool calls', () => {
    const meter = new BudgetMeter(budget, () => 0);
    meter.countToolCall();
    meter.countToolCall();
    meter.countToolCall();
    expect(() => meter.countToolCall()).toThrow(BudgetExceededError);
  });

  it('trips on cost overrun', () => {
    const meter = new BudgetMeter(budget, () => 0);
    meter.charge(0.09);
    expect(() => meter.charge(0.02)).toThrow(/budget/i);
  });

  it('trips on wall-clock overrun', () => {
    let now = 0;
    const meter = new BudgetMeter(budget, () => now);
    meter.assertOk();
    now = 1001;
    expect(() => meter.assertOk()).toThrow(BudgetExceededError);
  });

  it('ignores non-finite or negative charges', () => {
    const meter = new BudgetMeter(budget, () => 0);
    meter.charge(Number.NaN);
    meter.charge(-5);
    expect(meter.snapshot().costUsd).toBe(0);
  });

  it('reports remaining wall-clock time, floored at zero', () => {
    let now = 0;
    const meter = new BudgetMeter(budget, () => now);
    expect(meter.remainingWallMs()).toBe(1000);
    now = 600;
    expect(meter.remainingWallMs()).toBe(400);
    now = 5000;
    expect(meter.remainingWallMs()).toBe(0);
  });
});
