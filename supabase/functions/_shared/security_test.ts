import { constantTimeSecretEqual, sha256Hex } from './security.ts';
import { assert, assertEquals } from './test_utils.ts';

Deno.test('constantTimeSecretEqual accepts only the exact secret', () => {
  const secret = 'scheduler-secret-with-at-least-32-characters';
  assert(constantTimeSecretEqual(secret, secret));
  assert(!constantTimeSecretEqual(null, secret));
  assert(!constantTimeSecretEqual(`${secret}x`, secret));
  assert(!constantTimeSecretEqual(secret.slice(0, -1), secret));
  assert(!constantTimeSecretEqual('x'.repeat(513), secret));
});

Deno.test('sha256Hex returns a stable lowercase digest', async () => {
  assertEquals(
    await sha256Hex('benefits'),
    '20c658fac0a11ba36211ce641a8451b661117e1ec553e2015e42886d509fb70d',
  );
});
