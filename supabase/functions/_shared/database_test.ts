import { PostgrestRpcDatabase, SafeRpcError } from './database.ts';
import { assert, assertEquals, assertRejects } from './test_utils.ts';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.test(
  'database gateway uses service-role headers and exact scheduler RPC parameters',
  async () => {
    const requests: Request[] = [];
    const fetchImplementation = ((input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/scheduler_begin_run')) {
        return Promise.resolve(response('00000000-0000-4000-8000-000000000001'));
      }
      if (request.url.endsWith('/scheduler_prepare_work')) {
        return Promise.resolve(
          response([
            { generated_instances: 1, scheduled_notifications: 2, skipped_notifications: 3 },
          ]),
        );
      }
      return Promise.reject(new Error('unexpected request'));
    }) as typeof fetch;
    const database = new PostgrestRpcDatabase({
      supabaseUrl: 'http://127.0.0.1:54321',
      serviceRoleKey: 'service-role-secret',
      fetchImplementation,
    });

    const runId = await database.beginRun('cron');
    const prepared = await database.prepareWork(runId, 24);
    assertEquals(prepared.scheduled_notifications, 2);
    assertEquals(requests[0].headers.get('authorization'), 'Bearer service-role-secret');
    assertEquals(requests[0].headers.get('apikey'), 'service-role-secret');
    assertEquals(await requests[1].json(), {
      p_job_run_id: runId,
      p_generation_month_limit: 24,
    });
  },
);

Deno.test('database gateway never exposes a private PostgREST error body', async () => {
  const database = new PostgrestRpcDatabase({
    supabaseUrl: 'http://127.0.0.1:54321',
    serviceRoleKey: 'service-role-secret',
    fetchImplementation: (() =>
      Promise.resolve(
        response(
          {
            code: 'P0001',
            message: 'owner@example.test and private benefit notes must not escape',
          },
          400,
        ),
      )) as typeof fetch,
  });

  let caught: unknown;
  try {
    await database.beginRun('cron');
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof SafeRpcError);
  assert(!caught.message.includes('owner@example.test'));
  assert(!caught.message.includes('private benefit'));
});

Deno.test('database gateway rejects malformed claim rows before delivery', async () => {
  const database = new PostgrestRpcDatabase({
    supabaseUrl: 'http://127.0.0.1:54321',
    serviceRoleKey: 'service-role-secret',
    fetchImplementation: (() =>
      Promise.resolve(response([{ notification_id: 'not-a-uuid' }]))) as typeof fetch,
  });

  await assertRejects(() =>
    database.claimNotifications(
      '00000000-0000-4000-8000-000000000001',
      25,
      900,
      'Benefits <benefits@example.test>',
    ),
  );
});
