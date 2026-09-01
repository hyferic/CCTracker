import { daysBetween, plainDate } from './dates';
import type { BenefitInstance } from '../types';

export type UrgencyGroup = 'soon' | 'month' | 'quarter' | 'year' | 'none';

const NO_DEADLINE = '9999-12-01';

export function urgencyGroup(instance: BenefitInstance, today: string): UrgencyGroup {
  if (instance.period_end >= NO_DEADLINE) return 'none';
  const days = daysBetween(today, instance.period_end);
  if (days <= 7) return 'soon';
  const current = plainDate(today);
  const end = plainDate(instance.period_end);
  const monthEnd = current.with({ day: current.daysInMonth });
  if (end.since(monthEnd).sign <= 0) return 'month';
  const quarterEndMonth = Math.ceil(current.month / 3) * 3;
  const quarterStart = plainDate(`${current.year}-${String(quarterEndMonth).padStart(2, '0')}-01`);
  const quarterEnd = quarterStart.with({ day: quarterStart.daysInMonth });
  if (end.since(quarterEnd).sign <= 0) return 'quarter';
  const yearEnd = plainDate(`${current.year}-12-31`);
  if (end.since(yearEnd).sign <= 0) return 'year';
  return 'none';
}

const GROUP_ORDER: Record<UrgencyGroup, number> = {
  soon: 0,
  month: 1,
  quarter: 2,
  year: 3,
  none: 4,
};
const CADENCE_ORDER: Record<BenefitInstance['recurrence_type'], number> = {
  one_time: 0,
  monthly: 1,
  quarterly: 2,
  semiannual: 3,
  annual: 4,
  custom: 5,
};

export function isOutstanding(instance: BenefitInstance) {
  return (
    instance.is_live &&
    instance.definition_active &&
    instance.lifecycle_status === 'active' &&
    instance.usage_status !== 'used'
  );
}

export function sortOutstanding(instances: BenefitInstance[], today: string) {
  return [...instances].sort((a, b) => {
    // Stable product order: urgency group, days, partial state, cadence, remaining/value, name, id.
    const group = GROUP_ORDER[urgencyGroup(a, today)] - GROUP_ORDER[urgencyGroup(b, today)];
    if (group) return group;
    const days = daysBetween(today, a.period_end) - daysBetween(today, b.period_end);
    if (days) return days;
    const partial = Number(b.usage_status === 'partial') - Number(a.usage_status === 'partial');
    if (partial) return partial;
    const cadence = CADENCE_ORDER[a.recurrence_type] - CADENCE_ORDER[b.recurrence_type];
    if (cadence) return cadence;
    const remaining =
      (b.remaining_quantity ?? Number.NEGATIVE_INFINITY) -
      (a.remaining_quantity ?? Number.NEGATIVE_INFINITY);
    if (remaining) return remaining;
    const value =
      (b.available_quantity ?? Number.NEGATIVE_INFINITY) -
      (a.available_quantity ?? Number.NEGATIVE_INFINITY);
    if (value) return value;
    return (
      a.benefit_name.localeCompare(b.benefit_name) || a.instance_id.localeCompare(b.instance_id)
    );
  });
}

export function groupOutstanding(instances: BenefitInstance[], today: string) {
  return (['soon', 'month', 'quarter', 'year', 'none'] as UrgencyGroup[])
    .map((group) => ({
      group,
      instances: sortOutstanding(
        instances.filter((instance) => urgencyGroup(instance, today) === group),
        today,
      ),
    }))
    .filter((section) => section.instances.length);
}
