import { FakeMailTransport } from './email.ts';
import { processNotifications } from './processor.ts';
import { sha256Hex } from './security.ts';
import { assert, assertEquals } from './test_utils.ts';
import type {
  ClaimedNotification,
  DatabaseGateway,
  DeliveryResult,
  MailTransport,
  ProcessorConfig,
  RunCounts,
  SafeLogger,
  SchedulerSystemHealth,
  SchedulerTrigger,
} from './types.ts';

const runId = '00000000-0000-4000-8000-000000000001';
const notificationId = '00000000-0000-4000-8000-000000000002';
const claimToken = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';
const fromEmail = 'Benefits <benefits@example.test>';

const config: ProcessorConfig = {
  batchSize: 25,
  maxBatches: 4,
  concurrency: 4,
  leaseSeconds: 900,
  generationMonthLimit: 24,
  maxRuntimeMs: 110_000,
  minimumBatchBudgetMs: 1,
  fromEmail,
};

const logger: SafeLogger = { info() {}, error() {} };

async function makeClaim(
  overrides: Partial<ClaimedNotification> = {},
): Promise<ClaimedNotification> {
  const frozenPayloadText = JSON.stringify({
    from: fromEmail,
    to: ['owner@example.test'],
    subject: 'Benefit expiring soon',
    text: 'Seven days remain.',
    html: '<p>Seven days remain.</p>',
  });
  return {
    notification_id: notificationId,
    claim_token: claimToken,
    idempotency_key: idempotencyKey,
    frozen_payload: JSON.parse(frozenPayloadText),
    frozen_payload_text: frozenPayloadText,
    payload_sha256: await sha256Hex(frozenPayloadText),
    first_attempt_at: '2026-08-18T12:00:00Z',
    attempt_count: 1,
    ...overrides,
  };
}

class FakeDatabase implements DatabaseGateway {
  readonly outcomes: DeliveryResult[] = [];
  readonly finishStatuses: string[] = [];
  heartbeatCalls = 0;
  claimCalls = 0;

  constructor(public claimBatches: ClaimedNotification[][]) {}

  systemHealth(): Promise<SchedulerSystemHealth> {
    return Promise.resolve({
      database_ready: true,
      cron_registered: true,
      scheduler_secret_configured: true,
      function_url_configured: true,
      last_success_at: null,
    });
  }

  beginRun(_trigger: SchedulerTrigger): Promise<string> {
    return Promise.resolve(runId);
  }

  prepareWork(): Promise<{
    generated_instances: number;
    scheduled_notifications: number;
    skipped_notifications: number;
  }> {
    return Promise.resolve({
      generated_instances: 2,
      scheduled_notifications: 3,
      skipped_notifications: 1,
    });
  }

  claimNotifications(
    _jobRunId: string,
    _batchSize: number,
    _leaseSeconds: number,
  ): Promise<ClaimedNotification[]> {
    this.claimCalls += 1;
    return Promise.resolve(this.claimBatches.shift() ?? []);
  }

  recordNotificationOutcome(
    _notificationId: string,
    _claimToken: string,
    result: DeliveryResult,
  ): Promise<boolean> {
    this.outcomes.push(result);
    return Promise.resolve(true);
  }

  heartbeat(_jobRunId: string, _counts: RunCounts): Promise<boolean> {
    this.heartbeatCalls += 1;
    return Promise.resolve(true);
  }

  finishRun(_jobRunId: string, status: string): Promise<boolean> {
    this.finishStatuses.push(status);
    return Promise.resolve(true);
  }
}

class LeaseRecoveryDatabase extends FakeDatabase {
  private attemptIndex = 0;
  private leaseUntilMs = 0;
  private nowMs = 0;
  private resolved = false;

  constructor(private readonly attempts: ClaimedNotification[]) {
    super([]);
  }

  advance(milliseconds: number): void {
    this.nowMs += milliseconds;
  }

  override claimNotifications(
    _jobRunId: string,
    _batchSize: number,
    leaseSeconds: number,
  ): Promise<ClaimedNotification[]> {
    this.claimCalls += 1;
    if (this.resolved || this.nowMs < this.leaseUntilMs) return Promise.resolve([]);
    const claim = this.attempts[this.attemptIndex];
    if (!claim) return Promise.resolve([]);
    this.attemptIndex += 1;
    this.leaseUntilMs = this.nowMs + leaseSeconds * 1_000;
    return Promise.resolve([claim]);
  }

  override recordNotificationOutcome(
    _notificationId: string,
    _claimToken: string,
    result: DeliveryResult,
  ): Promise<boolean> {
    this.outcomes.push(result);
    if (this.outcomes.length === 1) return Promise.resolve(false);
    this.resolved = true;
    return Promise.resolve(true);
  }
}

Deno.test(
  'processor prepares, claims, sends, records, heartbeats, and finishes independently',
  async () => {
    const claim = await makeClaim();
    const database = new FakeDatabase([[claim], []]);
    const transport = new FakeMailTransport();

    const result = await processNotifications(database, transport, config, 'cron', logger);
    assertEquals(result.status, 'succeeded');
    assertEquals(result.counts.generatedInstances, 2);
    assertEquals(result.counts.claimedNotifications, 1);
    assertEquals(result.counts.providerAccepted, 1);
    assertEquals(database.outcomes[0].outcome, 'provider_accepted');
    assertEquals(database.heartbeatCalls, 1);
    assertEquals(database.finishStatuses, ['succeeded']);
    assertEquals(transport.deliveries[0], {
      payloadText: claim.frozen_payload_text,
      idempotencyKey,
    });
  },
);

Deno.test('payload hash mismatch is never submitted to the provider', async () => {
  const claim = await makeClaim({ payload_sha256: '0'.repeat(64) });
  const database = new FakeDatabase([[claim], []]);
  const transport = new FakeMailTransport();

  const result = await processNotifications(database, transport, config, 'cron', logger);
  assertEquals(transport.deliveries.length, 0);
  assertEquals(database.outcomes[0].outcome, 'definitive_failed');
  assertEquals(database.outcomes[0].errorCategory, 'payload_integrity_mismatch');
  assertEquals(result.counts.definitiveFailed, 1);
});

Deno.test(
  'one provider failure does not prevent another notification from completing',
  async () => {
    const second = await makeClaim({
      notification_id: '00000000-0000-4000-8000-000000000005',
      claim_token: '00000000-0000-4000-8000-000000000006',
      idempotency_key: '00000000-0000-4000-8000-000000000007',
    });
    const database = new FakeDatabase([[await makeClaim(), second], []]);
    let calls = 0;
    const transport: MailTransport = {
      send() {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? {
                outcome: 'retryable_failed',
                errorCategory: 'http_503',
                errorMessage: 'Provider unavailable.',
              }
            : { outcome: 'provider_accepted', providerMessageId: 'accepted-second' },
        );
      },
    };

    const result = await processNotifications(database, transport, config, 'cron', logger);
    assertEquals(result.counts.retryableFailed, 1);
    assertEquals(result.counts.providerAccepted, 1);
    assertEquals(database.outcomes.length, 2);
  },
);

Deno.test('recovery reuses byte-identical payload and idempotency key', async () => {
  const firstAttempt = await makeClaim();
  const retry = await makeClaim({ attempt_count: 2 });
  const transport = new FakeMailTransport('ambiguous');

  await processNotifications(
    new FakeDatabase([[firstAttempt], []]),
    transport,
    config,
    'cron',
    logger,
  );
  await processNotifications(
    new FakeDatabase([[retry], []]),
    transport,
    config,
    'manual_recovery',
    logger,
  );

  assertEquals(transport.deliveries.length, 2);
  assertEquals(transport.deliveries[0], transport.deliveries[1]);
});

Deno.test('overlapping scheduler invocations submit one leased claim only once', async () => {
  const claim = await makeClaim();
  const database = new FakeDatabase([[claim], []]);
  const transport = new FakeMailTransport();

  const results = await Promise.all([
    processNotifications(database, transport, config, 'cron', logger),
    processNotifications(database, transport, config, 'manual_recovery', logger),
  ]);

  assertEquals(transport.deliveries.length, 1);
  assertEquals(database.outcomes.length, 1);
  assertEquals(
    results.reduce((total, result) => total + result.counts.providerAccepted, 0),
    1,
  );
});

Deno.test(
  'an unrecorded provider outcome waits for lease expiry and retries identical bytes and key',
  async () => {
    const firstAttempt = await makeClaim();
    const recoveredAttempt = await makeClaim({
      claim_token: '00000000-0000-4000-8000-000000000009',
      attempt_count: 2,
    });
    const database = new LeaseRecoveryDatabase([firstAttempt, recoveredAttempt]);
    const transport = new FakeMailTransport();

    const first = await processNotifications(database, transport, config, 'cron', logger);
    assertEquals(first.status, 'partial_failure');
    assertEquals(first.counts.outcomeRecordFailures, 1);

    const beforeLeaseExpiry = await processNotifications(
      database,
      transport,
      config,
      'manual_recovery',
      logger,
    );
    assertEquals(beforeLeaseExpiry.counts.claimedNotifications, 0);
    assertEquals(transport.deliveries.length, 1);

    database.advance(config.leaseSeconds * 1_000 + 1);
    const recovered = await processNotifications(
      database,
      transport,
      config,
      'manual_recovery',
      logger,
    );
    assertEquals(recovered.counts.providerAccepted, 1);
    assertEquals(transport.deliveries.length, 2);
    assertEquals(transport.deliveries[0], transport.deliveries[1]);
  },
);

Deno.test('retry preserves its frozen sender after the configured sender rotates', async () => {
  const retry = await makeClaim({ attempt_count: 2 });
  const transport = new FakeMailTransport();
  const rotatedConfig = { ...config, fromEmail: 'Benefits <new-sender@example.test>' };

  const result = await processNotifications(
    new FakeDatabase([[retry], []]),
    transport,
    rotatedConfig,
    'cron',
    logger,
  );

  assertEquals(result.counts.providerAccepted, 1);
  assertEquals(transport.deliveries[0].payloadText, retry.frozen_payload_text);
});

Deno.test('processor stops at configured batch bound', async () => {
  const claim1 = await makeClaim();
  const claim2 = await makeClaim({
    notification_id: '00000000-0000-4000-8000-000000000005',
    claim_token: '00000000-0000-4000-8000-000000000006',
    idempotency_key: '00000000-0000-4000-8000-000000000007',
  });
  const database = new FakeDatabase([[claim1], [claim2], [await makeClaim()]]);
  const boundedConfig = { ...config, batchSize: 1, maxBatches: 2 };
  const result = await processNotifications(
    database,
    new FakeMailTransport(),
    boundedConfig,
    'cron',
    logger,
  );

  assert(result.counts.bounded);
  assertEquals(result.counts.claimedNotifications, 2);
  assertEquals(database.claimCalls, 2);
});
