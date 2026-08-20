const url = process.env.PROCESS_NOTIFICATIONS_URL;
const secret = process.env.SCHEDULER_SECRET;
const requireSchedulerConfig = process.env.SMOKE_REQUIRE_SCHEDULER_CONFIG === 'true';
const expectedProjectRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;

if (!url || !secret) {
  console.error('PROCESS_NOTIFICATIONS_URL and SCHEDULER_SECRET are required.');
  process.exit(2);
}

if (expectedProjectRef) {
  const parsedUrl = new URL(url);
  const expectedHost = `${expectedProjectRef}.supabase.co`;
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.hostname !== expectedHost ||
    parsedUrl.pathname !== '/functions/v1/process-notifications'
  ) {
    throw new Error('PROCESS_NOTIFICATIONS_URL does not match the protected Supabase project.');
  }
}

async function post(candidateSecret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-scheduler-secret': candidateSecret,
      },
      body: JSON.stringify({ mode: 'health' }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const unauthorized = await post(`invalid-${crypto.randomUUID()}`);
if (unauthorized.status !== 401) {
  throw new Error(`Wrong-secret health check returned HTTP ${unauthorized.status}, expected 401.`);
}

const response = await post(secret);
if (!response.ok) throw new Error(`Authorized health check returned HTTP ${response.status}.`);

const body = await response.json();
if (body?.ok !== true || body?.mode !== 'health' || body?.database?.database_ready !== true) {
  throw new Error('Authorized health response did not confirm database readiness.');
}

if (
  requireSchedulerConfig &&
  (body.database.cron_registered !== true ||
    body.database.scheduler_secret_configured !== true ||
    body.database.function_url_configured !== true)
) {
  throw new Error('Production Cron or Vault configuration is incomplete.');
}

console.log(
  `Edge health passed (database ready; scheduler config required: ${requireSchedulerConfig}).`,
);
