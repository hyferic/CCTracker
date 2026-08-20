import type { ProcessorConfig } from './types.ts';

export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface BaseRuntimeConfig {
  schedulerSecret: string;
  supabaseUrl: string;
  serviceRoleKey: string;
}

export interface ProcessingRuntimeConfig extends ProcessorConfig {
  mailTransport: 'resend' | 'fake';
  resendApiKey?: string;
  fakeOutcome: 'provider_accepted' | 'definitive_failed' | 'retryable_failed' | 'ambiguous';
  resendTimeoutMs: number;
}

function required(env: EnvironmentReader, name: string): string {
  const value = env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function boundedInteger(
  env: EnvironmentReader,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env.get(name);
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

export function readBaseRuntimeConfig(env: EnvironmentReader): BaseRuntimeConfig {
  const schedulerSecret = required(env, 'SCHEDULER_SECRET');
  if (schedulerSecret.length < 32) throw new Error('scheduler_secret_too_short');

  const supabaseUrl = required(env, 'SUPABASE_URL');
  if (!/^https?:\/\//.test(supabaseUrl)) throw new Error('invalid_supabase_url');

  return {
    schedulerSecret,
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
  };
}

export function readProcessingRuntimeConfig(env: EnvironmentReader): ProcessingRuntimeConfig {
  const mailTransportValue = (env.get('MAIL_TRANSPORT') ?? 'resend').trim().toLowerCase();
  if (mailTransportValue !== 'resend' && mailTransportValue !== 'fake') {
    throw new Error('invalid_mail_transport');
  }
  if (mailTransportValue === 'fake' && env.get('ALLOW_FAKE_MAIL_TRANSPORT') !== 'true') {
    throw new Error('fake_mail_transport_not_allowed');
  }

  const fakeOutcomeValue = (env.get('FAKE_MAIL_OUTCOME') ?? 'provider_accepted').trim();
  const allowedFakeOutcomes = new Set([
    'provider_accepted',
    'definitive_failed',
    'retryable_failed',
    'ambiguous',
  ]);
  if (!allowedFakeOutcomes.has(fakeOutcomeValue)) throw new Error('invalid_fake_mail_outcome');

  const batchSize = boundedInteger(env, 'NOTIFICATION_BATCH_SIZE', 10, 1, 25);
  const concurrency = boundedInteger(env, 'NOTIFICATION_CONCURRENCY', 5, 1, 10);
  const resendTimeoutMs = boundedInteger(env, 'RESEND_TIMEOUT_MS', 8_000, 1_000, 15_000);
  const maxRuntimeMs = boundedInteger(env, 'NOTIFICATION_MAX_RUNTIME_MS', 110_000, 60_000, 130_000);
  const minimumBatchBudgetMs =
    (resendTimeoutMs + 15_000) * Math.ceil(batchSize / concurrency) + 17_000;
  if (minimumBatchBudgetMs >= maxRuntimeMs) throw new Error('unsafe_notification_runtime_budget');

  return {
    batchSize,
    maxBatches: boundedInteger(env, 'NOTIFICATION_MAX_BATCHES', 4, 1, 20),
    concurrency,
    leaseSeconds: boundedInteger(env, 'NOTIFICATION_LEASE_SECONDS', 900, 60, 1800),
    generationMonthLimit: boundedInteger(env, 'GENERATION_MONTH_LIMIT', 24, 1, 24),
    maxRuntimeMs,
    // Each concurrency wave can consume both the provider timeout and the guarded
    // outcome RPC timeout. Reserve one more RPC window for the batch heartbeat.
    minimumBatchBudgetMs,
    resendTimeoutMs,
    fromEmail: required(env, 'RESEND_FROM_EMAIL'),
    mailTransport: mailTransportValue,
    resendApiKey:
      mailTransportValue === 'resend' ? required(env, 'RESEND_API_KEY') : env.get('RESEND_API_KEY'),
    fakeOutcome: fakeOutcomeValue as ProcessingRuntimeConfig['fakeOutcome'],
  };
}
