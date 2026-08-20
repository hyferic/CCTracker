import { Temporal } from '@js-temporal/polyfill';
import {
  daysBetween,
  formatDate,
  formatInstantInTimeZone,
  isWithinInclusive,
  localDateFromInstant,
  plainDate,
  validateTimeZone,
} from './dates';

describe('date-only and timezone rules', () => {
  it('calculates inclusive expiration days without UTC parsing', () => {
    expect(daysBetween('2028-02-22', '2028-02-29')).toBe(7);
    expect(daysBetween('2028-02-29', '2028-02-29')).toBe(0);
    expect(daysBetween('2028-03-01', '2028-02-29')).toBe(-1);
    expect(formatDate('2028-02-29')).toBe('Feb 29, 2028');
  });

  it('uses the explicit IANA timezone across midnight and DST', () => {
    const instant = '2027-03-14T04:30:00Z';
    expect(localDateFromInstant(instant, 'America/New_York').toString()).toBe('2027-03-13');
    expect(localDateFromInstant(instant, 'Asia/Tokyo').toString()).toBe('2027-03-14');
    expect(localDateFromInstant('2027-03-14T07:30:00Z', 'America/New_York').toString()).toBe(
      '2027-03-14',
    );
    expect(
      formatInstantInTimeZone('2028-01-01T02:30:00Z', 'America/New_York', 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    ).toBe('12/31/2027');
  });

  it('validates zones and inclusive boundaries', () => {
    expect(validateTimeZone('America/New_York')).toBe(true);
    expect(validateTimeZone('Not/A_Timezone')).toBe(false);
    expect(
      isWithinInclusive(plainDate('2028-02-29'), plainDate('2028-02-01'), plainDate('2028-02-29')),
    ).toBe(true);
    expect(Temporal.PlainDate.compare(plainDate('2028-03-01'), plainDate('2028-02-29'))).toBe(1);
  });
});
