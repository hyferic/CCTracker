import type { BenefitInstance, LifecycleStatus, UsageStatus } from '../types';
import { Temporal } from '@js-temporal/polyfill';
import { daysBetween, plainDate } from './dates';

export interface StatusResult {
  lifecycle: LifecycleStatus;
  usage: UsageStatus;
  daysRemaining: number;
  expiring7Days: boolean;
  expiring30Days: boolean;
  display: string;
}

export function calculateStatus(input: {
  today: string;
  periodStart: string;
  periodEnd: string;
  availableQuantity: number | null;
  redeemedQuantity: number;
  manuallyCompleted?: boolean;
  voided?: boolean;
}): StatusResult {
  const today = plainDate(input.today);
  const start = plainDate(input.periodStart);
  const end = plainDate(input.periodEnd);
  let lifecycle: LifecycleStatus;
  if (input.voided) lifecycle = 'void';
  else if (Temporal.PlainDate.compare(today, start) < 0) lifecycle = 'upcoming';
  else if (Temporal.PlainDate.compare(today, end) > 0) lifecycle = 'expired';
  else lifecycle = 'active';

  let usage: UsageStatus;
  if (input.availableQuantity === null) {
    usage = input.manuallyCompleted ? 'used' : input.redeemedQuantity > 0 ? 'partial' : 'unused';
  } else if (input.redeemedQuantity <= 0) usage = 'unused';
  else if (input.redeemedQuantity >= input.availableQuantity) usage = 'used';
  else usage = 'partial';

  const daysRemaining = daysBetween(today, end);
  const incomplete = usage !== 'used';
  const expiring7Days =
    lifecycle === 'active' && incomplete && daysRemaining >= 0 && daysRemaining <= 7;
  const expiring30Days =
    lifecycle === 'active' && incomplete && daysRemaining >= 0 && daysRemaining <= 30;
  const display =
    lifecycle === 'active'
      ? expiring7Days
        ? `Expiring Soon · ${usage === 'partial' ? 'Partially Used' : 'Unused'}`
        : usage === 'unused'
          ? 'Available'
          : usage === 'partial'
            ? 'Partially Used'
            : 'Used'
      : lifecycle === 'upcoming'
        ? 'Upcoming'
        : lifecycle === 'void'
          ? 'Void'
          : `Expired · ${usage === 'used' ? 'Used' : usage === 'partial' ? 'Partially Used' : 'Unused'}`;
  return { lifecycle, usage, daysRemaining, expiring7Days, expiring30Days, display };
}

export function displayStatus(
  instance: Pick<BenefitInstance, 'lifecycle_status' | 'usage_status' | 'expiring_7_days'>,
) {
  if (instance.lifecycle_status === 'active' && instance.expiring_7_days)
    return `Expiring Soon · ${instance.usage_status === 'partial' ? 'Partially Used' : 'Unused'}`;
  if (instance.lifecycle_status === 'active')
    return instance.usage_status === 'unused'
      ? 'Available'
      : instance.usage_status === 'partial'
        ? 'Partially Used'
        : 'Used';
  if (instance.lifecycle_status === 'upcoming') return 'Upcoming';
  if (instance.lifecycle_status === 'void') return 'Void';
  return `Expired · ${instance.usage_status === 'used' ? 'Used' : instance.usage_status === 'partial' ? 'Partially Used' : 'Unused'}`;
}

export function attentionScore(instance: BenefitInstance): number {
  if (instance.enrollment_missed) return 100;
  if (instance.enrollment_due_7_days) return 90;
  if (instance.expiring_7_days && instance.usage_status !== 'used') return 80;
  if (instance.enrollment_due_30_days) return 65;
  if (instance.expiring_30_days) return 60;
  if (instance.recently_activated) return 45;
  if (instance.reset_soon) return 35;
  if (instance.lifecycle_status === 'upcoming') return 20;
  return 0;
}

export function attentionLabel(instance: BenefitInstance): string {
  if (instance.enrollment_missed) return 'Enrollment overdue';
  if (instance.enrollment_due_7_days) return 'Enrollment due within 7 days';
  if (instance.enrollment_due_30_days) return 'Enrollment due in 8–30 days';
  if (instance.recently_activated) return 'Available again';
  if (instance.reset_soon) return 'Resets soon';
  if (instance.lifecycle_status === 'upcoming') return `Starts ${instance.period_start}`;
  return `${instance.days_remaining} days remaining`;
}
