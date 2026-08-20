const url = process.env.PROCESS_NOTIFICATIONS_URL;
const secret = process.env.SCHEDULER_SECRET;
const mode = process.env.RECOVERY_MODE;
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;

if (!url || !secret || (mode !== 'health' && mode !== 'process')) {
  console.error('Recovery URL, secret, and a valid mode are required.');
  process.exit(2);
}

if (expectedProjectRef) {
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== `${expectedProjectRef}.supabase.co` ||
    parsedUrl.pathname !== '/functions/v1/process-notifications'
  ) {
    throw new Error('PROCESS_NOTIFICATIONS_URL does not match the protected Supabase project.');
  }
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), mode === 'process' ? 135_000 : 20_000);
let response;
try {
  response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-scheduler-secret': secret,
    },
    body: JSON.stringify(
      mode === 'health' ? { mode: 'health' } : { mode: 'process', trigger: 'manual_recovery' },
    ),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}

if (!response.ok) throw new Error(`Recovery endpoint returned HTTP ${response.status}.`);

const body = await response.json();
if (body?.ok !== true || body?.mode !== mode) throw new Error('Recovery response was invalid.');

if (mode === 'health') {
  console.log(
    `Health OK (database=${body.database?.database_ready === true}, cron=${body.database?.cron_registered === true}).`,
  );
} else {
  const counts = body.counts ?? {};
  console.log(
    [
      `Recovery run ${body.status ?? 'unknown'} (${body.runId ?? 'unknown run'})`,
      `claimed=${Number(counts.claimedNotifications ?? 0)}`,
      `accepted=${Number(counts.providerAccepted ?? 0)}`,
      `retryable=${Number(counts.retryableFailed ?? 0)}`,
      `ambiguous=${Number(counts.ambiguous ?? 0)}`,
      `review-write-failures=${Number(counts.outcomeRecordFailures ?? 0)}`,
    ].join(', '),
  );
}
