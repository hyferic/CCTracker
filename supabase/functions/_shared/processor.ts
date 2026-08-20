import { validateFrozenResendPayload } from './email.ts';
import { sha256Hex } from './security.ts';
import type {
  ClaimedNotification,
  DatabaseGateway,
  DeliveryResult,
  MailTransport,
  ProcessResult,
  ProcessorConfig,
  RunCounts,
  SafeLogger,
  SchedulerTrigger,
} from './types.ts';

export function emptyRunCounts(): RunCounts {
  return {
    generatedInstances: 0,
    scheduledNotifications: 0,
    skippedNotifications: 0,
    claimedNotifications: 0,
    providerAccepted: 0,
    definitiveFailed: 0,
    retryableFailed: 0,
    ambiguous: 0,
    outcomeRecordFailures: 0,
    heartbeatFailures: 0,
    batches: 0,
    bounded: false,
  };
}

function safeErrorCategory(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]{1,80}$/i.test(error.message)) return error.message;
  return 'scheduler_operation_failed';
}

function incrementOutcome(counts: RunCounts, outcome: DeliveryResult['outcome']): void {
  switch (outcome) {
    case 'provider_accepted':
      counts.providerAccepted += 1;
      break;
    case 'definitive_failed':
      counts.definitiveFailed += 1;
      break;
    case 'retryable_failed':
      counts.retryableFailed += 1;
      break;
    case 'ambiguous':
      counts.ambiguous += 1;
      break;
  }
}

async function validateClaim(
  claim: ClaimedNotification,
  expectedFrom: string,
): Promise<DeliveryResult | null> {
  // A first attempt must freeze the configured sender. A retry must preserve the
  // already-frozen sender even if operators rotated the default between attempts.
  const senderForValidation = claim.attempt_count === 1 ? expectedFrom : undefined;
  if (!validateFrozenResendPayload(claim.frozen_payload_text, senderForValidation)) {
    return {
      outcome: 'definitive_failed',
      errorCategory: 'invalid_frozen_payload',
      errorMessage: 'Frozen email payload failed server validation and was not sent.',
    };
  }

  const actualHash = await sha256Hex(claim.frozen_payload_text);
  if (actualHash.toLowerCase() !== claim.payload_sha256.toLowerCase()) {
    return {
      outcome: 'definitive_failed',
      errorCategory: 'payload_integrity_mismatch',
      errorMessage: 'Frozen email payload integrity check failed and was not sent.',
    };
  }

  return null;
}

async function processClaim(
  database: DatabaseGateway,
  transport: MailTransport,
  claim: ClaimedNotification,
  fromEmail: string,
  counts: RunCounts,
  logger: SafeLogger,
): Promise<void> {
  let result: DeliveryResult;
  try {
    result =
      (await validateClaim(claim, fromEmail)) ??
      (await transport.send(claim.frozen_payload_text, claim.idempotency_key));
  } catch {
    result = {
      outcome: 'ambiguous',
      errorCategory: 'processor_transport_exception',
      errorMessage: 'Email transport ended unexpectedly; provider acceptance is unknown.',
    };
  }

  incrementOutcome(counts, result.outcome);
  try {
    const recorded = await database.recordNotificationOutcome(
      claim.notification_id,
      claim.claim_token,
      result,
    );
    if (!recorded) {
      counts.outcomeRecordFailures += 1;
      logger.error('notification_outcome_not_recorded', { outcome: result.outcome });
    }
  } catch {
    // The lease and immutable idempotency key make a later recovery safe. Never send
    // again within this invocation when the outcome write is uncertain.
    counts.outcomeRecordFailures += 1;
    logger.error('notification_outcome_record_failed', { outcome: result.outcome });
  }
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await operation(values[currentIndex]);
    }
  });
  await Promise.all(workers);
}

export async function processNotifications(
  database: DatabaseGateway,
  transport: MailTransport,
  config: ProcessorConfig,
  trigger: SchedulerTrigger,
  logger: SafeLogger,
  now: () => number = Date.now,
): Promise<ProcessResult> {
  const counts = emptyRunCounts();
  const startedAt = now();
  let runId: string | undefined;

  try {
    runId = await database.beginRun(trigger);
    const prepared = await database.prepareWork(runId, config.generationMonthLimit);
    counts.generatedInstances = prepared.generated_instances;
    counts.scheduledNotifications = prepared.scheduled_notifications;
    counts.skippedNotifications = prepared.skipped_notifications;

    for (let batch = 0; batch < config.maxBatches; batch += 1) {
      if (now() - startedAt >= config.maxRuntimeMs - config.minimumBatchBudgetMs) {
        counts.bounded = true;
        break;
      }

      const claims = await database.claimNotifications(
        runId,
        config.batchSize,
        config.leaseSeconds,
        config.fromEmail,
      );
      if (claims.length === 0) break;

      counts.batches += 1;
      counts.claimedNotifications += claims.length;
      await mapWithConcurrency(claims, config.concurrency, (claim) =>
        processClaim(database, transport, claim, config.fromEmail, counts, logger),
      );

      try {
        const heartbeatRecorded = await database.heartbeat(runId, counts);
        if (!heartbeatRecorded) counts.heartbeatFailures += 1;
      } catch {
        counts.heartbeatFailures += 1;
        logger.error('scheduler_heartbeat_failed', { batch: counts.batches });
      }

      if (claims.length === config.batchSize && batch === config.maxBatches - 1) {
        counts.bounded = true;
      }
    }

    const status =
      counts.outcomeRecordFailures > 0 || counts.heartbeatFailures > 0
        ? 'partial_failure'
        : 'succeeded';
    const finished = await database.finishRun(runId, status, counts);
    if (!finished) throw new Error('scheduler_finish_not_recorded');

    logger.info('scheduler_run_finished', {
      runId,
      status,
      claimed: counts.claimedNotifications,
      accepted: counts.providerAccepted,
      failed:
        counts.definitiveFailed +
        counts.retryableFailed +
        counts.ambiguous +
        counts.outcomeRecordFailures,
      bounded: counts.bounded,
    });
    return { runId, status, counts };
  } catch (error) {
    const category = safeErrorCategory(error);
    logger.error('scheduler_run_failed', { runId: runId ?? null, category });
    if (runId) {
      try {
        await database.finishRun(runId, 'failed', counts, category);
      } catch {
        logger.error('scheduler_failure_state_not_recorded', { runId });
      }
    }
    throw new Error(category);
  }
}
