/**
 * Data Center → Clients ordering: debtors first, then Gold → Silver → Bronze → Building → No cards.
 */
import { describe, expect, it } from 'vitest';
import { resolveTier, resolveTierForRow } from '../../_shared/loyalty';
import { compareClients, type SortableClient } from './clientSort';

/** A client whose tier resolves to `bucket`, using real thresholds rather than a faked TierResult. */
function client(name: string, bucket: string, owed = 0): SortableClient {
  // T1 (1 card) thresholds: bronze 1100, silver 1500, gold 2000.
  const gallons =
    bucket === 'gold' ? 2500 : bucket === 'silver' ? 1600 : bucket === 'bronze' ? 1200 : 200;
  const tier =
    bucket === 'building'
      ? resolveTierForRow({
          activeCardsPrevMonth: 0,
          activeCardsThisMonth: 1,
          inNetworkGallonsThisMonth: gallons,
        })
      : resolveTier(1, gallons);
  return { name, owed, tier };
}

const order = (cs: SortableClient[]) => [...cs].sort(compareClients).map((c) => c.name);

describe('compareClients', () => {
  it('ranks tiers Gold → Silver → Bronze → Building → No cards', () => {
    const cs = [
      client('idle', 'idle'),
      client('building', 'building'),
      client('bronze', 'bronze'),
      client('silver', 'silver'),
      client('gold', 'gold'),
    ];
    expect(order(cs)).toEqual(['gold', 'silver', 'bronze', 'building', 'idle']);
  });

  it('puts every debtor above every non-debtor, whatever their tier', () => {
    const cs = [
      client('gold-clear', 'gold'),
      client('idle-owing', 'idle', 500),
      client('silver-clear', 'silver'),
      client('building-owing', 'building', 20),
    ];
    // Money owed outranks loyalty: the two debtors come first, then tier orders within each group.
    expect(order(cs)).toEqual(['building-owing', 'idle-owing', 'gold-clear', 'silver-clear']);
  });

  it('still ranks debtors against each other by tier', () => {
    const cs = [client('bronze-owing', 'bronze', 10), client('gold-owing', 'gold', 10)];
    expect(order(cs)).toEqual(['gold-owing', 'bronze-owing']);
  });

  it('treats under $1 as not owing (matches the card’s Owed figure)', () => {
    const cs = [client('cents', 'idle', 0.4), client('clear-gold', 'gold', 0)];
    expect(order(cs)).toEqual(['clear-gold', 'cents']);
  });

  it('is a total order, so the grid cannot reshuffle between revalidates', () => {
    const cs = [client('b', 'gold'), client('a', 'gold'), client('c', 'gold')];
    // Same tier, same gallons, no debt → the name is the last key.
    expect(order(cs)).toEqual(['a', 'b', 'c']);
    expect(order([...cs].reverse())).toEqual(['a', 'b', 'c']);
  });

  it('orders equal-rank clients by book size before falling back to the name', () => {
    const big = { name: 'zeta', owed: 0, tier: resolveTier(1, 9000) };
    const small = { name: 'alpha', owed: 0, tier: resolveTier(1, 2100) };
    expect(order([small, big])).toEqual(['zeta', 'alpha']);
  });
});
