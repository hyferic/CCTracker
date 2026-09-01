import type { BenefitInstance, ValueKind } from '../types';

export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(Math.round(value * 100) - value * 100) < 1e-8;
}

export function formatQuantity(
  value: number | null,
  options: {
    valueKind: ValueKind;
    currency?: string | null;
    unitLabel?: string | null;
    locale?: string;
  },
) {
  if (value === null)
    return options.locale?.toLowerCase().startsWith('zh') ? '不限额度' : 'Uncapped';
  if (options.valueKind === 'money' || options.valueKind === 'percentage_cashback') {
    return new Intl.NumberFormat(options.locale ?? 'en-US', {
      style: 'currency',
      currency: options.currency ?? 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return `${new Intl.NumberFormat(options.locale ?? 'en-US', { maximumFractionDigits: 2 }).format(value)} ${options.unitLabel ?? (options.valueKind === 'points' ? 'points' : 'units')}`;
}

export function availableByCurrency(instances: BenefitInstance[]) {
  return instances.reduce<Record<string, number>>((totals, instance) => {
    if (
      instance.lifecycle_status === 'active' &&
      instance.remaining_quantity !== null &&
      (instance.value_kind === 'money' || instance.value_kind === 'percentage_cashback')
    ) {
      const currency = instance.currency ?? 'USD';
      totals[currency] = (totals[currency] ?? 0) + instance.remaining_quantity;
    }
    return totals;
  }, {});
}

export function redemptionRemaining(available: number | null, redemptions: number[]) {
  if (redemptions.some((amount) => amount <= 0 || !Number.isFinite(amount)))
    throw new RangeError('Redemptions must be positive finite values.');
  const used = redemptions.reduce((sum, amount) => sum + amount, 0);
  if (available === null) return { used, remaining: null };
  if (used > available + 1e-8) throw new RangeError('Redemptions exceed the benefit value.');
  return { used, remaining: Math.max(0, available - used) };
}
