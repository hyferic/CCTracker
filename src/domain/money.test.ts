import {
  availableByCurrency,
  formatQuantity,
  hasAtMostTwoDecimals,
  redemptionRemaining,
} from './money';
import { benefitInstance } from '../test/fixtures';

describe('value and balance logic', () => {
  it('calculates multiple partial redemptions and rejects overuse', () => {
    expect(redemptionRemaining(100, [40, 25])).toEqual({ used: 65, remaining: 35 });
    expect(() => redemptionRemaining(100, [80, 25])).toThrow('exceed');
    expect(redemptionRemaining(null, [10, 20])).toEqual({ used: 30, remaining: null });
  });

  it('enforces two-decimal fiat precision and formats uncapped values', () => {
    expect(hasAtMostTwoDecimals(12.34)).toBe(true);
    expect(hasAtMostTwoDecimals(12.345)).toBe(false);
    expect(formatQuantity(null, { valueKind: 'percentage_cashback', currency: 'USD' })).toBe(
      'Uncapped',
    );
    expect(formatQuantity(1500, { valueKind: 'points', unitLabel: 'points' })).toContain(
      '1,500 points',
    );
  });

  it('groups currency totals without inventing FX conversion', () => {
    const totals = availableByCurrency([
      benefitInstance({ currency: 'USD', remaining_quantity: 10 }),
      benefitInstance({ instance_id: 'other', currency: 'EUR', remaining_quantity: 20 }),
      benefitInstance({
        instance_id: 'uncapped',
        available_quantity: null,
        remaining_quantity: null,
        value_kind: 'percentage_cashback',
      }),
    ]);
    expect(totals).toEqual({ USD: 10, EUR: 20 });
  });
});
