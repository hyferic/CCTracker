import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Account,
  CardCatalogProduct,
  CardCatalogTemplate,
  BenefitDefinition,
  BenefitInput,
  BenefitInstance,
  EditScope,
  NotificationRecord,
  Profile,
  Redemption,
  SchedulerHealth,
  TemplateSelection,
} from '../types';
import { requireSupabase } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function fail(error: PostgrestError | null) {
  if (error) throw new ApiError(error.message, error.code);
}

export async function getProfile(): Promise<Profile> {
  const { data, error } = await requireSupabase().from('profiles').select('*').single();
  fail(error);
  return data as Profile;
}

export async function updateProfile(input: {
  notification_email: string | null;
  timezone: string;
  expiration_reminders_enabled: boolean;
  reactivation_reminders_enabled: boolean;
  recent_reset_days: number;
}) {
  const { data, error } = await requireSupabase().rpc('update_profile_settings', {
    p_settings: input,
  });
  fail(error);
  return data as Profile;
}

export async function listAccounts(includeInactive = true): Promise<Account[]> {
  let query = requireSupabase().from('accounts').select('*').order('display_name');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  fail(error);
  return (data ?? []).map(mapAccount);
}

export type AccountWrite = Omit<
  Account,
  | 'id'
  | 'user_id'
  | 'created_at'
  | 'updated_at'
  | 'origin_product_version_id'
  | 'origin_product_stable_key'
  | 'origin_product_version'
  | 'origin_product_hash'
>;

export async function createAccount(input: AccountWrite): Promise<Account> {
  const user = await requireSupabase().auth.getUser();
  if (!user.data.user) throw new ApiError('Your session expired. Sign in again.');
  const { data, error } = await requireSupabase()
    .from('accounts')
    .insert({ ...accountPayload(input), user_id: user.data.user.id })
    .select()
    .single();
  fail(error);
  return mapAccount(data);
}

export async function updateAccount(id: string, input: AccountWrite): Promise<Account> {
  const { data, error } = await requireSupabase()
    .from('accounts')
    .update(accountPayload(input))
    .eq('id', id)
    .select()
    .single();
  fail(error);
  return mapAccount(data);
}

function accountPayload(input: AccountWrite) {
  const { is_active, ...rest } = input;
  return { ...rest, active: is_active };
}

export async function listCardCatalog(): Promise<CardCatalogProduct[]> {
  const { data, error } = await requireSupabase()
    .from('card_catalog_current')
    .select('*')
    .order('issuer')
    .order('product_name')
    .order('template_name');
  fail(error);
  const products = new Map<string, CardCatalogProduct>();
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const productId = row.product_version_id as string;
    let product = products.get(productId);
    if (!product) {
      product = {
        product_version_id: productId,
        product_stable_key: row.product_stable_key as string,
        product_version: Number(row.product_version),
        issuer: row.issuer as string,
        product_name: row.product_name as string,
        aliases: Array.isArray(row.aliases) ? (row.aliases as string[]) : [],
        market_scope: row.market_scope as string,
        annual_fee: row.annual_fee === null ? null : Number(row.annual_fee),
        annual_fee_currency: row.annual_fee_currency as string | null,
        official_url: row.product_official_url as string,
        verified_on: row.product_verified_on as string,
        age_days: Number(row.age_days),
        templates: [],
      };
      products.set(productId, product);
    }
    product.templates.push({
      template_version_id: row.template_version_id as string,
      template_stable_key: row.template_stable_key as string,
      template_version: Number(row.template_version),
      template_name: row.template_name as string,
      summary: row.summary as string,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      date_strategy: row.date_strategy as CardCatalogTemplate['date_strategy'],
      fixed_start: row.fixed_start as string | null,
      fixed_end: row.fixed_end as string | null,
      setup_field: row.setup_field as CardCatalogTemplate['setup_field'],
      terms_timezone: row.terms_timezone as string,
      default_selected: Boolean(row.default_selected),
      confidence: row.confidence as CardCatalogTemplate['confidence'],
      official_url: row.template_official_url as string,
      verified_on: row.template_verified_on as string,
      age_days: Number(row.age_days),
    });
    product.age_days = Math.max(product.age_days, Number(row.age_days));
  }
  return [...products.values()];
}

export async function createAccountWithTemplates(input: {
  account: AccountWrite;
  productVersionId: string | null;
  selections: TemplateSelection[];
  staleCatalogAcknowledged: boolean;
}) {
  const { data, error } = await requireSupabase().rpc('create_account_with_templates', {
    p_account: accountPayload(input.account),
    p_product_version_id: input.productVersionId,
    p_template_selections: input.selections,
    p_stale_catalog_acknowledged: input.staleCatalogAcknowledged,
  });
  fail(error);
  return data as {
    account_id: string;
    definition_ids: string[];
    benefits_created: number;
    catalog_verified_on: string | null;
    benefit_anniversary_inferred: boolean;
  };
}

function mapAccount(row: unknown): Account {
  const value = row as Record<string, unknown>;
  return {
    ...value,
    card_service_name: (value.card_service_name as string | null) ?? '',
    is_active: Boolean(value.active),
  } as unknown as Account;
}

export async function deleteAccount(id: string) {
  const { error } = await requireSupabase().from('accounts').delete().eq('id', id);
  fail(error);
}

export async function listDefinitions(): Promise<BenefitDefinition[]> {
  const { data, error } = await requireSupabase()
    .from('benefit_definitions')
    .select('*')
    .order('name');
  fail(error);
  return (data ?? []).map(mapDefinition);
}

function mapDefinition(row: unknown): BenefitDefinition {
  const value = row as Record<string, unknown>;
  return {
    ...value,
    amount: (value.benefit_amount as number | null | undefined) ?? null,
    description: (value.description as string | null | undefined) ?? '',
    notes: (value.notes as string | null | undefined) ?? '',
    eligibility_notes: (value.eligibility_notes as string | null | undefined) ?? '',
    tags: Array.isArray(value.tags) ? value.tags : [],
    recurrence_basis: value.recurrence_basis === 'none' ? 'calendar' : value.recurrence_basis,
    expiration_email_enabled: Boolean(value.expiration_reminder_enabled),
    reactivation_email_enabled: Boolean(value.reactivation_reminder_enabled),
  } as unknown as BenefitDefinition;
}

function benefitPayload(input: BenefitInput) {
  return {
    account_id: input.account_id,
    name: input.name,
    category: input.category,
    description: input.description,
    notes: input.notes,
    value_kind: input.value_kind,
    benefit_amount: input.amount,
    currency: input.currency,
    unit_label: input.unit_label,
    minimum_spend: input.minimum_spend,
    cashback_percentage: input.cashback_percentage,
    cashback_cap: input.cashback_cap,
    merchant: input.merchant,
    merchant_category: input.merchant_category,
    website: input.website,
    tags: input.tags,
    eligibility_notes: input.eligibility_notes,
    enrollment_required: input.enrollment_required,
    enrollment_deadline: input.enrollment_deadline,
    enrolled_at: input.enrolled_at,
    effective_date: input.effective_date,
    end_date: input.end_date,
    display_reset_date: input.display_reset_date,
    recurrence_type: input.recurrence_type,
    recurrence_basis: input.recurrence_type === 'one_time' ? 'none' : input.recurrence_basis,
    anchor_date: input.recurrence_type === 'one_time' ? null : input.anchor_date,
    interval_months: input.interval_months,
    expiration_reminder_enabled: input.expiration_email_enabled,
    reactivation_reminder_enabled: input.reactivation_email_enabled,
    terms_timezone: input.terms_timezone,
    period_value_rules: input.period_value_rules,
  };
}

export async function listInstances(
  options: { includeAuditVersions?: boolean } = {},
): Promise<BenefitInstance[]> {
  const { data, error } = await requireSupabase()
    .from(options.includeAuditVersions ? 'benefit_instance_dashboard' : 'benefit_instance_overview')
    .select('*')
    .order('period_end');
  fail(error);
  return (data ?? []).map(mapInstance);
}

export async function getInstance(instanceId: string): Promise<BenefitInstance> {
  const { data, error } = await requireSupabase()
    .from('benefit_instance_dashboard')
    .select('*')
    .eq('instance_id', instanceId)
    .single();
  fail(error);
  return mapInstance(data);
}

function mapInstance(row: unknown): BenefitInstance {
  const value = row as Record<string, unknown>;
  return {
    ...value,
    issuer: (value.provider as string | null | undefined) ?? null,
    expiring_7_days: Boolean(value.expiring_in_7_days),
    expiring_30_days: Boolean(value.expiring_in_30_days),
  } as unknown as BenefitInstance;
}

export async function createBenefit(input: BenefitInput, backfillMonths = 0) {
  const { data, error } = await requireSupabase().rpc('create_benefit', {
    p_benefit: benefitPayload(input),
    p_backfill_months: backfillMonths,
  });
  fail(error);
  return data as { definition_id: string; current_instance_id: string | null };
}

export async function editBenefit(
  definitionId: string,
  input: BenefitInput,
  scope: Exclude<EditScope, 'this_period'>,
  effectiveBoundary: string | null,
) {
  const { data, error } = await requireSupabase().rpc('edit_benefit', {
    p_definition_id: definitionId,
    p_changes: benefitPayload(input),
    p_scope: scope === 'future' ? 'future_periods' : scope,
    p_effective_from: effectiveBoundary || null,
  });
  fail(error);
  return data as { revision_id: string };
}

export async function overrideInstance(
  instanceId: string,
  input: {
    available_quantity: number | null;
    period_start: string;
    period_end: string;
    reason: string;
  },
) {
  const { data, error } = await requireSupabase().rpc('override_instance', {
    p_instance_id: instanceId,
    p_changes: {
      available_quantity: input.available_quantity,
      period_start: input.period_start,
      period_end: input.period_end,
    },
    p_reason: input.reason,
  });
  fail(error);
  return data as { instance_id: string };
}

export async function setBenefitActive(definitionId: string, active: boolean) {
  const { error } = await requireSupabase().rpc('set_benefit_active', {
    p_definition_id: definitionId,
    p_active: active,
  });
  fail(error);
}

export async function setRecurrenceEnabled(definitionId: string, enabled: boolean) {
  const { error } = await requireSupabase().rpc('set_recurrence_enabled', {
    p_definition_id: definitionId,
    p_enabled: enabled,
  });
  fail(error);
}

export async function deleteBenefitDraft(definitionId: string) {
  const { data, error } = await requireSupabase().rpc('delete_benefit_draft', {
    p_definition_id: definitionId,
  });
  fail(error);
  return Boolean(data);
}

export async function listRedemptions(instanceId?: string): Promise<Redemption[]> {
  let query = requireSupabase()
    .from('redemptions')
    .select('*')
    .order('used_date', { ascending: false });
  if (instanceId) query = query.eq('benefit_instance_id', instanceId);
  const { data, error } = await query;
  fail(error);
  return (data ?? []).map(mapRedemption);
}

function mapRedemption(row: unknown): Redemption {
  const value = row as Record<string, unknown>;
  return {
    ...value,
    quantity: value.redeemed_quantity,
    used_on: value.used_date,
  } as unknown as Redemption;
}

export async function recordRedemption(
  instanceId: string,
  input: {
    quantity: number;
    used_on: string;
    merchant: string | null;
    transaction_description: string | null;
    notes: string | null;
  },
) {
  const { data, error } = await requireSupabase().rpc('record_redemption', {
    p_instance_id: instanceId,
    p_redeemed_quantity: input.quantity,
    p_used_date: input.used_on,
    p_merchant: input.merchant,
    p_transaction_description: input.transaction_description,
    p_notes: input.notes,
  });
  fail(error);
  return mapRedemption(data);
}

export async function editRedemption(
  redemptionId: string,
  input: Omit<Redemption, 'id' | 'benefit_instance_id' | 'user_id' | 'created_at' | 'updated_at'>,
) {
  const { data, error } = await requireSupabase().rpc('edit_redemption', {
    p_redemption_id: redemptionId,
    p_redeemed_quantity: input.quantity,
    p_used_date: input.used_on,
    p_merchant: input.merchant,
    p_transaction_description: input.transaction_description,
    p_notes: input.notes,
  });
  fail(error);
  return mapRedemption(data);
}

export async function deleteRedemption(redemptionId: string) {
  const { error } = await requireSupabase().rpc('delete_redemption', {
    p_redemption_id: redemptionId,
  });
  fail(error);
}

export async function markUncappedComplete(instanceId: string, note: string | null) {
  const { error } = await requireSupabase().rpc('mark_uncapped_complete', {
    p_instance_id: instanceId,
    p_note: note,
  });
  fail(error);
}

export async function markFiniteUsed(
  instanceId: string,
  usedOn: string,
  details?: {
    merchant?: string | null;
    transaction_description?: string | null;
    notes?: string | null;
  },
) {
  const { data, error } = await requireSupabase().rpc('mark_finite_used', {
    p_instance_id: instanceId,
    p_used_date: usedOn,
    p_merchant: details?.merchant ?? null,
    p_transaction_description: details?.transaction_description ?? null,
    p_notes: details?.notes ?? null,
  });
  fail(error);
  return mapRedemption(data);
}

export async function confirmBenefitPeriodUsed(instanceId: string, usedOn: string, note?: string) {
  const { data, error } = await requireSupabase().rpc('confirm_benefit_period_used', {
    p_instance_id: instanceId,
    p_used_date: usedOn,
    p_note: note ?? null,
  });
  fail(error);
  return data as { instance_id: string; archived: boolean; generated_instances: number };
}

export async function markBenefitEnrolled(definitionId: string, enrolledAt: string) {
  const { data, error } = await requireSupabase().rpc('edit_benefit', {
    p_definition_id: definitionId,
    p_changes: { enrolled_at: enrolledAt },
    p_scope: 'current_and_future',
    p_effective_from: null,
  });
  fail(error);
  return data as { definition_id: string; enrolled_at: string; state_only: true };
}

export async function schedulerHealth(): Promise<SchedulerHealth> {
  const { data, error } = await requireSupabase().rpc('scheduler_health');
  fail(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiError('Scheduler health is unavailable.');
  return row as SchedulerHealth;
}

export async function listNotifications(): Promise<NotificationRecord[]> {
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select(
      'id,benefit_instance_id,notification_type,state,scheduled_for,provider_message_id,provider_accepted_at,last_error_category,created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  fail(error);
  return (data ?? []).map((row) => {
    const value = row as Record<string, unknown>;
    return { ...value, accepted_at: value.provider_accepted_at } as unknown as NotificationRecord;
  });
}

export async function getExportData() {
  const client = requireSupabase();
  const [accounts, definitions, revisions, instances, csvInstances, redemptions, notifications] =
    await Promise.all([
      client.from('accounts').select('*'),
      client.from('benefit_definitions').select('*'),
      client.from('benefit_definition_revisions').select('*'),
      client.from('benefit_instances').select('*'),
      client.from('benefit_instance_dashboard').select('*'),
      client.from('redemptions').select('*'),
      client
        .from('notifications')
        .select(
          'id,benefit_instance_id,notification_type,state,scheduled_for,provider_accepted_at,provider_message_id,created_at',
        ),
    ]);
  for (const response of [
    accounts,
    definitions,
    revisions,
    instances,
    csvInstances,
    redemptions,
    notifications,
  ])
    fail(response.error);
  return {
    accounts: (accounts.data ?? []) as Array<Record<string, unknown>>,
    definitions: (definitions.data ?? []) as Array<Record<string, unknown>>,
    revisions: (revisions.data ?? []) as Array<Record<string, unknown>>,
    instances: (instances.data ?? []) as Array<Record<string, unknown>>,
    csvInstances: (csvInstances.data ?? []) as Array<Record<string, unknown>>,
    redemptions: (redemptions.data ?? []) as Array<Record<string, unknown>>,
    notifications: (notifications.data ?? []) as Array<Record<string, unknown>>,
  };
}

export async function importBackup(
  backup: Record<string, unknown>,
  duplicatePolicy: 'skip' | 'import_as_new',
  notificationPolicy: 'suppress_current' | 'schedule_fresh',
) {
  const { data, error } = await requireSupabase().rpc('import_backup', {
    p_backup: backup,
    p_duplicate_policy: duplicatePolicy,
    p_current_notification_policy: notificationPolicy,
  });
  fail(error);
  const result = data as Record<string, unknown>;
  return {
    accounts: Number(result.accounts_imported ?? 0),
    definitions: Number(result.definitions_imported ?? 0),
    instances: Number(result.instances_imported ?? 0),
    redemptions: Number(result.redemptions_imported ?? 0),
    warnings: Array.isArray(result.provenance_warnings)
      ? (result.provenance_warnings as string[])
      : [],
  };
}
