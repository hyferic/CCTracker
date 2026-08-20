import { isUuid } from './security.ts';
import type {
  ClaimedNotification,
  DatabaseGateway,
  DeliveryResult,
  PrepareWorkResult,
  RunCounts,
  SchedulerSystemHealth,
  SchedulerTrigger,
} from './types.ts';

const MAX_RPC_RESPONSE_BYTES = 2_000_000;

export class SafeRpcError extends Error {
  constructor(
    public readonly rpcName: string,
    public readonly status: number,
    public readonly category: string,
  ) {
    super(`rpc_${rpcName}_${category}`);
    this.name = 'SafeRpcError';
  }
}

interface RpcClientOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid_rpc_response');
  }
  return value as Record<string, unknown>;
}

function asNonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid_rpc_response');
  return Number(value);
}

function firstRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1) throw new Error('invalid_rpc_response');
  return asRecord(value[0]);
}

function sanitizeDatabaseError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { code?: unknown };
    if (typeof parsed.code === 'string' && /^[A-Z0-9_]{1,32}$/i.test(parsed.code)) {
      return `database_${parsed.code.toLowerCase()}`;
    }
  } catch {
    // The response body can contain private database details. Never surface it.
  }
  return 'database_rejected';
}

export class PostgrestRpcDatabase implements DatabaseGateway {
  private readonly rpcBaseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RpcClientOptions) {
    this.rpcBaseUrl = `${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc`;
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async rpc(name: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(`${this.rpcBaseUrl}/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey,
          'Content-Type': 'application/json',
          'X-Client-Info': 'benefits-tracker-process-notifications/1.0',
        },
        body: JSON.stringify(parameters),
        signal: controller.signal,
      });

      const text = await response.text();
      if (text.length > MAX_RPC_RESPONSE_BYTES) {
        throw new SafeRpcError(name, response.status, 'response_too_large');
      }
      if (!response.ok) {
        throw new SafeRpcError(name, response.status, sanitizeDatabaseError(text));
      }
      if (text === '') return null;

      try {
        return JSON.parse(text);
      } catch {
        throw new SafeRpcError(name, response.status, 'invalid_response');
      }
    } catch (error) {
      if (error instanceof SafeRpcError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new SafeRpcError(name, 0, 'timeout');
      }
      throw new SafeRpcError(name, 0, 'unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  async systemHealth(): Promise<SchedulerSystemHealth> {
    const row = firstRow(await this.rpc('scheduler_system_health'));
    if (
      typeof row.database_ready !== 'boolean' ||
      typeof row.cron_registered !== 'boolean' ||
      typeof row.scheduler_secret_configured !== 'boolean' ||
      typeof row.function_url_configured !== 'boolean' ||
      !(row.last_success_at === null || typeof row.last_success_at === 'string')
    ) {
      throw new Error('invalid_rpc_response');
    }
    return row as unknown as SchedulerSystemHealth;
  }

  async beginRun(trigger: SchedulerTrigger): Promise<string> {
    const value = await this.rpc('scheduler_begin_run', { p_trigger: trigger });
    if (!isUuid(value)) throw new Error('invalid_rpc_response');
    return value;
  }

  async prepareWork(jobRunId: string, generationMonthLimit: number): Promise<PrepareWorkResult> {
    const row = firstRow(
      await this.rpc('scheduler_prepare_work', {
        p_job_run_id: jobRunId,
        p_generation_month_limit: generationMonthLimit,
      }),
    );
    return {
      generated_instances: asNonnegativeInteger(row.generated_instances),
      scheduled_notifications: asNonnegativeInteger(row.scheduled_notifications),
      skipped_notifications: asNonnegativeInteger(row.skipped_notifications),
    };
  }

  async claimNotifications(
    jobRunId: string,
    batchSize: number,
    leaseSeconds: number,
    fromEmail: string,
  ): Promise<ClaimedNotification[]> {
    const value = await this.rpc('scheduler_claim_notifications', {
      p_job_run_id: jobRunId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
      p_from_email: fromEmail,
    });
    if (!Array.isArray(value)) throw new Error('invalid_rpc_response');

    return value.map((entry) => {
      const row = asRecord(entry);
      if (
        !isUuid(row.notification_id) ||
        !isUuid(row.claim_token) ||
        !isUuid(row.idempotency_key) ||
        typeof row.frozen_payload_text !== 'string' ||
        typeof row.payload_sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(row.payload_sha256) ||
        typeof row.first_attempt_at !== 'string' ||
        !Number.isSafeInteger(row.attempt_count) ||
        Number(row.attempt_count) < 1
      ) {
        throw new Error('invalid_rpc_response');
      }
      return row as unknown as ClaimedNotification;
    });
  }

  async recordNotificationOutcome(
    notificationId: string,
    claimToken: string,
    result: DeliveryResult,
  ): Promise<boolean> {
    const value = await this.rpc('scheduler_record_notification_outcome', {
      p_notification_id: notificationId,
      p_claim_token: claimToken,
      p_outcome: result.outcome,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error_category: result.errorCategory ?? null,
      p_error_message: result.errorMessage ?? null,
    });
    if (typeof value !== 'boolean') throw new Error('invalid_rpc_response');
    return value;
  }

  async heartbeat(jobRunId: string, counts: RunCounts): Promise<boolean> {
    const value = await this.rpc('scheduler_heartbeat', {
      p_job_run_id: jobRunId,
      p_counts: counts,
    });
    if (typeof value !== 'boolean') throw new Error('invalid_rpc_response');
    return value;
  }

  async finishRun(
    jobRunId: string,
    status: 'succeeded' | 'partial_failure' | 'failed',
    counts: RunCounts,
    error?: string,
  ): Promise<boolean> {
    const value = await this.rpc('scheduler_finish_run', {
      p_job_run_id: jobRunId,
      p_status: status,
      p_counts: counts,
      p_error: error ?? null,
    });
    if (typeof value !== 'boolean') throw new Error('invalid_rpc_response');
    return value;
  }
}
