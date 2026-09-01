import { describe, expect, it } from 'vitest';
import { benefitInstance } from '../test/fixtures';
import { groupOutstanding, sortOutstanding, urgencyGroup } from './dashboard';

describe('dashboard ordering', () => {
  it('groups deadlines by urgency while keeping no-deadline items last', () => {
    const today = '2028-02-24';
    expect(urgencyGroup(benefitInstance({ period_end: '2028-02-28' }), today)).toBe('soon');
    expect(urgencyGroup(benefitInstance({ period_end: '2028-02-29' }), '2028-02-01')).toBe('month');
    expect(urgencyGroup(benefitInstance({ period_end: '2028-03-31' }), today)).toBe('quarter');
    expect(urgencyGroup(benefitInstance({ period_end: '9999-12-01' }), today)).toBe('none');
    expect(
      groupOutstanding(
        [
          benefitInstance({ instance_id: 'year', period_end: '2028-12-31' }),
          benefitInstance({ instance_id: 'soon', period_end: '2028-02-28' }),
        ],
        today,
      ).map((section) => section.group),
    ).toEqual(['soon', 'year']);
  });

  it('uses partial state, cadence, value, name, and id as deterministic tie-breaks', () => {
    const base = { period_end: '2028-02-28', days_remaining: 4 };
    const ordered = sortOutstanding(
      [
        benefitInstance({
          ...base,
          instance_id: 'z',
          benefit_name: 'Same',
          usage_status: 'unused',
          recurrence_type: 'annual',
          remaining_quantity: 99,
          available_quantity: 99,
        }),
        benefitInstance({
          ...base,
          instance_id: 'b',
          benefit_name: 'Same',
          usage_status: 'partial',
          recurrence_type: 'monthly',
          remaining_quantity: 1,
          available_quantity: 1,
        }),
        benefitInstance({
          ...base,
          instance_id: 'value-high',
          benefit_name: 'Same',
          usage_status: 'partial',
          recurrence_type: 'monthly',
          remaining_quantity: 1,
          available_quantity: 9,
        }),
        benefitInstance({
          ...base,
          instance_id: 'annual',
          benefit_name: 'Same',
          usage_status: 'partial',
          recurrence_type: 'annual',
          remaining_quantity: 1,
          available_quantity: 1,
        }),
        benefitInstance({
          ...base,
          instance_id: 'a',
          benefit_name: 'Same',
          usage_status: 'partial',
          recurrence_type: 'monthly',
          remaining_quantity: 1,
          available_quantity: 1,
        }),
      ],
      '2028-02-24',
    );
    expect(ordered.map((item) => item.instance_id)).toEqual([
      'value-high',
      'a',
      'b',
      'annual',
      'z',
    ]);
  });
});
