export type ValueKind = 'money' | 'percentage_cashback' | 'points' | 'membership' | 'other';
export type RecurrenceType =
  | 'one_time'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'custom';
export type RecurrenceBasis = 'none' | 'calendar' | 'anniversary';
export type LifecycleStatus = 'upcoming' | 'active' | 'expired' | 'void';
export type UsageStatus = 'unused' | 'partial' | 'used';
export type EditScope = 'future' | 'current_and_future' | 'this_period';

export interface Profile {
  user_id: string;
  email: string;
  notification_email: string | null;
  timezone: string;
  expiration_reminders_enabled: boolean;
  reactivation_reminders_enabled: boolean;
  recent_reset_days: number;
}

export interface Account {
  id: string;
  user_id: string;
  display_name: string;
  issuer: string;
  card_service_name: string;
  nickname: string | null;
  last_four: string | null;
  annual_fee: number | null;
  annual_fee_currency: string | null;
  renewal_date: string | null;
  benefit_anniversary_date: string | null;
  origin_product_version_id: string | null;
  origin_product_stable_key: string | null;
  origin_product_version: number | null;
  origin_product_hash: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BenefitInput {
  account_id: string | null;
  name: string;
  category: string;
  description: string;
  notes: string;
  value_kind: ValueKind;
  amount: number | null;
  currency: string | null;
  unit_label: string | null;
  minimum_spend: number | null;
  cashback_percentage: number | null;
  cashback_cap: number | null;
  merchant: string | null;
  merchant_category: string | null;
  website: string | null;
  tags: string[];
  eligibility_notes: string;
  enrollment_required: boolean;
  enrollment_deadline: string | null;
  enrolled_at: string | null;
  effective_date: string;
  end_date: string | null;
  display_reset_date: string | null;
  recurrence_enabled: boolean;
  recurrence_type: RecurrenceType;
  recurrence_basis: Exclude<RecurrenceBasis, 'none'>;
  anchor_date: string | null;
  interval_months: number | null;
  expiration_email_enabled: boolean;
  reactivation_email_enabled: boolean;
  terms_timezone: string;
  period_value_rules: PeriodValueRule[];
}

export interface PeriodValueRule {
  calendar_month: number;
  available_quantity: number;
}

export interface BenefitDefinition extends BenefitInput {
  id: string;
  user_id: string;
  active: boolean;
  current_revision_no: number;
  created_at: string;
  updated_at: string;
  origin_source: 'manual' | 'catalog' | 'import';
  origin_template_version_id: string | null;
  origin_template_stable_key: string | null;
  origin_template_version: number | null;
  origin_template_hash: string | null;
  origin_verified_on: string | null;
  customized_at: string | null;
}

export interface BenefitInstance {
  instance_id: string;
  definition_id: string;
  revision_id: string;
  account_id: string | null;
  benefit_name: string;
  account_display_name: string | null;
  issuer: string | null;
  category: string;
  description: string | null;
  notes: string | null;
  merchant: string | null;
  merchant_category: string | null;
  website: string | null;
  eligibility_notes: string | null;
  tags: string[];
  value_kind: ValueKind;
  available_quantity: number | null;
  redeemed_quantity: number;
  remaining_quantity: number | null;
  earned_to_date: number;
  currency: string | null;
  unit_label: string | null;
  cashback_percentage: number | null;
  minimum_spend: number | null;
  period_label: string;
  nominal_start: string;
  nominal_end: string;
  period_start: string;
  period_end: string;
  recurrence_type: RecurrenceType;
  recurrence_basis: RecurrenceBasis;
  lifecycle_status: LifecycleStatus;
  usage_status: UsageStatus;
  days_remaining: number;
  expiring_7_days: boolean;
  expiring_30_days: boolean;
  recently_activated: boolean;
  reset_soon: boolean;
  enrollment_due: boolean;
  enrollment_missed: boolean;
  enrollment_due_7_days: boolean;
  enrollment_due_30_days: boolean;
  enrollment_required: boolean;
  enrollment_deadline: string | null;
  enrolled_at: string | null;
  definition_active: boolean;
  recurrence_enabled: boolean;
  manually_completed_at: string | null;
  occurrence_key: string;
  instance_version: number;
  display_reset_date: string | null;
  supersedes_instance_id: string | null;
  superseded_by_instance_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  is_live: boolean;
  is_audit_version: boolean;
  search_text: string;
  origin_source: 'manual' | 'catalog' | 'import';
  origin_template_version_id: string | null;
  origin_template_stable_key: string | null;
  origin_template_version: number | null;
  origin_verified_on: string | null;
  customized_at: string | null;
  terms_timezone: string;
  period_value_rules: PeriodValueRule[];
}

export interface CardCatalogTemplate {
  template_version_id: string;
  template_stable_key: string;
  template_version: number;
  template_name: string;
  summary: string;
  payload: Record<string, unknown>;
  date_strategy: 'calendar' | 'account_anniversary' | 'fixed' | 'qualification_cycle';
  fixed_start: string | null;
  fixed_end: string | null;
  setup_field: 'benefit_anniversary_date' | 'first_qualifying_month' | null;
  terms_timezone: string;
  default_selected: boolean;
  confidence: 'high' | 'limited' | 'contingent';
  official_url: string;
  verified_on: string;
  age_days: number;
}

export interface CardCatalogProduct {
  product_version_id: string;
  product_stable_key: string;
  product_version: number;
  issuer: string;
  product_name: string;
  aliases: string[];
  market_scope: string;
  annual_fee: number | null;
  annual_fee_currency: string | null;
  official_url: string;
  verified_on: string;
  age_days: number;
  templates: CardCatalogTemplate[];
}

export interface TemplateSelection {
  template_version_id: string;
  setup?: { first_qualifying_month?: string };
}

export interface Redemption {
  id: string;
  benefit_instance_id: string;
  user_id: string;
  quantity: number;
  used_on: string;
  merchant: string | null;
  transaction_description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerHealth {
  last_success_at: string | null;
  last_status: string | null;
  next_expected_at: string | null;
  failed_count: number;
  requires_review_count: number;
  is_stale: boolean;
}

export interface NotificationRecord {
  id: string;
  benefit_instance_id: string;
  notification_type: 'expiration_7_day' | 'reactivation';
  state: string;
  scheduled_for: string;
  provider_message_id: string | null;
  accepted_at: string | null;
  last_error_category: string | null;
  created_at: string;
}

export interface DashboardFilters {
  query: string;
  account: string;
  provider: string;
  category: string;
  lifecycle: '' | LifecycleStatus;
  usage: '' | UsageStatus;
  recurrence: '' | 'recurring' | 'one_time';
  expiration: '' | '7' | '30' | 'later';
  enrollment: '' | 'required' | 'complete';
  merchant: string;
  active: '' | 'active' | 'inactive';
  audit: 'live' | 'all' | 'void';
  sort: 'attention' | 'expiration' | 'remaining' | 'name';
}
