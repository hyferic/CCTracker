import { z } from 'zod';

const optionalMoney = z.number().min(0).multipleOf(0.01).nullable();
const optionalPositiveMoney = z.number().positive().multipleOf(0.01).nullable();
const optionalText = z.string().trim().max(4000).nullable();

export const benefitInputSchema = z
  .object({
    account_id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().max(4000),
    notes: z.string().trim().max(8000),
    value_kind: z.enum(['money', 'percentage_cashback', 'points', 'membership', 'other']),
    amount: optionalPositiveMoney,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    unit_label: z.string().trim().max(40).nullable(),
    minimum_spend: optionalMoney,
    cashback_percentage: z.number().positive().max(100).nullable(),
    cashback_cap: optionalPositiveMoney,
    merchant: optionalText,
    merchant_category: optionalText,
    website: z.string().url().max(1000).nullable(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    eligibility_notes: z.string().trim().max(8000),
    enrollment_required: z.boolean(),
    enrollment_deadline: z.string().date().nullable(),
    enrolled_at: z.string().date().nullable(),
    effective_date: z.string().date(),
    end_date: z.string().date().nullable(),
    display_reset_date: z.string().date().nullable(),
    recurrence_enabled: z.boolean(),
    recurrence_type: z.enum(['one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom']),
    recurrence_basis: z.enum(['calendar', 'anniversary']),
    anchor_date: z.string().date().nullable(),
    interval_months: z.number().int().min(1).max(120).nullable(),
    expiration_email_enabled: z.boolean(),
    reactivation_email_enabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.end_date && value.end_date < value.effective_date)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: 'End date must be on or after the effective date.',
      });
    if (value.recurrence_type === 'one_time' && !value.end_date)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end_date'],
        message: 'One-time benefits require an expiration/end date.',
      });
    if (value.display_reset_date && !value.recurrence_enabled)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['display_reset_date'],
        message: 'Only recurring benefits can have a display reset date.',
      });
    if (value.display_reset_date && value.display_reset_date < value.effective_date)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['display_reset_date'],
        message: 'Display reset date must be on or after the effective date.',
      });
    if (value.display_reset_date && value.end_date && value.display_reset_date > value.end_date)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['display_reset_date'],
        message: 'Display reset date cannot be after the final end date.',
      });
    if (value.value_kind === 'money' && (value.amount === null || !value.currency))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Money benefits require an amount and currency.',
      });
    if (
      value.value_kind === 'money' &&
      (value.cashback_percentage !== null || value.cashback_cap !== null)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cashback_percentage'],
        message: 'Fixed-value benefits cannot include cashback fields.',
      });
    if (value.value_kind === 'percentage_cashback' && value.cashback_percentage === null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cashback_percentage'],
        message: 'Cashback offers require a percentage.',
      });
    if (value.value_kind === 'percentage_cashback' && !value.currency)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'Cashback offers require a cap currency, even if uncapped.',
      });
    if (value.value_kind === 'percentage_cashback' && value.amount !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Cashback offers use the cashback cap instead of a fixed amount.',
      });
    if (value.value_kind === 'points' && (value.amount === null || !Number.isInteger(value.amount)))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'Points must be a whole number.',
      });
    if (
      ['points', 'membership', 'other'].includes(value.value_kind) &&
      (value.amount === null || !value.unit_label)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit_label'],
        message: 'Non-monetary benefits require a positive quantity and unit label.',
      });
    if (
      ['points', 'membership', 'other'].includes(value.value_kind) &&
      (value.currency !== null ||
        value.minimum_spend !== null ||
        value.cashback_percentage !== null ||
        value.cashback_cap !== null)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value_kind'],
        message: 'Non-monetary benefits cannot include currency, spend, or cashback fields.',
      });
    if (value.recurrence_enabled && value.recurrence_type === 'one_time')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrence_type'],
        message: 'Choose a recurring interval.',
      });
    if (!value.recurrence_enabled && value.recurrence_type !== 'one_time')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrence_type'],
        message: 'One-time benefits cannot have a recurring interval.',
      });
    if (
      (value.recurrence_basis === 'anniversary' || value.recurrence_type === 'custom') &&
      value.recurrence_enabled &&
      !value.anchor_date
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor_date'],
        message: 'Anchored recurrence requires an anchor date.',
      });
    if (value.recurrence_type === 'custom' && !value.interval_months)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['interval_months'],
        message: 'Custom recurrence requires a month interval.',
      });
    if (!value.enrollment_required && value.enrollment_deadline)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['enrollment_deadline'],
        message: 'Enrollment deadline requires enrollment to be enabled.',
      });
  });

export const accountInputSchema = z
  .object({
    display_name: z.string().trim().min(1).max(120),
    issuer: z.string().trim().min(1).max(120),
    card_service_name: z.string().trim().min(1).max(120),
    nickname: z.string().trim().max(80).nullable(),
    last_four: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
    annual_fee: optionalMoney,
    annual_fee_currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    renewal_date: z.string().date().nullable(),
    notes: z.string().trim().max(4000).nullable(),
    is_active: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.annual_fee === null) !== (value.annual_fee_currency === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annual_fee_currency'],
        message: 'Annual fee and currency must be set together.',
      });
  });

export type BenefitInputValidated = z.infer<typeof benefitInputSchema>;
