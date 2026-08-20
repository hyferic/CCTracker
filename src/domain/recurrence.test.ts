import { Temporal } from '@js-temporal/polyfill';
import parityFixture from '../../supabase/tests/recurrence_anchor_parity.json';
import {
  addOriginalAnchorMonths,
  occurrenceAtSequence,
  occurrenceForDate,
  occurrencesThrough,
  sequenceForDate,
  type RecurrenceRule,
} from './recurrence';

const monthly: RecurrenceRule = {
  recurrenceType: 'monthly',
  recurrenceBasis: 'calendar',
  effectiveDate: '2028-01-15',
};

describe('shared SQL/TypeScript anchor parity fixture', () => {
  it.each(parityFixture.cases)(
    '$anchor plus $offsetMonths months resolves to $expected',
    ({ anchor, offsetMonths, expected }) => {
      expect(
        addOriginalAnchorMonths(Temporal.PlainDate.from(anchor), offsetMonths).toString(),
      ).toBe(expected);
    },
  );
});

describe('calendar recurrence', () => {
  it('uses actual month boundaries through February and leap years', () => {
    expect(occurrenceAtSequence(monthly, 0)).toMatchObject({
      nominalStart: '2028-01-01',
      periodStart: '2028-01-15',
      periodEnd: '2028-01-31',
    });
    expect(occurrenceAtSequence(monthly, 1)).toMatchObject({
      nominalStart: '2028-02-01',
      nominalEnd: '2028-02-29',
    });
    expect(occurrenceAtSequence({ ...monthly, effectiveDate: '2027-01-01' }, 1)?.nominalEnd).toBe(
      '2027-02-28',
    );
  });

  it.each([
    ['quarterly', '2027-04-01', '2027-06-30'],
    ['semiannual', '2027-07-01', '2027-12-31'],
    ['annual', '2028-01-01', '2028-12-31'],
  ] as const)('generates %s calendar periods', (recurrenceType, expectedStart, expectedEnd) => {
    const sequence = recurrenceType === 'annual' ? 1 : 1;
    const rule: RecurrenceRule = {
      recurrenceType,
      recurrenceBasis: 'calendar',
      effectiveDate: '2027-01-01',
    };
    expect(occurrenceAtSequence(rule, sequence)).toMatchObject({
      nominalStart: expectedStart,
      nominalEnd: expectedEnd,
    });
  });

  it('crosses December to January with deterministic keys', () => {
    const rule = { ...monthly, effectiveDate: '2027-12-01' };
    expect(occurrenceAtSequence(rule, 1)).toMatchObject({
      occurrenceKey: 'calendar:monthly:2028-01-01',
      nominalStart: '2028-01-01',
      nominalEnd: '2028-01-31',
    });
  });
});

describe('anchored recurrence', () => {
  it('uses original end-of-month anchor without drift', () => {
    const anchor = Temporal.PlainDate.from('2027-08-31');
    expect(addOriginalAnchorMonths(anchor, 1).toString()).toBe('2027-09-30');
    expect(addOriginalAnchorMonths(anchor, 2).toString()).toBe('2027-10-31');
  });

  it('returns a leap-day anniversary to Feb 29 in a leap year', () => {
    const rule: RecurrenceRule = {
      recurrenceType: 'annual',
      recurrenceBasis: 'anniversary',
      effectiveDate: '2024-02-29',
      anchorDate: '2024-02-29',
    };
    expect(occurrenceAtSequence(rule, 1)?.nominalStart).toBe('2025-02-28');
    expect(occurrenceAtSequence(rule, 4)?.nominalStart).toBe('2028-02-29');
  });

  it('supports custom N-month periods and finds the containing sequence', () => {
    const rule: RecurrenceRule = {
      recurrenceType: 'custom',
      recurrenceBasis: 'anniversary',
      effectiveDate: '2027-08-15',
      anchorDate: '2027-08-15',
      intervalMonths: 5,
    };
    expect(occurrenceAtSequence(rule, 1)).toMatchObject({
      nominalStart: '2028-01-15',
      nominalEnd: '2028-06-14',
    });
    expect(sequenceForDate(rule, '2028-06-14')).toBe(1);
    expect(occurrenceForDate(rule, '2028-06-14')?.sequence).toBe(1);
  });

  it('clips effective and final end dates without changing occurrence identity', () => {
    const rule: RecurrenceRule = {
      recurrenceType: 'quarterly',
      recurrenceBasis: 'calendar',
      effectiveDate: '2027-02-10',
      endDate: '2027-04-12',
    };
    expect(occurrenceAtSequence(rule, 0)).toMatchObject({
      nominalStart: '2027-01-01',
      periodStart: '2027-02-10',
      periodEnd: '2027-03-31',
      occurrenceKey: 'calendar:quarterly:2027-01-01',
    });
    expect(occurrenceAtSequence(rule, 1)).toMatchObject({
      nominalStart: '2027-04-01',
      periodEnd: '2027-04-12',
    });
    expect(occurrenceAtSequence(rule, 2)).toBeNull();
  });

  it('bounds generation and rejects oversized backfill', () => {
    expect(occurrencesThrough(monthly, '2028-01-15', '2028-03-01')).toHaveLength(3);
    expect(() => occurrencesThrough(monthly, '2020-01-01', '2028-01-01')).toThrow(
      'limited to 24 months',
    );
  });
});
