import { Temporal } from '@js-temporal/polyfill';

export const DEFAULT_TIMEZONE = 'America/New_York';

export function plainDate(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(value);
}

export function todayInTimeZone(timeZone = DEFAULT_TIMEZONE): Temporal.PlainDate {
  return Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
}

export function localDateFromInstant(
  instant: string | Temporal.Instant,
  timeZone = DEFAULT_TIMEZONE,
): Temporal.PlainDate {
  return (typeof instant === 'string' ? Temporal.Instant.from(instant) : instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();
}

export function daysBetween(start: string | Temporal.PlainDate, end: string | Temporal.PlainDate) {
  const startDate = typeof start === 'string' ? plainDate(start) : start;
  const endDate = typeof end === 'string' ? plainDate(end) : end;
  return startDate.until(endDate, { largestUnit: 'days' }).days;
}

export function formatDate(value: string, locale = 'en-US'): string {
  const date = plainDate(value);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

export function formatInstantInTimeZone(
  value: string,
  timeZone = DEFAULT_TIMEZONE,
  locale = 'en-US',
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(Object.keys(options).length ? options : { dateStyle: 'medium', timeStyle: 'short' }),
    timeZone,
  }).format(new Date(value));
}

export function minDate(a: Temporal.PlainDate, b: Temporal.PlainDate): Temporal.PlainDate {
  return Temporal.PlainDate.compare(a, b) <= 0 ? a : b;
}

export function maxDate(a: Temporal.PlainDate, b: Temporal.PlainDate): Temporal.PlainDate {
  return Temporal.PlainDate.compare(a, b) >= 0 ? a : b;
}

export function isWithinInclusive(
  date: Temporal.PlainDate,
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
) {
  return Temporal.PlainDate.compare(date, start) >= 0 && Temporal.PlainDate.compare(date, end) <= 0;
}

export function validateTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}
