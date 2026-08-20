import type { EnvironmentReader } from './config.ts';
import { FakeMailTransport } from './email.ts';
import { createHandler } from './handler.ts';
import { sha256Hex } from './security.ts';
import { assert, assertEquals } from './test_utils.ts';
import type {
  ClaimedNotification,
  DatabaseGateway,
  DeliveryResult,
  MailTransport,
  RunCounts,
  SchedulerSystemHealth,
  SchedulerTrigger,
} from './types.ts';

const schedulerSecret = 'test-scheduler-secret-that-is-long-enough-123';

class MapEnvironment implements EnvironmentReader {
  constructor(private readonly values: Record<string, string>) {}
  get(name: string): string | undefined {
    return this.values[name];
  }
}

class EmptyDatabase implements DatabaseGateway {
  systemHealth(): Promise<SchedulerSystemHealth> {
    return Promise.resolve({
      database_ready: true,
      cron_registered: true,
      scheduler_secret_configured: true,
      function_url_configured: true,
      last_success_at: '2026-08-18T12:00:00Z',
    });
  }
  beginRun(_trigger: SchedulerTrigger): Promise<string> {
    return Promise.resolve('00000000-0000-4000-8000-000000000001');
  }
  prepareWork(): Promise<{
    generated_instances: number;
    scheduled_notifications: number;
    skipped_notifications: number;
  }> {
    return Promise.resolve({
      generated_instances: 0,
      scheduled_notifications: 0,
      skipped_notifications: 0,
    });
  }
  claimNotifications(): Promise<ClaimedNotification[]> {
    return Promise.resolve([]);
  }
  recordNotificationOutcome(
    _notificationId: string,
    _claimToken: string,
    _result: DeliveryResult,
  ): Promise<boolean> {
    return Promise.resolve(true);
  }
  heartbeat(_jobRunId: string, _counts: RunCounts): Promise<boolean> {
    return Promise.resolve(true);
  }
  finishRun(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

function environment(includeProcessing = false): MapEnvironment {
  return new MapEnvironment({
    SCHEDULER_SECRET: schedulerSecret,
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    ...(includeProcessing
      ? {
          MAIL_TRANSPORT: 'fake',
          ALLOW_FAKE_MAIL_TRANSPORT: 'true',
          RESEND_FROM_EMAIL: 'Benefits <benefits@example.test>',
        }
      : {}),
  });
}

function request(body: unknown, secret?: string, method = 'POST', signal?: AbortSignal): Request {
  return new Request('http://localhost/functions/v1/process-notifications', {
    method,
    signal,
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-scheduler-secret': secret } : {}),
    },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
  });
}

Deno.test('scheduler endpoint rejects all methods except POST and emits no CORS', async () => {
  const handler = createHandler({ env: environment(), database: new EmptyDatabase() });
  for (const method of ['GET', 'OPTIONS', 'PUT']) {
    const response = await handler(request({}, schedulerSecret, method));
    assertEquals(response.status, 405);
    assertEquals(response.headers.get('access-control-allow-origin'), null);
  }
});

Deno.test(
  'scheduler endpoint rejects missing, wrong, and browser-JWT-only authentication',
  async () => {
    const handler = createHandler({ env: environment(), database: new EmptyDatabase() });
    const missing = await handler(request({ mode: 'health' }));
    assertEquals(missing.status, 401);

    const wrong = await handler(request({ mode: 'health' }, 'wrong-secret-that-is-long-enough'));
    assertEquals(wrong.status, 401);

    const jwtOnly = new Request('http://localhost/functions/v1/process-notifications', {
      method: 'POST',
      headers: {
        authorization: 'Bearer user-jwt',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ mode: 'health' }),
    });
    assertEquals((await handler(jwtOnly)).status, 401);
  },
);

Deno.test(
  'health mode validates database readiness without requiring email credentials',
  async () => {
    const handler = createHandler({ env: environment(), database: new EmptyDatabase() });
    const response = await handler(request({ mode: 'health' }, schedulerSecret));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get('access-control-allow-origin'), null);
    const body = await response.json();
    assertEquals(body.ok, true);
    assertEquals(body.database.cron_registered, true);
  },
);

Deno.test('process mode requires a signed trigger and returns bounded counts', async () => {
  const handler = createHandler({
    env: environment(true),
    database: new EmptyDatabase(),
    transport: new FakeMailTransport(),
  });
  const response = await handler(
    request({ mode: 'process', trigger: 'manual_recovery' }, schedulerSecret),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.ok, true);
  assertEquals(body.counts.claimedNotifications, 0);

  const invalid = await handler(request({ mode: 'process' }, schedulerSecret));
  assertEquals(invalid.status, 400);
});

Deno.test('scheduler endpoint rejects oversized request bodies', async () => {
  const handler = createHandler({ env: environment(), database: new EmptyDatabase() });
  const response = await handler(
    request({ mode: 'health', padding: 'x'.repeat(3_000) }, schedulerSecret),
  );
  assertEquals(response.status, 400);
  assert(!(await response.text()).includes('padding'));
});

Deno.test('caller disconnect does not cancel an already-started claimed delivery', async () => {
  const frozenPayloadText = JSON.stringify({
    from: 'Benefits <benefits@example.test>',
    to: ['owner@example.test'],
    subject: 'Benefit expiring soon',
    text: 'Seven days remain.',
  });
  const claim: ClaimedNotification = {
    notification_id: '00000000-0000-4000-8000-000000000002',
    claim_token: '00000000-0000-4000-8000-000000000003',
    idempotency_key: '00000000-0000-4000-8000-000000000004',
    frozen_payload: JSON.parse(frozenPayloadText),
    frozen_payload_text: frozenPayloadText,
    payload_sha256: await sha256Hex(frozenPayloadText),
    first_attempt_at: '2026-08-18T12:00:00Z',
    attempt_count: 1,
  };

  class OneClaimDatabase extends EmptyDatabase {
    claimed = false;
    outcomes: DeliveryResult[] = [];

    override claimNotifications(): Promise<ClaimedNotification[]> {
      if (this.claimed) return Promise.resolve([]);
      this.claimed = true;
      return Promise.resolve([claim]);
    }

    override recordNotificationOutcome(
      _notificationId: string,
      _claimToken: string,
      result: DeliveryResult,
    ): Promise<boolean> {
      this.outcomes.push(result);
      return Promise.resolve(true);
    }
  }

  let releaseProvider: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const providerStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const transport: MailTransport = {
    send() {
      markStarted?.();
      return new Promise<DeliveryResult>((resolve) => {
        releaseProvider = () =>
          resolve({ outcome: 'provider_accepted', providerMessageId: 'accepted-after-disconnect' });
      });
    },
  };
  const database = new OneClaimDatabase();
  const handler = createHandler({ env: environment(true), database, transport });
  const controller = new AbortController();
  const pendingResponse = handler(
    request({ mode: 'process', trigger: 'cron' }, schedulerSecret, 'POST', controller.signal),
  );

  await providerStarted;
  controller.abort();
  releaseProvider?.();
  const response = await pendingResponse;
  assertEquals(response.status, 200);
  assertEquals(database.outcomes, [
    { outcome: 'provider_accepted', providerMessageId: 'accepted-after-disconnect' },
  ]);
});
