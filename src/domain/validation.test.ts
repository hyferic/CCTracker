import { accountInputSchema, benefitInputSchema } from './validation';
import type { BenefitInput } from '../types';

const fixedBenefit: BenefitInput = {
  account_id: null,
  name: 'Annual hotel credit',
  category: 'Hotel',
  description: '',
  notes: '',
  value_kind: 'money',
  amount: 100,
  currency: 'USD',
  unit_label: null,
  minimum_spend: null,
  cashback_percentage: null,
  cashback_cap: null,
  merchant: null,
  merchant_category: null,
  website: null,
  tags: [],
  eligibility_notes: '',
  enrollment_required: false,
  enrollment_deadline: null,
  enrolled_at: null,
  effective_date: '2028-01-01',
  end_date: '2028-12-31',
  display_reset_date: null,
  recurrence_enabled: true,
  recurrence_type: 'annual',
  recurrence_basis: 'calendar',
  anchor_date: null,
  interval_months: null,
  expiration_email_enabled: true,
  reactivation_email_enabled: true,
  terms_timezone: 'America/New_York',
  period_value_rules: [],
};

describe('benefit validation', () => {
  it('accepts fixed credit and capped/uncapped cashback models', () => {
    expect(benefitInputSchema.safeParse(fixedBenefit).success).toBe(true);
    const cashback = {
      ...fixedBenefit,
      value_kind: 'percentage_cashback' as const,
      amount: null,
      cashback_percentage: 10,
      cashback_cap: null,
    };
    expect(benefitInputSchema.safeParse(cashback).success).toBe(true);
    expect(benefitInputSchema.safeParse({ ...cashback, cashback_cap: 50 }).success).toBe(true);
  });

  it('rejects invalid date order, points fractions, and missing one-time expiration', () => {
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        recurrence_enabled: false,
        recurrence_type: 'one_time',
        end_date: null,
      }).success,
    ).toBe(false);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        value_kind: 'points',
        amount: 1.5,
        currency: null,
        unit_label: 'points',
      }).success,
    ).toBe(false);
    expect(benefitInputSchema.safeParse({ ...fixedBenefit, end_date: '2027-12-31' }).success).toBe(
      false,
    );
    expect(benefitInputSchema.safeParse({ ...fixedBenefit, amount: 0 }).success).toBe(false);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        display_reset_date: '2027-12-31',
      }).success,
    ).toBe(false);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        recurrence_enabled: false,
        recurrence_type: 'one_time',
        display_reset_date: '2028-06-01',
      }).success,
    ).toBe(false);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        value_kind: 'percentage_cashback',
        amount: null,
        cashback_percentage: 10,
        cashback_cap: 0,
      }).success,
    ).toBe(false);
  });

  it('validates fee/currency pairing and four digits only', () => {
    const account = {
      display_name: 'Travel Card',
      issuer: 'Example',
      card_service_name: 'Travel',
      nickname: null,
      last_four: '1234',
      annual_fee: 95,
      annual_fee_currency: 'USD',
      renewal_date: null,
      notes: null,
      is_active: true,
    };
    expect(accountInputSchema.safeParse(account).success).toBe(true);
    expect(accountInputSchema.safeParse({ ...account, annual_fee_currency: null }).success).toBe(
      false,
    );
    expect(accountInputSchema.safeParse({ ...account, last_four: '12345' }).success).toBe(false);
  });

  it('allows only unique month-specific values on calendar money benefits', () => {
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        period_value_rules: [{ calendar_month: 12, available_quantity: 35 }],
      }).success,
    ).toBe(true);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        period_value_rules: [
          { calendar_month: 12, available_quantity: 35 },
          { calendar_month: 12, available_quantity: 40 },
        ],
      }).success,
    ).toBe(false);
    expect(
      benefitInputSchema.safeParse({
        ...fixedBenefit,
        recurrence_basis: 'anniversary',
        anchor_date: '2028-01-01',
        period_value_rules: [{ calendar_month: 12, available_quantity: 35 }],
      }).success,
    ).toBe(false);
  });
});
