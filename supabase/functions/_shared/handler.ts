import {
  readBaseRuntimeConfig,
  readProcessingRuntimeConfig,
  type EnvironmentReader,
} from './config.ts';
import { PostgrestRpcDatabase } from './database.ts';
import { FakeMailTransport, ResendTransport } from './email.ts';
import { jsonResponse, readBoundedJson } from './http.ts';
import { processNotifications } from './processor.ts';
import { constantTimeSecretEqual } from './security.ts';
import type { DatabaseGateway, MailTransport, SafeLogger, SchedulerTrigger } from './types.ts';

interface HandlerDependencies {
  env?: EnvironmentReader;
  database?: DatabaseGateway;
  transport?: MailTransport;
  logger?: SafeLogger;
}

const consoleLogger: SafeLogger = {
  info(event, fields = {}) {
    console.info(JSON.stringify({ level: 'info', event, ...fields }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ level: 'error', event, ...fields }));
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInvocation(value: unknown): {
  mode: 'health' | 'process';
  trigger: SchedulerTrigger;
} {
  if (!isRecord(value) || (value.mode !== 'health' && value.mode !== 'process')) {
    throw new Error('invalid_request');
  }

  if (value.mode === 'health') return { mode: 'health', trigger: 'manual_recovery' };
  if (value.trigger !== 'cron' && value.trigger !== 'manual_recovery') {
    throw new Error('invalid_request');
  }
  return { mode: 'process', trigger: value.trigger };
}

export function createHandler(
  dependencies: HandlerDependencies = {},
): (request: Request) => Promise<Response> {
  const env: EnvironmentReader = dependencies.env ?? { get: (name) => Deno.env.get(name) };
  const logger = dependencies.logger ?? consoleLogger;

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    }

    let baseConfig;
    try {
      baseConfig = readBaseRuntimeConfig(env);
    } catch {
      logger.error('scheduler_configuration_invalid');
      return jsonResponse({ error: 'service_unavailable' }, 503);
    }

    if (
      !constantTimeSecretEqual(
        request.headers.get('x-scheduler-secret'),
        baseConfig.schedulerSecret,
      )
    ) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    let invocation;
    try {
      invocation = parseInvocation(await readBoundedJson(request));
    } catch {
      return jsonResponse({ error: 'invalid_request' }, 400);
    }

    const database =
      dependencies.database ??
      new PostgrestRpcDatabase({
        supabaseUrl: baseConfig.supabaseUrl,
        serviceRoleKey: baseConfig.serviceRoleKey,
      });

    if (invocation.mode === 'health') {
      try {
        const health = await database.systemHealth();
        return jsonResponse({ ok: health.database_ready, mode: 'health', database: health });
      } catch {
        logger.error('scheduler_health_failed');
        return jsonResponse({ error: 'service_unavailable' }, 503);
      }
    }

    try {
      const processingConfig = readProcessingRuntimeConfig(env);
      const transport =
        dependencies.transport ??
        (processingConfig.mailTransport === 'fake'
          ? new FakeMailTransport(processingConfig.fakeOutcome)
          : new ResendTransport({
              apiKey: processingConfig.resendApiKey!,
              timeoutMs: processingConfig.resendTimeoutMs,
            }));
      const result = await processNotifications(
        database,
        transport,
        processingConfig,
        invocation.trigger,
        logger,
      );
      return jsonResponse({ ok: true, mode: 'process', ...result });
    } catch {
      return jsonResponse({ error: 'processing_failed' }, 500);
    }
  };
}
