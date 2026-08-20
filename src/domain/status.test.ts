import { calculateStatus, displayStatus } from './status';
import { benefitInstance } from '../test/fixtures';

describe('independent lifecycle and usage status', () => {
  it.each([
    ['2028-01-31', 'upcoming'],
    ['2028-02-01', 'active'],
    ['2028-02-29', 'active'],
    ['2028-03-01', 'expired'],
  ] as const)('derives %s as %s', (today, lifecycle) => {
    expect(
      calculateStatus({
        today,
        periodStart: '2028-02-01',
        periodEnd: '2028-02-29',
        availableQuantity: 100,
        redeemedQuantity: 0,
      }).lifecycle,
    ).toBe(lifecycle);
  });

  it.each([
    [0, 'unused'],
    [25, 'partial'],
    [100, 'used'],
  ] as const)('derives finite redemption %s as %s', (redeemedQuantity, usage) => {
    expect(
      calculateStatus({
        today: '2028-02-10',
        periodStart: '2028-02-01',
        periodEnd: '2028-02-29',
        availableQuantity: 100,
        redeemedQuantity,
      }).usage,
    ).toBe(usage);
  });

  it('requires explicit completion for an uncapped offer', () => {
    const base = {
      today: '2028-02-10',
      periodStart: '2028-02-01',
      periodEnd: '2028-02-29',
      availableQuantity: null,
    };
    expect(calculateStatus({ ...base, redeemedQuantity: 0 }).usage).toBe('unused');
    expect(calculateStatus({ ...base, redeemedQuantity: 20 }).usage).toBe('partial');
    expect(calculateStatus({ ...base, redeemedQuantity: 20, manuallyCompleted: true }).usage).toBe(
      'used',
    );
  });

  it('flags exactly seven days and composes the display label', () => {
    const result = calculateStatus({
      today: '2028-02-22',
      periodStart: '2028-02-01',
      periodEnd: '2028-02-29',
      availableQuantity: 100,
      redeemedQuantity: 25,
    });
    expect(result).toMatchObject({
      daysRemaining: 7,
      expiring7Days: true,
      expiring30Days: true,
      display: 'Expiring Soon · Partially Used',
    });
    expect(displayStatus(benefitInstance())).toBe('Expiring Soon · Partially Used');
  });
});
