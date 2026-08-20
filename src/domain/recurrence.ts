import { Temporal } from '@js-temporal/polyfill';
import type { RecurrenceBasis, RecurrenceType } from '../types';
import { isWithinInclusive, maxDate, minDate, plainDate } from './dates';

export interface RecurrenceRule {
  recurrenceType: RecurrenceType;
  recurrenceBasis: RecurrenceBasis;
  effectiveDate: string;
  endDate?: string | null;
  anchorDate?: string | null;
  intervalMonths?: number | null;
}

export interface Occurrence {
  sequence: number;
  occurrenceKey: string;
  nominalStart: string;
  nominalEnd: string;
  periodStart: string;
  periodEnd: string;
  label: string;
}

function calendarMonths(type: Exclude<RecurrenceType, 'one_time' | 'custom'>): number {
  return { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[type];
}

function calendarStart(
  type: Exclude<RecurrenceType, 'one_time' | 'custom'>,
  date: Temporal.PlainDate,
) {
  const months = calendarMonths(type);
  const bucketMonth = Math.floor((date.month - 1) / months) * months + 1;
  return Temporal.PlainDate.from({ year: date.year, month: bucketMonth, day: 1 });
}

export function addOriginalAnchorMonths(anchor: Temporal.PlainDate, months: number) {
  const targetMonth = anchor.with({ day: 1 }).add({ months });
  const isEndOfMonth = anchor.day === anchor.daysInMonth;
  const day = isEndOfMonth
    ? targetMonth.daysInMonth
    : Math.min(anchor.day, targetMonth.daysInMonth);
  return targetMonth.with({ day });
}

function occurrenceKey(rule: RecurrenceRule, sequence: number, nominalStart: Temporal.PlainDate) {
  const basis = rule.recurrenceBasis;
  if (basis === 'calendar') return `calendar:${rule.recurrenceType}:${nominalStart.toString()}`;
  const anchor = rule.anchorDate ?? rule.effectiveDate;
  return `anchor:${anchor}:${rule.intervalMonths ?? recurrenceIntervalMonths(rule)}:${sequence}`;
}

export function recurrenceIntervalMonths(rule: RecurrenceRule): number {
  if (rule.recurrenceType === 'custom') {
    if (!rule.intervalMonths || rule.intervalMonths < 1)
      throw new RangeError('Custom recurrence requires a positive month interval.');
    return rule.intervalMonths;
  }
  if (rule.recurrenceType === 'one_time') return 0;
  return calendarMonths(rule.recurrenceType);
}

function clipOccurrence(
  rule: RecurrenceRule,
  sequence: number,
  nominalStart: Temporal.PlainDate,
  nominalEnd: Temporal.PlainDate,
): Occurrence | null {
  const effective = plainDate(rule.effectiveDate);
  const definitionEnd = rule.endDate ? plainDate(rule.endDate) : null;
  if (definitionEnd && Temporal.PlainDate.compare(nominalStart, definitionEnd) > 0) return null;
  if (Temporal.PlainDate.compare(nominalEnd, effective) < 0) return null;
  const periodStart = maxDate(nominalStart, effective);
  const periodEnd = definitionEnd ? minDate(nominalEnd, definitionEnd) : nominalEnd;
  if (Temporal.PlainDate.compare(periodStart, periodEnd) > 0) return null;
  const label = labelOccurrence(rule.recurrenceType, nominalStart, nominalEnd);
  return {
    sequence,
    occurrenceKey: occurrenceKey(rule, sequence, nominalStart),
    nominalStart: nominalStart.toString(),
    nominalEnd: nominalEnd.toString(),
    periodStart: periodStart.toString(),
    periodEnd: periodEnd.toString(),
    label,
  };
}

export function occurrenceAtSequence(rule: RecurrenceRule, sequence: number): Occurrence | null {
  if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError('Sequence must be >= 0.');
  if (rule.recurrenceType === 'one_time') {
    if (sequence !== 0) return null;
    const start = plainDate(rule.effectiveDate);
    const end = rule.endDate ? plainDate(rule.endDate) : start;
    return clipOccurrence(rule, 0, start, end);
  }

  if (rule.recurrenceBasis === 'calendar' && rule.recurrenceType !== 'custom') {
    const first = calendarStart(rule.recurrenceType, plainDate(rule.effectiveDate));
    const months = recurrenceIntervalMonths(rule);
    const nominalStart = first.add({ months: sequence * months });
    return clipOccurrence(
      rule,
      sequence,
      nominalStart,
      nominalStart.add({ months }).subtract({ days: 1 }),
    );
  }

  const anchor = plainDate(rule.anchorDate ?? rule.effectiveDate);
  const months = recurrenceIntervalMonths(rule);
  const nominalStart = addOriginalAnchorMonths(anchor, sequence * months);
  const nextStart = addOriginalAnchorMonths(anchor, (sequence + 1) * months);
  return clipOccurrence(rule, sequence, nominalStart, nextStart.subtract({ days: 1 }));
}

export function sequenceForDate(rule: RecurrenceRule, dateValue: string): number {
  const date = plainDate(dateValue);
  if (rule.recurrenceType === 'one_time') return 0;
  if (rule.recurrenceBasis === 'calendar' && rule.recurrenceType !== 'custom') {
    const first = calendarStart(rule.recurrenceType, plainDate(rule.effectiveDate));
    const months = recurrenceIntervalMonths(rule);
    const monthDelta = (date.year - first.year) * 12 + (date.month - first.month);
    return Math.max(0, Math.floor(monthDelta / months));
  }
  const anchor = plainDate(rule.anchorDate ?? rule.effectiveDate);
  const months = recurrenceIntervalMonths(rule);
  const rough = Math.max(
    0,
    Math.floor(((date.year - anchor.year) * 12 + date.month - anchor.month) / months),
  );
  let sequence = rough;
  while (sequence > 0) {
    const occurrence = occurrenceAtSequence(rule, sequence);
    if (occurrence && Temporal.PlainDate.compare(plainDate(occurrence.nominalStart), date) <= 0)
      break;
    sequence -= 1;
  }
  while (true) {
    const next = occurrenceAtSequence(rule, sequence + 1);
    if (!next || Temporal.PlainDate.compare(plainDate(next.nominalStart), date) > 0) break;
    sequence += 1;
  }
  return sequence;
}

export function occurrenceForDate(rule: RecurrenceRule, dateValue: string): Occurrence | null {
  const date = plainDate(dateValue);
  const occurrence = occurrenceAtSequence(rule, sequenceForDate(rule, dateValue));
  if (!occurrence) return null;
  return isWithinInclusive(date, plainDate(occurrence.periodStart), plainDate(occurrence.periodEnd))
    ? occurrence
    : null;
}

export function occurrencesThrough(
  rule: RecurrenceRule,
  fromValue: string,
  throughValue: string,
  maxMonths = 24,
) {
  const from = plainDate(fromValue);
  const through = plainDate(throughValue);
  if (Temporal.PlainDate.compare(from, through) > 0) return [];
  if (from.until(through, { largestUnit: 'months' }).months > maxMonths)
    throw new RangeError(`Generation is limited to ${maxMonths} months.`);
  const startSequence = sequenceForDate(rule, fromValue);
  const output: Occurrence[] = [];
  for (let sequence = startSequence; sequence < startSequence + maxMonths + 3; sequence += 1) {
    const occurrence = occurrenceAtSequence(rule, sequence);
    if (!occurrence) break;
    if (Temporal.PlainDate.compare(plainDate(occurrence.periodStart), through) > 0) break;
    if (Temporal.PlainDate.compare(plainDate(occurrence.periodEnd), from) >= 0)
      output.push(occurrence);
  }
  return output;
}

function labelOccurrence(type: RecurrenceType, start: Temporal.PlainDate, end: Temporal.PlainDate) {
  if (type === 'monthly') return start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  if (type === 'quarterly') return `Q${Math.floor((start.month - 1) / 3) + 1} ${start.year}`;
  if (type === 'semiannual') return `${start.month === 1 ? 'H1' : 'H2'} ${start.year}`;
  if (type === 'annual' && start.month === 1 && start.day === 1) return `${start.year}`;
  return `${start.toString()} – ${end.toString()}`;
}
