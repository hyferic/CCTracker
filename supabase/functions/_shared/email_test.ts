import { ResendTransport, validateFrozenResendPayload } from './email.ts';
import { assert, assertEquals } from './test_utils.ts';

const payload = JSON.stringify({
  from: 'Benefits <benefits@example.test>',
  to: ['owner@example.test'],
  subject: 'Benefit expiring soon',
  text: 'Seven days remain.',
  html: '<p>Seven days remain.</p>',
});

Deno.test('frozen payload validation permits the narrow email shape', () => {
  assert(validateFrozenResendPayload(payload, 'Benefits <benefits@example.test>'));
  assert(!validateFrozenResendPayload(payload, 'other@example.test'));
  assert(
    !validateFrozenResendPayload(
      JSON.stringify({ ...JSON.parse(payload), attachments: [{ content: 'unsafe' }] }),
      'Benefits <benefits@example.test>',
    ),
  );
});

Deno.test('Resend transport sends exact frozen bytes and immutable idempotency key', async () => {
  let request: Request | undefined;
  const transport = new ResendTransport({
    apiKey: 're_test_key',
    timeoutMs: 1_000,
    fetchImplementation: ((input: string | URL | Request, init?: RequestInit) => {
      request = new Request(input, init);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'provider-message-id' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch,
  });

  const result = await transport.send(payload, '11111111-1111-4111-8111-111111111111');
  assertEquals(result, {
    outcome: 'provider_accepted',
    providerMessageId: 'provider-message-id',
  });
  assert(request);
  assertEquals(await request.text(), payload);
  assertEquals(request.headers.get('idempotency-key'), '11111111-1111-4111-8111-111111111111');
  assertEquals(request.headers.get('authorization'), 'Bearer re_test_key');
});

for (const [status, expected] of [
  [400, 'definitive_failed'],
  [408, 'ambiguous'],
  [422, 'definitive_failed'],
  [429, 'retryable_failed'],
  [500, 'retryable_failed'],
] as const) {
  Deno.test(`Resend HTTP ${status} is classified as ${expected}`, async () => {
    const transport = new ResendTransport({
      apiKey: 're_test_key',
      timeoutMs: 1_000,
      fetchImplementation: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ name: status === 422 ? 'validation_error' : 'provider_error' }),
            {
              status,
            },
          ),
        )) as typeof fetch,
    });

    const result = await transport.send(payload, '11111111-1111-4111-8111-111111111111');
    assertEquals(result.outcome, expected);
    assert(!result.errorMessage?.includes('owner@example.test'));
  });
}

Deno.test('network failures are ambiguous rather than blindly retried with a new key', async () => {
  const transport = new ResendTransport({
    apiKey: 're_test_key',
    timeoutMs: 1_000,
    fetchImplementation: (() => Promise.reject(new TypeError('network down'))) as typeof fetch,
  });
  const result = await transport.send(payload, '11111111-1111-4111-8111-111111111111');
  assertEquals(result.outcome, 'ambiguous');
  assertEquals(result.errorCategory, 'transport_unavailable');
});

Deno.test('a slow provider is aborted at the configured transport timeout', async () => {
  const providerSignals: AbortSignal[] = [];
  const transport = new ResendTransport({
    apiKey: 're_test_key',
    timeoutMs: 10,
    fetchImplementation: ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const providerSignal = init?.signal;
        if (!providerSignal) return;
        providerSignals.push(providerSignal);
        providerSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Provider request aborted.', 'AbortError')),
          { once: true },
        );
      })) as typeof fetch,
  });

  const result = await transport.send(payload, '11111111-1111-4111-8111-111111111111');
  assert(providerSignals[0]?.aborted);
  assertEquals(result.outcome, 'ambiguous');
  assertEquals(result.errorCategory, 'transport_timeout');
});

Deno.test('a 2xx without a provider message ID remains ambiguous', async () => {
  const transport = new ResendTransport({
    apiKey: 're_test_key',
    timeoutMs: 1_000,
    fetchImplementation: (() => Promise.resolve(responseWithoutId())) as typeof fetch,
  });
  const result = await transport.send(payload, '11111111-1111-4111-8111-111111111111');
  assertEquals(result.outcome, 'ambiguous');
  assertEquals(result.errorCategory, 'invalid_provider_response');
});

function responseWithoutId(): Response {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}
