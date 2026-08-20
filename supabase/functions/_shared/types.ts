export type SchedulerTrigger = 'cron' | 'manual_recovery';

export interface PrepareWorkResult {
  generated_instances: number;
  scheduled_notifications: number;
  skipped_notifications: number;
}

export interface ClaimedNotification {
  notification_id: string;
  claim_token: string;
  idempotency_key: string;
  frozen_payload: unknown;
  frozen_payload_text: string;
  payload_sha256: string;
  first_attempt_at: string;
  attempt_count: number;
}

export type DeliveryOutcome =
  | 'provider_accepted'
  | 'definitive_failed'
  | 'retryable_failed'
  | 'ambiguous';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  providerMessageId?: string;
  errorCategory?: string;
  errorMessage?: string;
}

export interface SchedulerSystemHealth {
  database_ready: boolean;
  cron_registered: boolean;
  scheduler_secret_configured: boolean;
  function_url_configured: boolean;
  last_success_at: string | null;
}

export interface RunCounts {
  generatedInstances: number;
  scheduledNotifications: number;
  skippedNotifications: number;
  claimedNotifications: number;
  providerAccepted: number;
  definitiveFailed: number;
  retryableFailed: number;
  ambiguous: number;
  outcomeRecordFailures: number;
  heartbeatFailures: number;
  batches: number;
  bounded: boolean;
}

export interface ProcessResult {
  runId: string;
  status: 'succeeded' | 'partial_failure';
  counts: RunCounts;
}

export interface DatabaseGateway {
  systemHealth(): Promise<SchedulerSystemHealth>;
  beginRun(trigger: SchedulerTrigger): Promise<string>;
  prepareWork(jobRunId: string, generationMonthLimit: number): Promise<PrepareWorkResult>;
  claimNotifications(
    jobRunId: string,
    batchSize: number,
    leaseSeconds: number,
    fromEmail: string,
  ): Promise<ClaimedNotification[]>;
  recordNotificationOutcome(
    notificationId: string,
    claimToken: string,
    result: DeliveryResult,
  ): Promise<boolean>;
  heartbeat(jobRunId: string, counts: RunCounts): Promise<boolean>;
  finishRun(
    jobRunId: string,
    status: 'succeeded' | 'partial_failure' | 'failed',
    counts: RunCounts,
    error?: string,
  ): Promise<boolean>;
}

export interface MailTransport {
  send(payloadText: string, idempotencyKey: string): Promise<DeliveryResult>;
}

export interface ProcessorConfig {
  batchSize: number;
  maxBatches: number;
  concurrency: number;
  leaseSeconds: number;
  generationMonthLimit: number;
  maxRuntimeMs: number;
  minimumBatchBudgetMs: number;
  fromEmail: string;
}

export interface SafeLogger {
  info(event: string, fields?: Record<string, string | number | boolean | null>): void;
  error(event: string, fields?: Record<string, string | number | boolean | null>): void;
}
